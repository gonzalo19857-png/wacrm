"use client";

import { MessageSquare, Zap } from "lucide-react";

import { cn } from "@/lib/utils";
import type { QuickReply } from "@/types";
import { interactivePayloadPreviewText } from "@/lib/whatsapp/interactive";

interface SlashQuickReplyMenuProps {
  items: QuickReply[];
  activeIndex: number;
  onHover: (index: number) => void;
  onPick: (qr: QuickReply) => void;
}

/**
 * WhatsApp-Business-style shortcut menu: floats directly above the
 * composer textarea while the agent types "/" + a filter at the very
 * start of the message (see the slash-detection regex in
 * `message-composer.tsx`). Kept as a plain absolutely-positioned div
 * rather than the app's Popover primitive (`base-ui`) because that
 * primitive moves DOM focus into its content on open — this menu needs
 * the textarea to stay focused so arrow keys and continued typing keep
 * working while it's open.
 */
export function SlashQuickReplyMenu({
  items,
  activeIndex,
  onHover,
  onPick,
}: SlashQuickReplyMenuProps) {
  return (
    <div className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-sm overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
      <ul className="max-h-64 overflow-y-auto py-1">
        {items.map((qr, i) => (
          <li key={qr.id}>
            <button
              type="button"
              onMouseEnter={() => onHover(i)}
              // mousedown (not click) + preventDefault so the textarea
              // never loses focus/selection before the pick is handled.
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(qr);
              }}
              className={cn(
                "flex w-full items-start gap-2 px-3 py-2 text-left",
                i === activeIndex ? "bg-muted" : "hover:bg-muted/60",
              )}
            >
              {qr.kind === "interactive" ? (
                <Zap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              ) : (
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {qr.title}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {qr.kind === "interactive" && qr.interactive_payload
                    ? interactivePayloadPreviewText(qr.interactive_payload)
                    : qr.content_text}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
