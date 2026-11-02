/**
 * Hook: useRevolvingCycle
 * ย้าย fetch + action ของ "ยอดใช้จ่ายหมุนเวียน" ออกจาก RevolvingBalanceSection มาไว้ที่เดียว
 * เพื่อให้ CardPayNextSummary (ด้านบน) กับ cashback/history (ด้านล่าง) ใช้ state ชุดเดียวกัน
 * (spec-credit-card-detail-redesign C-1)
 *
 * ⚠ hook นี้ **ไม่คำนวณเงินเอง** เลย: ตัวเลขทุกตัวมาจาก /api/credit-cards/revolving
 *   (buildRevolvingCycles ฝั่ง server) — currentCycle/previousMonthCycle/history เป็นแค่ find/sort
 *
 * Silent refresh (R2): status 'loading' แสดงเฉพาะเมื่อยังไม่มีข้อมูลของ card.id + month นี้
 * การ re-fetch จาก card ตัวใหม่ (card.id/month เดิม) หรือ refreshKey ยังคงข้อมูลเดิมไว้ ไม่สลับเป็น loading
 * ปุ่มจ่ายจึงไม่ถูก unmount และ focus ไม่หลุดไป body; draft แคชแบคที่กำลังพิมพ์ก็ไม่ถูกเขียนทับ
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildRevolvingRowKey, getCardDueMonth, isValidCashbackAmount } from '../creditCardUtils';
import type { buildRevolvingCycles } from '../creditCardUtils';
import { creditCardAPI, expenseAPI } from './apiUtils';
import { parseAndFormat } from './numberUtils';
import { showToast } from './toast';

export type RevolvingCycle = ReturnType<typeof buildRevolvingCycles>[number];

export interface RevolvingCard {
  id: string;
  name?: string;
  statementDay?: number | string | null;
  annualRate?: number | string;
  minPaymentPercent?: number | string;
  dueDay?: number | string | null;
}

export type CurrentCycle = Omit<RevolvingCycle, 'id' | 'cardId' | 'month' | 'paidAt' | 'paidSource' | 'minimumPreview'>
  & Partial<Pick<RevolvingCycle, 'id' | 'cardId' | 'month' | 'paidAt' | 'paidSource' | 'minimumPreview'>>;

export type RevolvingStatus = 'loading' | 'ready' | 'error';

export interface CardTotal {
  actual: number;
  installmentTotal: number;
}

interface RevolvingResponse {
  cycles?: RevolvingCycle[];
  truncated?: boolean;
}

export type ConfirmMinimumHandler = (params: {
  card: RevolvingCard;
  cycle: CurrentCycle;
  onConfirm: () => void | Promise<void>;
}) => void;

export interface UseRevolvingCycleOptions {
  card: RevolvingCard | null | undefined;
  month: string;
  /** เพิ่มค่านี้เพื่อสั่ง re-fetch แบบ silent (ไม่ remount, ไม่สลับ loading) */
  refreshKey?: number;
  /** เรียกหลัง action (จ่าย/ยกเลิก/แคชแบค) สำเร็จ — ให้หน้าโหลดข้อมูลบัตรใหม่ */
  onChanged?: () => void;
  onConfirmMinimum?: ConfirmMinimumHandler;
}

export const EMPTY_CYCLE: CurrentCycle = {
  newSpend: 0,
  carriedBalance: 0,
  totalDue: 0,
  minPaymentDue: 0,
  paymentAction: null,
  amountDue: 0,
  paidAmount: 0,
  interest: 0,
  closingBalance: 0,
  cashbackAmount: 0,
  creditBalance: 0,
  stored: false,
  isImplicit: true
};

export interface RevolvingCycleState {
  status: RevolvingStatus;
  currentCycle: CurrentCycle;
  previousMonthCycle: RevolvingCycle | null;
  /** ทุกรอบ เรียงเดือนล่าสุดก่อน */
  history: RevolvingCycle[];
  truncated: boolean;
  cardTotal: CardTotal | null;
  cashbackDraft: string;
  busy: boolean;
  changeCashbackDraft: (value: string) => void;
  focusCashback: () => void;
  blurCashback: (rawValue: string) => void;
  payFull: () => Promise<void>;
  payMinimum: () => void;
  undoPayment: () => Promise<void>;
  retry: () => void;
}

