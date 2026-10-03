"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare, Pencil, Plus, Trash2, Zap, ImagePlus, Video, X } from "lucide-react";
import { toast } from "sonner";

import { uploadLibraryMedia } from "@/lib/storage/upload-media";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsPanelHead } from "./settings-panel-head";
import {
  InteractiveBuilder,
  blankButtonsPayload,
} from "@/components/interactive/interactive-builder";
import {
  interactivePayloadPreviewText,
  type InteractiveMessagePayload,
} from "@/lib/whatsapp/interactive";
import type { QuickReply, QuickReplyKind } from "@/types";

type MediaKind = "image" | "video";

// Mirrors the chat-media composer's picker accept lists (migration 023) —
// same formats the account is already allowed to send.
const MEDIA_ACCEPT: Record<MediaKind, string> = {
  image: "image/png,image/jpeg,image/webp,image/gif",
  video: "video/mp4,video/3gpp,video/quicktime",
};

interface DraftState {
  id?: string;
  title: string;
  kind: QuickReplyKind;
  content_text: string;
  interactive_payload: InteractiveMessagePayload;
  /** Already-saved image URL, or null if none/removed. Mutually exclusive with `video_url`. */
  image_url: string | null;
  /** Already-saved video URL, or null if none/removed (migration 075). */
  video_url: string | null;
}

function emptyDraft(): DraftState {
  return {
    title: "",
    kind: "text",
    content_text: "",
    interactive_payload: blankButtonsPayload(),
    image_url: null,
    video_url: null,
  };
}

