# Studio — connecting Facebook + Instagram

Studio publishes to a Facebook Page and its linked Instagram Business account
via Facebook Login (OAuth). This is a one-time setup the account owner (or
whoever manages the Meta App) does in Meta's own console before clicking
"Conectar Facebook" inside Studio.

## 1. Add Facebook Login for Business to the existing Meta App

Use the SAME Meta App already used for the WhatsApp Cloud API integration —
no need for a second app. In [Meta for Developers](https://developers.facebook.com/apps/):

1. Open the app → **Add Product** → **Facebook Login for Business** → Set Up.
2. The **Instagram Graph API** and **Pages API** products are usually bundled
   in automatically; if not, add them the same way.

## 2. Register the OAuth redirect URI

Facebook Login → **Settings** → **Valid OAuth Redirect URIs**, add exactly:

```
<NEXT_PUBLIC_SITE_URL>/api/studio/meta/oauth/callback
```

This must match byte-for-byte what the app sends (same scheme, host, no
trailing slash) or Facebook rejects the redirect.

## 3. Confirm your role on the app

App **Roles** → **Roles**: the Facebook user who will click "Conectar
Facebook" in Studio must be listed as **Admin**, **Developer**, or **Tester**.

While the app is in **Development Mode** (the default, and fine for a
single-business tool like this), users in these roles can grant the scopes
below to themselves without Meta's App Review process — but only for Pages/
Instagram accounts they themselves own or manage. This does not extend to
other businesses; that would require going through App Review, which is out
of scope for Studio.

## 4. Confirm the Instagram account is a Business/Creator account

Instagram publishing via the Graph API only works against a **Business** or
**Creator** account, linked to the Facebook Page in Meta Business Suite. A
personal Instagram account cannot be connected. Check: Meta Business Suite →
Settings → Accounts → Instagram accounts.

## 5. Set the environment variables

Both are read by `src/app/api/studio/meta/oauth/*`:

- `META_APP_ID` — already used for WhatsApp template image headers; now also
  required for Studio's OAuth `client_id`.
- `META_APP_SECRET` — already required for WhatsApp webhook signature
  verification; now also used as the OAuth `client_secret` and to sign the
  stateless CSRF `state` parameter (`src/lib/studio/oauth-state.ts`).
- `NEXT_PUBLIC_SITE_URL` — must be set and must match the redirect URI
  registered in step 2 exactly.

## 6. Connect

In Studio → **Conexiones**, click **Conectar Facebook**, approve the
requested permissions (`pages_show_list`, `pages_manage_posts`,
`pages_manage_metadata`, `pages_read_engagement`, `instagram_basic`,
`instagram_content_publish`, `business_management`, `ads_management`,
`ads_read`), and you'll land back on Conexiones with your Page name,
Instagram handle, and ad account showing.

Studio connects to the **first** Page (and first active ad account) your
account manages — it's built for one Page + one linked Instagram account +
one ad account, not a multi-account picker. If you have several ad
accounts, make sure the one you want Studio to use for the ad creator is
the first one returned for your user (or the only active one) — otherwise
disconnect and reconnect after adjusting which ad account you have access
to.

## 7. Ad creator (Studio → Anuncios)

Once ads_management is granted and an ad account is connected, Studio →
**Anuncios** can create real Campaign → Ad Set → Ad Creative → Ad objects
on that ad account via the Marketing API (`src/lib/studio/meta-ads.ts`).
Every ad is created **PAUSED at every level** — nothing spends until
someone explicitly clicks "Activar" (a confirmation shows the exact daily
budget first). v1 supports a single objective: OUTCOME_TRAFFIC (link
clicks), with a single image creative and automatic (Advantage+)
placements — no video, carousel, or Click-to-WhatsApp destination type
yet.

## 8. Messenger auto-reply (Marketplace/Page messages)

Buyer messages on a Marketplace listing arrive as ordinary Facebook Page
Messenger conversations, and the same AI auto-reply bot that answers
WhatsApp (Settings → AI Assistant) can answer these too — same catalog
knowledge, same handoff rules. Marketplace *listing* automation itself
(creating/editing ads) is out of scope: Meta has no public API for it.

1. In [Meta for Developers](https://developers.facebook.com/apps/), open the
   app → **Add Product** → **Messenger** → Set Up (if not already added).
2. Reconnect: click "Desconectar" then "Conectar Facebook" in Studio →
   **Conexiones** once, so the new `pages_messaging` scope (added to the
   permission list above) is actually granted — an existing connection's
   token predates it.
3. Set `MESSENGER_WEBHOOK_VERIFY_TOKEN` (any random string) in your env.
4. Messenger → **Webhooks** in the Meta App dashboard → subscribe your Page
   to the `messages` field, with:
   - Callback URL: `<NEXT_PUBLIC_SITE_URL>/api/messenger/webhook`
   - Verify token: the exact value of `MESSENGER_WEBHOOK_VERIFY_TOKEN`

   Reconnecting in step 2 already calls the Graph API to subscribe the Page
   (`src/lib/studio/meta-graph.ts#subscribePageToMessaging`) — this manual
   step is only needed if that best-effort call failed (check server logs)
   or if Meta requires the dashboard subscription to be set explicitly for
   your app.
5. Because you (the person connecting) are an Admin/Developer/Tester on the
   app and own the Page — the same Development-Mode carve-out that lets the
   other scopes above work without App Review — `pages_messaging` likely
   works immediately for real customer messages. If Meta later requires
   Business Verification/App Review at higher volume, that's a one-time step
   in Meta's dashboard, not a code change.

Once subscribed, message the connected Page from a personal account to
confirm a reply comes back — the new contact will show up with a
`psid:...`-prefixed phone (Messenger has no phone number) until you rename
it.

## Disconnecting

The "Desconectar" button in Studio only removes the connection stored in
this app's database — it does not revoke Facebook's own grant. To fully
revoke access, go to Facebook → Settings → Apps and Websites, and remove the
app there.
