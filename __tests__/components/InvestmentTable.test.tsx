/**
 * InvestmentTable states (spec-ui-review-remediation §C, AC 7-8): pristine vs existing data vs
 * filtered-empty vs load error. Save/dirty contract is unchanged and only spot-checked.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import InvestmentTable from '../../src/frontend/components/InvestmentTable';
import { investmentAPI } from '../../src/shared/utils/frontend/apiUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  investmentAPI: { getByMonth: jest.fn(), getAll: jest.fn(), saveList: jest.fn() }
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

const api = jest.mocked(investmentAPI);
const MONTH = '2026-08';

beforeEach(() => {
  jest.clearAllMocks();
  Element.prototype.scrollIntoView = jest.fn();
  api.getByMonth.mockResolvedValue([] as never);
  api.getAll.mockResolvedValue({} as never);
  api.saveList.mockResolvedValue({ success: true } as never);
});

describe('pristine loaded-empty state', () => {
  it('shows neutral guidance and no allocation warning or "must total 100%" text', async () => {
    render(<InvestmentTable selectedMonth={MONTH} />);
    expect(await screen.findByText('เพิ่มรายการเพื่อจัดสัดส่วน')).toBeInTheDocument();
    expect(screen.queryByText(/ต้องครบ 100%/)).not.toBeInTheDocument();
    expect(screen.queryByText('รวมเปอร์เซ็น')).not.toBeInTheDocument();
    expect(screen.queryByText('ไม่มีรายการลงทุน')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ เพิ่มรายการลงทุน' })).toBeEnabled();
  });

  it('does not show the fresh-empty state while loading', () => {
    api.getByMonth.mockReturnValue(new Promise(() => {}) as never);
    render(<InvestmentTable selectedMonth={MONTH} />);
    // neither the neutral guidance nor the "0% / must total 100%" warning is shown before the data arrives
    expect(screen.queryByText('เพิ่มรายการเพื่อจัดสัดส่วน')).not.toBeInTheDocument();
    expect(screen.queryByText('รวมเปอร์เซ็น')).not.toBeInTheDocument();
    expect(screen.queryByText(/ต้องครบ 100%/)).not.toBeInTheDocument();
  });
});

describe('allocation validation remains once work exists', () => {
  it('adding a row brings back the under-100% feedback and the existing add action', async () => {
    render(<InvestmentTable selectedMonth={MONTH} />);
    fireEvent.click(await screen.findByRole('button', { name: '+ เพิ่มรายการลงทุน' }));
    expect(await screen.findByText('รวมเปอร์เซ็น')).toBeInTheDocument();
    expect(screen.getByText(/ต้องครบ 100%/)).toBeInTheDocument();
    expect(screen.queryByText('เพิ่มรายการเพื่อจัดสัดส่วน')).not.toBeInTheDocument();
  });

  it('a positive base amount with no rows is allocation work, so validation shows', async () => {
    render(<InvestmentTable selectedMonth={MONTH} />);
    await screen.findByText('เพิ่มรายการเพื่อจัดสัดส่วน');
    fireEvent.change(screen.getByLabelText('จำนวนเงินลงทุนรวม (บาท)'), { target: { value: '1000' } });
    expect(screen.getByText(/ต้องครบ 100%/)).toBeInTheDocument();
    expect(screen.queryByText('เพิ่มรายการเพื่อจัดสัดส่วน')).not.toBeInTheDocument();
  });

  it('over-100% feedback and averaging to exactly 100% still work', async () => {
    api.getByMonth.mockResolvedValue([
      { id: 'a', name: 'กองทุน A', percent: '80', amount: '' },
      { id: 'b', name: 'กองทุน B', percent: '40', amount: '' },
      { id: 'c', name: 'กองทุน C', percent: '', amount: '' }
    ] as never);
    render(<InvestmentTable selectedMonth={MONTH} />);
    expect(await screen.findByText(/\(เกิน 100%\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'เฉลี่ยเปอร์เซ็น' }));
    expect(screen.getByText(/^100%/)).toBeInTheDocument();
    expect(screen.queryByText(/เกิน 100%|ต้องครบ 100%/)).not.toBeInTheDocument();
  });
});

describe('filtered-empty is not pristine', () => {
  it('a search that hides existing rows says so, keeps the total check and can be cleared', async () => {
    api.getByMonth.mockResolvedValue([{ id: 'a', name: 'กองทุน A', percent: '100', amount: '' }] as never);
    render(<InvestmentTable selectedMonth={MONTH} />);
    await screen.findAllByDisplayValue('กองทุน A');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ไม่มีชื่อนี้' } });
    expect(screen.getByText('ไม่พบรายการที่ตรงกับคำค้นหา')).toBeInTheDocument();
    expect(screen.queryByText('เพิ่มรายการเพื่อจัดสัดส่วน')).not.toBeInTheDocument();
    expect(screen.getByText('รวมเปอร์เซ็น')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ล้างคำค้นหา' }));
    expect((await screen.findAllByDisplayValue('กองทุน A')).length).toBeGreaterThan(0);
  });
});

describe('load error', () => {
  it('shows an alert with retry, never the fresh-empty guidance, and retry reloads', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    api.getByMonth.mockRejectedValueOnce(new Error('network'));
    render(<InvestmentTable selectedMonth={MONTH} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดรายการลงทุนไม่สำเร็จ');
    expect(screen.queryByText('เพิ่มรายการเพื่อจัดสัดส่วน')).not.toBeInTheDocument();
    expect(screen.queryByText('ไม่มีรายการลงทุน')).not.toBeInTheDocument();
    expect(screen.queryByText('รวมเปอร์เซ็น')).not.toBeInTheDocument();

    api.getByMonth.mockResolvedValueOnce([{ id: 'a', name: 'กองทุน A', percent: '100', amount: '' }] as never);
    fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
    expect((await screen.findAllByDisplayValue('กองทุน A')).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe('percent input names', () => {
  it('names each percent input with purpose and item in both branches', async () => {
    api.getByMonth.mockResolvedValue([
      { id: 'a', name: 'กองทุน A', percent: '60', amount: '' },
      { id: 'b', name: 'กองทุน B', percent: '40', amount: '' }
    ] as never);
    render(<InvestmentTable selectedMonth={MONTH} />);
    expect(await screen.findAllByRole('textbox', { name: 'เปอร์เซ็นการลงทุน - กองทุน A' })).toHaveLength(2);
    expect(screen.getAllByRole('textbox', { name: 'เปอร์เซ็นการลงทุน - กองทุน B' })).toHaveLength(2);
  });
});
