// creditCardTileUtils.ts
// Pure helpers สำหรับ tile บัตรเครดิตบน /credit-cards (spec-credit-card-tiles §4, review REV-7)
// ไม่มีเลขเงินคำนวณที่นี่ — ยอดเงินมาจาก API (buildCardMonthDueMap) เท่านั้น
// ไม่ import โค้ด backend (shared/frontend เท่านั้น)

import { BANK_ISSUER_KEYS, getBankIssuer, isBankIssuerKey, type BankIssuerKey } from '../creditCardBankCatalog';
import { resolveInstallmentDueDate, PLAN_STATUS } from '../creditCardUtils';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * วันนี้แบบ YYYY-MM-DD ตามเวลาท้องถิ่น — แหล่งเดียวกับ diffDaysFromToday (new Date() + local
 * getFullYear/getMonth/getDate) เพื่อให้ลำดับ sort กับ chip "เลยกำหนด" ตรงกันช่วงเที่ยงคืน (REV-7)
 */
export function getLocalTodayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** ตัด nextDueDate เหลือ 10 ตัวอักษร (YYYY-MM-DD); ค่าไม่ถูกต้อง => null (REV-7) */
export function normaliseDueDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const head = value.slice(0, 10);
  if (!ISO_DATE_RE.test(head)) return null;
  const [y, m, d] = head.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return head;
}

export interface SortableCard {
  id?: string;
  name?: string;
  nextDueDate?: string | null;
}

/**
 * เรียง: เลยกำหนดก่อน (เลยนานสุดก่อน) -> ที่จะถึงเรียงจากใกล้ -> ไม่มีวันครบกำหนดท้ายสุด
 * -> tie-break ชื่อ (localeCompare 'th') แล้ว id. ทั้งสองกลุ่มแรกคือ "วันที่น้อยไปมาก" จึงใช้กฎเดียว
 * (review §d) · todayIso รับไว้เพื่อสัญญาของ API/ความชัดเจน แต่ไม่เปลี่ยนลำดับ
 * คืน array ใหม่ ไม่แก้ input
 */
