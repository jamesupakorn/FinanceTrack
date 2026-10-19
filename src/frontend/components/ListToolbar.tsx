import { useId, useState } from 'react';
import type { ListCriteria } from '../../shared/utils/frontend/listView';
import { emptyListCriteria } from '../../shared/utils/frontend/listView';

export interface ListOption { value: string; label: string }
export interface ListFilter {
  key: string;
  label: string;
  options?: ListOption[];
  type?: 'month';
  min?: string;
  max?: string;
}
interface ListToolbarProps {
  label: string;
  criteria: ListCriteria;
  onChange: (criteria: ListCriteria) => void;
  orders?: ListOption[];
  filters?: ListFilter[];
  search?: boolean;
  visible: number;
  total: number;
  changed?: boolean;
  onRefresh?: () => void;
  pinned?: number;
  groupNote?: string;
  helper?: string;
  error?: string;
}

const CONTROL = 'min-h-11 min-w-0 rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-base text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

export default function ListToolbar({
  label, criteria, onChange, orders = [], filters = [], search = true,
  visible, total, changed, onRefresh, pinned = 0, groupNote, helper, error
}: ListToolbarProps) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const activeFilters = filters.filter(filter => Boolean(criteria.filters[filter.key]));
  const restricted = Boolean(criteria.query || activeFilters.length);
  const updateFilter = (key: string, value: string) =>
    onChange({ ...criteria, filters: { ...criteria.filters, [key]: value } });
  return (
    <div data-list-view-controls className="my-space-4 min-w-0 space-y-space-3">
      <div className="flex flex-wrap items-end gap-space-2">
        {search && (
          <label className="flex min-w-0 basis-full flex-col gap-space-1 md:flex-1 md:basis-auto">
            <span className="text-sm text-secondary">ค้นหา{label}</span>
            <span className="flex gap-space-2">
              <input type="search" className={`${CONTROL} w-full`} placeholder={`ค้นหา${label}…`}
                value={draft ?? criteria.query}
                onCompositionStart={event => setDraft(event.currentTarget.value)}
                onCompositionEnd={event => {
                  setDraft(null);
                  onChange({ ...criteria, query: event.currentTarget.value });
                }}
                onChange={event => {
                  if (draft !== null) setDraft(event.target.value);
                  else onChange({ ...criteria, query: event.target.value });
                }} />
              {criteria.query && <button type="button" className={CONTROL} aria-label={`ล้างคำค้นหา${label}`}
                onClick={() => { setDraft(null); onChange({ ...criteria, query: '' }); }}>ล้าง</button>}
            </span>
          </label>
        )}
        {filters.length > 0 && <button type="button" className={`${CONTROL} flex-1 md:flex-none`}
          aria-expanded={expanded} aria-controls={`${id}-filters`} onClick={() => setExpanded(value => !value)}>
          ตัวกรอง{activeFilters.length ? ` (${activeFilters.length})` : ''}
        </button>}
        {orders.length > 0 && <label className="flex min-w-0 flex-1 flex-col gap-space-1">
          <span className="text-sm text-secondary">เรียงตาม — {label}</span>
          <select className={`${CONTROL} w-full`} value={criteria.order}
            onChange={event => onChange({ ...criteria, order: event.target.value })}>
            <option value="">ลำดับเดิม</option>
            {orders.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>}
      </div>
      {expanded && filters.length > 0 && <div id={`${id}-filters`} className="flex flex-wrap gap-space-3 rounded-sm bg-surface-2 p-space-3">
        {filters.map(filter => <label key={filter.key} className="flex min-w-0 basis-full flex-col gap-space-1 sm:flex-1">
          <span className="text-sm text-secondary">{filter.label}</span>
          {filter.type === 'month'
            ? <input type="month" className={CONTROL} value={criteria.filters[filter.key] ?? ''}
              min={filter.min} max={filter.max} aria-invalid={Boolean(error)}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={event => updateFilter(filter.key, event.target.value)} />
            : <select className={CONTROL} value={criteria.filters[filter.key] ?? ''}
              onChange={event => updateFilter(filter.key, event.target.value)}>
              <option value="">ทั้งหมด</option>
              {criteria.filters[filter.key] && !filter.options?.some(option => option.value === criteria.filters[filter.key]) &&
                <option value={criteria.filters[filter.key]}>{criteria.filters[filter.key]}</option>}
              {filter.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>}
        </label>)}
      </div>}
      {activeFilters.length > 0 && <p className="break-words text-sm text-secondary">
        {activeFilters.map(filter => `${filter.label}: ${filter.options?.find(option => option.value === criteria.filters[filter.key])?.label ?? criteria.filters[filter.key]}`).join(' · ')}
      </p>}
      {error && <p id={`${id}-error`} role="alert" className="text-sm text-neg">{error}</p>}
      <div className="flex flex-wrap items-center gap-space-2">
        <p role="status" aria-live="polite" className="text-sm text-secondary">แสดง {visible} จาก {total} รายการ</p>
        {restricted && <button type="button" className={CONTROL}
          onClick={() => onChange({ ...emptyListCriteria(), order: criteria.order })}>ล้างตัวกรอง</button>}
        {(restricted || criteria.order) && <button type="button" className={CONTROL}
          onClick={() => onChange(emptyListCriteria())}>คืนค่าเริ่มต้น</button>}
        {changed && onRefresh && <button type="button" className={CONTROL} onClick={onRefresh}>อัปเดตรายการ</button>}
      </div>
      {pinned > 0 && <p className="text-sm text-secondary">รายการใหม่ — ยังไม่กรอง ({pinned})</p>}
      {changed && !pinned && <p className="text-sm text-secondary">แก้ไขอยู่ — ยังไม่กรอง</p>}
      {criteria.order && groupNote && <p className="text-sm text-secondary">{groupNote}</p>}
      {restricted && <p className="text-sm text-secondary">ยอดสรุปรวมทุกรายการ</p>}
      {helper && <p className="text-sm text-secondary">{helper}</p>}
      {total > 0 && visible === 0 && <p className="text-sm text-secondary">ไม่พบรายการที่ตรงกับตัวกรอง</p>}
    </div>
  );
}
