/**
 * คอมโพเนนต์: AccountBreakdownPanel
 * panel แจกแจงยอดของบัญชีธนาคารหนึ่งบัญชี/หนึ่งคอลัมน์ (เดือนนี้ หรือ ค้างเดือนก่อน)
 *
 * แสดงผลอย่างเดียว: ตัวเลขทุกตัวมาจาก AccountBreakdown ที่ getAccountBreakdown สร้าง (breakdown.total คือยอดที่ตารางแสดง)
 * ไม่รวมยอดใหม่ ไม่เรียกฟังก์ชันคำนวณบัตรเครดิต (buildSchedule / buildRevolvingCycles) — แถวบัตรอ่าน breakdown ที่ server ส่งมาเท่านั้น
 */

import { useState, type KeyboardEvent } from 'react';
import type { AccountBreakdown, AccountBreakdownItem } from '../../shared/utils/commonUtils';
import type { MonthKey } from '../../shared/types/domain';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { formatMonthKeyTH } from '../../shared/utils/dateUtils';
import { isRevolvingRowKey, formatIsoDateTH } from '../../shared/utils/creditCardUtils';
import { formatRowDueText, getValidResolvedDueDate } from '../../shared/utils/frontend/expenseDueText';
import { Icons } from './Icons';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const NUMERIC = 'font-[family-name:var(--font-numeric)] tabular-nums';

export interface BreakdownView {
  listed: AccountBreakdownItem[];
  zeroCount: number;
  paidListed: AccountBreakdownItem[];
}

const finiteOrZero = (value: number): number => (Number.isFinite(value) ? value : 0);

/** U-9: amount มาก→น้อย แล้วชื่อ (th) แล้ว key — ใช้แสดงผลเท่านั้น ไม่ป้อนกลับเข้าการรวมยอด */
const compareItems = (a: AccountBreakdownItem, b: AccountBreakdownItem): number => {
  const byAmount = finiteOrZero(b.amount) - finiteOrZero(a.amount);
  if (byAmount !== 0) return byAmount;
  const byName = a.name.localeCompare(b.name, 'th');
  if (byName !== 0) return byName;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
};

/** จัดเรียง (U-9) และแยกแถวยอด 0 (U-10) เท่านั้น — ไม่รวมเงิน */
export function toBreakdownView(breakdown: AccountBreakdown | null | undefined): BreakdownView {
  const items = breakdown?.items ?? [];
  const paidItems = breakdown?.paidItems ?? [];
  return {
    listed: items.filter(item => item.amount !== 0).sort(compareItems),
    zeroCount: items.filter(item => item.amount === 0).length,
    paidListed: paidItems.filter(item => item.amount !== 0).sort(compareItems)
  };
}

/** chevron ในช่อง gutter ขนาด 16px คงที่ (U-1) — หมุน 180° เมื่อเปิด */
export function Chevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center text-tertiary transition-transform duration-fast ease-graphite motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
    >
      <Icons.ChevronDown size={16} />
    </span>
  );
}

interface CardView {
  installments: Array<{ key: string; name: string; amount: number; paid: boolean }>;
  nonInstallment: number;
  parts: string[];
  minimumCaption: string | null;
}

const toNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** อ่าน breakdown ของแถวบัตรเพื่อแสดงผล — ไม่ well-formed => null (DD-10) */
function readCardView(item: AccountBreakdownItem): CardView | null {
  if (!isRevolvingRowKey(item.key)) return null;
  const breakdown = item.breakdown;
  if (!breakdown || typeof breakdown !== 'object') return null;
  if (!Array.isArray(breakdown.installments)) return null;
  const revolving = breakdown.revolving;
  if (!revolving || typeof revolving !== 'object') return null;

  const parts: string[] = [];
  const newSpend = toNumber(revolving.newSpend);
  const carried = toNumber(revolving.carriedBalance);
  const cashback = toNumber(revolving.cashbackAmount);
  if (newSpend !== 0) parts.push(`ใช้จ่ายใหม่ ${formatCurrency(newSpend)}`);
  if (carried !== 0) parts.push(`ยอดยกมา ${formatCurrency(carried)}`);
  if (cashback !== 0) parts.push(`เงินคืน ${formatCurrency(cashback)}`);

  return {
    installments: breakdown.installments.map((line, index) => ({
      key: String(line?.key ?? index),
      name: String(line?.name ?? ''),
      amount: toNumber(line?.amount),
      paid: line?.paid === true
    })),
    // display clamp ของตัวเลข server (SPEND-4) — ไม่ใช่สูตรใหม่
    nonInstallment: Math.max(0, toNumber(revolving.totalDue)),
    parts,
    minimumCaption: revolving.paymentAction === 'minimum' ? `ชำระขั้นต่ำแล้ว ${formatCurrency(toNumber(revolving.minPaymentDue))}` : null
  };
}

