/**
 * คอมโพเนนต์: CreditCardDashboard (หน้าจอ 1)
 * ภาพรวมหนี้บัตรทั้งหมด + รายการที่ครบกำหนดเร็ว ๆ นี้ + การ์ดบัตรทุกใบ
 *
 * ตอบคำถามเดียวให้เร็วที่สุด: "เดือนนี้ต้องจ่ายบัตรเท่าไหร่ และผ่อนอะไรอยู่บ้าง"
 * บนมือถือรวม summary เหลือการ์ดเดียวเพื่อให้อ่านได้โดยไม่ต้อง scroll (J1)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  resolveInstallmentDueDate,
  formatIsoDateTH,
  diffDaysFromToday,
  describeDueDistance,
  formatDayLabel,
  round2,
  PLAN_STATUS
} from '../../shared/utils/creditCardUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { Icons } from './Icons';
import styles from '../styles/CreditCard.module.css';

const UPCOMING_WINDOW_DAYS = 7;
const UPCOMING_MAX_ITEMS = 5;
const HIGH_UTILISATION_PERCENT = 80;

/** เมนู ⋯ ของการ์ด — ปิดเมื่อคลิกนอกพื้นที่หรือกด Escape (แบบเดียวกับ userMenuWrapper ใน edit.js) */
function CardMenu({ card, onEdit, onAddPlan, onDelete }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false);
    };
    const handleEsc = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  const run = (action) => {
    setOpen(false);
    action?.(card);
  };

  return (
    <div className={styles.menuWrapper} ref={wrapperRef}>
      <button
        type="button"
        className={styles.iconButton}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`ตัวเลือกของบัตร ${card.name}`}
        onClick={() => setOpen(value => !value)}
      >
        <Icons.Settings size={16} />
      </button>
      {open && (
        <div className={styles.menuDropdown} role="menu">
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => run(onEdit)}>
            <Icons.Edit size={16} /> แก้ไขบัตร
          </button>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => run(onAddPlan)}>
            <Icons.Plus size={16} /> เพิ่มแผนผ่อนในบัตรนี้
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${styles.menuItem} ${styles.menuItemDanger}`}
            onClick={() => run(onDelete)}
          >
            <Icons.Trash size={16} /> ลบบัตร
          </button>
        </div>
      )}
    </div>
  );
}

export default function CreditCardDashboard({
  cards = [],
  totals = null,
  plans = [],
  loading = false,
  error = null,
  pendingKeys = [],
  onRetry,
  onAddCard,
  onEditCard,
  onDeleteCard,
  onAddPlan,
  onAddPlanForCard,
  onOpenCard,
  onToggleInstallment,
  onOpenCalendar,
  planCreatedNote = null
}) {
  const cardById = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);

  /** งวดที่ครบกำหนดภายใน 7 วัน หรือเลยกำหนดแล้ว เรียงตามวันที่ */
  const upcoming = useMemo(() => {
    const events = [];
    plans.forEach(plan => {
      if (plan?.status !== PLAN_STATUS.ONGOING) return;
      const card = cardById.get(plan.cardId);
      if (!card) return;
      (Array.isArray(plan.schedule) ? plan.schedule : []).forEach(row => {
        if (row?.paid === true) return;
        const dueDate = resolveInstallmentDueDate(card.dueDay, row.dueMonth);
        const diffDays = diffDaysFromToday(dueDate);
        if (diffDays === null) return;
        if (diffDays > UPCOMING_WINDOW_DAYS) return;
        events.push({
          key: `${plan.id}_${row.no}`,
          planId: plan.id,
          installmentNo: row.no,
          card,
          plan,
          payment: row.payment,
          dueDate,
          diffDays
        });
      });
    });
    events.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return events;
  }, [plans, cardById]);

  const hasPlans = plans.length > 0;

  if (loading) {
    return (
      <div role="status" aria-busy="true">
        <span className={styles.srOnly}>กำลังโหลดข้อมูลบัตรเครดิต</span>
        <div className={styles.skeletonStrip}>
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </div>
        <div className={styles.cardGrid}>
          <div className={styles.skeleton} style={{ height: 220 }} />
          <div className={styles.skeleton} style={{ height: 220 }} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.errorState} role="alert">
        <span>{error}</span>
        <button type="button" className={styles.ghostButton} onClick={onRetry}>ลองใหม่</button>
      </div>
    );
  }

  if (!cards.length) {
    return (
      <div className={styles.emptyState}>
        <Icons.CreditCard size={48} color="var(--color-primary)" />
        <h2 className={styles.emptyTitle}>ยังไม่มีบัตรเครดิต</h2>
        <p className={styles.emptyText}>เพิ่มบัตรเพื่อเริ่มติดตามหนี้และแผนผ่อนชำระ</p>
        <button type="button" className={styles.primaryButton} onClick={onAddCard}>
          <Icons.Plus size={16} /> เพิ่มบัตร
        </button>
      </div>
    );
  }

  const monthlyDueTotal = round2(upcoming.reduce((sum, event) => sum + (Number(event.payment) || 0), 0));
  const dueCardCount = new Set(upcoming.map(event => event.card.id)).size;

  return (
    <div>
      {/* summary — desktop 4 tiles */}
      <div className={styles.summaryStrip} aria-live="polite">
        <div className={styles.summaryTile}>
          <p className={styles.summaryLabel}>หนี้คงเหลือรวม</p>
          <p className={styles.summaryValue}>{formatCurrency(totals?.remainingPayable || 0)}</p>
          <span className={styles.summaryHint}>บาท</span>
        </div>
        <div className={styles.summaryTile}>
          <p className={styles.summaryLabel}>ครบกำหนดเร็ว ๆ นี้</p>
          <p className={styles.summaryValue}>{formatCurrency(monthlyDueTotal)}</p>
          <span className={styles.summaryHint}>{`บาท · ${dueCardCount} บัตร`}</span>
        </div>
        <div className={styles.summaryTile}>
          <p className={styles.summaryLabel}>วงเงินคงเหลือ</p>
          <p className={styles.summaryValue}>{formatCurrency(totals?.availableCredit || 0)}</p>
          <span className={styles.summaryHint}>{`/ ${formatCurrency(totals?.creditLimit || 0)} บาท`}</span>
        </div>
        <div className={styles.summaryTile}>
          <p className={styles.summaryLabel}>แผนที่กำลังผ่อน</p>
          <p className={styles.summaryValue}>{`${totals?.ongoingPlanCount || 0} แผน`}</p>
          <span className={styles.summaryHint}>{`ใน ${totals?.cardCount || 0} บัตร`}</span>
        </div>
      </div>

      {/* summary — mobile single card */}
      <div className={styles.summaryMobileCard} aria-live="polite">
        <p className={styles.summaryLabel}>หนี้คงเหลือรวม</p>
        <p className={styles.summaryValue}>{`${formatCurrency(totals?.remainingPayable || 0)} บาท`}</p>
        <p className={styles.summaryHint}>
          {`ครบกำหนดเร็ว ๆ นี้ ${formatCurrency(monthlyDueTotal)} · เหลือวงเงิน ${formatCurrency(totals?.availableCredit || 0)} · ${totals?.ongoingPlanCount || 0} แผน`}
        </p>
      </div>

      {planCreatedNote && <p className={styles.hint}>{planCreatedNote}</p>}

      <div className={styles.sectionHeaderRow}>
        <h2 className={styles.sectionTitle}>ครบกำหนดเร็ว ๆ นี้</h2>
        {upcoming.length > UPCOMING_MAX_ITEMS && (
          <button type="button" className={styles.ghostButton} onClick={onOpenCalendar}>ดูทั้งหมดในปฏิทิน</button>
        )}
      </div>

      {upcoming.length === 0 ? (
        <p className={styles.hint}>{`ไม่มีรายการครบกำหนดใน ${UPCOMING_WINDOW_DAYS} วันนี้ 🎉`}</p>
      ) : (
        <div className={styles.upcomingList}>
          {upcoming.slice(0, UPCOMING_MAX_ITEMS).map(event => {
            const overdue = event.diffDays < 0;
            const busy = pendingKeys.includes(event.key);
            return (
              <div
                key={event.key}
                className={`${styles.upcomingItem} ${overdue ? styles.upcomingOverdue : ''}`}
                style={{ borderLeftColor: overdue ? undefined : event.card.color }}
              >
                <div className={styles.upcomingTopRow}>
                  <span className={styles.upcomingName}>
                    {overdue && <Icons.AlertTriangle size={16} color="#eb5757" />}
                    <span className={styles.colorChip} style={{ '--card-accent': event.card.color }} aria-hidden="true" />
                    {`${event.card.name}${event.card.last4 ? ` ····${event.card.last4}` : ''}`}
                  </span>
                  <span className={styles.upcomingAmount}>{`${formatCurrency(event.payment)} บาท`}</span>
                </div>
                <span className={styles.upcomingMeta}>
                  {`${event.plan.itemName} · งวด ${event.installmentNo}/${event.plan.months}`}
                </span>
                <span className={styles.upcomingMeta}>
                  {`${formatIsoDateTH(event.dueDate)} · ${describeDueDistance(event.diffDays)}`}
                </span>
                <button
                  type="button"
                  className={`${styles.paidPill} ${busy ? styles.paidPillBusy : ''}`}
                  disabled={busy}
                  onClick={() => onToggleInstallment?.(event.planId, event.installmentNo, true, event.key)}
                >
                  ยังไม่ชำระ — แตะเพื่อยืนยัน
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className={styles.sectionHeaderRow}>
        <h2 className={styles.sectionTitle}>บัตรทั้งหมด</h2>
      </div>

      <div className={styles.cardGrid}>
        {cards.map(card => {
          const creditLimit = Number(card.creditLimit) || 0;
          const utilisation = creditLimit > 0
            ? Math.min(100, round2((Number(card.remainingPrincipal) || 0) / creditLimit * 100))
            : 0;
          const highUtilisation = creditLimit > 0 && utilisation >= HIGH_UTILISATION_PERCENT;
          return (
            <div key={card.id} className={styles.cardTile} style={{ '--card-accent': card.color }}>
              <div className={styles.cardTileHeader}>
                <span className={styles.cardTileName}>
                  <span className={styles.colorChip} aria-hidden="true" />
                  {card.name}
                </span>
                <CardMenu
                  card={card}
                  onEdit={onEditCard}
                  onAddPlan={onAddPlanForCard}
                  onDelete={onDeleteCard}
                />
              </div>
              <span className={styles.cardTileSub}>
                {[card.bankName, card.last4 ? `····${card.last4}` : ''].filter(Boolean).join(' · ') || 'ไม่ระบุธนาคาร'}
              </span>

              <span className={styles.cardDebtLabel}>หนี้คงเหลือ</span>
              <span className={styles.cardDebtValue}>{`${formatCurrency(card.remainingPayable)} บาท`}</span>

              {creditLimit > 0 && (
                <>
                  <div className={styles.utilBar}>
                    <div
                      className={`${styles.utilFill} ${highUtilisation ? styles.utilFillDanger : ''}`}
                      style={{ width: `${utilisation}%` }}
                    />
                  </div>
                  <span className={styles.utilText}>
                    {`ใช้ไป ${utilisation.toFixed(1)}% · วงเงิน ${formatCurrency(creditLimit)} · เหลือ ${formatCurrency(card.availableCredit)}`}
                  </span>
                  {highUtilisation && (
                    <span className={styles.warnChip}>
                      <Icons.AlertTriangle size={14} /> ใช้วงเงินเกิน {HIGH_UTILISATION_PERCENT}%
                    </span>
                  )}
                </>
              )}

              <span className={styles.cardMetaLine}>
                {`สรุปยอด ${formatDayLabel(card.statementDay)} · ครบกำหนด ${formatDayLabel(card.dueDay)}`}
              </span>
              <span className={styles.cardMetaLine}>{`${card.ongoingPlanCount} แผนกำลังผ่อน`}</span>

              <div className={styles.cardTileFooter}>
                <button type="button" className={styles.ghostButton} onClick={() => onOpenCard?.(card.id)}>
                  ดูรายละเอียด
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {!hasPlans && <p className={styles.hint}>ยังไม่มีแผนผ่อน — กด + เพิ่มแผนผ่อนชำระ</p>}

      <div className={styles.sectionHeaderRow}>
        <button type="button" className={styles.primaryButton} onClick={onAddPlan}>
          <Icons.Plus size={16} /> เพิ่มแผนผ่อนชำระ
        </button>
      </div>
    </div>
  );
}
