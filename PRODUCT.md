# Product

## Register

product

## Users

ผู้ใช้หลัก: เจ้าของโปรเจกต์ (1 คน หรือสมาชิกในครัวเรือน) ที่คุ้นเคยกับแอปพอสมควร
บริบท: บันทึกข้อมูลการเงินประจำเดือน — ทั้งบนมือถือ (หลัก) และ desktop
งานหลัก: กรอกรายรับ / รายจ่าย / ออม / ลงทุน / ภาษี → ดูสรุปรายเดือน → ส่งข้อมูลไป LINE notify

## Product Purpose

Personal finance dashboard สำหรับ Thai household — ช่วยให้เจ้าของบ้านสามารถ track รายรับ/รายจ่าย/ออม/ภาษีในหน้าเดียว
ลดเวลาการบันทึกเมื่อเทียบกับ spreadsheet
Success = เปิดแอป กรอกข้อมูล กด Save ภายใน 3 นาทีต่อเดือน

## Brand Personality

Premium dark — focused, minimal, confident
Feels like a personal CFO tool: มืออาชีพแต่ไม่ซับซ้อนเกินไป

## Anti-references

- Spreadsheet UI ที่ดูเหมือน Excel clone (ตาราง, borders ทุกที่, zero personality)
- Fintech SaaS ที่ cluttered และหนัก (Intuit/Mint/Quickbooks style)
- Navy-and-gold "finance bro" aesthetic
- Dashboard ที่เต็มไปด้วย chart widget เหมือน Tableau

## Design Principles

1. **ข้อมูลนำ, ประดับตามมา** — numbers ต้องอ่านชัดก่อน; decoration อยู่ใน background
2. **Mobile-first เสมอ** — 768px เป็น breakpoint หลัก; ทุก interaction ต้องทำได้ด้วยนิ้วโป้ง
3. **Save ครั้งเดียว, จบหน้าเดียว** — Floating Bar เป็น single save point; ไม่มีกด Save หลายจุด
4. **Quiet confidence** — ความ precision และ spacing พูดแทน decoration
5. **ลด friction ทุกจุด** — smart defaults, carry-over จากเดือนก่อน, เห็นสรุปทันที

## Accessibility & Inclusion

- Target: WCAG 2.1 AA (contrast ratio ≥ 4.5:1 สำหรับ body text)
- Thai-language UI ตลอด
- Mobile touch target ≥ 44×44px
- inputMode="decimal" สำหรับ number inputs
- Reduced motion: @media (prefers-reduced-motion) ต้องครอบ animation ทุกตัว
