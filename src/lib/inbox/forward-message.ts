import type { Message } from "@/types";

/** Payload shape `/api/whatsapp/send` expects for a forwarded message. */
export interface ForwardSendPayload {
  message_type: string;
  content_text?: string;
  media_url?: string;
  filename?: string;
}

/**
 * Turn an existing message into the params needed to resend its content
 * to a different conversation — the CRM's "forward" (there is no Meta
 * endpoint to relay a message directly; a forward here is really "send
 * a new message with the same content").
 *
 * Media types reuse the original `media_url` as-is: it's already a
 * public URL in our own storage bucket, so Meta can fetch it again with
 * no re-upload. Text-bearing types (including `location`, which this
 * CRM only ever persists as a formatted text string — see the webhook's
 * 'location' case — and `template`/`interactive`, which can't be
 * resent as the same structured type to an arbitrary contact) forward
 * as plain text of their rendered content.
 *
 * Returns null when there's nothing forwardable (e.g. inbound media
 * Meta's CDN has since expired, leaving no `media_url`).
 */
export function buildForwardPayload(message: Message): ForwardSendPayload | null {
  switch (message.content_type) {
    case "image":
    case "video":
    case "document":
    case "audio":
      if (!message.media_url) return null;
      return {
        message_type: message.content_type,
        media_url: message.media_url,
        content_text: message.content_type === "audio" ? undefined : message.content_text,
        filename: message.content_type === "document" ? message.content_text || undefined : undefined,
      };

    case "text":
    case "location":
    case "template":
    case "interactive": {
      const text = message.content_text || message.template_name;
      if (!text) return null;
      return { message_type: "text", content_text: text };
    }

    default:
      return null;
  }
}
