import type { Message } from "@/types";

/** Payload shape `/api/whatsapp/send` expects for a forwarded message. */
export interface ForwardSendPayload {
  message_type: string;
  content_text?: string;
  media_url?: string;
  filename?: string;
  latitude?: number;
  longitude?: number;
  location_name?: string;
  location_address?: string;
}

// This CRM never persists a location's lat/lng in their own columns —
// the webhook only ever writes a formatted "name - address - lat,lng"
// string to content_text (see its 'location' case). The inbox bubble
// already relies on this exact shape to turn it into a clickable Maps
// link (see message-bubble.tsx's 'location' case); reuse the same
// regex here to pull the real coordinates back out for forwarding.
const LOCATION_COORDS_RE = /(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)\s*$/;

/**
 * Turn an existing message into the params needed to resend its content
 * to a different conversation — the CRM's "forward" (there is no Meta
 * endpoint to relay a message directly; a forward here is really "send
 * a new message with the same content").
 *
 * Media types reuse the original `media_url` as-is: it's already a
 * public URL in our own storage bucket, so Meta can fetch it again with
 * no re-upload. `location` resends as a real WhatsApp location message
 * (a tappable map pin), parsed back out of content_text — matching what
 * a native WhatsApp forward does — falling back to plain text only if
 * the coordinates can't be parsed (e.g. a malformed legacy row). Other
 * text-bearing types (`template`/`interactive`, which can't be resent
 * as the same structured type to an arbitrary contact) forward as plain
 * text of their rendered content.
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

    case "location": {
      const coords = message.content_text?.match(LOCATION_COORDS_RE);
      if (coords) {
        const label = message.content_text!
          .slice(0, coords.index)
          .replace(/\s*-\s*$/, "")
          .trim();
        const [name, ...rest] = label ? label.split(" - ") : [];
        return {
          message_type: "location",
          latitude: Number(coords[1]),
          longitude: Number(coords[2]),
          location_name: name || undefined,
          location_address: rest.length ? rest.join(" - ") : undefined,
        };
      }
      // No parseable coordinates — fall through to a plain-text forward.
      if (!message.content_text) return null;
      return { message_type: "text", content_text: message.content_text };
    }

    case "text":
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
