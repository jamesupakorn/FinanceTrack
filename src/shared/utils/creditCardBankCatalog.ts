// creditCardBankCatalog.ts
// แคตาล็อกผู้ออกบัตร (ธนาคาร/บริษัทบัตรเครดิต) 11 รายชื่อ + 'other' — ที่เดียวที่กำหนดข้อมูลผู้ออกบัตร
// Pure module: ไม่มี import, ไม่มี I/O
//
// ฟีเจอร์: credit-card-bank-issuer-logo
// กฎของไฟล์นี้:
// - `color` ทุกตัวต้องเป็น hex 6 หลัก ตัวพิมพ์เล็กเสมอ (CARD_COLORS.includes() เทียบ string ตรงตัว)
// - `logo` เป็น string | null — ถ้ายังตรวจสิทธิ์การใช้โลโก้ไม่ได้ ให้ใส่ null (fallback เป็นจุดสี, R-1)
// - hex เป็นค่าประมาณจาก design pass — ต้องตรวจกับ brand guideline จริงก่อน release แรกที่มีไฟล์นี้
//   หลังจากนั้นค่าจะ freeze (BR-CC-021): ห้ามแก้/ลบ เพราะจะทำให้บัตรที่เคยบันทึกสีนี้ไว้ถูกเปลี่ยนเป็น
//   CARD_COLORS[0] แบบไม่รู้ตัวตอน save ครั้งต่อไป

/** ลำดับการประกาศ = ลำดับ dropdown (ES2015+ guarantee สำหรับ non-integer key) จบท้ายด้วย 'other' */
export const BANK_ISSUERS = {
  kbank:       { label: 'ธนาคารกสิกรไทย',      color: '#138f2d', logo: '/bank-logos/kbank.svg' },
  scb:         { label: 'ธนาคารไทยพาณิชย์',    color: '#4e2a84', logo: '/bank-logos/scb.svg' },
  ktb:         { label: 'ธนาคารกรุงไทย',        color: '#1ba5e1', logo: '/bank-logos/ktb.svg' },
  bbl:         { label: 'ธนาคารกรุงเทพ',        color: '#1e4598', logo: '/bank-logos/bbl.svg' },
  krungsri:    { label: 'ธนาคารกรุงศรีอยุธยา',  color: '#fec43b', logo: '/bank-logos/krungsri.svg' },
  ttb:         { label: 'ธนาคารทีทีบี',         color: '#004b93', logo: '/bank-logos/ttb.svg' },
  uob:         { label: 'ธนาคารยูโอบี',         color: '#0b3979', logo: '/bank-logos/uob.svg' },
  // รวม Citibank Thailand (UOB ซื้อกิจการ consumer business ปี 2023)
  ktc:         { label: 'เคทีซี',               color: '#00338e', logo: '/bank-logos/ktc.svg' },
  aeon:        { label: 'อิออน',                color: '#e4002b', logo: '/bank-logos/aeon.svg' },
  firstchoice: { label: 'เฟิร์สช้อยส์',         color: '#f26522', logo: '/bank-logos/firstchoice.svg' },
  shopee:      { label: 'Shopee',               color: '#ee4d2d', logo: '/bank-logos/shopee.svg' },
  // ครอบคลุม SPayLater + SEasyCash; ผลิตภัณฑ์ย่อยระบุในช่อง bankName
  other:       { label: 'อื่นๆ',                color: '#6b7280', logo: null }
} as const;

export type BankIssuerKey = keyof typeof BANK_ISSUERS;

/** Dropdown order = declaration order (ES2015+ guarantees it for non-integer keys). Ends with 'other'. */
export const BANK_ISSUER_KEYS: BankIssuerKey[] = Object.keys(BANK_ISSUERS) as BankIssuerKey[];

/** Own-property check. `key in BANK_ISSUERS` would accept 'constructor' / 'toString' (V-2). */
export function isBankIssuerKey(value: unknown): value is BankIssuerKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BANK_ISSUERS, value);
}

/** Read-time fallback ONLY. Never use this to build a value that gets written (BR-CC-020). */
export function getBankIssuer(card: { bankIssuer?: unknown } | null | undefined): BankIssuerKey {
  return isBankIssuerKey(card?.bankIssuer) ? card.bankIssuer : 'other';
}
