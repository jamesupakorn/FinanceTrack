/**
 * คอมโพเนนต์: BudgetHealthPanel
 * 4 แถวสุขภาพงบประมาณ + rollup — อ่านจาก evaluateBudgetHealth() ล้วน ไม่คำนวณเกณฑ์เอง (BR-DASH-005)
 *
 * Collapsible ตาม §UX Review ของ spec-dashboard.md — พับเก็บเป็นค่าเริ่มต้นเสมอทั้งมือถือและเดสก์ท็อป
 * (รวม lg — UX_SPEC §6.4 ยังโชว์ "สุขภาพงบประมาณ ▾" พับอยู่) ใช้ CollapsibleHeading ตัวเดียวกับที่
 * DashboardCalendarSection ใช้ (architecture-review-dashboard-graphite.md Finding 3) รายบรรทัด rollup
 * ยังโผล่ในหัวข้อตอนพับอยู่เสมอ (AC-DB-29)
 *
 * ข้อความ/label ของแต่ละแถวอ่านจาก row.statusLabel / health.rollupMessage ที่โมเดลคำนวณมาให้ตรง ๆ
 * (ไม่ re-derive ข้อความเอง) — ไอคอน/สีเลือกจาก row.status (คีย์ภาษาอังกฤษ) แมปเป็น money semantics
 * ใหม่ (--pos/--warn/--neg) ตาม UX_SPEC §3.1
 *
 * Graphite redesign (Dashboard pass) — Tailwind only, ไม่ import Dashboard.module.css/
 * CreditCard.module.css อีกต่อไป
 */

import { useEffect, useState } from 'react';
import { evaluateBudgetHealth } from '../../shared/utils/frontend/monthlySummary';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { Icons } from './Icons';
import CollapsibleHeading from './CollapsibleHeading';

const STATUS_META = {
  ok: { Icon: Icons.Check, color: 'var(--pos)' },
  near: { Icon: Icons.AlertTriangle, color: 'var(--warn)' },
  over: { Icon: Icons.TrendingUp, color: 'var(--neg)' },
  critical: { Icon: Icons.AlertTriangle, color: 'var(--neg)' },
  'on-target': { Icon: Icons.Check, color: 'var(--pos)' },
  'below-target': { Icon: Icons.TrendingDown, color: 'var(--warn)' }
};

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

function sanitizeNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return num === 0 ? 0 : num;
}

function BudgetRow({ row }) {
  const meta = STATUS_META[row.status] || STATUS_META.ok;
  const { Icon } = meta;
  const thresholdText = row.kind === 'max' ? `เกณฑ์ ≤ ${row.threshold}%` : `เกณฑ์ ≥ ${row.threshold}%`;
  const isOver = row.status === 'over' || row.status === 'critical';
  const barPercent = sanitizeNumber(row.barPercent);

  return (
    <div className="flex flex-col gap-space-2 border-b border-border-subtle pb-space-3 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-space-3">
        <span className="min-w-0 flex-1 font-semibold text-primary">{row.label}</span>
        <span className="font-semibold text-primary tabular-nums">{`${formatCurrency(sanitizeNumber(row.amount))} ฿`}</span>
        <span className="min-w-12 text-right text-secondary tabular-nums">{`${sanitizeNumber(row.ratio).toFixed(1)}%`}</span>
      </div>
      <span className="text-xs text-tertiary">{thresholdText}</span>
      <div className={`relative h-2 overflow-hidden rounded-full bg-surface-2 ${isOver ? 'outline outline-1 outline-neg outline-offset-1' : ''}`}>
        <div className="h-full rounded-full transition-[width] duration-base" style={{ width: `${barPercent}%`, background: meta.color }} />
        <span className="absolute -top-0.5 -bottom-0.5 left-full w-0.5 bg-tertiary" aria-hidden="true" />
      </div>
      <span className="inline-flex items-center gap-space-2 text-sm font-semibold" style={{ color: meta.color }}>
        <Icon size={16} color={meta.color} />
        {row.statusLabel}
      </span>
      <a
        href={`/settings#${row.id}`}
        className={`inline-flex min-h-11 w-fit items-center self-start px-space-1 text-sm font-semibold text-accent no-underline ${FOCUS_RING}`}
      >
        แก้ไขเกณฑ์
      </a>
    </div>
  );
}

function TransferableSavingsAction({ amount, onConfirm, isConfirming }) {
  const available = amount > 0;
  return (
    <div
      className="flex flex-col items-stretch gap-space-3 border-t border-border-subtle pt-space-4 md:flex-row md:items-center md:justify-between"
      aria-live="polite"
    >
      <div>
        <p className="m-0 text-sm text-secondary">เงินออมที่โอนได้</p>
        <p className="m-0 text-lg font-bold text-primary tabular-nums">{`${formatCurrency(Math.max(0, amount))} ฿`}</p>
      </div>
      {available ? (
        <button
          type="button"
          className={`min-h-11 shrink-0 cursor-pointer rounded-full border-none bg-accent px-space-4 font-bold text-on-accent disabled:cursor-not-allowed disabled:opacity-55 ${FOCUS_RING}`}
          onClick={onConfirm}
          disabled={isConfirming}
        >
          {isConfirming ? 'กำลังเพิ่มเข้าเงินออม...' : 'เพิ่มเข้าเงินออม'}
        </button>
      ) : (
        <p className="m-0 text-sm text-secondary">เดือนนี้ยังไม่มีเงินเหลือพร้อมออม</p>
      )}
    </div>
  );
}

