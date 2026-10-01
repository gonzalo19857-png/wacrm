"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  KeyboardEvent,
} from "react";
import {
  Send,
  LayoutTemplate,
  Paperclip,
  Image as ImageIcon,
  Video,
  FileText,
  Mic,
  Square,
  X,
  Loader2,
  Sparkles,
  Plus,
  MessageSquareDashed,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCan } from "@/hooks/use-can";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from "@/lib/storage/upload-media";
import { ReplyQuote } from "./reply-quote";
import { EmojiPicker } from "./emoji-picker";
import { useTranslations } from "next-intl";
import {
  InteractiveBuilder,
  blankButtonsPayload,
} from "@/components/interactive/interactive-builder";
import { validateInteractivePayload } from "@/lib/whatsapp/interactive";
import type { InteractiveMessagePayload, QuickReply } from "@/types";
import { QuickReplyPicker } from "./quick-reply-picker";
import { SlashQuickReplyMenu } from "./slash-quick-reply-menu";

/**
 * Matches only when "/" is the very first character of the whole draft
 * and nothing after it is whitespace yet — same trigger WhatsApp
 * Business uses. Typing a space (or anything before the "/") closes the
 * shortcut menu instead of keeping it open.
 */
const SLASH_TRIGGER = /^\/(\S*)$/;

/** Media content types an agent can send from the composer. */
export type ComposerMediaKind = "image" | "video" | "document" | "audio";

/** Pulls every pasted image out of a clipboard event. Shared by the
 *  textarea's paste handler and the draft preview's caption-input paste
 *  handler, since staging a batch swaps which of those two is on screen. */
