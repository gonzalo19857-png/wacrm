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

/**
 * Points a bot's webhook at our `/api/telegram/webhook/[destinationId]`
 * route (migration 066) so it can receive messages, not just send
 * them — used for the "/resumen" daily digest command. `secretToken`
 * is echoed back by Telegram on every call as the
 * `X-Telegram-Bot-Api-Secret-Token` header, which the webhook route
 * checks before trusting a request. Best-effort by design (callers
 * swallow the result) — a registration failure just means `/resumen`
 * won't work yet, never something that should block saving the
 * destination.
 */
export async function setTelegramWebhook(
  botToken: string,
  url: string,
  secretToken: string,
): Promise<TelegramSendResult> {
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, secret_token: secretToken }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.description ?? `Telegram API returned ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error reaching Telegram',
    }
  }
}

/** Registers the bot's slash-command menu (the "/" tap-to-fill list in
 *  Telegram's own UI) — how the "/resumen" command shows up as a
 *  one-tap option instead of something the agent has to remember to
 *  type. */
export async function setTelegramCommands(
  botToken: string,
  commands: { command: string; description: string }[],
): Promise<TelegramSendResult> {
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.description ?? `Telegram API returned ${res.status}` }
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
