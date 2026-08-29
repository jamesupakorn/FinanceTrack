/**
 * คอมโพเนนต์: CreditCardDetail (หน้าจอ 2)
 * รายละเอียดบัตร 1 ใบ: สรุปวงเงิน/หนี้ + แผนผ่อนทั้งหมดของบัตรนั้น พร้อมตารางผ่อนรายงวด
 *
 * ตารางผ่อน: กางไว้บน desktop, พับไว้บนมือถือ (window.innerWidth < 768 ตอน init)
 * แผน 60 งวดจะไม่ถูกเทลงจอมือถือทั้งก้อน — แสดง 6 งวดถัดไปที่ยังไม่ชำระ + งวดที่ชำระแล้ว
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatDayLabel,
  formatIsoDateTH,
  resolveInstallmentDueDate,
  round2,
  PLAN_STATUS
} from '../../shared/utils/creditCardUtils';
import { formatMonthKeyTH } from '../../shared/utils/dateUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { Icons } from './Icons';
import RevolvingBalanceSection from './RevolvingBalanceSection';
import styles from '../styles/CreditCard.module.css';

const COLLAPSED_UNPAID_PREVIEW = 6;
const LONG_PLAN_THRESHOLD = 12;

function PlanMenu({ plan, onRename, onEdit, onCancel, onDelete }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const editable = plan.installmentsPaid === 0 && plan.status !== PLAN_STATUS.CANCELLED;

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
    action?.(plan);
  };

  return (
    <div className={styles.menuWrapper} ref={wrapperRef}>
      <button
        type="button"
        className={styles.iconButton}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`ตัวเลือกของแผน ${plan.itemName}`}
        onClick={() => setOpen(value => !value)}
      >
        <Icons.Settings size={16} />
      </button>
      {open && (
        <div className={styles.menuDropdown} role="menu">
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => run(onRename)}>
            <Icons.Edit size={16} /> แก้ไขชื่อรายการ
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            disabled={!editable}
            title={editable ? undefined : `แก้ไขไม่ได้เพราะชำระไปแล้ว ${plan.installmentsPaid} งวด`}
            onClick={() => run(onEdit)}
          >
            <Icons.Settings size={16} /> แก้ไขแผน
          </button>
          {!editable && plan.status !== PLAN_STATUS.CANCELLED && (
            <p className={styles.menuHelper}>
              {`แก้ไขไม่ได้เพราะชำระไปแล้ว ${plan.installmentsPaid} งวด — ให้ยกเลิกแผนแล้วสร้างใหม่`}
            </p>
          )}
          {plan.status !== PLAN_STATUS.CANCELLED && (
            <button
              type="button"
              role="menuitem"
              className={`${styles.menuItem} ${styles.menuItemDanger}`}
              onClick={() => run(onCancel)}
            >
              <Icons.X size={16} /> ยกเลิกแผน
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className={`${styles.menuItem} ${styles.menuItemDanger}`}
            disabled={plan.installmentsPaid > 0}
            title={plan.installmentsPaid > 0 ? 'ลบไม่ได้เพราะมีงวดที่ชำระแล้ว — ให้ยกเลิกแผนแทน' : undefined}
            onClick={() => run(onDelete)}
          >
            <Icons.Trash size={16} /> ลบแผน
          </button>
        </div>
      )}
    </div>
  );
}

function describePlanInterest(plan) {
  if (plan.interestMode === 'manual') {
    return `ค่าธรรมเนียม ${formatCurrency(plan.manualFeePerMonth)} บาท/งวด`;
  }
  const methodLabel = plan.calcMethod === 'effective' ? 'ลดต้นลดดอก' : 'แบบคงที่';
  return `${methodLabel} ${plan.annualRate}%/ปี`;
}

function PlanCard({
  plan,
  card,
  isMobileView,
  pendingKeys,
  onToggleInstallment,
  onRename,
  onEdit,
  onCancel,
  onDelete
}) {
  const [scheduleOpen, setScheduleOpen] = useState(!isMobileView);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setScheduleOpen(!isMobileView);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobileView]);

  const schedule = Array.isArray(plan.schedule) ? plan.schedule : [];
  const nextUnpaidNo = plan.nextUnpaid?.no ?? null;
  const isLongPlan = plan.months > LONG_PLAN_THRESHOLD;

  const visibleRows = useMemo(() => {
    if (!isLongPlan || showAll) return schedule;
    let unpaidShown = 0;
    return schedule.filter(row => {
      if (row.paid === true) return true;
      if (unpaidShown < COLLAPSED_UNPAID_PREVIEW) {
        unpaidShown += 1;
        return true;
      }
      return false;
    });
  }, [schedule, isLongPlan, showAll]);

  const settled = plan.status === PLAN_STATUS.COMPLETED || plan.status === PLAN_STATUS.CANCELLED;

  const renderPaidPill = (row) => {
    const key = `${plan.id}_${row.no}`;
    const busy = pendingKeys.includes(key);
    const disabled = busy || plan.status === PLAN_STATUS.CANCELLED;
    return (
      <button
        type="button"
        className={`${styles.paidPill} ${row.paid ? styles.paidPillOn : ''} ${busy ? styles.paidPillBusy : ''}`}
        disabled={disabled}
        onClick={() => onToggleInstallment?.(plan.id, row.no, !row.paid, key)}
      >
        {row.paid ? '✓ ชำระแล้ว' : 'ยังไม่ชำระ — แตะเพื่อยืนยัน'}
      </button>
    );
  };

  return (
    <div className={`${styles.planCard} ${settled ? styles.planCardSettled : ''}`}>
      <div className={styles.planHeaderRow}>
        <h3 className={styles.planTitle} title={plan.itemName}>{plan.itemName}</h3>
        <PlanMenu
          plan={plan}
          onRename={onRename}
          onEdit={onEdit}
          onCancel={onCancel}
          onDelete={onDelete}
        />
      </div>

      {plan.status === PLAN_STATUS.COMPLETED && <span className={`${styles.badge} ${styles.badgeDone}`}>✓ ผ่อนครบแล้ว</span>}
      {plan.status === PLAN_STATUS.CANCELLED && <span className={`${styles.badge} ${styles.badgeCancelled}`}>ยกเลิกแผนแล้ว</span>}

      <span className={styles.planMeta}>{`${formatCurrency(plan.totalPrice)} บาท · ${plan.months} งวด`}</span>
      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${plan.progressPercent}%` }} />
      </div>
      <span className={styles.planMeta}>{`${plan.installmentsPaid}/${plan.months} งวด · ชำระแล้ว ${plan.progressPercent}%`}</span>
      <span className={styles.planMeta}>{`งวดละ ${formatCurrency(plan.monthlyPayment)} บาท · คงเหลือ ${formatCurrency(plan.remainingPayable)} บาท`}</span>
      <span className={styles.planMeta}>{describePlanInterest(plan)}</span>
      {plan.nextUnpaid && (
        <span className={styles.planMeta}>
          {`งวดถัดไป ${plan.nextUnpaid.no}/${plan.months} · ${formatIsoDateTH(resolveInstallmentDueDate(card?.dueDay, plan.nextUnpaid.dueMonth))}`}
        </span>
      )}

      <button
        type="button"
        className={styles.scheduleToggle}
        aria-expanded={scheduleOpen}
        onClick={() => setScheduleOpen(value => !value)}
      >
        {scheduleOpen ? 'ซ่อนตารางผ่อน' : 'ดูตารางผ่อน'}
        <Icons.ChevronDown size={16} />
      </button>

      {scheduleOpen && (
        <>
          {/* desktop */}
          <div className={styles.scheduleTableWrap}>
            <table className={styles.scheduleTable}>
              <thead>
                <tr>
                  <th>งวด</th>
                  <th>เดือน</th>
                  <th>ยอดชำระ</th>
                  <th>เงินต้น</th>
                  <th>ดอกเบี้ย</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(row => (
                  <tr
                    key={row.no}
                    className={`${row.paid ? styles.scheduleRowPaid : ''} ${row.no === nextUnpaidNo ? styles.scheduleRowNext : ''}`}
                  >
                    <td>{row.no}</td>
                    <td>{formatMonthKeyTH(row.dueMonth)}</td>
                    <td>{formatCurrency(row.payment)}</td>
                    <td>{formatCurrency(row.principal)}</td>
                    <td>{formatCurrency(row.interest)}</td>
                    <td>{renderPaidPill(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* mobile */}
          <div className={styles.scheduleCards}>
            {visibleRows.map(row => (
              <div
                key={row.no}
                className={`${styles.scheduleCard} ${row.paid ? styles.scheduleCardPaid : ''} ${row.no === nextUnpaidNo ? styles.scheduleCardNext : ''}`}
              >
                <div className={styles.scheduleCardHead}>
                  <span>{`งวด ${row.no}`}</span>
                  <span>{formatMonthKeyTH(row.dueMonth)}</span>
                </div>
                <span className={styles.scheduleCardAmount}>{formatCurrency(row.payment)}</span>
                <span className={styles.scheduleCardSplit}>
                  {`ต้น ${formatCurrency(row.principal)} · ดบ ${formatCurrency(row.interest)}`}
                </span>
                {renderPaidPill(row)}
              </div>
            ))}
          </div>

          {isLongPlan && !showAll && visibleRows.length < schedule.length && (
            <button type="button" className={styles.scheduleMoreButton} onClick={() => setShowAll(true)}>
              {`แสดงทั้งหมด (${plan.months} งวด)`}
            </button>
          )}
        </>
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
  onRenamePlan,
  onEditPlan,
  onCancelPlan,
  onDeletePlan,
  onToggleInstallment,
  onConfirmMinimum,
  onRevolvingChanged
}) {
  const [isMobileView, setIsMobileView] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobileView(media.matches);
    update();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  const defaultScheduleOpen = !isMobileView;

  const orderedPlans = useMemo(() => {
    const rank = (plan) => (plan.status === PLAN_STATUS.ONGOING ? 0 : 1);
    return [...plans].sort((a, b) => rank(a) - rank(b) || String(a.createdAt).localeCompare(String(b.createdAt)));
  }, [plans]);

  if (!card) {
    return (
      <div className={styles.emptyState}>
        <Icons.AlertTriangle size={40} color="#eb5757" />
        <h2 className={styles.emptyTitle}>ไม่พบบัตรใบนี้</h2>
        <button type="button" className={styles.ghostButton} onClick={onBack}>กลับหน้าภาพรวม</button>
      </div>
    );
  }

  const creditLimit = Number(card.creditLimit) || 0;
  const utilisation = creditLimit > 0
    ? Math.min(100, round2((Number(card.remainingPrincipal) || 0) / creditLimit * 100))
    : 0;

  return (
    <div>
      <div className={styles.sectionHeaderRow}>
        <button type="button" className={styles.ghostButton} onClick={onBack} aria-label="กลับหน้าภาพรวม">
          <Icons.ChevronLeft size={16} /> กลับ
        </button>
        <h2 className={styles.sectionTitle}>{card.name}</h2>
      </div>

      <div className={styles.detailLayout}>
        <div className={styles.detailSummaryPanel} style={{ '--card-accent': card.color }}>
          <div className={styles.detailBand} />
          <div className={styles.detailBody}>
            <span className={styles.cardTileName}>
              <span className={styles.colorChip} aria-hidden="true" />
              {card.name}
            </span>
            <span className={styles.cardTileSub}>
              {[card.bankName, card.last4 ? `····${card.last4}` : ''].filter(Boolean).join(' · ') || 'ไม่ระบุธนาคาร'}
            </span>

            <span className={styles.cardDebtLabel}>หนี้คงเหลือ</span>
            <span className={styles.cardDebtValue}>{`${formatCurrency(card.remainingPayable)} บาท`}</span>

            {/* แยกที่มาให้ชัด มิฉะนั้นตัวเลขรวมจะอธิบายไม่ได้เมื่อมีสองแหล่งป้อนเข้ามา */}
            {Number(card.revolvingDue) > 0 && (
              <>
                <div className={styles.detailRow}>
                  <span className={styles.detailRowLabel}>ผ่อนชำระ</span>
                  <span className={styles.detailRowValue}>{formatCurrency(card.installmentPayable)}</span>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailRowLabel}>ยอดหมุนเวียน</span>
                  <span className={styles.detailRowValue}>{formatCurrency(card.revolvingDue)}</span>
                </div>
              </>
            )}

            {creditLimit > 0 && (
              <>
                <div className={styles.detailRow}>
                  <span className={styles.detailRowLabel}>วงเงิน</span>
                  <span className={styles.detailRowValue}>{formatCurrency(creditLimit)}</span>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailRowLabel}>ใช้ไป</span>
                  <span className={styles.detailRowValue}>{formatCurrency(card.remainingPrincipal)}</span>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailRowLabel}>คงเหลือ</span>
                  <span className={styles.detailRowValue}>{formatCurrency(card.availableCredit)}</span>
                </div>
                <div className={styles.utilBar}>
                  <div
                    className={`${styles.utilFill} ${utilisation >= 80 ? styles.utilFillDanger : ''}`}
                    style={{ width: `${utilisation}%` }}
                  />
                </div>
                <span className={styles.utilText}>{`${utilisation.toFixed(1)}%`}</span>
              </>
            )}

            <div className={styles.detailRow}>
              <span className={styles.detailRowLabel}>สรุปยอด</span>
              <span className={styles.detailRowValue}>{formatDayLabel(card.statementDay)}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailRowLabel}>ครบกำหนด</span>
              <span className={styles.detailRowValue}>{formatDayLabel(card.dueDay)}</span>
            </div>

            <div className={styles.cardTileFooter}>
              <button type="button" className={styles.ghostButton} onClick={() => onEditCard?.(card)}>
                <Icons.Edit size={16} /> แก้ไขบัตร
              </button>
            </div>
            <div className={styles.cardTileFooter}>
              <button type="button" className={styles.ghostButton} onClick={() => onDeleteCard?.(card)}>
                <Icons.Trash size={16} /> ลบบัตร
              </button>
            </div>
          </div>
        </div>

        <div>
          {/* ยอดหมุนเวียนเป็นภาระหลักของบัตร จึงอยู่เหนือรายการแผนผ่อนซึ่งเป็นรายละเอียดย่อย */}
          <RevolvingBalanceSection
            card={card}
            isMobileView={isMobileView}
            onConfirmMinimum={onConfirmMinimum}
            onChanged={onRevolvingChanged}
          />

          <div className={styles.sectionHeaderRow}>
            <h2 className={styles.sectionTitle}>{`แผนผ่อนชำระ (${plans.length})`}</h2>
            <button type="button" className={styles.primaryButton} onClick={() => onAddPlanForCard?.(card)}>
              <Icons.Plus size={16} /> เพิ่ม
            </button>
          </div>

          {orderedPlans.length === 0 ? (
            <p className={styles.hint}>ยังไม่มีแผนผ่อนในบัตรนี้ — กด “เพิ่ม” เพื่อเริ่มต้น</p>
          ) : (
            <div className={styles.planList}>
              {orderedPlans.map(plan => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  card={card}
                  isMobileView={isMobileView}
                  pendingKeys={pendingKeys}
                  onToggleInstallment={onToggleInstallment}
                  onRename={onRenamePlan}
                  onEdit={onEditPlan}
                  onCancel={onCancelPlan}
                  onDelete={onDeletePlan}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