function extractPastedImages(e: React.ClipboardEvent): File[] {
  const items = e.clipboardData?.items;
  if (!items) return [];
  const files: File[] = [];
  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

/** Supabase Storage bucket holding agent-sent chat attachments (migration 023). */
export const CHAT_MEDIA_BUCKET = "chat-media";

/** Meta caps media captions at 1024 chars. Enforced here and in the send route. */
export const MEDIA_CAPTION_MAX = 1024;

/** Hard cap on a single voice recording so it can't blow the upload/
 *  transcode limits — auto-stops the recorder when reached. */
const MAX_RECORDING_SECONDS = 5 * 60;

export interface SendMediaPayload {
  kind: ComposerMediaKind;
  /** Public chat-media URL Meta fetches at send time. */
  mediaUrl: string;
  /** Storage object path — lets the caller GC the object if the send fails. */
  path: string;
  /** Optional caption (image/video/document only). */
  caption?: string;
  /** Original file name — surfaced to the recipient for documents. */
  filename?: string;
  replyToId?: string;
}

interface ReplyDraft {
  /** Internal UUID of the message being replied to — sent back through onSend. */
  id: string;
  authorLabel: string;
  preview: string;
}

// Mirrors the chat-media bucket's allowed_mime_types (migration 023) for
// the file picker so unsupported files are rejected before upload rather
// than failing with a confusing Storage error. Audio has no picker — it's
// captured via the recorder.
const PICKER_ACCEPT: Record<"image" | "video" | "document", string> = {
  image: "image/png,image/jpeg,image/webp",
  video: "video/mp4,video/3gpp",
  document:
    "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain",
};

interface MediaDraft {
  kind: ComposerMediaKind;
  mediaUrl: string;
  /** Storage path — used to GC the object if the draft is discarded. */
  path: string;
  filename: string;
}

interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  /**
   * True when the contact has no phone number on file — Meta's Cloud API
   * requires one to address any outbound send, template or otherwise, so
   * there's no "restart via template" escape hatch here the way there is
   * for `sessionExpired`. The fix has to happen in the contact panel
   * (add the number), not in this composer.
   */
  noPhone?: boolean;
  onSend: (text: string, replyToId?: string) => void;
  // May be async — the composer awaits it so several staged attachments
  // are sent one at a time instead of racing (the caller mints each
  // optimistic bubble's id from Date.now(), which needs the gap).
  onSendMedia: (payload: SendMediaPayload) => void | Promise<void>;
  onSendInteractive: (payload: InteractiveMessagePayload, replyToId?: string) => void;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Worker that encodes mic input to Ogg/Opus entirely in the browser
 *  (vendored from opus-recorder into /public). Recording client-side in a
 *  Meta-accepted format means no server ffmpeg / transcode step. */
const OPUS_ENCODER_PATH = "/opus/encoderWorker.min.js";

export function MessageComposer({
  conversationId,
  sessionExpired,
  noPhone = false,
  onSend,
  onSendMedia,
  onSendInteractive,
  onOpenTemplates,
  replyTo,
  onClearReply,
}: MessageComposerProps) {
  const t = useTranslations("Inbox.composer");

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Mirror of `text` for stageFiles below, which carries the draft over to
  // the attachment caption only after its upload resolves. Reading the
  // closed-over `text` param at that point would snapshot whatever was
  // typed at paste-time and silently drop anything typed while the upload
  // was still in flight — the ref always has the latest value instead.
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  }, [text]);
  // Populated once `openInteractiveBuilder` is defined below (see the
  // effect next to it) — lets the slash-menu handler above call it
  // without a declaration-order problem in this component body.
  const openInteractiveBuilderRef = useRef<(seed?: InteractiveMessagePayload) => void>(
    () => {},
  );

  // Interactive-message builder dialog + quick-reply picker.
  const [interactiveOpen, setInteractiveOpen] = useState(false);
  const [interactivePayload, setInteractivePayload] =
    useState<InteractiveMessagePayload>(blankButtonsPayload);
  const [savingQuickReply, setSavingQuickReply] = useState(false);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);

  // Shared quick-reply list — fetched once here so both the "+" picker
  // dialog and the slash-command menu below read from the same data
  // instead of each fetching independently.
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [quickRepliesLoading, setQuickRepliesLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setQuickRepliesLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/quick-replies", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setQuickReplies((data.quick_replies as QuickReply[]) ?? []);
        }
      } finally {
        if (!cancelled) setQuickRepliesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Slash-command shortcut menu (WhatsApp-Business style). `slashQuery`
  // is `null` when closed, or the text typed after "/" when open —
  // see `SLASH_TRIGGER` above for exactly when that is.
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const slashMatches = useMemo(() => {
    if (slashQuery === null) return [];
    const q = slashQuery.toLowerCase();
    return quickReplies.filter((qr) => qr.title.toLowerCase().includes(q));
  }, [quickReplies, slashQuery]);
  const slashMenuOpen = slashQuery !== null && slashMatches.length > 0;

  // Media attachment state. `drafts` holds any uploaded-but-not-yet-sent
  // attachments (pasting or attaching more than one queues them here
  // instead of replacing); `draftCaption` is the single caption shared
  // across the batch, applied to the last non-audio item on send.
  // `busy` covers the upload/transcode window.
  const [drafts, setDrafts] = useState<MediaDraft[]>([]);
  const [draftCaption, setDraftCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  // Mirror of `drafts` for the unmount cleanup, which can't read render
  // state. Kept in sync below so navigating away with staged-but-unsent
  // attachments GCs the orphaned objects.
  const draftsRef = useRef<MediaDraft[]>([]);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  // Best-effort GC of a staged object the user never sent. Fire-and-forget.
  const removeStaged = useCallback((path: string | undefined) => {
    if (!path) return;
    void deleteAccountMedia(CHAT_MEDIA_BUCKET, path).catch(() => {});
  }, []);

  // Voice recording state. The recorder encodes Ogg/Opus in-browser
  // (opus-recorder) so there's no server-side transcode.
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef<import("opus-recorder").default | null>(null);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Viewers (read-only role) can browse the inbox but never send.
  // For solo users this is always true — single-owner accounts pass
  // every capability — so the disabled branch is a no-op there.
  const canSend = useCan("send-messages");
  const readOnly = !canSend;
  // Media (like free-form text) is only allowed inside the 24h window.
  // `noPhone` blocks everything — unlike an expired session, there's no
  // template-based restart that can address a send with no number.
  const inputsDisabled = readOnly || sessionExpired || noPhone;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Tear down any live recording + timer on unmount so a mid-record
  // navigation doesn't leak the mic, and GC any staged-but-unsent
  // attachments so they don't orphan in the bucket.
  useEffect(() => {
    return () => {
      clearTimer();
      cancelledRef.current = true;
      // stop() releases the mic stream + audio context inside opus-recorder.
      void recorderRef.current?.stop().catch(() => {});
      draftsRef.current.forEach((d) => removeStaged(d.path));
    };
  }, [clearTimer, removeStaged]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // Max 4 lines (~96px)
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || sessionExpired || noPhone) return;

    setSending(true);
    try {
      onSend(trimmed, replyTo?.id);
      setText("");
      setSlashQuery(null);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } finally {
      setSending(false);
    }
  }, [text, sending, sessionExpired, noPhone, onSend, replyTo?.id]);

  // A picked quick reply (from either entry point) replaces or fills the
  // composer text; interactive snippets open the builder pre-filled.
  // Declared before handleKeyDown/handleChange since both call it.
  const handlePickSlashQuickReply = useCallback(
    (qr: QuickReply) => {
      setSlashQuery(null);
      if (qr.kind === "interactive" && qr.interactive_payload) {
        setText("");
        openInteractiveBuilderRef.current(qr.interactive_payload);
        return;
      }
      if (qr.image_url) {
        // Stage it exactly like a freshly-uploaded attachment (same
        // preview/caption/send UI) — `path: ""` is deliberate: it's a
        // reusable library asset in the `product-images` bucket, not an
        // ephemeral chat-media upload, so discard/unmount/send-failure
        // must never try to GC it (removeStaged/deleteAccountMedia both
        // no-op on an empty path). Picking one replaces any staged batch —
        // it's a deliberate "send this instead" action, not an addition.
        draftsRef.current.forEach((d) => removeStaged(d.path));
        setDrafts([{ kind: "image", mediaUrl: qr.image_url, path: "", filename: qr.title }]);
        setDraftCaption(qr.content_text ?? "");
        setText("");
        return;
      }
      const body = qr.content_text ?? "";
      setText(body);
      requestAnimationFrame(() => {
        adjustHeight();
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    },
    [adjustHeight, removeStaged],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (slashMenuOpen) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashActiveIndex((i) => (i + 1) % slashMatches.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashActiveIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          handlePickSlashQuickReply(slashMatches[slashActiveIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlashQuery(null);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [slashMenuOpen, slashMatches, slashActiveIndex, handlePickSlashQuickReply, handleSend]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setText(value);
      adjustHeight();
      const match = SLASH_TRIGGER.exec(value);
      if (match) {
        setSlashQuery(match[1]);
        setSlashActiveIndex(0);
      } else {
        setSlashQuery(null);
      }
    },
    [adjustHeight]
  );

  // Inserts at the caret (not just appended) so picking an emoji mid-edit
  // lands where the agent was actually typing. `emoji.length` is safe here
  // even for multi-code-unit emoji (flags, ZWJ sequences, variation
  // selectors) since JS string indices and textarea selection offsets both
  // count UTF-16 code units.
  const handleInsertEmoji = useCallback(
    (emoji: string) => {
      const el = textareaRef.current;
      const start = el?.selectionStart ?? text.length;
      const end = el?.selectionEnd ?? text.length;
      setText((prev) => prev.slice(0, start) + emoji + prev.slice(end));
      setSlashQuery(null);
      requestAnimationFrame(() => {
        adjustHeight();
        if (!el) return;
        el.focus();
        const pos = start + emoji.length;
        el.setSelectionRange(pos, pos);
      });
    },
    [text, adjustHeight]
  );

  // Ask the AI assistant for a suggested reply and drop it into the
  // composer for the agent to edit + send. Read-only server-side —
  // nothing is sent until the agent hits Send.
  const handleDraft = useCallback(async () => {
    if (drafting) return;
    setDrafting(true);
    try {
      const res = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "ai_not_configured") {
          toast.error("AI isn't set up yet — enable it in Settings → AI Assistant.");
        } else {
          toast.error(data.error ?? "Couldn't draft a reply.");
        }
        return;
      }
      const draftText = typeof data.draft === "string" ? data.draft.trim() : "";
      if (!draftText) {
        toast.error("The assistant didn't return a reply.");
        return;
      }
      setText(draftText);
      setSlashQuery(null);
      // Let the textarea grow to fit and drop the cursor at the end so
      // the agent can tweak immediately.
      requestAnimationFrame(() => {
        adjustHeight();
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    } catch {
      toast.error("Couldn't reach the AI assistant.");
    } finally {
      setDrafting(false);
    }
  }, [drafting, conversationId, adjustHeight]);

  // ---- Interactive message + quick replies --------------------------

  const openInteractiveBuilder = useCallback(
    (seed?: InteractiveMessagePayload) => {
      setInteractivePayload(seed ?? blankButtonsPayload());
      setInteractiveOpen(true);
    },
    [],
  );
  useEffect(() => {
    openInteractiveBuilderRef.current = openInteractiveBuilder;
  }, [openInteractiveBuilder]);

  const sendInteractive = useCallback(() => {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    onSendInteractive(interactivePayload, replyTo?.id);
    setInteractiveOpen(false);
    onClearReply?.();
  }, [interactivePayload, onSendInteractive, replyTo?.id, onClearReply]);

  // Persist the current builder payload as a reusable interactive snippet.
  const saveAsQuickReply = useCallback(async () => {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const title = window
      .prompt(t("quickReplyNamePrompt"))
      ?.trim();
    if (!title) return;
    setSavingQuickReply(true);
    try {
      const res = await fetch("/api/quick-replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          kind: "interactive",
          interactive_payload: interactivePayload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t("quickReplySaveError"));
        return;
      }
      // Reflect it immediately in the shared list — otherwise it'd only
      // show up in the slash menu / "+" picker after a composer remount.
      if (data.quick_reply) {
        setQuickReplies((prev) => [data.quick_reply as QuickReply, ...prev]);
      }
      toast.success(t("quickReplySaved"));
    } catch {
      toast.error(t("quickReplySaveError"));
    } finally {
      setSavingQuickReply(false);
    }
  }, [interactivePayload, t]);

  // A picked quick reply: text fills the composer; interactive opens the
  // builder pre-filled so the agent can tweak before sending.
  const handlePickQuickReply = useCallback(
    (qr: QuickReply) => {
      setQuickReplyOpen(false);
      setSlashQuery(null);
      if (qr.kind === "interactive" && qr.interactive_payload) {
        openInteractiveBuilder(qr.interactive_payload);
        return;
      }
      if (qr.image_url) {
        // Same reasoning as the slash-menu path above: reusable library
        // asset, `path: ""` so it's never mistaken for an ephemeral
        // chat-media upload and GC'd. Replaces any staged batch.
        draftsRef.current.forEach((d) => removeStaged(d.path));
        setDrafts([{ kind: "image", mediaUrl: qr.image_url, path: "", filename: qr.title }]);
        setDraftCaption(qr.content_text ?? "");
        return;
      }
      const body = qr.content_text ?? "";
      // Separate the snippet from any existing draft with a newline so the
      // words don't run together ("Thanks" + "we'll…" → "Thankswe'll…").
      setText((prev) =>
        prev && !/\s$/.test(prev) ? `${prev}\n${body}` : `${prev}${body}`,
      );
      requestAnimationFrame(() => {
        adjustHeight();
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    },
    [openInteractiveBuilder, adjustHeight, removeStaged],
  );

  // Upload one or more captured files to chat-media and queue them as
  // drafts. Appends to any already-staged batch instead of replacing it,
  // so pasting/attaching several images in a row stages all of them.
  const stageFiles = useCallback(
    async (kind: ComposerMediaKind, files: File[]) => {
      // Per-kind ceiling mirrors Meta's caps (image 5 MB, etc.) so we
      // reject before upload rather than orphaning an object that Meta
      // would then refuse at send.
      const max = MEDIA_MAX_BYTES_BY_KIND[kind];
      const valid = files.filter((file) => {
        if (file.size > max) {
          toast.error(
            `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — ${kind} limit is ${Math.round(
              max / 1024 / 1024,
            )} MB.`,
          );
          return false;
        }
        return true;
      });
      if (valid.length === 0) return;
      setBusy(true);
      try {
        const uploaded = await Promise.all(
          valid.map((file) => uploadAccountMedia(CHAT_MEDIA_BUCKET, file)),
        );
        const newDrafts: MediaDraft[] = uploaded.map(({ publicUrl, path }, i) => ({
          kind,
          mediaUrl: publicUrl,
          path,
          filename: valid[i].name,
        }));
        // Starting a new batch with text already typed? Carry it over as
        // the shared caption instead of just hiding it behind the
        // attachment preview (that text would otherwise never get sent).
        // Reads the ref (not the `text` param) so anything typed while the
        // upload above was still in flight is included, not dropped.
        if (draftsRef.current.length === 0 && textRef.current.trim()) {
          setDraftCaption(textRef.current.trim());
          setText("");
        }
        setDrafts((prev) => [...prev, ...newDrafts]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const handlePicked = useCallback(
    (kind: "image" | "video" | "document", fileList: FileList | null) => {
      if (fileList && fileList.length > 0) void stageFiles(kind, Array.from(fileList));
    },
    [stageFiles],
  );

  // Dropping files from the OS (e.g. selecting several in Explorer/Finder
  // and dragging them in) stages the whole batch in one go — the same
  // pain point as the video/document picker being one-at-a-time, but for
  // agents who'd rather drag than click through the attach menu. Files are
  // grouped by kind since each staged item still needs its own kind tag.
  const [dragOver, setDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const classifyDroppedFile = useCallback((file: File): ComposerMediaKind => {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("audio/")) return "audio";
    return "document";
  }, []);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (inputsDisabled || busy) return;
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      dragCounterRef.current += 1;
      setDragOver(true);
    },
    [inputsDisabled, busy],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (inputsDisabled || busy) return;
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
    },
    [inputsDisabled, busy],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      dragCounterRef.current = 0;
      setDragOver(false);
      if (inputsDisabled || busy) return;
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      const byKind = new Map<ComposerMediaKind, File[]>();
      for (const file of files) {
        const kind = classifyDroppedFile(file);
        byKind.set(kind, [...(byKind.get(kind) ?? []), file]);
      }
      for (const [kind, kindFiles] of byKind) {
        void stageFiles(kind, kindFiles);
      }
    },
    [inputsDisabled, busy, classifyDroppedFile, stageFiles],
  );

  // Pasting a screenshot or copied image (Ctrl+V) stages it exactly like
  // the attach-menu picker, instead of forcing agents through the file
  // dialog for something a normal WhatsApp client handles natively.
  // Doesn't bail when a batch is already staged — pasting again queues
  // more images instead of being silently ignored. Doesn't bail on `busy`
  // either: stageFiles appends via a functional update, so a paste fired
  // while an earlier one is still uploading safely queues too, instead of
  // being dropped with no feedback (which is what made back-to-back pastes
  // look like "only one image at a time" worked).
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (inputsDisabled) return;
      const files = extractPastedImages(e);
      if (files.length === 0) return;
      e.preventDefault();
      void stageFiles("image", files);
    },
    [inputsDisabled, stageFiles],
  );

  // Once a batch is staged the textarea unmounts (the draft preview takes
  // its place), so a second Ctrl+V has nothing to land on unless the
  // preview's own caption input also accepts pasted images.
  const handleCaptionPaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      if (inputsDisabled) return;
      const files = extractPastedImages(e);
      if (files.length === 0) return;
      e.preventDefault();
      void stageFiles("image", files);
    },
    [inputsDisabled, stageFiles],
  );

  // ---- Voice recording (client-side Ogg/Opus, no server transcode) ---

  // The encoded Ogg/Opus file from opus-recorder → upload as an audio
  // draft. WhatsApp renders Ogg/Opus as a playable voice note.
  const finalizeRecording = useCallback(
    async (bytes: Uint8Array) => {
      // Uint8Array is a valid BlobPart at runtime; the cast sidesteps the
      // lib.dom ArrayBufferLike-vs-ArrayBuffer generic mismatch.
      const file = new File([bytes as unknown as BlobPart], `voice-${Date.now()}.ogg`, {
        type: "audio/ogg",
      });
      if (file.size === 0) return; // cancelled / empty take
      if (file.size > MEDIA_MAX_BYTES_BY_KIND.audio) {
        toast.error("Recording is too long (over 16 MB).");
        return;
      }
      setBusy(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
        setDrafts((prev) => [...prev, { kind: "audio", mediaUrl: publicUrl, path, filename: file.name }]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const startRecording = useCallback(async () => {
    if (inputsDisabled || busy || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      toast.error("Voice recording isn't supported in this browser.");
      return;
    }
    try {
      // Lazy-load the encoder (≈400 KB worker) only when the user records,
      // keeping it out of the main bundle.
      const { default: Recorder } = await import("opus-recorder");
      const recorder = new Recorder({
        encoderPath: OPUS_ENCODER_PATH,
        numberOfChannels: 1,
        encoderApplication: 2048, // VOIP — tuned for speech
        encoderSampleRate: 48000,
        streamPages: false, // one callback with the complete file on stop
      });
      cancelledRef.current = false;
      recorder.ondataavailable = (bytes) => {
        if (cancelledRef.current) return;
        void finalizeRecording(bytes);
      };
      recorderRef.current = recorder;
      await recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      void recorderRef.current?.stop().catch(() => {});
      recorderRef.current = null;
      toast.error("Microphone access denied or unavailable.");
    }
  }, [inputsDisabled, busy, recording, finalizeRecording]);

  const stopRecording = useCallback(() => {
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  // Auto-stop at the cap so a forgotten recording can't blow the
  // upload size limit.
  useEffect(() => {
    if (recording && recordSeconds >= MAX_RECORDING_SECONDS) {
      stopRecording();
    }
  }, [recording, recordSeconds, stopRecording]);

  // ---- Draft send / discard -----------------------------------------

  // WhatsApp has no multi-image "album" message — each staged file goes
  // out as its own send. The shared caption rides on the last non-audio
  // one (matches how a WhatsApp client itself shows a caption typed under
  // several selected photos), and the reply-to context only on the first
  // so the quoted bubble doesn't repeat down the batch.
  const sendDrafts = useCallback(async () => {
    if (drafts.length === 0 || busy) return;
    const toSend = drafts;
    const caption = draftCaption.trim();
    const replyToId = replyTo?.id;
    // Clear immediately — sends continue in the background below — so the
    // composer is ready for the next message right away.
    setDrafts([]);
    setDraftCaption("");
    onClearReply?.();
    for (let i = 0; i < toSend.length; i++) {
      const d = toSend[i];
      // The last non-audio item still ahead in the queue gets the caption.
      const isLastSendable =
        d.kind !== "audio" && !toSend.slice(i + 1).some((rest) => rest.kind !== "audio");
      await onSendMedia({
        kind: d.kind,
        mediaUrl: d.mediaUrl,
        path: d.path,
        caption: isLastSendable ? caption || undefined : undefined,
        filename: d.kind === "document" ? d.filename : undefined,
        replyToId: i === 0 ? replyToId : undefined,
      });
    }
  }, [drafts, busy, draftCaption, onSendMedia, replyTo?.id, onClearReply]);

  // Discard one staged file (GCs it — it was uploaded but never sent).
  const discardDraftAt = useCallback(
    (index: number) => {
      setDrafts((prev) => {
        removeStaged(prev[index]?.path);
        return prev.filter((_, i) => i !== index);
      });
    },
    [removeStaged],
  );

  // Discard the whole staged batch.
  const discardAllDrafts = useCallback(() => {
    draftsRef.current.forEach((d) => removeStaged(d.path));
    setDrafts([]);
    setDraftCaption("");
  }, [removeStaged]);

  // ---- Render --------------------------------------------------------

  return (
    <div
      className="relative border-t border-border bg-card p-3"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/90">
          <p className="text-sm font-medium text-primary">{t("dropFilesHint")}</p>
        </div>
      )}
      {replyTo && (
        <div className="mb-2">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        </div>
      )}
      {noPhone ? (
        <div className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-400">{t("noPhoneHint")}</p>
        </div>
      ) : (
        sessionExpired && (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2">
            <p className="text-xs text-amber-400">
              {t("sessionExpiredHint")}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-amber-400 hover:text-amber-300"
              onClick={onOpenTemplates}
            >
              <LayoutTemplate className="mr-1 h-3 w-3" />
              {t("templates")}
            </Button>
          </div>
        )
      )}

      {/* Hidden file inputs driven by the attach menu — all three allow
          selecting several files at once. */}
      <input
        ref={imageInputRef}
        type="file"
        accept={PICKER_ACCEPT.image}
        multiple
        className="hidden"
        onChange={(e) => {
          handlePicked("image", e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept={PICKER_ACCEPT.video}
        multiple
        className="hidden"
        onChange={(e) => {
          handlePicked("video", e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={documentInputRef}
        type="file"
        accept={PICKER_ACCEPT.document}
        multiple
        className="hidden"
        onChange={(e) => {
          handlePicked("document", e.target.files);
          e.target.value = "";
        }}
      />

      {drafts.length > 0 ? (
        <MediaDraftPreview
          drafts={drafts}
          caption={draftCaption}
          busy={busy}
          readOnly={readOnly}
          onCaptionChange={setDraftCaption}
          onCaptionPaste={handleCaptionPaste}
          onRemove={discardDraftAt}
          onDiscardAll={discardAllDrafts}
          onSend={sendDrafts}
          t={t}
        />
      ) : recording ? (
        // Recording bar — replaces the composer while the mic is live.
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted px-4 py-2.5">
          <span className="flex h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
          <span className="flex-1 text-sm text-foreground">
            {t("recording", { current: formatDuration(recordSeconds), max: formatDuration(MAX_RECORDING_SECONDS) })}
          </span>
          <button
            type="button"
            onClick={cancelRecording}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-card hover:text-foreground"
          >
            {t("cancel")}
          </button>
          <Button
            size="sm"
            onClick={stopRecording}
            className="h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90"
            title={t("stopAndAttach")}
          >
            <Square className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          {/* Attach menu — photo / video / document / voice. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={inputsDisabled || busy}
              title={
                readOnly
                  ? t("readOnlyTitle")
                  : inputsDisabled
                    ? undefined
                    : t("attachMedia")
              }
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="border-border bg-popover">
              <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                <ImageIcon className="mr-2 h-4 w-4" />
                {t("photo")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => videoInputRef.current?.click()}>
                <Video className="mr-2 h-4 w-4" />
                {t("video")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => documentInputRef.current?.click()}>
                <FileText className="mr-2 h-4 w-4" />
                {t("document")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void startRecording()}>
                <Mic className="mr-2 h-4 w-4" />
                {t("voiceNote")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* + menu — interactive messages + quick replies. Gated on the
              24h window like free-form text (interactive requires it). */}
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={inputsDisabled}
              title={
                readOnly
                  ? t("readOnlyTitle")
                  : inputsDisabled
                    ? undefined
                    : t("moreActions")
              }
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="border-border bg-popover">
              <DropdownMenuItem onClick={() => openInteractiveBuilder()}>
                <MessageSquareDashed className="mr-2 h-4 w-4" />
                {t("interactiveMessage")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setQuickReplyOpen(true)}>
                <Zap className="mr-2 h-4 w-4" />
                {t("quickReplies")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <GatedButton
            variant="ghost"
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            title={readOnly ? undefined : t("sendTemplate")}
            className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground"
            onClick={onOpenTemplates}
          >
            <LayoutTemplate className="h-4 w-4" />
          </GatedButton>

          <GatedButton
            variant="ghost"
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            disabled={drafting}
            title={readOnly ? undefined : t("draftWithAI")}
            className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-primary"
            onClick={handleDraft}
          >
            {drafting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </GatedButton>

          <EmojiPicker
            onPick={handleInsertEmoji}
            disabled={inputsDisabled}
            title={
              readOnly
                ? t("readOnlyTitle")
                : inputsDisabled
                  ? undefined
                  : t("addEmoji")
            }
          />

          <div className="relative flex-1">
            {slashMenuOpen && (
              <SlashQuickReplyMenu
                items={slashMatches}
                activeIndex={slashActiveIndex}
                onHover={setSlashActiveIndex}
                onPick={handlePickSlashQuickReply}
              />
            )}
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                readOnly
                  ? t("readOnlyPlaceholder")
                  : noPhone
                    ? t("noPhonePlaceholder")
                    : sessionExpired
                      ? t("sessionExpiredPlaceholder")
                      : t("typeMessagePlaceholder")
              }
              disabled={sessionExpired || readOnly || noPhone}
              rows={1}
              // Textarea keeps its own inline title — the GatedButton
              // wrapping pattern doesn't apply to non-button inputs.
              // The placeholder text also surfaces the read-only state.
              title={readOnly ? t("readOnlyTitle") : undefined}
              className={cn(
                "w-full resize-none rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50",
                (sessionExpired || readOnly || noPhone) && "cursor-not-allowed opacity-50"
              )}
            />
          </div>

          <GatedButton
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            disabled={!text.trim() || sessionExpired || noPhone || sending}
            onClick={handleSend}
            className="h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </GatedButton>
        </div>
      )}

      {/* Hint sits outside the flex row so its height doesn't push
          `items-end` buttons below the textarea. Indented to line up
          under the textarea left edge. */}
      {drafts.length === 0 && !recording && (
        <p className="mt-1 pl-[8.25rem] text-[10px] text-muted-foreground">
          {t("draftHint")}
        </p>
      )}

      {/* Interactive-message builder dialog. */}
      <Dialog open={interactiveOpen} onOpenChange={setInteractiveOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("interactiveMessage")}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto">
            <InteractiveBuilder
              value={interactivePayload}
              onChange={setInteractivePayload}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={savingQuickReply}
              onClick={saveAsQuickReply}
            >
              {savingQuickReply ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="mr-1 h-4 w-4" />
              )}
              {t("saveAsQuickReply")}
            </Button>
            <Button onClick={sendInteractive}>
              <Send className="mr-1 h-4 w-4" />
              {t("send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick-reply picker. */}
      <QuickReplyPicker
        open={quickReplyOpen}
        onOpenChange={setQuickReplyOpen}
        onPick={handlePickQuickReply}
        items={quickReplies}
        loading={quickRepliesLoading}
      />
    </div>
  );
}

/**
 * Staged-attachment(s) preview with one shared caption + send/discard.
 * Declared at module scope (not nested in MessageComposer) so React keeps
 * it mounted across the parent's re-renders — a nested component would
 * remount the caption input on every keystroke and drop focus.
 */
function MediaDraftPreview({
  drafts,
  caption,
  busy,
  readOnly,
  onCaptionChange,
  onCaptionPaste,
  onRemove,
  onDiscardAll,
  onSend,
  t,
}: {
  drafts: MediaDraft[];
  caption: string;
  busy: boolean;
  readOnly: boolean;
  onCaptionChange: (caption: string) => void;
  onCaptionPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  onRemove: (index: number) => void;
  onDiscardAll: () => void;
  onSend: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const single = drafts.length === 1 ? drafts[0] : null;
  // Audio never takes a caption (Meta rejects it) — hide the input only
  // when the whole batch is audio, since the caption would have nowhere
  // to land.
  const showCaption = drafts.some((d) => d.kind !== "audio");

  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {single ? (
            <MediaDraftThumb draft={single} large />
          ) : (
            <div className="flex flex-wrap gap-2">
              {drafts.map((d, i) => (
                <div key={d.path || `${d.mediaUrl}-${i}`} className="relative">
                  <MediaDraftThumb draft={d} />
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    aria-label={t("removeAttachment")}
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-background p-0.5 text-muted-foreground shadow hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDiscardAll}
          aria-label={t("removeAttachment")}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 flex items-end gap-2">
        {showCaption && (
          <input
            value={caption}
            maxLength={MEDIA_CAPTION_MAX}
            onChange={(e) => onCaptionChange(e.target.value)}
            onPaste={onCaptionPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder={t("addCaption")}
            // Autofocus (only fires on this component's mount, i.e. when a
            // batch first starts) so a follow-up Ctrl+V for another image
            // has somewhere to land without an extra click.
            autoFocus
            className="flex-1 rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50"
          />
        )}
        <GatedButton
          size="sm"
          canAct={!readOnly}
          gateReason="send messages"
          disabled={busy}
          onClick={onSend}
          className={cn(
            "h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90 disabled:opacity-40",
            !showCaption && "ml-auto",
          )}
        >
          <Send className="h-4 w-4" />
        </GatedButton>
      </div>
    </div>
  );
}

/** One staged attachment's thumbnail — `large` renders the original
 *  single-attachment size, otherwise a small grid tile for a multi-file
 *  batch. */
function MediaDraftThumb({ draft, large = false }: { draft: MediaDraft; large?: boolean }) {
  if (draft.kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={draft.mediaUrl}
        alt={draft.filename}
        className={large ? "max-h-40 rounded-lg object-cover" : "h-20 w-20 rounded-lg object-cover"}
      />
    );
  }
  if (draft.kind === "video") {
    return (
      <video
        src={draft.mediaUrl}
        controls={large}
        className={large ? "max-h-40 rounded-lg" : "h-20 w-20 rounded-lg object-cover"}
      />
    );
  }
  if (draft.kind === "audio") {
    return <audio src={draft.mediaUrl} controls className={large ? "w-full" : "max-w-[200px]"} />;
  }
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-sm text-foreground",
        !large &&
          "h-20 w-20 flex-col justify-center rounded-lg bg-muted p-1 text-center text-[10px]",
      )}
    >
      <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
      <span className={large ? "truncate" : "line-clamp-2 break-all"}>{draft.filename}</span>
    </div>
  );
}