export function QuickRepliesManager() {
  const [items, setItems] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  // A picked-but-not-yet-uploaded photo/video, staged the same way
  // ProductManager stages one — uploaded to Storage only on Save, not
  // on pick, so cancelling the dialog never orphans an object.
  const [pendingMedia, setPendingMedia] = useState<{ file: File; kind: MediaKind } | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/quick-replies", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setItems((data.quick_replies as QuickReply[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setDraft(emptyDraft());
    setPendingMedia(null);
    setMediaPreview(null);
  };
  const openEdit = (qr: QuickReply) => {
    setDraft({
      id: qr.id,
      title: qr.title,
      kind: qr.kind,
      content_text: qr.content_text ?? "",
      interactive_payload:
        qr.interactive_payload ?? blankButtonsPayload(),
      image_url: qr.image_url ?? null,
      video_url: qr.video_url ?? null,
    });
    setPendingMedia(null);
    setMediaPreview(null);
  };

  const handleMediaPick = (kind: MediaKind, file: File | undefined) => {
    if (!file) return;
    setPendingMedia({ file, kind });
    setMediaPreview(URL.createObjectURL(file));
  };

  const removeMedia = () => {
    setPendingMedia(null);
    setMediaPreview(null);
    setDraft((d) => (d ? { ...d, image_url: null, video_url: null } : d));
  };

  const save = useCallback(async () => {
    if (!draft) return;
    if (!draft.title.trim()) {
      toast.error("Give the quick reply a name.");
      return;
    }

    setSaving(true);
    try {
      // Only a text quick reply can carry media — mirrors ProductManager's
      // own upload-then-save pattern: the file goes to Storage first
      // (product-images for a photo, product-media for a video —
      // migrations 068/075), then its public URL rides along in the same
      // JSON body the existing quick-reply API routes already accept.
      let imageUrl = draft.kind === "text" ? draft.image_url : null;
      let videoUrl = draft.kind === "text" ? draft.video_url : null;
      if (draft.kind === "text" && pendingMedia) {
        const bucket = pendingMedia.kind === "video" ? "product-media" : "product-images";
        const { publicUrl } = await uploadLibraryMedia(bucket, pendingMedia.file, pendingMedia.file.name);
        if (pendingMedia.kind === "video") {
          videoUrl = publicUrl;
          imageUrl = null;
        } else {
          imageUrl = publicUrl;
          videoUrl = null;
        }
      }

      const payload =
        draft.kind === "interactive"
          ? { title: draft.title, kind: "interactive", interactive_payload: draft.interactive_payload }
          : {
              title: draft.title,
              kind: "text",
              content_text: draft.content_text,
              image_url: imageUrl,
              video_url: videoUrl,
            };

      const res = await fetch(
        draft.id ? `/api/quick-replies/${draft.id}` : "/api/quick-replies",
        {
          method: draft.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't save the quick reply.");
        return;
      }
      toast.success(draft.id ? "Quick reply updated." : "Quick reply created.");
      setDraft(null);
      setPendingMedia(null);
      setMediaPreview(null);
      await load();
    } catch (err) {
      console.error("Failed to save quick reply:", err);
      toast.error("Couldn't save the quick reply.");
    } finally {
      setSaving(false);
    }
  }, [draft, load, pendingMedia]);

  const remove = useCallback(
    async (id: string) => {
      if (!window.confirm("Delete this quick reply?")) return;
      const res = await fetch(`/api/quick-replies/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Couldn't delete the quick reply.");
        return;
      }
      await load();
    },
    [load],
  );

  return (
    <div>
      <SettingsPanelHead
        title="Quick replies"
        description="Reusable snippets — plain text or a saved interactive message — that agents can insert from the inbox composer."
        action={
          <Button onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" />
            New quick reply
          </Button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          No quick replies yet. Create one to reuse it across conversations.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((qr) => (
            <li
              key={qr.id}
              className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
            >
              {qr.kind === "text" && qr.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qr.image_url}
                  alt=""
                  className="mt-0.5 size-8 shrink-0 rounded-md border border-border object-cover"
                />
              ) : qr.kind === "text" && qr.video_url ? (
                <video
                  src={qr.video_url}
                  className="mt-0.5 size-8 shrink-0 rounded-md border border-border object-cover"
                />
              ) : qr.kind === "interactive" ? (
                <Zap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              ) : (
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{qr.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {qr.kind === "interactive" && qr.interactive_payload
                    ? interactivePayloadPreviewText(qr.interactive_payload)
                    : qr.content_text}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="icon-sm" onClick={() => openEdit(qr)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(qr.id)}
                  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit quick reply" : "New quick reply"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="max-h-[70vh] space-y-3 overflow-y-auto">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Name</label>
                <Input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="e.g. Business hours"
                  className="bg-muted text-foreground"
                />
              </div>
              <div className="flex gap-2">
                <KindTab
                  active={draft.kind === "text"}
                  label="Text"
                  onClick={() => setDraft({ ...draft, kind: "text" })}
                />
                <KindTab
                  active={draft.kind === "interactive"}
                  label="Interactive"
                  onClick={() => setDraft({ ...draft, kind: "interactive" })}
                />
              </div>
              {draft.kind === "text" ? (
                <>
                  <Textarea
                    value={draft.content_text}
                    onChange={(e) => setDraft({ ...draft, content_text: e.target.value })}
                    placeholder="The message text to insert"
                    className="min-h-28 bg-muted text-foreground"
                  />
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">
                      Photo or video (optional)
                    </label>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept={MEDIA_ACCEPT.image}
                      className="hidden"
                      onChange={(e) => {
                        handleMediaPick("image", e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                    <input
                      ref={videoInputRef}
                      type="file"
                      accept={MEDIA_ACCEPT.video}
                      className="hidden"
                      onChange={(e) => {
                        handleMediaPick("video", e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                    {mediaPreview || draft.image_url || draft.video_url ? (
                      <div className="flex items-center gap-2">
                        {(pendingMedia?.kind ?? (draft.video_url ? "video" : "image")) === "video" ? (
                          <video
                            src={mediaPreview ?? draft.video_url ?? undefined}
                            controls
                            className="size-16 rounded-md border border-border object-cover"
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={mediaPreview ?? draft.image_url ?? undefined}
                            alt=""
                            className="size-16 rounded-md border border-border object-cover"
                          />
                        )}
                        <Button type="button" variant="outline" size="sm" onClick={removeMedia}>
                          <X className="mr-1 h-3.5 w-3.5" />
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => imageInputRef.current?.click()}
                        >
                          <ImagePlus className="mr-1 h-3.5 w-3.5" />
                          Add image
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => videoInputRef.current?.click()}
                        >
                          <Video className="mr-1 h-3.5 w-3.5" />
                          Add video
                        </Button>
                      </div>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Picking this quick reply from the inbox stages the photo/video (with this
                      text as the caption) instead of filling the message box.
                    </p>
                  </div>
                </>
              ) : (
                <InteractiveBuilder
                  value={draft.interactive_payload}
                  onChange={(p) => setDraft({ ...draft, interactive_payload: p })}
                />
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KindTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "flex-1 rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary"
          : "flex-1 rounded-md border border-border bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      }
    >
      {label}
    </button>
  );
}
