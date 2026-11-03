/**
 * ชื่อ accessible ของช่องกรอกการเงินในตารางรายรับ/รายจ่าย: "<หน้าที่ของช่อง> - <บริบทของแถว>"
 * ใช้ aria-label ตรง ๆ (ไม่ใช้ id) เพราะตารางเดสก์ท็อปกับการ์ดมือถือ render พร้อมกันและซ่อนด้วย CSS
 * id ร่วมข้ามสองสาขาจึงไม่ปลอดภัย
 */

const UNNAMED_ROW = 'รายการไม่มีชื่อ';

/**
 * บริบทของแต่ละแถว (ลำดับเดียวกับ names) — ใช้ชื่อที่แสดงอยู่ถ้าไม่ว่างและไม่ซ้ำ
 * ถ้าว่างหรือซ้ำกับแถวอื่น เติมลำดับที่อ่านได้ ("รายการที่ N") ให้แยกแถวออกจากกัน ไม่เปิดเผย key ฐานข้อมูล
 */
export function buildRowContexts(names: ReadonlyArray<string | null | undefined>): string[] {
  const trimmed = names.map(name => (typeof name === 'string' ? name.trim() : ''));
  const counts = new Map<string, number>();
  trimmed.forEach(name => counts.set(name, (counts.get(name) ?? 0) + 1));
  return trimmed.map((name, index) => {
    if (name && counts.get(name) === 1) return name;
    return `${name || UNNAMED_ROW} (รายการที่ ${index + 1})`;
  });
}

export function financialFieldLabel(purpose: string, rowContext: string): string {
  return `${purpose} - ${rowContext}`;
}