/** caption ของแถว (§4.4): รอบบิล (แถวบัตร) · ครบกำหนด */
function buildCaption(item: AccountBreakdownItem, columnMonthKey: MonthKey | null | undefined): string {
  const isCard = isRevolvingRowKey(item.key);
  const parts: string[] = [];
  if (isCard && typeof item.cycleMonth === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(item.cycleMonth)) {
    parts.push(`รอบบิล ${formatMonthKeyTH(item.cycleMonth as MonthKey)}`);
  }
  const resolved = getValidResolvedDueDate(item.resolvedDueDate);
  if (resolved && (isCard || resolved.slice(0, 7) !== columnMonthKey)) {
    parts.push(`ครบกำหนด ${formatIsoDateTH(resolved)}`);
  } else {
    const dueText = formatRowDueText(item, columnMonthKey);
    if (dueText) parts.push(`ครบกำหนด${dueText}`);
  }
  return parts.join(' · ');
}

interface AccountBreakdownPanelProps {
  id: string;
  titleId: string;
  /** "เดือนนี้" หรือ "ค้างเดือนก่อน (ต.ค. 2569)" */
  columnLabel: string;
  account: string;
  breakdown: AccountBreakdown | null | undefined;
  columnMonthKey?: MonthKey | null;
  onClose: () => void;
}

