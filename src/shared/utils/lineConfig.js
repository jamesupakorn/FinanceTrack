export function getLineToken() {
  return process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
}

export function getLineUserId() {
  return process.env.LINE_CHANNEL_USER_ID || '';
}

