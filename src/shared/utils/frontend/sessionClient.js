let activeUserId = null;

export function setActiveUserId(userId) {
  activeUserId = userId || null;
}

export function getActiveUserId() {
  return activeUserId;
}

export function requireActiveUserId() {
  if (!activeUserId) {
    throw new Error('ยังไม่ได้เลือกโปรไฟล์ผู้ใช้');
  }
  return activeUserId;
}
