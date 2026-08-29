/**
 * LINE credentials — read from env vars only (TD-C03, 2026-08-29). Previously read from a
 * base64-"encoded" (not encrypted) file committed to git; migrated to `.env.local`
 * (`LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_USER_ID`), matching the existing
 * `LINE_CHANNEL_SECRET` pattern already used by `pages/api/line_webhook.js`. Server-only —
 * consumed only by `sendLineMessage.js`, which is only ever called from `pages/api/*`.
 */
export function getLineToken() {
  return process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
}

export function getLineUserId() {
  return process.env.LINE_CHANNEL_USER_ID || '';
}
