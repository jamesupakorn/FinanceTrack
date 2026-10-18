/**
 * คอมโพเนนต์: BankIssuerMark
 * แสดงโลโก้ธนาคาร/ผู้ออกบัตร ถ้ามีและโหลดสำเร็จ ไม่งั้น fallback เป็นจุดสีเดิม (12px)
 *
 * ฟีเจอร์: credit-card-bank-issuer-logo — ดู .pipeline/spec-credit-card-bank-issuer-logo.md AC-BI-25..28
 * ใช้ getBankIssuer(card) เพื่ออ่านค่าตอน render เท่านั้น — ไม่เขียนกลับ (BR-CC-020)
 * ทุกจอ (Dashboard/Detail/Form preview) ใช้คอมโพเนนต์นี้ร่วมกัน เพื่อให้ fallback logic อยู่ที่เดียว
 *
 * props:
 * - card: { bankIssuer?, color? } — ข้อมูลบัตร (หรือ object preview จาก Form)
 * - size: number px ของ logo tile เมื่อโลโก้โหลดสำเร็จ (default 24) — จุดสี fallback คงที่ 12px เสมอ
 * - decorative: boolean — true = alt="" (ใช้กับ Form preview ที่ select ข้าง ๆ ประกาศชื่อผู้ออกบัตรอยู่แล้ว)
 */

import { useEffect, useState } from 'react';
import { BANK_ISSUERS, getBankIssuer } from '../../shared/utils/creditCardBankCatalog';

export default function BankIssuerMark({ card, size = 24, decorative = false }) {
  const issuerKey = getBankIssuer(card);
  const issuer = BANK_ISSUERS[issuerKey];
  const logo = issuer.logo;
  const [imgFailed, setImgFailed] = useState(false);

  // รีเซ็ตสถานะ error เมื่อโลโก้เปลี่ยน (เช่น ผู้ใช้สลับผู้ออกบัตรใน Form แล้วโลโก้ตัวก่อนหน้าโหลดพลาดไว้)
  useEffect(() => {
    setImgFailed(false);
  }, [logo]);

  const showLogo = Boolean(logo) && !imgFailed;

  if (showLogo) {
    return (
      <img
        src={logo}
        alt={decorative ? '' : issuer.label}
        width={size}
        height={size}
        className="shrink-0 rounded-xs bg-white object-contain p-[2px]"
        style={{ width: size, height: size }}
        onError={() => setImgFailed(true)}
      />
    );
  }

  // Fallback: จุดสีเดิม 12px เสมอ ไม่ว่า size ที่ขอมาจะใหญ่แค่ไหน (คงลุคเดิม ไม่สร้างของใหม่)
  return (
    <span
      className="h-3 w-3 shrink-0 rounded-xs"
      style={{ background: card?.color }}
      aria-hidden="true"
    />
  );
}