export default function BudgetHealthPanel({ model, thresholds, onConfirmTransfer, isConfirmingTransfer }) {
  const [collapsed, setCollapsed] = useState(true); // พับเป็นค่าเริ่มต้นเสมอ ทั้งมือถือและเดสก์ท็อป (AC-DB-29)
  const [userToggled, setUserToggled] = useState(false);
  const health = evaluateBudgetHealth(model, thresholds);
  const rollupIcon = !health.available ? null : (health.attentionCount > 0 ? '⚠ ' : '✓ ');

  // ยกเว้นจาก AC-DB-29 เพียงจุดเดียว: ถ้ามีหมวดที่ต้องระวัง เปิดให้อัตโนมัติครั้งแรก เพราะนี่คือ
  // ข้อมูลที่มีความเสี่ยงสูงสุดในหน้านี้ ไม่ควรซ่อนไว้หลังการแตะแม้แต่บน desktop ที่มีพื้นที่พอ —
  // ไม่ทับค่าที่ผู้ใช้กดเปลี่ยนเองแล้ว (userToggled)
  useEffect(() => {
    if (!userToggled && health.available && health.attentionCount > 0) {
      setCollapsed(false);
    }
  }, [health.available, health.attentionCount, userToggled]);

  return (
    <section className="rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5">
      <CollapsibleHeading
        expanded={!collapsed}
        onToggle={() => {
          setUserToggled(true);
          setCollapsed((prev) => !prev);
        }}
        icon={Icons.BarChart}
        title="สุขภาพงบประมาณ"
        trailing={`${rollupIcon || ''}${health.rollupMessage}`}
      />

      {/* ความสูงพับ↔กาง เดิม mount/unmount ทันที (กระตุก) — ตอนนี้ animate ด้วย CSS grid-template-rows
          (0fr → 1fr) แทน โดยเฉพาะเพื่อให้ตอน auto-expand (attentionCount > 0, AC-DB-29 ด้านบน) ซึ่งเป็น
          กรณีที่เกิดบ่อยที่สุดจริงในบัญชีจริง ดูเป็น "ขยายอย่างตั้งใจ" แทน "จอกระตุก" (มติผู้ใช้ต่อ BUG-DG-2 —
          เลิกไล่ตามความสูงจริงด้วยสเกเลตันฝั่ง pages/index.js เพราะไล่ไม่ทันข้อมูลจริงที่แปรผัน ให้คอมโพเนนต์
          นี้รับผิดชอบ "ทำให้การขยับดูนุ่มนวล" แทน) กลไกเดียวกันนี้ครอบคลุมการกดพับ/กางเองของผู้ใช้ด้วย (ไม่ได้
          แยกกลไกที่สองสำหรับ auto-expand โดยเฉพาะ) — CSS transition จะ fire ก็ต่อเมื่อค่า collapsed
          เปลี่ยนจริงเท่านั้น (ไม่ใช่ทุก re-render เช่นตอน refreshData() คำนวณ model/health ใหม่โดยที่ collapsed
          ไม่เปลี่ยน) ใช้ --dur-slow/--ease เดียวกับ chevron ของ CollapsibleHeading (§3.6, ไม่ใช่กลไกที่สอง)
          reduced-motion ถูกปิดให้อัตโนมัติผ่านกฎ global ที่ globals.css (`*{transition-duration:0.01ms
          !important}`) — inline style ด้านล่างเป็นค่าปกติ (ไม่ใช่ !important) จึงถูกกฎ global ทับได้ตามลำดับ
          cascade ปกติ (ยืนยันแล้ว ไม่ได้ bypass) เนื้อหาข้างในยัง mount ตลอดเวลา (ไม่ conditional unmount
          เหมือนเดิม) เพราะเทคนิค 0fr/1fr ต้องมี content จริงให้วัด — ปิดการเข้าถึงตอนพับด้วย aria-hidden +
          inert แทน (กันลิงก์ "แก้ไขเกณฑ์" ที่มองไม่เห็นแต่ยัง tab ไปโดนได้) */}
      <div
        className="grid transition-[grid-template-rows]"
        style={{
          gridTemplateRows: collapsed ? '0fr' : '1fr',
          transitionDuration: 'var(--dur-slow)',
          transitionTimingFunction: 'var(--ease)'
        }}
        aria-hidden={collapsed}
        inert={collapsed}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-space-4 pt-space-3">
            {!health.available ? (
              <div className="py-space-3 text-center text-secondary">
                <p>{health.rollupMessage}</p>
                <a
                  href="/workspace/income"
                  className={`mt-space-3 inline-flex min-h-11 items-center rounded-full bg-accent px-space-4 font-semibold text-on-accent no-underline ${FOCUS_RING}`}
                >
                  เพิ่มรายรับ
                </a>
              </div>
            ) : (
              <>
                {health.rows.map((row) => <BudgetRow key={row.id} row={row} />)}
              </>
            )}
          </div>
        </div>
      </div>
      {health.available && (
        <TransferableSavingsAction
          amount={model.transferableSavings}
          onConfirm={onConfirmTransfer}
          isConfirming={isConfirmingTransfer}
        />
      )}
    </section>
  );
}
