// Shared OT scenarios for /api/salary, driven against Mongo and the JSON store.

type ParityDocument = Record<string, unknown>;

interface SalaryOvertimeParityScenario {
  name: string;
  seeds?: ParityDocument[];
  posts?: ParityDocument[];
  get?: string;
  getAll?: boolean;
  expected?: ParityDocument;
  expectedAll?: Record<string, ParityDocument>;
  stored?: Record<string, ParityDocument>;
}

/** Fields that must match exactly between storage modes. */
export const PARITY_FIELDS = ['income', 'deduct', 'overtime', 'overtimeLegacy', 'summary'] as const;

export function pickParityFields(doc: ParityDocument | null | undefined): ParityDocument {
  const out: ParityDocument = {};
  PARITY_FIELDS.forEach(field => {
    if (doc && Object.prototype.hasOwnProperty.call(doc, field)) out[field] = doc[field];
  });
  return out;
}

/**
 * Each scenario can seed legacy data, post a sequence of updates, then assert GET and persisted output.
 */
export const SALARY_OT_PARITY_SCENARIOS: SalaryOvertimeParityScenario[] = [
  {
    name: 'POST persists a summary whose total_income includes the computed OT, and stores only {id,hours,multiplier} (V-1, AC-OT-20, AC-OT-18/22)',
    posts: [{
      month: '2026-09',
      income: { salary: 30000, bonus: 5000 },
      deduct: { social_security: 750, tax: 1500 },
      overtime: [
        { id: 'ot_a', hours: 10, multiplier: 1.5, amount: 99999 },
        { id: 'ot_b', hours: 7.5, multiplier: 3, hourlyRate: 1 }
      ],
      note: 'มี OT'
    }],
    get: '2026-09',
    expected: {
      income: { salary: 30000, bonus: 5000 },
      deduct: { social_security: 750, tax: 1500 },
      overtime: [
        { id: 'ot_a', hours: 10, multiplier: 1.5 },
        { id: 'ot_b', hours: 7.5, multiplier: 3 }
      ],
      overtimeLegacy: [],
      summary: { total_income: 39688, total_deduct: 2250, net_income: 37438 }
    },
    stored: {
      '2026-09': {
        overtime: [
          { id: 'ot_a', hours: 10, multiplier: 1.5 },
          { id: 'ot_b', hours: 7.5, multiplier: 3 }
        ],
        summary: { total_income: 39688, total_deduct: 2250, net_income: 37438 }
      }
    }
  },
  {
    name: 'a legacy overtime_* amount is counted exactly once and survives the save verbatim, labels included (AC-OT-16, V-2)',
    posts: [{
      month: '2026-09',
      income: { salary: 30000, overtime_1_5x: 3200, __labels: { salary: 'เงินเดือน', overtime_1_5x: 'ค่าล่วงเวลา 1.5 เท่า' } },
      deduct: {},
      overtime: [{ id: 'ot_new', hours: 10, multiplier: 1.5 }]
    }],
    get: '2026-09',
    expected: {
      income: { salary: 30000, overtime_1_5x: 3200, __labels: { salary: 'เงินเดือน', overtime_1_5x: 'ค่าล่วงเวลา 1.5 เท่า' } },
      deduct: {},
      overtime: [{ id: 'ot_new', hours: 10, multiplier: 1.5 }],
      overtimeLegacy: [{ id: 'legacy_overtime_1_5x', key: 'overtime_1_5x', label: 'ค่าล่วงเวลา 1.5 เท่า', amount: 3200 }],
      summary: { total_income: 35075, total_deduct: 0, net_income: 35075 }
    },
    stored: {
      '2026-09': {
        income: { salary: 30000, overtime_1_5x: 3200, __labels: { salary: 'เงินเดือน', overtime_1_5x: 'ค่าล่วงเวลา 1.5 เท่า' } }
      }
    }
  },
  {
    name: 'a salary stored as a string feeds the OT total the same value the summary sums (A-3, edge 16c)',
    posts: [{ month: '2026-09', income: { salary: '30000' }, deduct: {}, overtime: [{ id: 'ot_str', hours: 10, multiplier: 1.5 }] }],
    get: '2026-09',
    expected: {
      income: { salary: '30000' },
      deduct: {},
      overtime: [{ id: 'ot_str', hours: 10, multiplier: 1.5 }],
      overtimeLegacy: [],
      summary: { total_income: 31875, total_deduct: 0, net_income: 31875 }
    }
  },
  {
    name: 'a POST without `overtime` clears the rows stored by the previous POST (AC-OT-19, A-9 caller contract)',
    posts: [
      { month: '2026-09', income: { salary: 30000 }, deduct: {}, overtime: [{ id: 'ot_gone', hours: 10, multiplier: 1.5 }] },
      { month: '2026-09', income: { salary: 30000 }, deduct: {} }
    ],
    get: '2026-09',
    expected: {
      income: { salary: 30000 },
      deduct: {},
      overtime: [],
      overtimeLegacy: [],
      summary: { total_income: 30000, total_deduct: 0, net_income: 30000 }
    },
    stored: { '2026-09': { overtime: [] } }
  },
  {
    name: 'carry-forward strips the legacy keys, carries no OT rows, and returns a recomputed summary (V-3, A-1, A-5, AC-OT-14/26, edge 16b)',
    posts: [{
      month: '2026-08',
      income: { salary: 30000, overtime_1_5x: 3200, __labels: { salary: 'เงินเดือน', overtime_1_5x: 'ค่าล่วงเวลา 1.5 เท่า' } },
      deduct: { tax: 500 },
      overtime: [{ id: 'ot_aug', hours: 10, multiplier: 1.5 }]
    }],
    get: '2026-09',
    expected: {
      income: { salary: 30000, __labels: { salary: 'เงินเดือน' } },
      deduct: { tax: 500 },
      overtime: [],
      overtimeLegacy: [],
      summary: { total_income: 30000, total_deduct: 500, net_income: 29500 }
    }
  },
  {
    name: 'GET-all normalises `overtime` and derives `overtimeLegacy` for every month, including malformed stored rows (A-2, edge 16a)',
    seeds: [
      { month: '2026-06', income: { salary: 30000, overtime_2x: 1200 }, deduct: {}, overtime: 'garbage', summary: { total_income: 31200, total_deduct: 0, net_income: 31200 } },
      { month: '2026-07', income: { salary: 31000 }, deduct: {}, overtime: [{ id: 'ot_bad', hours: -5, multiplier: 2.5, amount: 1 }, null], summary: { total_income: 31000, total_deduct: 0, net_income: 31000 } }
    ],
    getAll: true,
    expectedAll: {
      '2026-06': {
        income: { salary: 30000, overtime_2x: 1200 },
        deduct: {},
        overtime: [],
        overtimeLegacy: [{ id: 'legacy_overtime_2x', key: 'overtime_2x', label: 'ค่าล่วงเวลา 2 เท่า', amount: 1200 }],
        summary: { total_income: 31200, total_deduct: 0, net_income: 31200 }
      },
      '2026-07': {
        income: { salary: 31000 },
        deduct: {},
        overtime: [{ id: 'ot_bad', hours: 0, multiplier: 2 }],
        overtimeLegacy: [],
        summary: { total_income: 31000, total_deduct: 0, net_income: 31000 }
      }
    }
  }
];