export function sortCardsByDue<T extends SortableCard>(cards: readonly T[], todayIso: string = getLocalTodayIso()): T[] {
  void todayIso;
  return [...cards].sort((a, b) => {
    const da = normaliseDueDate(a.nextDueDate);
    const db = normaliseDueDate(b.nextDueDate);
    if (da !== db) {
      if (da === null) return 1;
      if (db === null) return -1;
      return da < db ? -1 : 1;
    }
    const byName = String(a.name ?? '').localeCompare(String(b.name ?? ''), 'th');
    if (byName !== 0) return byName;
    const ia = String(a.id ?? '');
    const ib = String(b.id ?? '');
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}

/** เลือกว่าง = ทั้งหมด; ใช้ getBankIssuer (read-only, BR-CC-020) */
export function filterCardsByIssuers<T extends { bankIssuer?: unknown }>(cards: readonly T[], selected: readonly BankIssuerKey[]): T[] {
  if (!selected.length) return [...cards];
  const set = new Set<BankIssuerKey>(selected);
  return cards.filter(card => set.has(getBankIssuer(card)));
}

/** จำนวนบัตรต่อผู้ออกบัตร เรียงตาม BANK_ISSUER_KEYS เฉพาะที่ count > 0 */
export function countCardsByIssuer(cards: readonly { bankIssuer?: unknown }[]): Array<{ key: BankIssuerKey; count: number }> {
  const counts = new Map<BankIssuerKey, number>();
  cards.forEach(card => {
    const key = getBankIssuer(card);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return BANK_ISSUER_KEYS.filter(key => (counts.get(key) || 0) > 0).map(key => ({ key, count: counts.get(key) as number }));
}

export const ISSUER_FILTER_STORAGE_KEY = 'financetrack.creditCards.issuerFilter.v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * อ่านตัวกรองที่บันทึกไว้ — ห้ามเรียกใน initial state (SSR/hydration) ให้เรียกใน useEffect
 * ล้มเหลว/JSON เสีย/ไม่ใช่ array => [] · ตัด key ที่ไม่รู้จักและซ้ำ · ไม่ throw
 */
export function loadIssuerFilter(storage: StorageLike | null = defaultStorage()): BankIssuerKey[] {
  try {
    if (!storage) return [];
    const raw = storage.getItem(ISSUER_FILTER_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: BankIssuerKey[] = [];
    parsed.forEach(value => {
      if (isBankIssuerKey(value) && !out.includes(value)) out.push(value);
    });
    return out;
  } catch {
    return [];
  }
}

/** บันทึกตัวกรอง (เฉพาะ key ที่รู้จัก) · ไม่ throw · คืน true เมื่อบันทึกสำเร็จ · ไม่ส่งไปเซิร์ฟเวอร์ */
export function saveIssuerFilter(keys: readonly unknown[], storage: StorageLike | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    const clean = (Array.isArray(keys) ? keys : []).filter(isBankIssuerKey);
    storage.setItem(ISSUER_FILTER_STORAGE_KEY, JSON.stringify(Array.from(new Set(clean))));
    return true;
  } catch {
    return false;
  }
}

export interface OverduePlanLike {
  cardId?: unknown;
  status?: unknown;
  schedule?: unknown;
}

/**
 * จำนวนงวดที่ยังไม่จ่ายของแผน ONGOING ของบัตรนี้ ที่วันครบกำหนด
 * (resolveInstallmentDueDate(card.dueDay, row.dueMonth)) < todayIso · แสดงผลเท่านั้น ไม่มีเลขเงิน
 */
export function countOverdueInstallments(
  card: { id?: unknown; dueDay?: unknown },
  plans: readonly OverduePlanLike[] | null | undefined,
  todayIso: string = getLocalTodayIso()
): number {
  if (!card?.id || !Array.isArray(plans)) return 0;
  let count = 0;
  plans.forEach(plan => {
    if (plan?.cardId !== card.id || plan.status !== PLAN_STATUS.ONGOING) return;
    const schedule = Array.isArray(plan.schedule) ? plan.schedule : [];
    schedule.forEach((row: { paid?: unknown; dueMonth?: unknown } | null) => {
      if (!row || row.paid === true || typeof row.dueMonth !== 'string') return;
      const due = resolveInstallmentDueDate(card.dueDay as number | string, row.dueMonth);
      if (due && due < todayIso) count += 1;
    });
  });
  return count;
}

// ---------------------------------------------------------------------------
// Contrast (WCAG 2.x)
// ---------------------------------------------------------------------------

export const TILE_TEXT_LIGHT = '#ffffff';
export const TILE_TEXT_DARK = '#000000';
const FALLBACK_TILE_COLOR = '#6b7280';

/** '#rgb' / '#rrggbb' -> [r,g,b] 0-255; ไม่ถูกต้อง => null */
export function parseHexColor(hex: unknown): [number, number, number] | null {
  if (typeof hex !== 'string') return null;
  let value = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(value)) value = value.split('').map(ch => ch + ch).join('');
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;
  return [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHexColor(hex) ?? (parseHexColor(FALLBACK_TILE_COLOR) as [number, number, number]);
  const [r, g, b] = rgb.map(channel => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * สีตัวอักษรคงที่ (ไม่ขึ้นกับ theme) บนพื้นสีบัตร: เลือกขาวหรือดำตามคอนทราสต์ที่สูงกว่า
 * ขาว/ดำบริสุทธิ์รับประกัน >= ~4.58:1 สำหรับทุกสี (จุดแย่สุดที่ luminance ≈ 0.179) จึงผ่าน 4.5:1 เสมอ
 * สีไม่ถูกต้องใช้สีเทา 'other' แทน
 */
export function pickTileTextColor(background: string): { color: string; ratio: number } {
  const bg = parseHexColor(background) ? background : FALLBACK_TILE_COLOR;
  const light = contrastRatio(bg, TILE_TEXT_LIGHT);
  const dark = contrastRatio(bg, TILE_TEXT_DARK);
  return light >= dark ? { color: TILE_TEXT_LIGHT, ratio: light } : { color: TILE_TEXT_DARK, ratio: dark };
}
