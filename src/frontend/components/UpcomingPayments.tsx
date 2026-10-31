/**
 * คอมโพเนนต์: UpcomingPayments
 * รายการ "ครบกำหนด" 3 กลุ่ม (เกินกำหนด/วันนี้/ใน 7 วัน) จาก collectUpcomingPayments() — ไม่ derive เอง
 * ปุ่มการทำรายการ (ผ่อนชำระ/ยอดหมุนเวียน) ใช้ handler ชุดเดียวกับ DashboardCalendarSection ที่ pages/index.js
 * เป็นเจ้าของ — ไม่มีสำเนาที่สาม (ดูหมายเหตุใน DashboardCalendarSection.js)
 *
 * ตัวกรอง (ring legend/arc) กรองด้วย source: รายจ่ายทั่วไป = 'plain', บัตรเครดิต = 'installment'|'revolving'
 * รายจ่ายประจำวัน/เงินออม ไม่มีวันครบกำหนดโดยออกแบบ — กรองแล้วว่างเปล่าเสมอ พร้อมลิงก์ไปหน้าที่เกี่ยวข้อง (BR-DASH-012)
 *
 * Graphite redesign (Dashboard pass) — Tailwind only ไม่ import Dashboard.module.css/CreditCard.module.css
 * อีกต่อไป (~10 คลาสที่เคยยืมจาก CreditCard.module.css — upcomingItem/paidPill/ฯลฯ — reimplement เป็น
 * Tailwind utility ตรง ๆ ในไฟล์นี้เอง architecture-review-dashboard-graphite.md Finding 1) นี่คือ "การ์ด
 * ครบกำหนด" ที่ตาม UX_SPEC §6.3 ย้ายมาเป็นองค์ประกอบแรกของหน้า (journey J1) — ลำดับ DOM จริงจัดที่
 * pages/index.js ไม่ใช่ที่นี่
 */

import { useEffect, useRef, useState } from 'react';
import { useListCriteria } from '../contexts/ListViewContext';
import { compareListValues, matchesListQuery } from '../../shared/utils/frontend/listView';
import { useListProjection } from '../../shared/utils/frontend/useListProjection';
import ListToolbar from './ListToolbar';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { formatIsoDateTH, describeDueDistance } from '../../shared/utils/creditCardUtils';
import { collectUpcomingPayments, collectPaidCardPayments } from '../../shared/utils/frontend/expenseEvents';
import { cardGroupKey, groupUpcomingByCard, isCardGroup } from '../../shared/utils/frontend/upcomingCardGroups';
import type { UpcomingCardGroup, UpcomingRow } from '../../shared/utils/frontend/upcomingCardGroups';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const PAID_PILL = `w-full min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-3 py-space-2 text-center text-sm font-semibold text-secondary tabular-nums ${FOCUS_RING}`;

type UpcomingEvent = ReturnType<typeof collectUpcomingPayments>['overdue'][number];
type UpcomingFilter = 'generalExpense' | 'creditCard' | 'dailyExpense' | 'savings';
type PaidEvent = ReturnType<typeof collectPaidCardPayments>[number];
type EventAction = (event: UpcomingEvent) => void | Promise<void>;
type PaidEventAction = (event: PaidEvent) => void | Promise<void>;

interface FilterEmptyCopy {
  text: string;
  href?: string;
}

const FILTER_EMPTY_COPY: Record<UpcomingFilter, FilterEmptyCopy> = {
  generalExpense: { text: 'ไม่มีรายจ่ายทั่วไปที่ครบกำหนดในช่วงนี้' },
  creditCard: { text: 'ไม่มีรายการบัตรเครดิตที่ครบกำหนดในช่วงนี้' },
  dailyExpense: { text: 'รายจ่ายประจำวันไม่มีวันครบกำหนด ดูรายละเอียดในหน้ารายจ่ายรายวัน', href: '/workspace/daily' },
  savings: { text: 'เงินออมไม่มีวันครบกำหนด', href: '/workspace/savings' }
};

interface UpcomingPaymentsProps {
  upcoming?: ReturnType<typeof collectUpcomingPayments> | null;
  filter?: UpcomingFilter | null;
  onClearFilter?: () => void;
  onViewCalendar?: () => void;
  pendingKeys?: string[];
  onToggleInstallment?: EventAction & PaidEventAction;
  onRevolvingFull?: EventAction;
  onRevolvingMinimum?: EventAction;
  highlightedKey?: string | null;
  /** รายการบัตรเครดิตที่ชำระแล้วของเดือนที่เลือก (collectPaidCardPayments) — ไม่ผ่าน ListToolbar */
  paidEvents?: PaidEvent[];
  onRevolvingCancel?: PaidEventAction;
}

