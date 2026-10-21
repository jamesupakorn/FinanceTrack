import { useEffect, useRef, useState } from 'react';
import { showToast } from '../../shared/utils/frontend/toast';
import type { BankAccount } from '../../shared/utils/bankAccountShape';

interface BankAccountDraft {
  key: string;
  id?: string;
  name: string;
  savedName: string;
}

interface BankAccountManagerProps {
  accounts: BankAccount[];
  loading: boolean;
  loadFailed: boolean;
  saving: boolean;
  onSave: (next: Array<{ id?: string; name: string }>) => Promise<boolean>;
  onRetryLoad: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const INPUT = `h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-base text-primary outline-none disabled:opacity-60 ${FOCUS_RING}`;
const REMOVE_BTN = `flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-interactive bg-surface-2 text-neg disabled:opacity-60 ${FOCUS_RING}`;

let draftKeySequence = 0;
const nextDraftKey = () => `new-${++draftKeySequence}`;

export default function BankAccountManager({
  accounts,
  loading,
  loadFailed,
  saving,
  onSave,
  onRetryLoad,
  onDirtyChange
}: BankAccountManagerProps) {
  const [drafts, setDrafts] = useState<BankAccountDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inputsRef = useRef(new Map<string, HTMLInputElement>());
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingFocusRef = useRef<{ key: string } | 'add' | null>(null);

  useEffect(() => {
    setDrafts(accounts.map(account => ({
      key: account.id,
      id: account.id,
      name: account.name,
      savedName: account.name
    })));
    setErrors({});
  }, [accounts]);

  const dirty = drafts.length !== accounts.length || drafts.some((draft, index) =>
    draft.id !== accounts[index]?.id || draft.name.trim() !== accounts[index]?.name
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    if (pending === 'add') {
      addButtonRef.current?.focus();
      return;
    }
    const input = inputsRef.current.get(pending.key);
    input?.focus();
    input?.select();
  }, [drafts]);

  const handleAdd = () => {
    const key = nextDraftKey();
    pendingFocusRef.current = { key };
    setDrafts(previous => [...previous, { key, name: 'บัญชีใหม่', savedName: 'บัญชีใหม่' }]);
  };

  const handleDelete = (index: number) => {
    const nextDrafts = drafts.filter((_, draftIndex) => draftIndex !== index);
    pendingFocusRef.current = index < nextDrafts.length ? { key: nextDrafts[index].key } : 'add';
    setDrafts(nextDrafts);
    setErrors(previous => {
      const next = { ...previous };
      delete next[drafts[index].key];
      return next;
    });
  };

  const handleBlur = (draft: BankAccountDraft) => {
    setDrafts(previous => previous.map(item => {
      if (item.key !== draft.key) return item;
      const name = item.name.trim();
      return name
        ? { ...item, name, savedName: name }
        : { ...item, name: item.savedName };
    }));
  };

  const handleSave = async () => {
    const seen = new Set<string>();
    const duplicateKeys = new Set<string>();
    drafts.forEach(draft => {
      const name = draft.name.trim();
      if (seen.has(name)) duplicateKeys.add(draft.key);
      seen.add(name);
    });
    if (duplicateKeys.size > 0) {
      setErrors(Object.fromEntries([...duplicateKeys].map(key => [key, 'ชื่อบัญชีซ้ำกับบัญชีอื่น'])));
      showToast('ชื่อบัญชีซ้ำกัน กรุณาแก้ไขก่อนบันทึก', 'error');
      return;
    }

    setErrors({});
    await onSave(drafts.map(draft => ({
      ...(draft.id ? { id: draft.id } : {}),
      name: draft.name.trim()
    })));
  };

  const disabled = loading || loadFailed || saving;

  return (
    <div aria-busy={loading || saving}>
      {loading && <p className="mb-space-3 text-sm text-secondary">กำลังโหลดรายชื่อบัญชี...</p>}
      {loadFailed && (
        <div className="mb-space-3 flex flex-col gap-space-2 rounded-sm border border-neg/40 bg-neg/10 p-space-3 text-sm text-neg">
          <span>โหลดรายชื่อบัญชีไม่สำเร็จ</span>
          <button
            type="button"
            className={`min-h-11 w-fit rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-sm font-medium text-primary ${FOCUS_RING}`}
            onClick={onRetryLoad}
          >
            ลองใหม่
          </button>
        </div>
      )}

      {drafts.length === 0 && !loading && (
        <p className="mb-space-3 text-sm text-secondary">ยังไม่มีบัญชี — กด “+ เพิ่มบัญชี” เพื่อเริ่มต้น</p>
      )}

      <div className="flex flex-col gap-space-3">
        {drafts.map((draft, index) => {
          const errorId = `bank-account-error-${draft.key}`;
          return (
            <div key={draft.key}>
              <div className="flex items-center gap-space-2">
                <input
                  ref={node => {
                    if (node) inputsRef.current.set(draft.key, node);
                    else inputsRef.current.delete(draft.key);
                  }}
                  type="text"
                  value={draft.name}
                  onChange={event => {
                    const name = event.target.value;
                    setDrafts(previous => previous.map(item => item.key === draft.key ? { ...item, name } : item));
                    setErrors(previous => {
                      if (!previous[draft.key]) return previous;
                      const next = { ...previous };
                      delete next[draft.key];
                      return next;
                    });
                  }}
                  onBlur={() => handleBlur(draft)}
                  className={INPUT}
                  placeholder="ชื่อบัญชี"
                  aria-label={`ชื่อบัญชี ${index + 1}`}
                  aria-invalid={errors[draft.key] ? 'true' : undefined}
                  aria-describedby={errors[draft.key] ? errorId : undefined}
                  disabled={disabled}
                />
                <button
                  type="button"
                  className={REMOVE_BTN}
                  onClick={() => handleDelete(index)}
                  aria-label={`ลบบัญชี ${draft.name || 'ที่ยังไม่ตั้งชื่อ'}`}
                  disabled={disabled}
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </div>
              {errors[draft.key] && <p id={errorId} className="mb-0 mt-space-1 text-xs text-neg">{errors[draft.key]}</p>}
            </div>
          );
        })}
      </div>

      <p className="mb-0 mt-space-3 text-xs text-tertiary">
        ลบบัญชีที่บัตรเครดิตผูกไว้ ยอดของบัตรนั้นจะไปอยู่ที่ “อื่นๆ/ไม่ระบุบัญชี”
      </p>

      <div className="mt-space-4 flex flex-col gap-space-2 md:flex-row md:justify-end">
        <button
          ref={addButtonRef}
          type="button"
          className={`min-h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary hover:bg-surface-3 disabled:opacity-60 md:w-auto ${FOCUS_RING}`}
          onClick={handleAdd}
          disabled={disabled}
        >
          + เพิ่มบัญชี
        </button>
        <button
          type="button"
          className={`min-h-11 w-full rounded-sm border border-accent bg-accent px-space-4 text-sm font-semibold text-primary disabled:opacity-60 md:w-auto ${FOCUS_RING}`}
          onClick={handleSave}
          disabled={!dirty || disabled}
        >
          {saving ? 'กำลังบันทึก...' : 'บันทึกบัญชีธนาคาร'}
        </button>
      </div>
    </div>
  );
}
