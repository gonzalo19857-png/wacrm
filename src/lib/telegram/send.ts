/**
 * Minimal Telegram Bot API client — just enough to DM a chat when the
 * AI auto-reply bot hands a conversation off to a human. No SDK
 * dependency; the Bot API is a plain JSON/HTTPS endpoint, so a
 * library would only wrap a single `fetch` call.
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org'

export type TelegramSendResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Send a plain-text message to a chat via `sendMessage`. Treats any
 * non-2xx response or `{ ok: false }` body as a failure and surfaces
 * Telegram's own `description` when present (e.g. "chat not found",
 * "bot was blocked by the user") so the settings UI / logs can show a
 * useful reason instead of a bare status code.
 */
/**
 * Confirm a bot token is real via `getMe` — no message is sent, so
 * this is safe to run on every save that changes the token (mirrors
 * the "verify before save" discipline `/api/ai/config` already
 * applies to the provider API key).
 */
export async function validateTelegramBotToken(
  botToken: string,
): Promise<TelegramSendResult> {
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/getMe`)
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.ok) {
      return {
        ok: false,
        error: data?.description ?? `Telegram API returned ${res.status}`,
      }
    }
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error reaching Telegram',
    }
  }
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<TelegramSendResult> {
  try {
    const res = await fetch(
      `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
      },
    )
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.ok) {
      return {
        ok: false,
        error: data?.description ?? `Telegram API returned ${res.status}`,
      }
    }
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error reaching Telegram',
    }
  }
}
