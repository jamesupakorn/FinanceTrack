let activeUserId: string | null = null;

export function setActiveUserId(userId?: string | null): void {
  activeUserId = userId || null;
}

export function requireActiveUserId(): string {
  if (!activeUserId) {
    throw new Error('ยังไม่ได้เลือกโปรไฟล์ผู้ใช้');
  }
  return activeUserId;
}