export default function AccountBreakdownPanel({
  id,
  titleId,
  columnLabel,
  account,
  breakdown,
  columnMonthKey,
  onClose
}: AccountBreakdownPanelProps) {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(() => new Set());
  const [paidOpen, setPaidOpen] = useState(false);
  const view = toBreakdownView(breakdown);
  const total = breakdown?.total ?? 0;

  const toggleCard = (key: string) => {
    setExpandedCards(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onClose();
  };

  const renderItem = (item: AccountBreakdownItem, cardId: string, muted: boolean) => {
    const caption = buildCaption(item, columnMonthKey);
    const card = readCardView(item);
    const amountTone = muted ? 'text-secondary' : 'text-primary';
    const nameCell = (
      <span className="min-w-0 flex-1">
        <span className={`block break-words [overflow-wrap:anywhere] ${muted ? 'text-secondary' : 'text-primary'}`}>{item.name}</span>
        {caption && <span className="block text-xs text-secondary">{caption}</span>}
      </span>
    );
    const amountCell = <span className={`whitespace-nowrap ${NUMERIC} ${amountTone}`}>{formatCurrency(item.amount)}</span>;

    if (!card) {
      return (
        <li key={item.key} className="flex items-start justify-between gap-space-3 py-space-2">
          {nameCell}
          {amountCell}
        </li>
      );
    }

    const expanded = expandedCards.has(item.key);
    const showNonInstallment = card.nonInstallment > 0 || card.parts.length > 0;
    const summary = `ผ่อน ${card.installments.length} งวด${showNonInstallment ? ` · ไม่ผ่อน ${formatCurrency(card.nonInstallment)}` : ''}`;
    return (
      <li key={item.key} className="py-space-1">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={cardId}
          onClick={() => toggleCard(item.key)}
          className={`flex min-h-11 w-full items-start justify-between gap-space-3 rounded-sm py-space-2 text-left hover:bg-surface-3 transition-colors duration-fast ease-graphite motion-reduce:transition-none ${FOCUS_RING}`}
        >
          <span className="flex min-w-0 flex-1 items-start gap-space-2">
            <span className="mt-[2px]"><Chevron open={expanded} /></span>
            <span className="min-w-0 flex-1">
              <span className={`block break-words [overflow-wrap:anywhere] ${muted ? 'text-secondary' : 'text-primary'}`}>{item.name}</span>
              {caption && <span className="block text-xs text-secondary">{caption}</span>}
              <span className="block text-xs text-secondary">{summary}</span>
            </span>
          </span>
          {amountCell}
          <span className="sr-only">แจกแจงงวดผ่อนของ {item.name}</span>
        </button>
        {expanded && (
          <ul id={cardId} className="m-0 ml-space-2 list-none border-l border-border-subtle pl-space-4">
            {card.installments.map(line => (
              <li key={line.key} className="flex items-start justify-between gap-space-3 py-space-1 text-sm">
                <span className="min-w-0 break-words [overflow-wrap:anywhere] text-secondary">
                  {line.name}
                  {line.paid && <span className="ml-space-2 text-xs text-secondary">ชำระแล้ว</span>}
                </span>
                <span className={`whitespace-nowrap ${NUMERIC} text-secondary`}>{formatCurrency(line.amount)}</span>
              </li>
            ))}
            {showNonInstallment && (
              <li className="py-space-1 text-sm">
                <div className="flex items-start justify-between gap-space-3">
                  <span className="min-w-0 text-secondary">ยอดไม่ผ่อนที่ต้องชำระ</span>
                  <span className={`whitespace-nowrap ${NUMERIC} text-secondary`}>{formatCurrency(card.nonInstallment)}</span>
                </div>
                {card.parts.length > 0 && <p className="m-0 text-xs text-secondary">{card.parts.join(' · ')}</p>}
                {card.minimumCaption && <p className="m-0 text-xs text-secondary">{card.minimumCaption}</p>}
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div role="region" aria-labelledby={titleId} id={id} onKeyDown={handleKeyDown}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-space-3 gap-y-space-1">
        <h5 id={titleId} className="m-0 text-sm font-semibold text-primary">{columnLabel} · {account}</h5>
        <p className="m-0 text-sm text-secondary">
          รวม <span className={`font-semibold text-primary ${NUMERIC}`}>{formatCurrency(total)}</span> บาท · {view.listed.length} รายการ
        </p>
      </div>

      {view.listed.length === 0 ? (
        <p className="m-0 mt-space-2 text-sm text-secondary">ไม่มีรายการค้างจ่าย</p>
      ) : (
        <ul className="m-0 mt-space-2 list-none p-0">
          {view.listed.map((item, index) => renderItem(item, `${id}-card-${index}`, false))}
        </ul>
      )}
      {view.zeroCount > 0 && <p className="m-0 mt-space-1 text-xs text-secondary">ยังไม่กรอกยอดอีก {view.zeroCount} รายการ</p>}

      {view.paidListed.length > 0 && (
        <div className="mt-space-2">
          <button
            type="button"
            aria-expanded={paidOpen}
            aria-controls={`${id}-paid`}
            onClick={() => setPaidOpen(open => !open)}
            className={`flex min-h-11 w-full items-center gap-space-2 rounded-sm text-left text-sm text-secondary hover:bg-surface-3 transition-colors duration-fast ease-graphite motion-reduce:transition-none ${FOCUS_RING}`}
          >
            <Chevron open={paidOpen} />
            <span>จ่ายแล้ว {view.paidListed.length} รายการ (ไม่นับในยอด)</span>
          </button>
          {paidOpen && (
            <ul id={`${id}-paid`} aria-label="จ่ายแล้ว ไม่นับรวมในยอด" className="m-0 list-none p-0">
              {view.paidListed.map((item, index) => renderItem(item, `${id}-card-paid-${index}`, true))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-space-2 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className={`inline-flex min-h-11 items-center rounded-sm px-space-3 text-sm font-medium text-accent hover:bg-surface-3 ${FOCUS_RING}`}
        >
          ซ่อนรายละเอียด
        </button>
      </div>
    </div>
  );
}
