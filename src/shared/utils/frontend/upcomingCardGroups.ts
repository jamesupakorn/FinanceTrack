/**
 * groupUpcomingByCard — จัดรายการ "ครบกำหนด" ของบัตรเครดิตเป็น 1 แถวต่อ (บัตร, รอบบิล)
 * (spec-upcoming-card-totals.md §3, UC-1..UC-4; ป้ายกำกับเป็นของ spec นี้ ไม่ใช่ BR/ADR/TD ที่ลงทะเบียน)
 *
 * Pure: ไม่มี fetch/React · ยอดรวมการ์ดเป็นผลบวก round2 ของยอดรายบรรทัดที่ server คำนวณมาแล้วเพื่อ "แสดงผล" เท่านั้น
 * ไม่ส่ง/ไม่เก็บ/ไม่ใช่กฎเงินใหม่ (รูปแบบเดียวกับ buildMonthEvents.monthTotals)
 */

import { round2 } from '../creditCardUtils';

export interface UpcomingLineBase {
  key: string;
  source?: string;
  name?: string;
  amount?: number | null;
  account?: string;
  cycleMonth?: string;
  isoDate: string;
  daysDiff: number;
  urgency: string;
  card?: { id: string; name?: string; color?: string } | null;
}

export interface UpcomingCardGroup<T extends UpcomingLineBase> {
  kind: 'card';
  groupKey: string;
  card: NonNullable<T['card']>;
  cycleMonth: string;
  isoDate: string;
  daysDiff: number;
  urgency: string;
  account: string;
  /** ชื่อบัตร (ใช้เรียงตามชื่อ) */
  name: string;
  /** ยอดรวมที่ต้องชำระ = round2(Σ ยอดบรรทัดที่ยังไม่ชำระ) */
  amount: number;
  lines: T[];
}

export type UpcomingRow<T extends UpcomingLineBase> = T | UpcomingCardGroup<T>;

export function isCardGroup<T extends UpcomingLineBase>(row: UpcomingRow<T>): row is UpcomingCardGroup<T> {
  return (row as UpcomingCardGroup<T>).kind === 'card';
}

export function cardGroupKey(cycleMonth: string | undefined, cardId: string): string {
  return `${cycleMonth ?? ''}_${cardId}`;
}

/** บรรทัดบัตรที่จัดกลุ่มได้ = ผ่อน/หมุนเวียน ที่หาบัตรเจอ (บัตร/แผนถูกลบ → คงเป็นแถวเดี่ยว) */
function isGroupable<T extends UpcomingLineBase>(row: T): boolean {
  return (row.source === 'installment' || row.source === 'revolving') && Boolean(row.card?.id);
}

export function groupUpcomingByCard<T extends UpcomingLineBase>(rows: readonly T[]): UpcomingRow<T>[] {
  const result: UpcomingRow<T>[] = [];
  const groups = new Map<string, UpcomingCardGroup<T>>();
  rows.forEach(row => {
    if (!isGroupable(row)) {
      result.push(row);
      return;
    }
    const card = row.card as NonNullable<T['card']>;
    const groupKey = cardGroupKey(row.cycleMonth, card.id);
    const existing = groups.get(groupKey);
    if (!existing) {
      const group: UpcomingCardGroup<T> = {
        kind: 'card',
        groupKey,
        card,
        cycleMonth: row.cycleMonth ?? '',
        isoDate: row.isoDate,
        daysDiff: row.daysDiff,
        urgency: row.urgency,
        account: row.account ?? '',
        name: card.name ?? '',
        amount: 0,
        lines: [row]
      };
      groups.set(groupKey, group);
      result.push(group);
      return;
    }
    existing.lines.push(row);
    // defensive: บรรทัดในกลุ่มเดียวกันควรวันเดียวกันเสมอ ถ้าไม่ใช่ ใช้บรรทัดที่เร่งด่วนที่สุด
    if (row.daysDiff < existing.daysDiff) {
      existing.daysDiff = row.daysDiff;
      existing.isoDate = row.isoDate;
      existing.urgency = row.urgency;
    }
    if (!existing.account && row.account) existing.account = row.account;
  });
  groups.forEach(group => {
    // ผ่อนชำระก่อน (ลำดับเดิมของ schedule) แล้วตามด้วยยอดหมุนเวียน
    group.lines = [
      ...group.lines.filter(line => line.source === 'installment'),
      ...group.lines.filter(line => line.source !== 'installment')
    ];
    group.amount = round2(group.lines.reduce((sum, line) => sum + (line.amount ?? 0), 0));
  });
  return result;
}
