/**
 * คอมโพเนนต์: SavingsLedgerPanel — แผงยอดกลาง (เงินออมสะสม) ใต้ SavingsTable บน /workspace/savings
 * (UX_SPEC-savings-loan-withdrawal.md §3). รวมปุ่ม "ยืมเงิน"/"ถอนเงินออม" และ SavingsLedgerHistory
 *
 * ไม่ใช่ component ที่ "save" ได้ — ไม่เรียก registerSave/markDirty ของ WorkspaceShell เด็ดขาด
 * (architecture-review-savings-loan-withdrawal-s4.md C-S4-5, BR-017 ปุ่มบันทึกเดียวต่อหน้า): การบันทึก
 * ทุกครั้งเกิดในกล่องโต้ตอบ (dialog) ของตัวเอง ทันทีที่กดยืนยัน
 *
 * ยอดทุกตัวมาจาก `GET /api/savings-loans` summary ตรง ๆ ไม่มีการคำนวณใหม่ที่นี่ (C-S4-2).
 */

import { useEffect, useRef, useState } from 'react';
import { savingsGoalsAPI, savingsLedgerAPI, type SavingsLoansGetResponse } from '../../shared/utils/frontend/apiUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import type { SavingsLoanWithBalance, SavingsWithdrawal } from '../../shared/utils/savingsLedger';
import LoadingSkeleton, { SkeletonBlock } from './LoadingSkeleton';
import SavingsLedgerHistory from './SavingsLedgerHistory';
import SavingsLoanDialog from './SavingsLoanDialog';
import SavingsWithdrawalDialog from './SavingsWithdrawalDialog';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const ACTION_BUTTON = `min-h-11 rounded-sm border border-border-interactive px-space-4 text-sm font-medium text-primary hover:bg-surface-3 ${FOCUS_RING}`;
const RETRY_BUTTON = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-sm text-primary ${FOCUS_RING}`;

type SummaryTotals = SavingsLoansGetResponse['summary'];
type GoalOption = { _id: string; goalName: string; currentAmount: number };

export interface SavingsLedgerPanelProps {
  /** เพิ่มเลขนี้ขึ้นเพื่อให้แผงรีเฟรชเงียบ ๆ โดยไม่ unmount (เช่น หลัง SavingsTable save, UX_SPEC §3.2) */
  reloadKey?: number;
}

export default function SavingsLedgerPanel({ reloadKey = 0 }: SavingsLedgerPanelProps) {
  const [summary, setSummary] = useState<SummaryTotals | null>(null);
  const [loans, setLoans] = useState<SavingsLoanWithBalance[]>([]);
  const [withdrawals, setWithdrawals] = useState<SavingsWithdrawal[]>([]);
  const [goals, setGoals] = useState<GoalOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [openDialog, setOpenDialog] = useState<'loan' | 'withdrawal' | null>(null);
  const hasLoadedOnce = useRef(false);
  /** fallback focus หลังลบแถวสุดท้ายในลิสต์ยืม/ประวัติ (§6.4) */
  const loanButtonRef = useRef<HTMLButtonElement | null>(null);
  const withdrawalButtonRef = useRef<HTMLButtonElement | null>(null);

  const load = async () => {
    try {
      const [loansRes, withdrawalsRes, goalsRes] = await Promise.all([
        savingsLedgerAPI.getLoans(),
        savingsLedgerAPI.getWithdrawals(),
        savingsGoalsAPI.getAll() as Promise<{ goals?: Array<{ _id: string; goalName: string; currentAmount: number }> } | null>,
      ]);
      setSummary(loansRes.summary);
      setLoans(loansRes.loans);
      setWithdrawals(withdrawalsRes.withdrawals);
      setGoals((goalsRes?.goals ?? []).map(goal => ({ _id: String(goal._id), goalName: goal.goalName, currentAmount: goal.currentAmount })));
      setLoadError(false);
      hasLoadedOnce.current = true;
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // ตั้ง loading=true ทุกครั้งที่ fetch ใหม่ (รวม reloadKey refetch) เพื่อให้ aria-busy ขึ้นระหว่างโหลดเสมอ
    // (UX_SPEC §10/§3.2) — skeleton ด้านล่างยัง gate ด้วย hasLoadedOnce.current แยกกัน จึงไม่เด้งทับรายการที่
    // เปิด <details> ไว้ตอน refetch เงียบ ๆ
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, retryTick]);

  const goalNameById = new Map(goals.map(goal => [goal._id, goal.goalName]));
  const poolBalance = summary?.poolBalance ?? 0;

  return (
    // onInput/onChange stopPropagation: WorkspaceShell's own children container (WorkspaceShell.tsx:402) marks
    // the whole page dirty on any onInput/onChange bubbling up to it, for components like SavingsTable that
    // genuinely share the page's one Save button. This panel is the opposite case (C-S4-5): it never calls
    // registerSave/markDirty because every field here belongs to SavingsLoanDialog/SavingsWithdrawalDialog, which
    // persist immediately on their own confirm button. Without stopping propagation here, typing in either dialog
    // still bubbles up as a React synthetic event and flips the shell's isDirty — showing a second, misleading
    // Save FAB and arming the leave-guard for writes that are already saved (F-S4-3, BR-017).
    <section id="savings-ledger" aria-labelledby="savings-ledger-title" aria-busy={loading && hasLoadedOnce.current ? true : undefined} className="mt-space-5 flex flex-col gap-space-4" onInput={event => event.stopPropagation()} onChange={event => event.stopPropagation()}>
      <h2 id="savings-ledger-title" className="m-0 text-lg font-semibold text-primary">ยอดกลาง (เงินออมสะสม)</h2>

      {loading && !hasLoadedOnce.current ? (
        <LoadingSkeleton label="กำลังโหลดยอดกลาง..." className="flex flex-col gap-space-2">
          <SkeletonBlock className="h-9 w-40" />
          <SkeletonBlock className="h-4 w-full" />
          <SkeletonBlock className="h-4 w-full" />
          <SkeletonBlock className="h-4 w-full" />
        </LoadingSkeleton>
      ) : loadError ? (
        <div className="flex flex-col items-start gap-space-2">
          <p role="alert" className="m-0 text-sm text-neg">โหลดข้อมูลยอดกลางไม่สำเร็จ</p>
          <button type="button" className={RETRY_BUTTON} onClick={() => { setLoading(true); setLoadError(false); setRetryTick(value => value + 1); }}>ลองอีกครั้ง</button>
        </div>
      ) : summary ? (
        <>
          <div className="rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1">
            <p className={`m-0 break-words font-[family-name:var(--font-numeric)] text-3xl font-semibold tabular-nums ${poolBalance < 0 ? 'text-neg' : 'text-primary'}`}>
              {poolBalance < 0 ? `−${formatCurrency(Math.abs(poolBalance))}` : formatCurrency(poolBalance)} ฿
            </p>
            {poolBalance < 0 && (
              <p className="m-0 mt-space-1 text-xs text-secondary">
                ยอดกลางติดลบ เพราะเงินออมที่บันทึกไว้ลดลงหลังจากยืม/ถอน — ยืมหรือถอนจากยอดกลางเพิ่มไม่ได้จนกว่ายอดจะเป็นบวก
              </p>
            )}
            <dl className="m-0 mt-space-2 flex flex-col gap-space-1 text-sm text-secondary">
              <div className="flex flex-wrap items-center justify-between gap-space-2">
                <dt>เงินออมที่บันทึกไว้</dt>
                <dd className="m-0 tabular-nums text-primary">{formatCurrency(summary.poolSavingsTotal)}</dd>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-space-2">
                <dt>ยืมออกไป (ยังไม่คืน)</dt>
                <dd className="m-0 tabular-nums text-primary">{`− ${formatCurrency(summary.poolOutstanding)}`}</dd>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-space-2">
                <dt>ถอนออกแล้ว</dt>
                <dd className="m-0 tabular-nums text-primary">{`− ${formatCurrency(summary.poolWithdrawn)}`}</dd>
              </div>
            </dl>
            <p className="m-0 mt-space-2 text-xs text-tertiary">
              {summary.poolCarriedForward > 0
                ? `ⓘ รวมยอดยกมาจากเดือนที่เก่ากว่า 15 เดือน ${formatCurrency(summary.poolCarriedForward)} ฿`
                : 'ⓘ คำนวณจากเงินออมทั้งหมดที่บันทึกไว้ในระบบ'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-space-2">
            <button ref={loanButtonRef} type="button" className={ACTION_BUTTON} onClick={() => setOpenDialog('loan')}>ยืมเงิน</button>
            <button ref={withdrawalButtonRef} type="button" className={ACTION_BUTTON} onClick={() => setOpenDialog('withdrawal')}>ถอนเงินออม</button>
          </div>

          <SavingsLedgerHistory
            loans={loans}
            withdrawals={withdrawals}
            goalNameById={goalNameById}
            onChanged={load}
            focusLoanButton={() => loanButtonRef.current?.focus()}
            focusWithdrawalButton={() => withdrawalButtonRef.current?.focus()}
          />
        </>
      ) : null}

      <SavingsLoanDialog open={openDialog === 'loan'} poolBalance={poolBalance} onClose={() => setOpenDialog(null)} onSaved={load} />
      <SavingsWithdrawalDialog open={openDialog === 'withdrawal'} poolBalance={poolBalance} onClose={() => setOpenDialog(null)} onSaved={load} />
    </section>
  );
}
