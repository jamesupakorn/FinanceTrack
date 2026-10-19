import { useCallback, useEffect, useState } from 'react';
import { auditLogAPI, type AuditLogItem } from '../../shared/utils/frontend/apiUtils';

export const RESOURCE_LABELS: Record<string, string> = {
  daily_expenses: 'รายจ่ายรายวัน',
  monthly_expense: 'รายจ่ายรายเดือน',
  monthly_income: 'รายรับรายเดือน',
  salary: 'เงินเดือน',
  savings: 'เงินออม',
  investment: 'การลงทุน',
  tax_accumulated: 'ภาษีสะสม',
  savings_goals: 'เป้าหมายการออม',
  credit_cards: 'บัตรเครดิต',
  credit_card_plans: 'แผนผ่อนบัตรเครดิต',
  credit_card_revolving: 'ยอดหมุนเวียนบัตรเครดิต',
  user_profile: 'การตั้งค่าโปรไฟล์',
  account: 'บัญชีผู้ใช้',
  line_link: 'การเชื่อมต่อ LINE',
};

export const ACTION_LABELS: Record<string, string> = {
  created: 'เพิ่มข้อมูล',
  updated: 'แก้ไขข้อมูล',
  deleted: 'ลบข้อมูล',
  retention_pruned: 'ลบอัตโนมัติ (เกิน 15 เดือน)',
  password_changed: 'เปลี่ยนรหัสผ่าน',
};

export const FIELD_LABELS: Record<string, string> = {
  password: 'รหัสผ่าน',
  lineId: 'การเชื่อมต่อ LINE',
  bankAccounts: 'บัญชีธนาคาร',
  budgetThresholds: 'เกณฑ์งบประมาณ',
  monthlySummaryEnabled: 'สรุปการเงินทาง LINE',
  amount: 'จำนวนเงิน',
  name: 'ชื่อรายการ',
  paid: 'สถานะชำระ',
  dueDay: 'วันครบกำหนด',
  bank: 'บัญชี',
};

const label = (map: Record<string, string>, key: string, fallback = key) => map[key] || fallback;

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function ActivityHistory() {
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (cursor: string | null) => {
    if (cursor) setLoadingMore(true); else setLoading(true);
    setFailed(false);
    try {
      const data = await auditLogAPI.list(cursor);
      setItems(prev => (cursor ? [...prev, ...data.items] : data.items));
      setNextCursor(data.nextCursor);
    } catch (error) {
      console.error('Failed to load activity history:', error);
      setFailed(true);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { load(null); }, [load]);

  return (
    <div data-testid="activity-history">
      <h2 className="m-0 text-xl font-semibold text-primary">ประวัติการเปลี่ยนแปลง</h2>
      <p className="m-0 mt-space-2 text-sm text-secondary">แสดงเฉพาะชื่อฟิลด์ที่เปลี่ยน ไม่แสดงค่าเดิมหรือค่าใหม่ เก็บประวัติไว้ 1 ปี</p>

      {loading && <p role="status" className="mt-space-4 text-sm text-secondary">กำลังโหลดประวัติ...</p>}

      {!loading && failed && items.length === 0 && (
        <div role="alert" className="mt-space-4 text-sm text-secondary">
          <p className="m-0">โหลดประวัติไม่สำเร็จ</p>
          <button type="button" className="mt-space-2 rounded-sm border border-border-default px-space-3 py-space-2" onClick={() => load(null)}>ลองใหม่</button>
        </div>
      )}

      {!loading && !failed && items.length === 0 && (
        <p className="mt-space-4 text-sm text-secondary">ยังไม่มีประวัติการเปลี่ยนแปลง</p>
      )}

      {items.length > 0 && (
        <ul className="m-0 mt-space-4 flex list-none flex-col gap-space-3 p-0">
          {items.map(item => (
            <li key={item.eventId} className="rounded-sm border border-border-default bg-surface-2 p-space-3">
              <div className="flex flex-wrap items-baseline justify-between gap-space-2">
                <strong className="text-sm font-semibold text-primary">
                  {label(ACTION_LABELS, item.action, 'การเปลี่ยนแปลง')} · {label(RESOURCE_LABELS, item.resource, 'ข้อมูลอื่น')}
                </strong>
                <time dateTime={item.occurredAt} className="text-xs text-secondary">{formatTime(item.occurredAt)}</time>
              </div>
              {item.resourceKey && <div className="text-xs text-secondary">{item.resourceKey}</div>}
              {item.changedFields.length > 0 && (
                <div className="mt-space-1 text-xs text-secondary">
                  ฟิลด์ที่เปลี่ยน: {item.changedFields.map((f: string) => label(FIELD_LABELS, f)).join(', ')}
                </div>
              )}
              {item.actorType === 'system'
                ? <div className="text-xs text-secondary">โดยระบบ</div>
                : <div className="text-xs text-secondary">โดยคุณ</div>}
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && failed && (
        <p role="alert" className="mt-space-3 text-sm text-secondary">โหลดเพิ่มไม่สำเร็จ</p>
      )}
      {nextCursor && !loading && (
        <button
          type="button"
          className="mt-space-4 rounded-sm border border-border-default px-space-3 py-space-2 text-sm"
          disabled={loadingMore}
          onClick={() => load(nextCursor)}
        >
          {loadingMore ? 'กำลังโหลด...' : failed ? 'ลองใหม่' : 'โหลดเพิ่ม'}
        </button>
      )}
    </div>
  );
}
