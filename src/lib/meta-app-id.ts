/**
 * Meta App ID, with a hardcoded fallback.
 *
 * Unlike META_APP_SECRET, an App ID isn't a secret — Meta sends it to
 * the browser as the OAuth `client_id` on every "Conectar Facebook"
 * click and shows it in the Facebook Developers console URL
 * (developers.facebook.com/apps/<id>/...). Baking in the owner's own
 * App ID as a fallback here means Studio's Facebook OAuth and
 * WhatsApp image-header templates keep working even when the
 * production host's env var panel is temporarily unreachable —
 * only `META_APP_ID` in the environment overrides it, so setting the
 * var later (or pointing this at a different app) still works exactly
 * as before.
 */
const FALLBACK_META_APP_ID = '947891471661793'

export function getMetaAppId(): string {
  return process.env.META_APP_ID || FALLBACK_META_APP_ID
}
