/**
 * คอมโพเนนต์: CreditCardDetail (หน้าจอ 2)
 * รายละเอียดบัตร 1 ใบ — redesign ตาม spec-credit-card-detail-redesign (.pipeline, local)
 *
 * ลำดับบนทุก viewport: identity header → ชำระรอบบิลนี้ (พร้อมตัวสลับเดือน) → รายการไม่ผ่อน → แผนผ่อนชำระ →
 * แคชแบค → ประวัติยอดหมุนเวียน; ปุ่ม "เพิ่มรายจ่าย" มีตัวเดียว (แถบติดล่างบนมือถือ / ปุ่มหัวหน้าบน desktop)
 *
 * ⚠ ไม่คำนวณเงินเอง: ตัวเลขทุกตัวมาจาก server (card, plans, useRevolvingCycle) เป็นการ "ย้าย" ตำแหน่งเท่านั้น
 *   นอกจาก utilisation (เปอร์เซ็นต์แสดงผลเดิม) — BR-CC-013, SPEND-2/SPEND-4
 *
 * เดือนเริ่มต้นของรอบบิล = รอบที่ครบกำหนดในเดือนนี้ (getPayableCycleMonth, OQ-4) ตั้งเมื่อ card.id เปลี่ยน
 * (รวม undefined → id เพราะหน้า cards เริ่มเป็น []) ไม่ตั้งใหม่เมื่อข้อมูลบัตรเดิม refresh
 *
 * breakpoint มีตัวเดียว: 768px (`md:` + BP.md) — ตัวควบคุมเพิ่มรายจ่ายเลือกใน JS จาก isMobileView (DD-2)
 */

import { useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import {
  formatDayLabel,
  formatIsoDateTH,
  getCurrentMonthKey,
  getPayableCycleMonth,
  resolveCardDueDate,
  round2,
  PLAN_STATUS,
  CARD_TYPE_LABELS,
  isLoanCardType
} from '../../shared/utils/creditCardUtils';
import { MONTH_KEY_RE } from '../../shared/utils/creditCardBasics';
import { formatMonthKeyTH } from '../../shared/utils/dateUtils';
import type { CreditSpendItem } from '../../shared/utils/frontend/apiUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { BP } from '../../shared/utils/frontend/breakpoints';
import { useRevolvingCycle, type ConfirmMinimumHandler } from '../../shared/utils/frontend/useRevolvingCycle';
import { Icons } from './Icons';
import RevolvingBalanceSection from './RevolvingBalanceSection';
import CardPayNextSummary from './CardPayNextSummary';
import BillingMonthSwitcher from './BillingMonthSwitcher';
import CreditSpendItems from './CreditSpendItems';
import RowActionMenu, { type RowActionMenuItem } from './RowActionMenu';
import BankIssuerMark from './BankIssuerMark';
import { ADD_BAR_HEIGHT_PX } from './addBarLayout';
import {
  PAID_PILL_CLASS,
  PAID_PILL_ON_CLASS,
  PAID_PILL_LABEL_PAID,
  PAID_PILL_LABEL_UNPAID
} from './installmentPaidPill';

interface InstallmentScheduleRow {
  no: number;
  paid?: boolean;
  dueMonth: string;
  payment: number | string;
  principal: number | string;
  interest: number | string;
}

interface CreditCardDetailData {
  id: string;
  name: string;
  color?: string;
  bankIssuer?: unknown;
  bankName?: string;
  last4?: string;
  creditLimit?: number | string;
  remainingPrincipal?: number | string;
  revolvingDue?: number | string;
  installmentPayable?: number | string;
  revolvingCredit?: number | string;
  remainingPayable: number | string;
  availableCredit: number | string;
  statementDay?: number | string;
  dueDay?: number | string;
  annualRate?: number | string;
  minPaymentPercent?: number | string;
  cardType?: unknown;
}

interface CreditPlanDetail {
  id: string;
  cardId: string;
  itemName: string;
  status?: string;
  installmentsPaid: number;
  installmentsRemaining?: number;
  months: number;
  schedule?: InstallmentScheduleRow[];
  nextUnpaid?: InstallmentScheduleRow | null;
  totalPrice: number | string;
  progressPercent: number;
  monthlyPayment: number | string;
  remainingPayable: number | string;
  interestMode?: string;
  manualFeePerMonth?: number | string;
  calcMethod?: string;
  annualRate?: number | string;
  createdAt?: string;
  /** เงินต้นคงเหลือรายแผน ถ้า server ส่งมา — ไม่มีก็ใช้ card.remainingPrincipal (สินเชื่อมีแผนเดียว) */
  remainingPrincipal?: number | string;
  /** S2 ส่งมาแล้ว; S3 ยังไม่อ่าน (ส่วนปรับอัตราดอกเบี้ยมาใน S4) */
  rateRevisionCount?: number;
  [key: string]: unknown;
}

type PlanAction = (plan: CreditPlanDetail) => void;
type InstallmentAction = (planId: string, installmentNo: number, paid: boolean, pendingKey: string) => void | Promise<void>;

interface CreditCardDetailProps {
  card: CreditCardDetailData | null;
  plans?: CreditPlanDetail[];
  pendingKeys?: string[];
  onBack?: () => void;
  onEditCard?: (card: CreditCardDetailData) => void;
  onDeleteCard?: (card: CreditCardDetailData) => void;
  /** เปิด sheet เพิ่มรายจ่ายที่ขั้นเลือกประเภท; month = เดือนที่ใช้คำนวณวันที่เริ่มต้น (DD-7) */
  onAddPlanForCard?: (card: CreditCardDetailData, month?: string) => void;
  /** เปิด sheet ที่ขั้นรายจ่ายธรรมดาตรง ๆ (empty state ของรายการไม่ผ่อน) */
  onAddSpendForCard?: (card: CreditCardDetailData, month?: string) => void;
  /** แก้ไขรายการไม่ผ่อนจากเมนู ⋯ ของแถว — หน้าเปิด AddCardExpenseSheet โหมด edit */
  onEditSpendItem?: (item: CreditSpendItem, card: CreditCardDetailData) => void;
  onRenamePlan?: PlanAction;
  onEditPlan?: PlanAction;
  onCancelPlan?: PlanAction;
  onDeletePlan?: PlanAction;
  onToggleInstallment?: InstallmentAction;
  onConfirmMinimum?: ConfirmMinimumHandler;
  onRevolvingChanged?: () => void;
  /** เพิ่มทุกครั้งที่บันทึกรายจ่ายธรรมดาสำเร็จ — ให้โหลดยอด/รายการจากเซิร์ฟเวอร์ใหม่ (ไม่คำนวณฝั่ง client) */
  spendRefreshKey?: number;
  /** เดือนรอบบิลที่เซิร์ฟเวอร์ตอบกลับของรายการที่เพิ่งบันทึก — สลับ statementMonth ไปเดือนนั้น */
  spendSavedMonth?: string | null;
  /** id ของรายการที่เพิ่งบันทึก — ใช้ focus ปุ่ม ⋯ ของแถวนั้นเมื่อย้ายไปเดือนอื่น (I-9/I-34) */
  spendSavedItemId?: string | null;
}

interface PlanRowProps {
  plan: CreditPlanDetail;
  card: CreditCardDetailData;
  isMobileView: boolean;
  pendingKeys: string[];
  isLoan?: boolean;
  onToggleInstallment?: InstallmentAction;
  onRename?: PlanAction;
  onEdit?: PlanAction;
  onCancel?: PlanAction;
  onDelete?: PlanAction;
}

const COLLAPSED_UNPAID_PREVIEW = 6;
const LONG_PLAN_THRESHOLD = 12;
const VISIBLE_COUNT_STEP = 12;

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const CARD = 'rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5';
const BTN_GHOST = `inline-flex min-h-11 items-center justify-center gap-space-2 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary transition-colors duration-fast ease-graphite hover:bg-surface-3 ${FOCUS_RING}`;
const BTN_ADD = `inline-flex min-h-11 items-center justify-center gap-space-2 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent transition-colors duration-fast ease-graphite hover:opacity-90 ${FOCUS_RING}`;
const SECTION_TITLE = 'm-0 text-lg font-semibold text-primary';
const BADGE = 'inline-flex w-fit items-center gap-space-1 rounded-full border border-border-default bg-surface-2 px-space-2 py-[2px] text-xs font-medium text-secondary';

function describePlanInterest(plan: CreditPlanDetail): string {
  if (plan.interestMode === 'manual') {
    return `ค่าธรรมเนียม ${formatCurrency(plan.manualFeePerMonth || 0)} บาท/งวด`;
  }
  const methodLabel = plan.calcMethod === 'effective' ? 'ลดต้นลดดอก' : 'แบบคงที่';
  return `${methodLabel} ${plan.annualRate}%/ปี`;
}

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}

