function normalizeUserId(value) {
  if (Array.isArray(value)) {
    return value[0];
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return typeof value === 'number' ? value.toString() : null;
}

export function getUserIdFromRequest(req) {
  if (!req) return null;
  const queryUser = normalizeUserId(req.query?.userId);
  if (queryUser) return queryUser;
  const bodyUser = normalizeUserId(req.body?.userId);
  if (bodyUser) return bodyUser;
  const headerUser = normalizeUserId(req.headers?.['x-user-id']);
  return headerUser;
}

export function assertUserId(req, res) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    res.status(400).json({ error: 'userId required' });
    return null;
  }
  return userId;
}
