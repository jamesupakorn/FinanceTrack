import { useEffect, useId, useRef, useState } from 'react';
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

function FilterSelect({
  labelledBy,
  value,
  options,
  onChange
}: {
  labelledBy: string;
  value: string;
  options: ListOption[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));

  useEffect(() => {
    if (!open) return undefined;
    listboxRef.current?.focus();
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };
  const select = (option: ListOption) => {
    onChange(option.value);
    close(true);
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-labelledby={labelledBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        className={`${CONTROL} flex w-full items-center justify-between gap-space-2 text-left text-sm`}
        onClick={() => {
          if (open) close();
          else {
            setActiveIndex(selectedIndex);
            setOpen(true);
          }
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setActiveIndex(selectedIndex);
            setOpen(true);
          }
        }}
      >
        <span className="truncate">{options[selectedIndex]?.label ?? value}</span>
        <svg aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          ref={listboxRef}
          id={`${id}-listbox`}
          role="listbox"
          aria-labelledby={labelledBy}
          aria-activedescendant={`${id}-option-${activeIndex}`}
          tabIndex={0}
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-60 overflow-y-auto rounded-sm border border-border-interactive bg-surface-3 p-space-1 text-sm text-primary shadow-elev-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex(index => Math.min(index + 1, options.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex(index => Math.max(index - 1, 0));
            } else if (event.key === 'Home') {
              event.preventDefault();
              setActiveIndex(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              setActiveIndex(options.length - 1);
            } else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              if (options[activeIndex]) select(options[activeIndex]);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              close(true);
            } else if (event.key === 'Tab') {
              close();
            }
          }}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={`flex min-h-11 cursor-pointer items-center rounded-sm px-space-3 py-space-2 ${index === activeIndex ? 'bg-surface-2' : ''} ${option.value === value ? 'font-semibold text-primary' : 'text-secondary'}`}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => select(option)}
            >
              <span className="min-w-0 break-words">{option.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
        {filters.map(filter => {
          const filterLabelId = `${id}-${filter.key}-label`;
          return (
            <div key={filter.key} className="flex min-w-0 basis-full flex-col gap-space-1 sm:flex-1">
              <span id={filterLabelId} className="text-sm text-secondary">{filter.label}</span>
              {filter.type === 'month'
                ? <input type="month" className={CONTROL} value={criteria.filters[filter.key] ?? ''}
                  min={filter.min} max={filter.max} aria-invalid={Boolean(error)}
                  aria-labelledby={filterLabelId}
                  aria-describedby={error ? `${id}-error` : undefined}
                  onChange={event => updateFilter(filter.key, event.target.value)} />
                : <FilterSelect
                  labelledBy={filterLabelId}
                  value={criteria.filters[filter.key] ?? ''}
                  options={[
                    { value: '', label: 'ทั้งหมด' },
                    ...(criteria.filters[filter.key] && !filter.options?.some(option => option.value === criteria.filters[filter.key])
                      ? [{ value: criteria.filters[filter.key], label: criteria.filters[filter.key] }]
                      : []),
                    ...(filter.options || [])
                  ]}
                  onChange={value => updateFilter(filter.key, value)}
                />}
            </div>
          );
        })}
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