interface UpcomingItemProps {
  event: UpcomingEvent;
  pendingKeys: string[];
  onToggleInstallment?: EventAction;
  onRevolvingFull?: EventAction;
  onRevolvingMinimum?: EventAction;
  highlighted: boolean;
  /** อยู่ในการ์ดบัตร: ไม่ซ้ำบรรทัดวันที่ (อยู่ที่หัวการ์ดแล้ว) */
  compact?: boolean;
}

type UpcomingLine = UpcomingEvent & { urgency: string };
type Row = UpcomingRow<UpcomingLine>;

interface GroupProps extends Omit<UpcomingItemProps, 'event' | 'highlighted'> {
  title: string;
  events: Row[];
  highlightedKey?: string | null;
  expanded: Set<string>;
  onToggleExpanded: (groupKey: string) => void;
  paidCounts: Map<string, number>;
}

function groupTypeMatches(row: Row, type: string): boolean {
  return isCardGroup(row) ? row.lines.some(line => line.source === type) : row.source === type;
}

function matchesFilter(event: Pick<UpcomingEvent, 'source'>, filter?: UpcomingFilter | null): boolean {
  if (!filter) return true;
  if (filter === 'generalExpense') return event.source === 'plain';
  if (filter === 'creditCard') return event.source === 'installment' || event.source === 'revolving';
  return false; // dailyExpense / เงินออม ไม่มีเหตุการณ์ครบกำหนดโดยออกแบบ
}

