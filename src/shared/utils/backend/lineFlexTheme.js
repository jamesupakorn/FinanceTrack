// src/shared/utils/backend/lineFlexTheme.js
// ธีมสีและ Flex primitive ที่ใช้ร่วมกันทั้ง 3 ข้อความ LINE (monthly summary / due notify / credit card)
// เป็นโมดูล pure — ไม่อ่าน config/env/DB/request state ใดๆ (สเปก AC-1)
//
// ที่มาของค่าสี: .pipeline/spec-line-flex-light-theme.md §2 / .pipeline/UX_SPEC-line-flex-light-theme.md §2
// ค่าทุกตัวผ่านการวัด WCAG AA แล้ว ห้ามเปลี่ยนโดยไม่วัดคอนทราสต์ใหม่ (R-4)

export const LINE_THEME = {
  surface: '#ffffff',
  surfaceFooter: '#f5f7fa',
  separator: '#e3e7ee',
  textPrimary: '#1f2430',
  textSecondary: '#6b7280',
  brand: '#1f6feb',
  danger: '#c62f3f',
  warning: '#a05e00',
  success: '#0f7a43',
  info: '#1f6feb',
  tintDanger: '#fdecee',
  tintWarning: '#fdf3e3',
  tintSuccess: '#e6f6ec',
  tintNeutral: '#eef3fb'
};

/**
 * สร้าง text component มาตรฐาน — ใช้ร่วมกันทุกการ์ด
 * คงรูปแบบเดิมจาก monthlyLineSummary.js (flex:1, wrap:true, empty-guard, weight mapping)
 * เปลี่ยนแค่สี default เป็น LINE_THEME.textPrimary
 */
export function textComponent(text, size = 'sm', color = LINE_THEME.textPrimary, weight = '400') {
  return { type: 'text', text: String(text || ' '), size, color, weight: weight === '700' ? 'bold' : 'regular', flex: 1, wrap: true };
}

/**
 * แถวไอคอน + label + ค่า (แนวนอน) — รับค่าที่ format เป็น string แล้วเท่านั้น
 * ห้ามรับตัวเลขดิบ เพื่อไม่ให้ต้อง unify amount()/formatAmount() ของแต่ละไฟล์ (AC-3)
 */
export function valueRow(icon, label, valueText, color = LINE_THEME.textSecondary) {
  return {
    type: 'box', layout: 'horizontal', spacing: 'sm', margin: 'md', alignItems: 'center',
    contents: [
      textComponent(icon, 'sm', color, '700'),
      textComponent(label, 'sm', LINE_THEME.textSecondary),
      textComponent(valueText, 'sm', LINE_THEME.textPrimary, '700')
    ]
  };
}

/** บรรทัดข้อความรองขนาด xs สี textSecondary — ใช้แทน tier สีที่ 3 เดิม (ดู UX spec §2.3) */
export function mutedLine(text) {
  return textComponent(text, 'xs', LINE_THEME.textSecondary);
}

/** เส้นคั่น */
export function separator(margin = 'xl') {
  return { type: 'separator', margin, color: LINE_THEME.separator };
}

/** กล่อง highlight (totals box) — พื้นหลังเป็น tint บางๆ ครอบ contents ที่ส่งเข้ามา */
export function tintBox(tint, contents) {
  return { type: 'box', layout: 'vertical', margin: 'xl', paddingAll: 'lg', backgroundColor: tint, cornerRadius: 'md', contents };
}

/** ปุ่ม CTA เดียวใน footer ของทุกการ์ด */
export function ctaButton(label, uri) {
  return { type: 'button', style: 'primary', color: LINE_THEME.brand, action: { type: 'uri', label, uri } };
}
