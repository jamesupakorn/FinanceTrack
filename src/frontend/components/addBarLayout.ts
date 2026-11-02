/**
 * ความสูงของแถบ "เพิ่มรายจ่าย" ที่ติดล่างบนมือถือ (CreditCardDetail) — ค่าเดียวที่ใช้ร่วมกันสองที่:
 *  - padding ล่างของ root (เพื่อให้แถวสุดท้ายเลื่อนพ้นแถบ)
 *  - การคำนวณ flip-above ของ RowActionMenu (เมนูต้องไม่ไปอยู่ใต้แถบ)
 * แก้ที่นี่ที่เดียวเพื่อไม่ให้สองที่ drift กัน (architecture review note 5, spec I-24/I-37)
 */
export const ADD_BAR_HEIGHT_PX = 88;
