"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  normalizeConversations,
} from "@/lib/inbox/conversations";
import { avatarColorFor } from "@/lib/avatar-color";
import { cn } from "@/lib/utils";
import type { Conversation, Message } from "@/types";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Search, Loader2, Forward as ForwardIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { buildReplyPreview } from "./reply-quote";

interface ForwardMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: Message | null;
  /** The thread currently open — excluded from the picker, forwarding to
   * the same conversation a message already lives in isn't useful. */
  excludeConversationId?: string;
  onForward: (targetConversationId: string) => void;
}

/**
 * WhatsApp-style "forward to..." picker. Reuses the same conversation
 * list the inbox sidebar fetches (contact + last message) so agents
 * recognise the same rows they already know, just without the status/
 * unread chrome that doesn't matter for a one-off forward.
 */
export function ForwardMessageDialog({
  open,
  onOpenChange,
  message,
  excludeConversationId,
  onForward,
}: ForwardMessageDialogProps) {
  const t = useTranslations("Inbox.forwardDialog");
  const tQuote = useTranslations("Inbox.replyQuote");

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const supabase = createClient();
    supabase
      .from("conversations")
      .select(CONVERSATION_SELECT)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to fetch conversations for forward:", error);
          setConversations([]);
        } else {
          setConversations(normalizeConversations(data ?? []));
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setSendingId(null);
    }
  }, [open]);

  const filtered = useMemo(() => {
    let result = conversations.filter((c) => c.id !== excludeConversationId);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        return name.includes(q) || phone.includes(q);
      });
    }
    return result;
  }, [conversations, excludeConversationId, search]);

  const preview = message ? buildReplyPreview(message, tQuote) : "";

  async function handlePick(conversationId: string) {
    if (sendingId) return;
    setSendingId(conversationId);
    try {
      await onForward(conversationId);
    } finally {
      setSendingId(null);
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <ForwardIcon className="h-4 w-4 text-primary" />
            {t("title")}
          </DialogTitle>
          <DialogDescription className="truncate text-muted-foreground">
            {preview}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
            autoFocus
          />
        </div>

        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-md border border-border bg-background/50 p-6 text-center">
              <p className="text-sm text-popover-foreground">{t("noConversations")}</p>
            </div>
          ) : (
            filtered.map((c) => {
              const displayName = c.contact?.name || c.contact?.phone || t("unknownContact");
              const isSending = sendingId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={!!sendingId}
                  onClick={() => handlePick(c.id)}
                  className="flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors hover:bg-muted disabled:opacity-60"
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                    style={{ backgroundColor: avatarColorFor(c.contact?.id || displayName) }}
                  >
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-popover-foreground">
                      {displayName}
                    </p>
                    {c.contact?.phone && (
                      <p className="truncate text-xs text-muted-foreground">
                        {c.contact.phone}
                      </p>
                    )}
                  </div>
                  {isSending && (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
