// Shared OT scenarios for /api/salary, driven twice: once against Mongo (salary.test.js) and once
// against the JSON store (salary-json-mode.test.js).
//
// เหตุผลที่ต้องเป็นไฟล์กลาง ไม่ใช่ก๊อปปี้เคสสองชุด: AC-OT-21 บอกว่าทั้งสองโหมดต้องคืนค่า
// `overtime` / `overtimeLegacy` / `income` / `deduct` / `summary` เหมือนกันสำหรับเอกสารเดียวกัน
// ถ้าเคสถูกเขียนแยกกัน ความ "เหมือนกัน" จะกลายเป็นเรื่องที่คนเขียนเทสต์ต้องคอยจำ ไม่ใช่สิ่งที่เทสต์บังคับ
// (`_id` / `userId` ต่างกันได้ตามโหมด จึงเทียบเฉพาะ 5 ฟิลด์นี้ — A-8)

/** ฟิลด์ที่สองโหมดต้องคืนค่าตรงกันเป๊ะ */
export const PARITY_FIELDS = ['income', 'deduct', 'overtime', 'overtimeLegacy', 'summary'];

export function pickParityFields(doc) {
  const out = {};
  PARITY_FIELDS.forEach((field) => {
    if (doc && Object.prototype.hasOwnProperty.call(doc, field)) out[field] = doc[field];
  });
  return out;
}

/**
 * แต่ละ scenario ประกอบด้วย
 *  - seeds:   เอกสารดิบที่เขียนตรงเข้า store (ข้าม POST) ใช้ทดสอบเอกสารเก่า/ข้อมูลเพี้ยน
 *  - posts:   body ของ POST ตามลำดับ
 *  - get:     เดือนที่จะ GET แล้วเทียบกับ `expected` (เฉพาะ PARITY_FIELDS)
 *  - getAll:  true = GET แบบไม่ระบุเดือน แล้วเทียบ `expectedAll` ทีละเดือน
 *  - stored:  ค่าที่ต้องเป็นจริงใน "เอกสารที่บันทึกแล้ว" ไม่ใช่แค่ response (AC-OT-20/18/19)
 */
export const SALARY_OT_PARITY_SCENARIOS = [
  {
    name: 'POST persists a summary whose total_income includes the computed OT, and stores only {id,hours,multiplier} (V-1, AC-OT-20, AC-OT-18/22)',
    posts: [
      {
        month: '2026-09',
        income: { salary: 30000, bonus: 5000 },
        deduct: { social_security: 750, tax: 1500 },
        // client แนบยอดเงิน/เรตมาด้วย — ต้องถูกทิ้งทั้งคู่ เซิร์ฟเวอร์คำนวณเอง
        overtime: [
          { id: 'ot_a', hours: 10, multiplier: 1.5, amount: 99999 },
          { id: 'ot_b', hours: 7.5, multiplier: 3, hourlyRate: 1 }
        ],
        note: 'มี OT'
      }
    ],
    get: '2026-09',
    // 30,000 + 5,000 = 35,000 ; OT = 125×1.5×10 (1,875) + 125×3×7.5 (2,812.5 → 2,813) = 4,688
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
    posts: [
      {
        month: '2026-09',
        income: {
          salary: 30000,
          overtime_1_5x: 3200,
          __labels: { salary: 'เงินเดือน', overtime_1_5x: 'ค่าล่วงเวลา 1.5 เท่า' }
        },
        deduct: {},
        overtime: [{ id: 'ot_new', hours: 10, multiplier: 1.5 }]
      }
    ],
    get: '2026-09',
    // 30,000 + 3,200 (ผ่าน income ครั้งเดียว) + 1,875 (OT คำนวณ) = 35,075
    expected: {
      income: {
        salary: 30000,
        overtime_1_5x: 3200,
        __labels: { salary: 'เงินเดือน', overtime_1_5x: 'ค่าล่วงเวลา 1.5 เท่า' }
      },
      deduct: {},
      overtime: [{ id: 'ot_new', hours: 10, multiplier: 1.5 }],
      overtimeLegacy: [
        {
          id: 'legacy_overtime_1_5x',
          key: 'overtime_1_5x',
          label: 'ค่าล่วงเวลา 1.5 เท่า',
          amount: 3200
        }
      ],
      summary: { total_income: 35075, total_deduct: 0, net_income: 35075 }
    },
    stored: {
      '2026-09': {
        income: {
          salary: 30000,
          overtime_1_5x: 3200,
          __labels: { salary: 'เงินเดือน', overtime_1_5x: 'ค่าล่วงเวลา 1.5 เท่า' }
        }
      }
    }
  },

  {
    name: 'a salary stored as a string feeds the OT total the same value the summary sums (A-3, edge 16c)',
    posts: [
      {
        month: '2026-09',
        income: { salary: '30000' },
        deduct: {},
        overtime: [{ id: 'ot_str', hours: 10, multiplier: 1.5 }]
      }
    ],
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
      {
        month: '2026-09',
        income: { salary: 30000 },
        deduct: {},
        overtime: [{ id: 'ot_gone', hours: 10, multiplier: 1.5 }]
      },
      // บันทึกครั้งที่สองโดยไม่ส่ง overtime = ล้างแถวทิ้ง ไม่ใช่คงของเดิมไว้
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
    posts: [
      {
        month: '2026-08',
        income: {
          salary: 30000,
          overtime_1_5x: 3200,
          __labels: { salary: 'เงินเดือน', overtime_1_5x: 'ค่าล่วงเวลา 1.5 เท่า' }
        },
        deduct: { tax: 500 },
        overtime: [{ id: 'ot_aug', hours: 10, multiplier: 1.5 }]
      }
    ],
    get: '2026-09',
    // เดือนที่ยังไม่บันทึก: 30,000 เท่านั้น — ไม่มี 3,200 (ตัดทิ้งก่อนคำนวณ) และไม่มี OT ที่ยกมา
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
      {
        month: '2026-06',
        income: { salary: 30000, overtime_2x: 1200 },
        deduct: {},
        // เอกสารเก่า: overtime ไม่ใช่อาร์เรย์เลย
        overtime: 'garbage',
        summary: { total_income: 31200, total_deduct: 0, net_income: 31200 }
      },
      {
        month: '2026-07',
        income: { salary: 31000 },
        deduct: {},
        // สมาชิกเพี้ยน: ตัวคูณนอกชุด ชั่วโมงติดลบ และ property ส่วนเกิน
        overtime: [{ id: 'ot_bad', hours: -5, multiplier: 2.5, amount: 1 }, null],
        summary: { total_income: 31000, total_deduct: 0, net_income: 31000 }
      }
    ],
    getAll: true,
    expectedAll: {
      '2026-06': {
        income: { salary: 30000, overtime_2x: 1200 },
        deduct: {},
        overtime: [],
        overtimeLegacy: [
          { id: 'legacy_overtime_2x', key: 'overtime_2x', label: 'ค่าล่วงเวลา 2 เท่า', amount: 1200 }
        ],
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