export function useRevolvingCycle({
  card,
  month,
  refreshKey = 0,
  onChanged,
  onConfirmMinimum
}: UseRevolvingCycleOptions): RevolvingCycleState {
  const [cycles, setCycles] = useState<RevolvingCycle[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [cardTotal, setCardTotal] = useState<CardTotal | null>(null);
  const [cashbackDraft, setCashbackDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<RevolvingStatus>('loading');
  const [retryTick, setRetryTick] = useState(0);

  const cardId = card?.id;
  const dataKey = cardId ? `${cardId}|${month}` : '';
  const dataKeyRef = useRef(dataKey);
  dataKeyRef.current = dataKey;
  /** key (card.id|month) ของข้อมูลที่ถืออยู่ตอนนี้ — null = ยังไม่มีข้อมูล */
  const loadedKeyRef = useRef<string | null>(null);
  const draftDirtyRef = useRef(false);
  const cashbackFocusedRef = useRef(false);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const onConfirmMinimumRef = useRef(onConfirmMinimum);
  onConfirmMinimumRef.current = onConfirmMinimum;

  const statementDay = card?.statementDay;
  const dueDay = card?.dueDay;

  // แถวยอดรวมบัตร (ccr_) อยู่ในตารางเดือน getCardDueMonth(card, month) (DP-1 placement) —
  // ตารางเดือน M เก็บรอบ getPayableCycleMonth(card, M); ที่นี่แค่หา key เดือน ไม่คำนวณเงิน
  const readCardTotal = useCallback(async (): Promise<CardTotal> => {
    const tableMonth = getCardDueMonth({ statementDay, dueDay }, month);
    const expense = await expenseAPI.getByMonth(tableMonth);
    const row = cardId ? expense?.[buildRevolvingRowKey(cardId)] : null;
    return { actual: Number(row?.actual) || 0, installmentTotal: Number(row?.breakdown?.installmentTotal) || 0 };
  }, [cardId, month, statementDay, dueDay]);

  const applyChain = useCallback((response: RevolvingResponse, { preserveDraft = false }: { preserveDraft?: boolean } = {}) => {
    const nextCycles = Array.isArray(response?.cycles) ? response.cycles : [];
    setCycles(nextCycles);
    setTruncated(response?.truncated === true);
    if (preserveDraft) return;
    const current = nextCycles.find(item => item.month === month);
    setCashbackDraft(current ? parseAndFormat(current.cashbackAmount || 0) : '');
  }, [month]);

  useEffect(() => {
    if (!cardId) return undefined;
    const key = `${cardId}|${month}`;
    let cancelled = false;
    const silent = loadedKeyRef.current === key;
    if (!silent) {
      loadedKeyRef.current = null;
      setStatus('loading');
      setCycles([]);
      setTruncated(false);
      setCardTotal(null);
      setCashbackDraft('');
      draftDirtyRef.current = false;
    }
    Promise.all([creditCardAPI.getRevolving({ cardId, month }), readCardTotal()])
      .then(([response, total]) => {
        if (cancelled) return;
        applyChain(response, { preserveDraft: silent && (draftDirtyRef.current || cashbackFocusedRef.current) });
        setCardTotal(total);
        loadedKeyRef.current = key;
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        loadedKeyRef.current = null;
        setCycles([]);
        setTruncated(false);
        setCardTotal(null);
        setCashbackDraft('');
        setStatus('error');
        showToast('โหลดยอดใช้จ่ายหมุนเวียนไม่สำเร็จ', 'error');
      });
    return () => { cancelled = true; };
  }, [card, cardId, month, refreshKey, retryTick, applyChain, readCardTotal]);

  // cycles/month ไม่ผูกกับ card จึง compute ได้แม้ card ยังไม่มา
  const { currentCycle, previousMonthCycle, history } = useMemo(() => {
    const current: CurrentCycle = cycles.find(item => item.month === month) || EMPTY_CYCLE;
    const previous = [...cycles]
      .filter(item => item.month < month)
      .sort((a, b) => a.month.localeCompare(b.month))
      .pop() || null;
    const sortedHistory = [...cycles].sort((a, b) => b.month.localeCompare(a.month));
    return { currentCycle: current, previousMonthCycle: previous, history: sortedHistory };
  }, [cycles, month]);

  const runAction = async (task: () => Promise<RevolvingResponse>, successMessage: string, failureMessage: string): Promise<void> => {
    const startedKey = dataKeyRef.current;
    setBusy(true);
    try {
      const response = await task();
      // เดือน/บัตรเปลี่ยนระหว่างรอ (เช่น blur แคชแบคแล้วสลับเดือนทันที) → อย่านำผลของเดือนเก่ามาทับ
      if (dataKeyRef.current === startedKey) {
        applyChain(response);
        const total = await readCardTotal();
        // s-2: เดือน/บัตรอาจเปลี่ยนระหว่างรอ card-total → อย่าให้ยอดเดือนเก่าทับ
        if (dataKeyRef.current === startedKey) setCardTotal(total);
      }
      showToast(successMessage);
      onChangedRef.current?.();
    } catch (error) {
      const message = (error as { message?: string } | null)?.message;
      showToast(message || failureMessage, 'error');
    } finally {
      setBusy(false);
    }
  };

  const changeCashbackDraft = (value: string) => {
    draftDirtyRef.current = true;
    setCashbackDraft(value);
  };

  const focusCashback = () => { cashbackFocusedRef.current = true; };

  // รูปแบบเดียวกับ handleSpendBlur: ว่าง = ล้างเป็น '0.00' (ห้ามส่ง '' เพราะ server ถือว่า no-op)
  const blurCashback = (rawValue: string) => {
    cashbackFocusedRef.current = false;
    draftDirtyRef.current = false;
    if (!cardId) return;
    const stored = parseAndFormat(currentCycle.cashbackAmount || 0);
    const trimmed = rawValue.trim();
    if (trimmed && !isValidCashbackAmount(trimmed)) {
      setCashbackDraft(stored);
      showToast('แคชแบคต้องเป็นตัวเลขไม่ติดลบ', 'error');
      return;
    }
    const formatted = trimmed ? parseAndFormat(trimmed) : '0.00';
    setCashbackDraft(formatted);
    if (formatted === stored) return;
    void runAction(
      () => creditCardAPI.saveRevolvingCashback(cardId, month, formatted),
      'บันทึกแคชแบคแล้ว',
      'บันทึกแคชแบคไม่สำเร็จ'
    );
  };

  const payFull = (): Promise<void> => runAction(
    () => creditCardAPI.setRevolvingAction(cardId as string, month, 'full'),
    'บันทึกจ่ายเต็มจำนวนแล้ว',
    'บันทึกการชำระไม่สำเร็จ'
  );

  // จ่ายขั้นต่ำ = สร้างหนี้ก้อนใหม่ จึงต้องยืนยันก่อน ต่างจากจ่ายเต็มที่ย้อนกลับได้ใน 1 แตะ
  const payMinimum = () => {
    if (!card) return;
    const confirmAction = () => runAction(
      () => creditCardAPI.setRevolvingAction(card.id, month, 'minimum'),
      'บันทึกจ่ายขั้นต่ำแล้ว',
      'บันทึกการชำระไม่สำเร็จ'
    );
    const confirm = onConfirmMinimumRef.current;
    if (typeof confirm === 'function') {
      confirm({ card, cycle: currentCycle, onConfirm: confirmAction });
      return;
    }
    void confirmAction();
  };

  const undoPayment = (): Promise<void> => runAction(
    () => creditCardAPI.setRevolvingAction(cardId as string, month, null),
    'ยกเลิกการชำระแล้ว',
    'ยกเลิกการชำระไม่สำเร็จ'
  );

  const retry = () => {
    loadedKeyRef.current = null;
    setRetryTick(value => value + 1);
  };

  return {
    status,
    currentCycle,
    previousMonthCycle,
    history,
    truncated,
    cardTotal,
    cashbackDraft,
    busy,
    changeCashbackDraft,
    focusCashback,
    blurCashback,
    payFull,
    payMinimum,
    undoPayment,
    retry
  };
}
