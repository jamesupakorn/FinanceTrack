// Retry สำหรับการส่ง LINE ของ notification path เท่านั้น (AC-2)
// ไม่ใส่ใน pushLineApiCall() เพื่อไม่ให้พฤติกรรมของ line_due_notify / line_notify / line_webhook เปลี่ยน

const RETRY_DELAY_MS = 1000;
const MAX_ATTEMPTS = 2;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** transient = fetch reject (ไม่มี status) หรือ HTTP 5xx — 4xx (เช่น LINE ID ไม่ถูกต้อง) ไม่ retry */
export function isTransientLineError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== 'number') return true;
  return status >= 500;
}

export async function withLineRetry<T>(
  send: () => Promise<T>,
  delayMs: number = RETRY_DELAY_MS
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS || !isTransientLineError(error)) throw error;
      await sleep(delayMs);
    }
  }
  throw lastError;
}