function PlanRow({
  plan,
  card,
  isMobileView,
  pendingKeys,
  isLoan = false,
  onToggleInstallment,
  onRename,
  onEdit,
  onCancel,
  onDelete
}: PlanRowProps) {
  // R-D: มือถือพับ / desktop กาง; ข้าม 768px แล้วรีเซ็ตตามเดิม
  const [open, setOpen] = useState(!isMobileView);
  const [showAll, setShowAll] = useState(false);
  // D-S3-3: จำนวนงวดที่ยังไม่ชำระที่แสดงในพรีวิว — ขยายทีละ 12 งวดต่อคลิก "แสดงเพิ่ม"
  const [visibleCount, setVisibleCount] = useState(COLLAPSED_UNPAID_PREVIEW);

  useEffect(() => {
    setOpen(!isMobileView);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobileView]);

  // รีเซ็ตพรีวิวเมื่อสลับไปดูแผน/ตารางผ่อนอื่น
  useEffect(() => {
    setShowAll(false);
    setVisibleCount(COLLAPSED_UNPAID_PREVIEW);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  const schedule = Array.isArray(plan.schedule) ? plan.schedule : [];
  const nextUnpaidNo = plan.nextUnpaid?.no ?? null;
  const isLongPlan = plan.months > LONG_PLAN_THRESHOLD;
  const detailId = `plan-detail-${plan.id}`;
  const cancelled = plan.status === PLAN_STATUS.CANCELLED;
  const editable = plan.installmentsPaid === 0 && !cancelled;
  const settled = plan.status === PLAN_STATUS.COMPLETED || cancelled;

  const visibleRows = useMemo(() => {
    if (!isLongPlan || showAll) return schedule;
    let unpaidShown = 0;
    return schedule.filter(row => {
      if (row.paid === true) return true;
      if (unpaidShown < visibleCount) {
        unpaidShown += 1;
        return true;
      }
      return false;
    });
  }, [schedule, isLongPlan, showAll, visibleCount]);

  const renderPaidPill = (row: InstallmentScheduleRow) => {
    const key = `${plan.id}_${row.no}`;
    const busy = pendingKeys.includes(key);
    const disabled = busy || cancelled;
    return (
      <button
        type="button"
        className={`${PAID_PILL_CLASS} ${row.paid ? PAID_PILL_ON_CLASS : ''}`}
        disabled={disabled}
        onClick={() => onToggleInstallment?.(plan.id, row.no, !row.paid, key)}
      >
        {row.paid ? PAID_PILL_LABEL_PAID : PAID_PILL_LABEL_UNPAID}
      </button>
    );
  };

  // สินเชื่อใช้คำว่า "ตารางผ่อน" แทน "แผน" (UX §6); กฎ disable เดิมทุกข้อ
  const planNoun = isLoan ? 'ตารางผ่อน' : 'แผน';
  const menuItems: RowActionMenuItem[] = [
    { key: 'rename', label: 'แก้ไขชื่อรายการ', icon: <Icons.Edit size={16} />, onSelect: () => onRename?.(plan) },
    {
      key: 'edit',
      label: `แก้ไข${planNoun}`,
      icon: <Icons.Settings size={16} />,
      disabled: !editable,
      disabledReason: editable
        ? undefined
        : cancelled
          ? `แก้ไขไม่ได้เพราะ${planNoun}ถูกยกเลิกแล้ว`
          : `แก้ไขไม่ได้เพราะชำระไปแล้ว ${plan.installmentsPaid} งวด — ให้ยกเลิก${planNoun}แล้วสร้างใหม่`,
      onSelect: () => onEdit?.(plan)
    },
    ...(cancelled ? [] : [{ key: 'cancel', label: `ยกเลิก${planNoun}`, icon: <Icons.X size={16} />, danger: true, onSelect: () => onCancel?.(plan) }]),
    {
      key: 'delete',
      label: `ลบ${planNoun}`,
      icon: <Icons.Trash size={16} />,
      danger: true,
      disabled: plan.installmentsPaid > 0,
      disabledReason: plan.installmentsPaid > 0 ? `ลบไม่ได้เพราะมีงวดที่ชำระแล้ว — ให้ยกเลิก${planNoun}แทน` : undefined,
      onSelect: () => onDelete?.(plan)
    }
  ];

  return (
    <div className="rounded-sm border border-border-default bg-surface-2 p-space-3">
      <div className="flex items-start gap-space-2">
        <button
          type="button"
          className={`flex min-h-11 min-w-0 flex-1 flex-col gap-space-1 rounded-sm text-left ${FOCUS_RING}`}
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen(value => !value)}
        >
          <span className="flex items-start justify-between gap-space-2">
            <span className="block line-clamp-2 text-base font-bold text-primary" title={plan.itemName}>{plan.itemName}</span>
            <span className={`mt-[2px] shrink-0 text-secondary transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}>
              <Icons.ChevronDown size={16} />
            </span>
          </span>
          <span className="block text-sm font-medium text-primary">{`งวดละ ${formatCurrency(plan.monthlyPayment)} ฿ · ชำระแล้ว ${plan.installmentsPaid}/${plan.months} งวด`}</span>
          <span aria-hidden="true" className="block h-2 overflow-hidden rounded-full bg-surface-3">
            <span className="block h-full rounded-full bg-accent transition-[width] duration-slow ease-graphite" style={{ width: `${plan.progressPercent}%` }} />
          </span>
          {plan.status === PLAN_STATUS.COMPLETED && <span className={`${BADGE} border-pos/40 bg-pos/16 text-pos`}>✓ ผ่อนครบแล้ว</span>}
          {cancelled && <span className={`${BADGE} border-neg/35 bg-neg/14 text-neg`}>ยกเลิกแผนแล้ว</span>}
          {!settled && plan.nextUnpaid && (
            <span className="block text-xs text-secondary">
              {`งวดถัดไป ${plan.nextUnpaid.no}/${plan.months} · ${formatIsoDateTH(resolveCardDueDate(card, plan.nextUnpaid.dueMonth) || '')}`}
            </span>
          )}
        </button>
        <RowActionMenu
          triggerLabel={`ตัวเลือกของแผน ${plan.itemName}`}
          items={menuItems}
          bottomInset={isMobileView ? ADD_BAR_HEIGHT_PX : 0}
        />
      </div>

      {open && (
        <div id={detailId} className="mt-space-2 flex flex-col gap-space-1">
          <span className="text-xs text-secondary">{`${isLoan ? 'ยอดเงินกู้' : 'ราคารวม'} ${formatCurrency(plan.totalPrice)} ฿ · ${plan.months} งวด`}</span>
          <span className="text-xs text-secondary">{`คงเหลือ ${formatCurrency(plan.remainingPayable)} ฿`}</span>
          <span className="text-xs text-secondary">{`ชำระแล้ว ${plan.progressPercent}%`}</span>
          <span className="text-xs text-secondary">{describePlanInterest(plan)}</span>

          {/* C5 table — md+ */}
          <div className="mt-space-2 hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-b border-border-default px-space-2 py-space-2 text-left font-semibold text-tertiary">งวด</th>
                  <th className="whitespace-nowrap border-b border-border-default px-space-2 py-space-2 text-left font-semibold text-tertiary">เดือน</th>
                  <th className="whitespace-nowrap border-b border-border-default px-space-2 py-space-2 text-right font-semibold text-tertiary">ยอดชำระ</th>
                  <th className="whitespace-nowrap border-b border-border-default px-space-2 py-space-2 text-right font-semibold text-tertiary">เงินต้น</th>
                  <th className="whitespace-nowrap border-b border-border-default px-space-2 py-space-2 text-right font-semibold text-tertiary">ดอกเบี้ย</th>
                  <th className="whitespace-nowrap border-b border-border-default px-space-2 py-space-2 text-left font-semibold text-tertiary">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(row => (
                  <tr
                    key={row.no}
                    className={`${row.paid ? 'opacity-60' : ''} ${row.no === nextUnpaidNo ? 'bg-accent-muted' : ''}`}
                  >
                    <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-primary">{row.no}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-primary">{formatMonthKeyTH(row.dueMonth)}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-right font-[family-name:var(--font-numeric)] tabular-nums text-primary">{formatCurrency(row.payment)}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-right font-[family-name:var(--font-numeric)] tabular-nums text-primary">{formatCurrency(row.principal)}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-right font-[family-name:var(--font-numeric)] tabular-nums text-primary">{formatCurrency(row.interest)}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2">{renderPaidPill(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* C4 stack — base */}
          <div className="mt-space-2 flex flex-col gap-space-2 md:hidden">
            {visibleRows.map(row => (
              <div
                key={row.no}
                className={`flex flex-col gap-space-1 rounded-sm border border-border-subtle bg-surface-1 p-space-3 ${row.paid ? 'opacity-65' : ''} ${row.no === nextUnpaidNo ? 'border-l-2 border-l-accent' : ''}`}
              >
                <div className="flex items-baseline justify-between gap-space-2 text-sm text-secondary">
                  <span>{`งวด ${row.no}`}</span>
                  <span>{formatMonthKeyTH(row.dueMonth)}</span>
                </div>
                <span className="font-[family-name:var(--font-numeric)] text-base font-semibold tabular-nums text-primary">{formatCurrency(row.payment)}</span>
                <span className="text-xs text-tertiary">
                  {`ต้น ${formatCurrency(row.principal)} · ดบ ${formatCurrency(row.interest)}`}
                </span>
                {renderPaidPill(row)}
              </div>
            ))}
          </div>

          {isLongPlan && !showAll && visibleRows.length < schedule.length && (
            <div className="mt-space-2 flex flex-col gap-space-2 sm:flex-row">
              <button
                type="button"
                className={`min-h-11 flex-1 rounded-sm border border-dashed border-border-default text-sm text-secondary ${FOCUS_RING}`}
                onClick={() => setVisibleCount(value => value + VISIBLE_COUNT_STEP)}
              >
                {`แสดงเพิ่ม ${VISIBLE_COUNT_STEP} งวด`}
              </button>
              <button
                type="button"
                className={`min-h-11 flex-1 rounded-sm border border-dashed border-border-default text-sm text-secondary ${FOCUS_RING}`}
                onClick={() => setShowAll(true)}
              >
                {`แสดงทั้งหมด (${plan.months} งวด)`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CreditCardDetail({
  card,
  plans = [],
  pendingKeys = [],
  onBack,
  onEditCard,
  onDeleteCard,
  onAddPlanForCard,
  onAddSpendForCard,
  onEditSpendItem,
  onRenamePlan,
  onEditPlan,
  onCancelPlan,
  onDeletePlan,
  onToggleInstallment,
  onConfirmMinimum,
  onRevolvingChanged,
  spendRefreshKey = 0,
  spendSavedMonth = null,
  spendSavedItemId = null
}: CreditCardDetailProps) {
  const payableCycle = useMemo(
    () => (card ? getPayableCycleMonth(card, getCurrentMonthKey()) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card?.statementDay, card?.dueDay]
  );

  const [statementMonth, setStatementMonth] = useState(() => (card ? getPayableCycleMonth(card, getCurrentMonthKey()) : getCurrentMonthKey()));
  // DD-7: false = ผู้ใช้ยังไม่ได้ขยับเดือนในรอบการเข้าชมนี้ → เพิ่มรายจ่ายใช้เดือนปฏิทินปัจจุบัน
  const [monthTouched, setMonthTouched] = useState(false);
  const [trackedCardId, setTrackedCardId] = useState<string | undefined>(card?.id);
  // เริ่ม/รีเซ็ตเดือนตอน card.id เปลี่ยน (รวม undefined → id) ระหว่าง render เพื่อไม่ให้ fetch เดือนเก่าก่อนหนึ่งรอบ;
  // undefined → id ไม่แย่งเดือนที่ผู้ใช้ขยับไปแล้ว แต่ id → id อื่นรีเซ็ตเสมอ (DD-8) และ monthTouched รีเซ็ตด้วย
  // s-1: id A → ไม่มีบัตร → id B ต้องรีเซ็ตเหมือน A → B (ไม่แย่งเดือนเฉพาะกรณียังไม่เคยมีบัตรเลย)
  const [hadCard, setHadCard] = useState(Boolean(card?.id));
  if (card?.id !== trackedCardId) {
    setTrackedCardId(card?.id);
    if (card && !hadCard) setHadCard(true);
    if (card && !(!hadCard && monthTouched)) {
      setStatementMonth(getPayableCycleMonth(card, getCurrentMonthKey()));
      setMonthTouched(false);
    }
  }

  const [localTick, setLocalTick] = useState(0);
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  // เปลี่ยนเดือนเฉพาะเมื่อ key เปลี่ยนหลัง mount; ค่า key ที่ค้างจากการบันทึกก่อนหน้าต้องไม่ดึงเดือนตอนเปิดหน้า
  const seenSpendKeyRef = useRef(spendRefreshKey);
  const statementMonthRef = useRef(statementMonth);
  statementMonthRef.current = statementMonth;
  useEffect(() => {
    if (seenSpendKeyRef.current === spendRefreshKey) return;
    seenSpendKeyRef.current = spendRefreshKey;
    // M-1: monthTouched และ focus แถวใหม่เกิดเฉพาะเมื่อบันทึกแล้ว "สลับเดือน" จริง;
    // เดือนเดิมให้ list refetch เงียบ ๆ และคง focus ที่ปุ่มเปิดไว้ (§6.5, I-35)
    if (spendRefreshKey > 0 && spendSavedMonth && MONTH_KEY_RE.test(spendSavedMonth) && spendSavedMonth !== statementMonthRef.current) {
      setStatementMonth(spendSavedMonth);
      setMonthTouched(true);
      if (spendSavedItemId) setFocusItemId(spendSavedItemId);
    }
  }, [spendRefreshKey, spendSavedMonth, spendSavedItemId]);

  const [isMobileView, setIsMobileView] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < BP.md
  );
  // I-38: ซ่อนแถบเพิ่มรายจ่ายขณะ focus อยู่ที่ช่องกรอก เพื่อไม่ให้ลอยเหนือคีย์บอร์ดมือถือ
  const [fieldFocused, setFieldFocused] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia(`(max-width: ${BP.md - 1}px)`);
    const update = () => setIsMobileView(media.matches);
    update();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  const handleRevolvingChanged = () => { onRevolvingChanged?.(); };
  // สินเชื่อไม่มียอดหมุนเวียน (BR-CC-038) — ไม่ต้องดึงรอบบิล
  const rev = useRevolvingCycle({
    card: isLoanCardType(card?.cardType) ? null : card,
    month: statementMonth,
    refreshKey: spendRefreshKey + localTick,
    onChanged: handleRevolvingChanged,
    onConfirmMinimum
  });

  const orderedPlans = useMemo(() => {
    const rank = (plan: CreditPlanDetail) => (plan.status === PLAN_STATUS.ONGOING ? 0 : 1);
    return [...plans].sort((a, b) => rank(a) - rank(b) || String(a.createdAt).localeCompare(String(b.createdAt)));
  }, [plans]);
  const ongoingPlans = orderedPlans.filter(plan => plan.status === PLAN_STATUS.ONGOING);
  const settledPlans = orderedPlans.filter(plan => plan.status !== PLAN_STATUS.ONGOING);
  const [settledOpen, setSettledOpen] = useState(false);

  if (!card) {
    return (
      <div className="flex flex-col items-center gap-space-3 rounded-md border border-dashed border-border-default bg-sunken px-space-5 py-space-7 text-center">
        <Icons.AlertTriangle size={40} color="var(--color-neg, #F87171)" />
        <h2 className="m-0 text-lg font-semibold text-primary">ไม่พบบัตรใบนี้</h2>
        <button type="button" className={BTN_GHOST} onClick={onBack}>กลับหน้าภาพรวม</button>
      </div>
    );
  }

  const isLoan = isLoanCardType(card.cardType);
  // สินเชื่อมีแผนได้แผนเดียว (BR-CC-034): ใช้แผนที่กำลังผ่อนก่อน ไม่มีก็แผนแรกที่จบแล้ว
  const loanPlan = isLoan ? (ongoingPlans[0] ?? orderedPlans[0] ?? null) : null;
  const creditLimit = Number(card.creditLimit) || 0;
  const utilisation = creditLimit > 0
    ? Math.min(100, round2((Number(card.remainingPrincipal) || 0) / creditLimit * 100))
    : 0;

  // DD-7: ผู้ใช้ยังไม่ขยับเดือน → ใช้เดือนปฏิทินเพื่อให้วันที่เริ่มต้นของ sheet เหมือนเดิม; ขยับแล้ว → ใช้เดือนที่ดูอยู่
  const addMonth = monthTouched ? statementMonth : getCurrentMonthKey();
  const bottomInset = isMobileView && !isLoan ? ADD_BAR_HEIGHT_PX : 0;

  const blurCashbackIfFocused = () => {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.id === 'revolving-cashback') active.blur();
  };

  // เปลี่ยนเดือนด้วยตัวสลับ: blur ช่องแคชแบคก่อนเพื่อให้บันทึกของเดือนเดิมเสร็จ/ถูกส่งก่อน (I-26)
  const handleMonthChange = (next: string) => {
    if (!MONTH_KEY_RE.test(next)) return;
    blurCashbackIfFocused();
    setStatementMonth(next);
    setMonthTouched(true);
  };

  const handleResetToPayable = () => {
    blurCashbackIfFocused();
    setStatementMonth(payableCycle);
    setMonthTouched(false);
  };

  // รายการไม่ผ่อนเปลี่ยน (ลบ): โหลดสรุป/ยอดรวมบัตรใหม่จาก server; เดือนอื่น → สลับไปเดือนนั้น (เหมือน onChanged เดิม)
  const handleSpendItemsChanged = (changedMonth: string) => {
    if (changedMonth && changedMonth !== statementMonth && MONTH_KEY_RE.test(changedMonth)) {
      setStatementMonth(changedMonth);
      setMonthTouched(true);
    }
    setLocalTick(value => value + 1);
    onRevolvingChanged?.();
  };

  const handleFocusIn = (event: FocusEvent<HTMLDivElement>) => setFieldFocused(isTextField(event.target));
  const handleFocusOut = () => setFieldFocused(false);

  const cardMenuItems: RowActionMenuItem[] = [
    { key: 'edit-card', label: isLoan ? 'แก้ไขสินเชื่อ' : 'แก้ไขบัตร', icon: <Icons.Edit size={16} />, onSelect: () => onEditCard?.(card) },
    { key: 'delete-card', label: isLoan ? 'ลบสินเชื่อ' : 'ลบบัตร', icon: <Icons.Trash size={16} />, danger: true, onSelect: () => onDeleteCard?.(card) }
  ];

  const renderPlanRow = (plan: CreditPlanDetail) => (
    <PlanRow
      key={plan.id}
      plan={plan}
      card={card}
      isMobileView={isMobileView}
      pendingKeys={pendingKeys}
      isLoan={isLoan}
      onToggleInstallment={onToggleInstallment}
      onRename={onRenamePlan}
      onEdit={onEditPlan}
      onCancel={onCancelPlan}
      onDelete={onDeletePlan}
    />
  );

  return (
    <div
      className="flex flex-col gap-space-4"
      style={isMobileView && !isLoan ? { paddingBottom: ADD_BAR_HEIGHT_PX } : undefined}
      onFocus={handleFocusIn}
      onBlur={handleFocusOut}
    >
      <div className="flex items-center gap-space-3">
        <button type="button" className={BTN_GHOST} onClick={onBack} aria-label="กลับหน้าภาพรวม">
          <Icons.ChevronLeft size={16} /> กลับ
        </button>
        <div className="ml-auto flex items-center gap-space-2">
          {!isMobileView && !isLoan && (
            <button type="button" data-add-expense-fallback className={BTN_ADD} onClick={() => onAddPlanForCard?.(card, addMonth)}>
              <span aria-hidden="true"><Icons.Plus size={16} /></span> เพิ่มรายจ่าย
            </button>
          )}
          <RowActionMenu triggerLabel={`ตัวเลือกของบัตร ${card.name}`} items={cardMenuItems} bottomInset={bottomInset} />
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-space-4 md:grid-cols-[320px_minmax(0,1fr)]">
        <div className="flex flex-col gap-space-4 md:sticky md:top-[90px]">
          {/* identity header (CD-A): เบากว่าการ์ดอื่น — ไม่มีเงา */}
          {isLoan ? (
          <header
            className="flex flex-col gap-space-2 rounded-md border border-border-default border-l-4 bg-surface-1 p-space-4"
            style={{ borderLeftColor: card.color || 'var(--color-accent, #D4A857)' }}
            data-testid="loan-detail-header"
          >
            <div className="flex items-center gap-space-2">
              <BankIssuerMark card={card} size={28} />
              <h2 className={`${SECTION_TITLE} min-w-0 break-words`}>{card.name}</h2>
            </div>
            <span className="text-xs text-tertiary">
              {[CARD_TYPE_LABELS[isLoanCardType(card.cardType) ? card.cardType : 'credit_card'].label, card.bankName, card.last4 ? `····${card.last4}` : ''].filter(Boolean).join(' · ')}
            </span>
            {/* ตัวเลขทุกตัวมาจาก server (plan/card) — แค่จัดวาง ไม่คำนวณ */}
            <dl className="m-0 grid grid-cols-2 gap-space-2">
              <div className="flex min-w-0 flex-col rounded-sm bg-surface-2 p-space-2">
                <dt className="text-xs text-tertiary">เงินต้นคงเหลือ</dt>
                <dd className="m-0 break-words font-[family-name:var(--font-numeric)] text-sm font-semibold tabular-nums text-primary">
                  {loanPlan ? `${formatCurrency(loanPlan.remainingPrincipal ?? card.remainingPrincipal ?? 0)} ฿` : '-'}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col rounded-sm bg-surface-2 p-space-2">
                <dt className="text-xs text-tertiary">ค่างวดปัจจุบัน</dt>
                <dd className="m-0 break-words font-[family-name:var(--font-numeric)] text-sm font-semibold tabular-nums text-primary">
                  {loanPlan ? `${formatCurrency(loanPlan.nextUnpaid?.payment ?? 0)} ฿` : '-'}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col rounded-sm bg-surface-2 p-space-2">
                <dt className="text-xs text-tertiary">ดอกเบี้ยปัจจุบัน</dt>
                <dd className="m-0 break-words text-sm font-semibold text-primary">
                  {loanPlan ? `${(Number(loanPlan.annualRate) || 0).toFixed(2)}% ต่อปี` : '-'}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col rounded-sm bg-surface-2 p-space-2">
                <dt className="text-xs text-tertiary">งวดคงเหลือ</dt>
                <dd className="m-0 break-words text-sm font-semibold text-primary">
                  {loanPlan ? `${loanPlan.installmentsRemaining ?? loanPlan.months} / ${loanPlan.months} งวด` : '-'}
                </dd>
              </div>
            </dl>
            <span className="text-xs text-secondary">
              {`ครบกำหนดทุกวันที่ ${formatDayLabel(card.dueDay as number | string)}`}
              {loanPlan?.status === PLAN_STATUS.ONGOING && loanPlan.nextUnpaid
                ? ` · งวดถัดไป ${formatIsoDateTH(resolveCardDueDate(card, loanPlan.nextUnpaid.dueMonth) || '')}`
                : ''}
            </span>
          </header>
          ) : (
          <header className="flex flex-col gap-space-1 rounded-md border border-border-default border-l-4 bg-surface-1 p-space-4" style={{ borderLeftColor: card.color || 'var(--color-accent, #D4A857)' }}>
            <div className="flex items-center gap-space-2">
              <BankIssuerMark card={card} size={28} />
              <h2 className={`${SECTION_TITLE} min-w-0 break-words`}>{card.name}</h2>
            </div>
            <span className="text-xs text-tertiary">
              {[card.bankName, card.last4 ? `····${card.last4}` : ''].filter(Boolean).join(' · ') || 'ไม่ระบุธนาคาร'}
            </span>
            <span className="text-xs text-tertiary">{`สรุปยอด ${formatDayLabel(card.statementDay as number | string)} · ครบกำหนด ${formatDayLabel(card.dueDay as number | string)}`}</span>
            {creditLimit > 0 && (
              <>
                <span className="mt-space-1 text-sm text-secondary">{`ใช้ไป ${formatCurrency(card.remainingPrincipal || 0)} / ${formatCurrency(creditLimit)} ฿`}</span>
                <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className={`h-full rounded-full transition-[width] duration-slow ease-graphite ${utilisation >= 80 ? 'bg-neg' : 'bg-accent'}`}
                    style={{ width: `${utilisation}%` }}
                  />
                </div>
                <span className="text-xs text-secondary">{`${utilisation.toFixed(1)}%`}</span>
                <span className="text-sm text-secondary">{`คงเหลือ ${formatCurrency(card.availableCredit || 0)} ฿`}</span>
              </>
            )}
            <span className="text-sm text-secondary">{`หนี้คงเหลือรวม ${formatCurrency(card.remainingPayable)} ฿`}</span>
            {/* แยกที่มาให้ชัด มิฉะนั้นตัวเลขรวมจะอธิบายไม่ได้เมื่อมีสองแหล่งป้อนเข้ามา */}
            {Number(card.revolvingDue) > 0 && (
              <span className="text-xs text-tertiary">{`ผ่อนชำระ ${formatCurrency(card.installmentPayable || 0)} · ยอดหมุนเวียน ${formatCurrency(card.revolvingDue || 0)}`}</span>
            )}
            {/* เครดิตแคชแบคแสดงแยก ไม่หักจากหนี้คงเหลือ/วงเงิน (N-1, BR-CC-031) */}
            {Number(card.revolvingCredit) > 0 && (
              <span className="text-xs text-pos">{`เครดิตแคชแบค ${formatCurrency(card.revolvingCredit || 0)}`}</span>
            )}
          </header>
          )}

          {!isLoan && (
          <CardPayNextSummary
            card={card}
            month={statementMonth}
            status={rev.status}
            currentCycle={rev.currentCycle}
            previousMonthCycle={rev.previousMonthCycle}
            cardTotal={rev.cardTotal}
            busy={rev.busy}
            onPayFull={() => { void rev.payFull(); }}
            onPayMinimum={rev.payMinimum}
            onUndo={() => { void rev.undoPayment(); }}
            onRetry={rev.retry}
            switcher={(
              <BillingMonthSwitcher
                month={statementMonth}
                payableCycle={payableCycle}
                onChange={handleMonthChange}
                onReset={handleResetToPayable}
              />
            )}
          />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-space-4">
          {!isLoan && (
          <CreditSpendItems
            key={`${card.id}-${statementMonth}`}
            cardId={card.id}
            month={statementMonth}
            refreshKey={spendRefreshKey}
            focusItemId={focusItemId}
            isMobileView={isMobileView}
            menuBottomInset={bottomInset}
            onEdit={item => onEditSpendItem?.(item, card)}
            onAddSimple={() => onAddSpendForCard?.(card, addMonth)}
            onFocusHandled={() => setFocusItemId(null)}
            onChanged={handleSpendItemsChanged}
          />
          )}

          <section className={`${CARD} flex flex-col gap-space-3`}>
            <h3 className={SECTION_TITLE}>{isLoan ? 'ตารางผ่อน' : `แผนผ่อนชำระ (${plans.length})`}</h3>
            {orderedPlans.length === 0 ? (
              <p className="m-0 text-sm text-tertiary">
                {isLoan ? 'ยังไม่มีตารางผ่อนของสินเชื่อนี้' : 'ยังไม่มีแผนผ่อนในบัตรนี้ — กด “เพิ่มรายจ่าย” เพื่อเริ่มต้น'}
              </p>
            ) : (
              <div className="flex flex-col gap-space-3">
                {ongoingPlans.map(renderPlanRow)}
                {settledPlans.length > 0 && (
                  <>
                    <button
                      type="button"
                      className={`flex min-h-11 w-full items-center justify-between gap-space-2 rounded-sm border border-border-default bg-surface-2 px-space-3 text-left text-sm font-medium text-secondary ${FOCUS_RING}`}
                      aria-expanded={settledOpen}
                      aria-controls="settled-plans-panel"
                      onClick={() => setSettledOpen(value => !value)}
                    >
                      {`แผนที่จบแล้ว (${settledPlans.length})`}
                      <span className={`transition-transform motion-reduce:transition-none ${settledOpen ? 'rotate-180' : ''}`}><Icons.ChevronDown size={16} /></span>
                    </button>
                    {settledOpen && (
                      <div id="settled-plans-panel" className="flex flex-col gap-space-3 text-secondary">
                        {settledPlans.map(renderPlanRow)}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </section>

          {!isLoan && <RevolvingBalanceSection month={statementMonth} isMobileView={isMobileView} rev={rev} />}
        </div>
      </div>

      {isMobileView && !isLoan && (
        <div
          hidden={fieldFocused}
          className="fixed inset-x-0 z-[90] border-t border-border-subtle bg-surface-1 px-space-4 py-space-3"
          style={{ bottom: 'var(--nav-safe-bottom, 56px)' }}
        >
          <button
            type="button"
            data-add-expense-fallback
            className={`flex min-h-12 w-full items-center justify-center gap-space-2 rounded-sm bg-accent px-space-4 text-sm font-semibold text-on-accent transition-colors duration-fast ease-graphite hover:opacity-90 ${FOCUS_RING}`}
            onClick={() => onAddPlanForCard?.(card, addMonth)}
          >
            <span aria-hidden="true"><Icons.Plus size={16} /></span> เพิ่มรายจ่าย
          </button>
        </div>
      )}
    </div>
  );
}
