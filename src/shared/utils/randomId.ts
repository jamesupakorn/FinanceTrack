/**
 * ตัวสุ่มสำหรับสร้างรหัส/คีย์ของแถวข้อมูลฝั่ง UI — ใช้ Web Crypto แทน Math.random()
 * (CodeQL js/insecure-randomness) ใช้ได้ทั้งเบราว์เซอร์และ Node ≥ 20 ไม่มี import ฝั่งใดฝั่งหนึ่ง
 */

/** จำนวนเต็มสุ่มช่วง [0, maxExclusive) */
export function randomInt(maxExclusive: number): number {
  const words = new Uint32Array(1);
  globalThis.crypto.getRandomValues(words);
  return words[0] % Math.max(1, Math.floor(maxExclusive));
}

/** สตริง base36 สุ่มยาว `length` ตัวอักษร (ค่าเริ่มต้น 5 เท่าเดิมของ Math.random().toString(36).slice(2, 7)) */
export function randomBase36(length = 5): string {
  const words = new Uint32Array(Math.ceil(length / 6) + 1);
  globalThis.crypto.getRandomValues(words);
  return Array.from(words, word => word.toString(36).padStart(7, '0')).join('').slice(0, length);
}