function UpcomingItem({ event, pendingKeys, onToggleInstallment, onRevolvingFull, onRevolvingMinimum, highlighted, compact }: UpcomingItemProps) {
  const busy = pendingKeys.includes(event.key);
  const typeLabel = event.source === 'installment' ? 'ผ่อนชำระ' : (event.source === 'revolving' ? 'ยอดหมุนเวียน' : 'รายจ่าย');
  const isOverdue = event.daysDiff < 0;
  const cardColor = event.card?.color as string | undefined;

  return (
    <div
      id={`upcoming-item-${event.key}`}
      // bg-surface-2, not bg-surface-1 — this row sits inside the section's own bg-surface-1 card, so
      // the surface step needs to actually step up (C1: "nested grouping uses --surface-2 with a border
      // and no shadow") to read as distinct from the parent, not just repeat the same fill (Stage 4 finding)
      className={`flex flex-col gap-space-2 rounded-md border border-border-default border-l-4 bg-surface-2 p-space-4 ${
        isOverdue && !cardColor ? 'border-l-neg' : 'border-l-border-default'
      } ${highlighted ? 'outline outline-2 outline-accent outline-offset-2' : ''}`}
      style={cardColor ? { borderLeftColor: cardColor } : undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-space-3">
        <span className="inline-flex items-center gap-space-2 font-semibold text-primary">
          {isOverdue && <span aria-hidden="true">⚠ </span>}
          {event.card && (
            <span
              className="h-3 w-3 shrink-0 rounded-xs"
              style={{ backgroundColor: cardColor }}
              aria-hidden="true"
            />
          )}
          {event.name}
        </span>
        <span className="whitespace-nowrap text-lg font-bold text-primary tabular-nums">{`${formatCurrency(event.amount ?? 0)} บาท`}</span>
      </div>
      <span className="text-sm text-secondary">
        {[event.account, typeLabel].filter(Boolean).join(' · ')}
      </span>
      {!compact && (
        <span className="text-sm text-secondary">
          {`${formatIsoDateTH(event.isoDate)} · ${describeDueDistance(event.daysDiff)}`}
        </span>
      )}

      {event.source === 'installment' && (
        <button
          type="button"
          className={`${PAID_PILL} ${busy ? 'opacity-60' : ''}`}
          disabled={busy}
          onClick={() => onToggleInstallment?.(event)}
        >
          {busy ? 'กำลังบันทึก...' : 'ยังไม่ชำระ — แตะเพื่อยืนยัน'}
        </button>
      )}

      {event.source === 'revolving' && (
        <div className="flex flex-col gap-space-2">
          <button
            type="button"
            className={`${PAID_PILL} ${busy ? 'opacity-60' : ''}`}
            disabled={busy}
            onClick={() => onRevolvingFull?.(event)}
          >
            {busy ? 'กำลังบันทึก...' : `จ่ายเต็มจำนวน ${formatCurrency(event.amount ?? 0)}`}
          </button>
          <button
            type="button"
            className={`${PAID_PILL} ${busy ? 'opacity-60' : ''}`}
            disabled={busy}
            onClick={() => onRevolvingMinimum?.(event)}
          >
            จ่ายขั้นต่ำ
          </button>
        </div>
      )}
    </div>
  );
}

interface UpcomingCardProps extends Omit<UpcomingItemProps, 'event' | 'highlighted'> {
  group: UpcomingCardGroup<UpcomingLine>;
  open: boolean;
  /** เปิดค้างเพราะมีบรรทัดกำลังบันทึก: ปุ่มซ่อนใช้ไม่ได้ */
  forcedOpen?: boolean;
  onToggle: () => void;
  paidCount: number;
  highlightedKey?: string | null;
}

/** การ์ดบัตรเครดิต 1 ใบต่อรอบบิล: ยอดรวม + ปุ่มกางดูรายการ (ปุ่มของตัวเอง ไม่ซ้อนในปุ่มอื่น) */
function UpcomingCard({ group, open, forcedOpen, onToggle, paidCount, highlightedKey, ...itemProps }: UpcomingCardProps) {
  const isOverdue = group.daysDiff < 0;
  const cardColor = group.card.color as string | undefined;
  const panelId = `upcoming-card-panel-${group.groupKey}`;
  const total = group.lines.length;
  return (
    <div
      id={`upcoming-card-${group.groupKey}`}
      className={`flex min-w-0 flex-col gap-space-2 rounded-md border border-border-default border-l-4 bg-surface-2 p-space-4 ${
        isOverdue && !cardColor ? 'border-l-neg' : 'border-l-border-default'
      }`}
      style={cardColor ? { borderLeftColor: cardColor } : undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-space-3">
        <span className="inline-flex min-w-0 items-center gap-space-2 break-words font-semibold text-primary">
          {isOverdue && <span aria-hidden="true">⚠ </span>}
          <span className="h-3 w-3 shrink-0 rounded-xs" style={{ backgroundColor: cardColor }} aria-hidden="true" />
          <span className="min-w-0 break-words">{group.name}</span>
        </span>
        <span className="flex flex-col items-end">
          <span className="text-xs text-secondary">ยอดที่ต้องชำระ</span>
          <span className="whitespace-nowrap text-lg font-bold text-primary tabular-nums">{`${formatCurrency(group.amount)} บาท`}</span>
        </span>
      </div>
      <span className="text-sm text-secondary">
        {[group.account, group.cycleMonth ? `รอบบิล ${group.cycleMonth}` : ''].filter(Boolean).join(' · ')}
      </span>
      <span className="text-sm text-secondary">
        {`${formatIsoDateTH(group.isoDate)} · ${describeDueDistance(group.daysDiff)}`}
      </span>
      {paidCount > 0 && (
        <span className="text-sm text-tertiary">{`ชำระแล้ว ${paidCount}/${total + paidCount} รายการ`}</span>
      )}
      <button
        type="button"
        className={`flex min-h-11 w-full items-center gap-space-2 rounded-sm border border-border-interactive bg-transparent px-space-3 text-left text-sm font-semibold text-primary ${forcedOpen ? 'opacity-60' : ''} ${FOCUS_RING}`}
        aria-expanded={open}
        aria-controls={panelId}
        disabled={forcedOpen}
        onClick={onToggle}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        {open ? 'ซ่อนรายการ' : `กางดูรายการ (${total})`}
      </button>
      <div id={panelId} hidden={!open} className="flex flex-col gap-space-3">
        {open && group.lines.map(line => (
          <UpcomingItem key={`${line.id ?? ''}${line.key}`} event={line} highlighted={highlightedKey === line.key} compact {...itemProps} />
        ))}
      </div>
    </div>
  );
}

function Group({ title, events, highlightedKey, expanded, onToggleExpanded, paidCounts, ...itemProps }: GroupProps) {
  if (!events.length) return null;
  return (
    <div>
      <h3 className="mb-space-2 text-sm font-bold text-secondary">{`${title} (${events.length})`}</h3>
      <div className="flex flex-col gap-space-3">
        {events.map((row) => {
          if (!isCardGroup(row)) {
            return <UpcomingItem key={row.id ?? row.key} event={row} highlighted={highlightedKey === row.key} {...itemProps} />;
          }
          // เปิดอยู่เสมอเมื่อมีบรรทัดที่กำลังบันทึก (การกางจาก NotificationBell เพิ่มเข้า expanded แทน จึงไม่หุบเมื่อไฮไลต์หมดเวลา)
          const forcedOpen = row.lines.some(line => itemProps.pendingKeys.includes(line.key));
          return (
            <UpcomingCard
              key={row.groupKey}
              group={row}
              open={forcedOpen || expanded.has(row.groupKey)}
              forcedOpen={forcedOpen}
              onToggle={() => onToggleExpanded(row.groupKey)}
              paidCount={paidCounts.get(row.groupKey) ?? 0}
              highlightedKey={highlightedKey}
              {...itemProps}
            />
          );
        })}
      </div>
    </div>
  );
}

function PaidItem({ event, busy, onToggleInstallment, onRevolvingCancel }: {
  event: PaidEvent;
  busy: boolean;
  onToggleInstallment?: PaidEventAction;
  onRevolvingCancel?: PaidEventAction;
}) {
  const typeLabel = event.source === 'installment' ? 'ผ่อนชำระ' : 'ยอดหมุนเวียน';
  const cardColor = event.card?.color as string | undefined;
  return (
    <div
      id={`paid-item-${event.key}`}
      className="flex flex-col gap-space-2 rounded-md border border-border-default border-l-4 border-l-border-default bg-surface-2 p-space-4"
      style={cardColor ? { borderLeftColor: cardColor } : undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-space-3">
        <span className="inline-flex items-center gap-space-2 font-semibold text-secondary">
          ✓
          {event.card && (
            <span className="h-3 w-3 shrink-0 rounded-xs" style={{ backgroundColor: cardColor }} aria-hidden="true" />
          )}
          {event.name}
        </span>
        <span className="whitespace-nowrap text-lg font-bold text-secondary tabular-nums">{`${formatCurrency(event.amount ?? 0)} บาท`}</span>
      </div>
      <span className="text-sm text-tertiary">
        {[event.account, typeLabel, formatIsoDateTH(event.isoDate)].filter(Boolean).join(' · ')}
      </span>
      {event.source === 'installment' ? (
        <button
          type="button"
          className={`${PAID_PILL} ${busy ? 'opacity-60' : ''}`}
          disabled={busy || !onToggleInstallment}
          onClick={() => onToggleInstallment?.(event)}
        >
          {busy ? 'กำลังบันทึก...' : '✓ ชำระแล้ว — แตะเพื่อยกเลิก'}
        </button>
      ) : (
        <button
          type="button"
          className={`${PAID_PILL} ${busy ? 'opacity-60' : ''}`}
          disabled={busy || !onRevolvingCancel}
          onClick={() => onRevolvingCancel?.(event)}
        >
          {busy ? 'กำลังบันทึก...' : 'ยกเลิกการชำระ'}
        </button>
      )}
    </div>
  );
}

interface PaidGroupProps {
  events: PaidEvent[];
  pendingKeys: string[];
  onToggleInstallment?: PaidEventAction;
  onRevolvingCancel?: PaidEventAction;
}

function PaidGroup({ events, pendingKeys, onToggleInstallment, onRevolvingCancel }: PaidGroupProps) {
  const [open, setOpen] = useState(false);
  if (!events.length) return null;
  const panelId = 'upcoming-paid-panel';
  return (
    <div>
      <button
        type="button"
        className={`flex min-h-11 w-full items-center gap-space-2 rounded-sm border-none bg-transparent px-0 text-left text-sm font-bold text-secondary ${FOCUS_RING}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(value => !value)}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        {`ชำระแล้วเดือนนี้ (${events.length})`}
      </button>
      <div id={panelId} hidden={!open} className="mt-space-2 flex flex-col gap-space-3">
        {open && events.map(event => (
          <PaidItem
            key={event.key}
            event={event}
            busy={pendingKeys.includes(event.key)}
            onToggleInstallment={onToggleInstallment}
            onRevolvingCancel={onRevolvingCancel}
          />
        ))}
      </div>
    </div>
  );
}

export default function UpcomingPayments({
  upcoming,
  filter,
  onClearFilter,
  onViewCalendar,
  pendingKeys = [],
  onToggleInstallment,
  onRevolvingFull,
  onRevolvingMinimum,
  highlightedKey,
  paidEvents,
  onRevolvingCancel
}: UpcomingPaymentsProps) {
  const [criteria, setCriteria] = useListCriteria('dashboard-upcoming');
  // Escape ล้างตัวกรองเมื่อมีตัวกรองใช้งานอยู่ (spec §5)
  useEffect(() => {
    if (!filter) return undefined;
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClearFilter?.();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [filter, onClearFilter]);

  const sourceRows = [
    ...(upcoming?.overdue ?? []).map(event => ({ ...event, urgency: 'overdue' })),
    ...(upcoming?.dueToday ?? []).map(event => ({ ...event, urgency: 'today' })),
    ...(upcoming?.dueSoon ?? []).map(event => ({ ...event, urgency: 'soon' }))
  ];
  const retained = useRef(sourceRows);
  const pendingRows = retained.current.filter(event => pendingKeys.includes(event.key) && !sourceRows.some(row => row.key === event.key));
  const allRows = [...sourceRows, ...pendingRows];
  retained.current = allRows;
  // ringFilter ก่อนจัดกลุ่ม (กลุ่มเป็นบัตรล้วน จึงไม่มีกลุ่มปนกับรายจ่ายทั่วไป) แล้วจัดเป็น 1 แถวต่อ (บัตร, รอบบิล)
  const ringRows: Row[] = groupUpcomingByCard<UpcomingLine>(allRows.filter(event => matchesFilter(event, filter)));
  const rowId = (row: Row) => (isCardGroup(row) ? row.groupKey : row.key);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = (groupKey: string) => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
    return next;
  });
  // เลือกจาก NotificationBell: กางการ์ดเจ้าของบรรทัดเข้า expanded (ถาวร) เพื่อให้บรรทัดอยู่ใน DOM ก่อน scrollIntoView
  // และไม่หุบเมื่อ highlightedKey ถูกล้าง
  useEffect(() => {
    if (!highlightedKey) return;
    const owner = ringRows.find(row => isCardGroup(row) && row.lines.some(line => line.key === highlightedKey));
    if (!owner || !isCardGroup(owner)) return;
    setExpanded(previous => (previous.has(owner.groupKey) ? previous : new Set(previous).add(owner.groupKey)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedKey]);
  // จำนวนรายการที่ชำระแล้วต่อ (รอบบิล, บัตร) สำหรับข้อความ "ชำระแล้ว k/n" (แสดงผลอย่างเดียว)
  const paidCounts = new Map<string, number>();
  (paidEvents ?? []).forEach(event => {
    if (!event.card?.id || !((event.amount ?? 0) > 0)) return;
    const groupKey = cardGroupKey(event.cycleMonth, event.card.id);
    paidCounts.set(groupKey, (paidCounts.get(groupKey) ?? 0) + 1);
  });
  const [field, direction] = criteria.order.split(':');
  const projection = useListProjection<Row>({
    rows: ringRows, getId: rowId,
    matches: row => matchesListQuery(
      isCardGroup(row)
        ? `${row.name} ${row.lines.map(line => line.name ?? '').join(' ')}`
        : `${row.name ?? ''} ${row.card?.name ?? ''}`,
      criteria.query) &&
      (!criteria.filters.type || groupTypeMatches(row, criteria.filters.type)) &&
      (!criteria.filters.account || (row.account || '__unassigned') === criteria.filters.account),
    compare: field ? (a, b) => compareListValues(
      field === 'name' ? a.name : field === 'amount' ? a.amount : a.isoDate,
      field === 'name' ? b.name : field === 'amount' ? b.amount : b.isoDate,
      direction === 'desc') : undefined,
    group: row => row.urgency, editable: true,
    criteriaKey: JSON.stringify([criteria, filter]),
    datasetKey: `${new Date().toISOString().slice(0, 10)}:${Boolean(upcoming)}`
  });
  const overdue = projection.items.filter(event => event.urgency === 'overdue');
  const dueToday = projection.items.filter(event => event.urgency === 'today');
  const dueSoon = projection.items.filter(event => event.urgency === 'soon');
  const itemProps = { pendingKeys, onToggleInstallment, onRevolvingFull, onRevolvingMinimum, expanded, onToggleExpanded: toggleExpanded, paidCounts };

  const paidGroupEvents = (paidEvents ?? []).filter(event => matchesFilter(event, filter));
  const totalAfterFilter = overdue.length + dueToday.length + dueSoon.length;
  const filterCopy = filter ? FILTER_EMPTY_COPY[filter] : null;

  return (
    <section className="rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5">
      <div className="mb-space-4 flex flex-wrap items-center justify-between gap-space-3">
        <div>
          <h2 className="text-xl font-semibold text-primary">รายการที่จะครบกำหนด</h2>
          <p className="mt-space-1 text-xs text-tertiary">แสดงเฉพาะรายการที่ยังไม่ชำระภายใน 7 วันนับจากวันนี้</p>
        </div>
        {filter && (
          <button
            type="button"
            className={`min-h-11 rounded-full border border-border-interactive bg-transparent px-space-4 font-semibold text-primary ${FOCUS_RING}`}
            onClick={onClearFilter}
          >
            ล้างตัวกรองจากวงแหวน
          </button>
        )}
      </div>
      {filter && <p className="text-sm text-secondary">จากวงแหวน: {({ generalExpense: 'รายจ่ายทั่วไป', creditCard: 'บัตรเครดิต', dailyExpense: 'รายจ่ายประจำวัน', savings: 'เงินออม' })[filter]}</p>}
      <ListToolbar label="รายการที่จะครบกำหนด" criteria={criteria} onChange={setCriteria}
        visible={projection.items.length} total={ringRows.length}
        changed={projection.changed} onRefresh={projection.refresh}
        groupNote="เรียงภายในแต่ละกลุ่ม"
        filters={[
          { key: 'type', label: 'ประเภท', options: [
            { value: 'plain', label: 'รายจ่ายทั่วไป' }, { value: 'installment', label: 'บัตรที่มีรายการผ่อนชำระ' }, { value: 'revolving', label: 'บัตรที่มียอดหมุนเวียน' }
          ] },
          { key: 'account', label: 'บัญชี', options: [
            { value: '__unassigned', label: 'ไม่ระบุบัญชี' },
            ...Array.from(new Set(allRows.flatMap(event => event.account ? [event.account] : []))).map(value => ({ value, label: value }))
          ] }
        ]}
        orders={Object.entries({ name: 'ชื่อ', amount: 'จำนวนเงิน', due: 'วันครบกำหนด' }).flatMap(([value, label]) => [
          { value: `${value}:asc`, label: `${label}: น้อยไปมาก` }, { value: `${value}:desc`, label: `${label}: มากไปน้อย` }
        ])} />

      {/* ประกาศให้ screen reader ทราบทุกครั้งที่ตัวกรองเปลี่ยนผลลัพธ์ (ข้อเสนอแนะจาก UX Review, ต้นทุนต่ำ) */}
      <div aria-live="polite" className="sr-only">
        {filter ? `กรองแล้ว พบ ${totalAfterFilter} รายการ` : ''}
      </div>

      {totalAfterFilter === 0 && ringRows.length === 0 ? (
        <div className="py-space-5 text-center text-secondary">
          {filterCopy ? (
            <>
              <p>{filterCopy.text}</p>
              {filterCopy.href && (
                <a
                  href={filterCopy.href}
                  className={`mt-space-3 inline-flex min-h-11 items-center rounded-full bg-accent px-space-4 font-semibold text-on-accent no-underline ${FOCUS_RING}`}
                >
                  เปิดบันทึกรายเดือน
                </a>
              )}
            </>
          ) : (
            <>
              <p>ไม่มีรายการที่ครบกำหนดใน 7 วันข้างหน้า</p>
              <button
                type="button"
                className={`mt-space-2 min-h-11 cursor-pointer border-none bg-transparent px-space-2 font-semibold text-accent underline ${FOCUS_RING}`}
                onClick={onViewCalendar}
              >
                ดูทั้งเดือนในปฏิทิน
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-space-5">
          <Group title="เกินกำหนด" events={overdue} highlightedKey={highlightedKey} {...itemProps} />
          <Group title="ครบกำหนดวันนี้" events={dueToday} highlightedKey={highlightedKey} {...itemProps} />
          <Group title="ครบกำหนดใน 7 วัน" events={dueSoon} highlightedKey={highlightedKey} {...itemProps} />
        </div>
      )}

      {/* กลุ่มชำระแล้ว: ตามวงแหวน (matchesFilter) แต่ไม่ผ่าน ListToolbar/useListProjection และไม่ใช่หน้าต่าง 7 วัน */}
      {paidGroupEvents.length > 0 && (
        <div className="mt-space-5">
          <PaidGroup
            events={paidGroupEvents}
            pendingKeys={pendingKeys}
            onToggleInstallment={onToggleInstallment}
            onRevolvingCancel={onRevolvingCancel}
          />
        </div>
      )}
    </section>
  );
}