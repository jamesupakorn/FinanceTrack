/** @jest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMocks } from 'node-mocks-http';
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import type { Db } from 'mongodb';
import { MongoMemoryServer } from '../../helpers/mongoReplSet';
import { MAX_SPEND_ITEMS_PER_CARD, MAX_SPEND_ITEMS_PER_CYCLE, MAX_REVOLVING_CYCLES_PER_CARD } from '../../../src/shared/utils/creditCardBasics';

const card = { id: 'cc_000000000001', name: 'บัตร A', annualRate: 18, minPaymentPercent: 10, dueDay: 20, creditLimit: 50000 };
const otherCard = { ...card, id: 'cc_000000000002', name: 'บัตร B' };
const month = '2026-10';
const itemInput = { cardId: card.id, month, name: 'อาหาร', amount: 1000 };

describe.each(['json', 'mongo'] as const)('spend items / card totals (%s)', mode => {
  let handler: NextApiHandler;
  let expense: NextApiHandler;
  let cards: NextApiHandler;
  let store: typeof import('../../../src/shared/utils/backend/creditCardStore');
  let session: typeof import('../../../src/shared/utils/backend/sessionCookie');
  let mongod: MongoMemoryServer | undefined;
  let db: Db | undefined;
  let dir: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'credit-spend-'));
    process.env.AUDIT_DATA_DIR = dir;
    process.env.DATA_MODE = mode;
    process.env.SESSION_SECRET = 'fixture-credit-spend-secret';
    if (mode === 'mongo') {
      mongod = await MongoMemoryServer.create();
      process.env.MONGODB_URI = mongod.getUri();
    } else {
      delete process.env.MONGODB_URI;
    }
    jest.resetModules();
    jest.doMock('../../../src/shared/utils/backend/creditCardStore', () => {
      const actual = jest.requireActual<typeof import('../../../src/shared/utils/backend/creditCardStore')>('../../../src/shared/utils/backend/creditCardStore');
      return { ...actual, updateUserCreditData: jest.fn(actual.updateUserCreditData) };
    });
    handler = require('../../../pages/api/credit-cards/spend-items').default;
    expense = require('../../../pages/api/monthly_expense').default;
    cards = require('../../../pages/api/credit-cards/index').default;
    store = require('../../../src/shared/utils/backend/creditCardStore');
    session = require('../../../src/shared/utils/backend/sessionCookie');
    if (mode === 'mongo') db = await require('../../../lib/mongodb').getDbPromise();
  }, 60000);

  afterAll(async () => {
    if (db) await db.client.close();
    if (mongod) await mongod.stop();
    delete process.env.AUDIT_DATA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await store.updateUserCreditData('u1', data => ({ ...data, cards: [card, otherCard], plans: [], cycles: [], spendItems: [] }));
  });

  async function call(route: NextApiHandler, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', body: Record<string, unknown> = {}, query: Record<string, string> = {}, userId: string | null = 'u1', csrf = true) {
    const sid = session.createSessionId();
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method, body, query,
      cookies: userId ? { [session.SESSION_COOKIE_NAME]: session.signSession(userId, sid) } : {},
      headers: csrf ? { 'x-csrf-token': session.signCsrfToken(sid) } : {}
    });
    await route(req, res);
    return { status: res._getStatusCode(), body: JSON.parse(res._getData() || '{}') };
  }

  it('AC-S1/S2/S4/S6: round-trips CRUD, derives an item-only cycle and never stores client money/source fields', async () => {
    const created = await call(handler, 'POST', { item: { ...itemInput, amount: '1,234.56', source: 'migration', newSpend: 999, totalDue: 999 } });
    expect(created.status).toBe(201);
    expect(created.body.cycle).toMatchObject({ month, newSpend: 1234.56 });
    let data = await store.getUserCreditData('u1');
    expect(data.spendItems).toEqual([expect.objectContaining({ name: 'อาหาร', amount: 1234.56, source: 'user' })]);
    expect(data.spendItems[0]).not.toHaveProperty('totalDue');
    expect(data.cycles).toEqual([]);
    const listed = await call(handler, 'GET', {}, { month, cardId: card.id });
    expect(listed.body.totals).toEqual({ [card.id]: 1234.56 });
    const changed = await call(handler, 'PUT', { item: { id: created.body.item.id, amount: 250, cardId: otherCard.id, month: '2030-01' } });
    expect(changed.status).toBe(200);
    expect(changed.body.item).toMatchObject({ cardId: card.id, month, amount: 250 });
    expect(changed.body.cycle.newSpend).toBe(250);
    expect((await call(handler, 'DELETE', { id: created.body.item.id })).status).toBe(200);
    data = await store.getUserCreditData('u1');
    expect(data.spendItems).toEqual([]);
    expect((await call(handler, 'GET', {}, { month })).body.totals[card.id]).toBe(0);
  });

  it.each([-1, 'abc'])('AC-S5 rejects amount %p without changing the document', async amount => {
    const before = await store.getUserCreditData('u1');
    expect((await call(handler, 'POST', { item: { ...itemInput, amount } })).status).toBe(400);
    expect(await store.getUserCreditData('u1')).toEqual(before);
  });

  it('AC-S5 rejects long names, bad months and cross-user writes', async () => {
    expect((await call(handler, 'POST', { item: { ...itemInput, name: 'a'.repeat(61) } })).status).toBe(400);
    expect((await call(handler, 'GET', {}, { month: '2026-13' })).status).toBe(400);
    expect((await call(handler, 'POST', { item: itemInput }, {}, 'u2')).status).toBe(404);
    expect((await call(handler, 'POST', { item: itemInput }, {}, null)).status).toBe(401);
    expect((await call(handler, 'POST', { item: itemInput }, {}, 'u1', false)).status).toBe(403);
  });

  it.each(['cycle', 'card'] as const)('AC-S5 enforces the %s cap without writing', async cap => {
    const count = cap === 'cycle' ? MAX_SPEND_ITEMS_PER_CYCLE : MAX_SPEND_ITEMS_PER_CARD;
    await store.updateUserCreditData('u1', data => ({
      ...data,
      spendItems: Array.from({ length: count }, (_, i) => ({
        id: `si_${i.toString(16).padStart(12, '0')}`, cardId: card.id, month: cap === 'cycle' ? month : '2026-09', name: 'เดิม', amount: 1
      }))
    }));
    const before = await store.getUserCreditData('u1');
    expect((await call(handler, 'POST', { item: itemInput })).status).toBe(409);
    expect(await store.getUserCreditData('u1')).toEqual(before);
  });

  async function seedMixedCard() {
    await store.updateUserCreditData('u1', data => ({
      ...data,
      spendItems: [{ ...itemInput, id: 'si_000000000001' }],
      plans: [{
        id: 'ip_000000000001', cardId: card.id, itemName: 'สินค้า', months: 1, status: 'ongoing',
        schedule: [{ no: 1, dueMonth: month, payment: 300, principal: 300, paid: false }]
      }, {
        id: 'ip_000000000002', cardId: card.id, itemName: 'ยกเลิกแล้ว', months: 1, status: 'cancelled_early',
        schedule: [{ no: 1, dueMonth: month, payment: 50, paid: false }]
      }]
    }));
  }

  it('AC-S7/S8/S9/S10: one full-total row, atomic minimum pay/undo, existing minimum and cancelled plan preserved', async () => {
    await seedMixedCard();
    const key = 'ccr_000000000001';
    let result = await call(expense, 'GET', {}, { month });
    expect(result.body[key]).toMatchObject({ actual: 1300, paid: false, derived: true, breakdown: { installmentTotal: 300, revolving: { newSpend: 1000 } } });
    expect(Object.keys(result.body).filter(k => k.startsWith('cci_'))).toEqual([]);
    const before = await store.getUserCreditData('u1');
    expect((await call(expense, 'PATCH', { month, key, paid: true })).status).toBe(409);
    expect(await store.getUserCreditData('u1')).toEqual(before);
    const write = jest.mocked(store.updateUserCreditData);
    write.mockClear();
    expect((await call(expense, 'PATCH', { month, key, paid: true, paymentAction: 'minimum' })).status).toBe(200);
    expect(write).toHaveBeenCalledTimes(1);
    let data = await store.getUserCreditData('u1');
    expect(data.cycles[0]).toMatchObject({ paymentAction: 'minimum', paidSource: 'card_total' });
    expect(data.cycles[0]).not.toHaveProperty('newSpend');
    expect(data.plans[0].schedule?.[0].paid).toBe(true);
    expect(data.plans[1].schedule?.[0].paid).toBe(false);
    result = await call(expense, 'GET', {}, { month });
    expect(result.body[key]).toMatchObject({ actual: 1300, paid: true, breakdown: { revolving: { minPaymentDue: 100 } } });
    await call(expense, 'PATCH', { month, key, paid: true, paymentAction: 'full' });
    expect((await store.getUserCreditData('u1')).cycles[0].paymentAction).toBe('minimum');
    await call(expense, 'PATCH', { month, key, paid: false });
    data = await store.getUserCreditData('u1');
    expect(data.cycles[0]).toMatchObject({ paymentAction: null, paidAt: null, paidSource: null });
    expect(data.plans[0].schedule?.[0].paid).toBe(false);
  });

  it('AC-S11: a full cycle store aborts before paying any installment', async () => {
    await seedMixedCard();
    await store.updateUserCreditData('u1', data => ({
      ...data, cycles: Array.from({ length: MAX_REVOLVING_CYCLES_PER_CARD }, (_, i) => ({
        cardId: card.id, month: `${2020 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`, paymentAction: 'full'
      }))
    }));
    const before = await store.getUserCreditData('u1');
    expect((await call(expense, 'PATCH', { month, key: 'ccr_000000000001', paid: true, paymentAction: 'full' })).status).toBe(409);
    expect(await store.getUserCreditData('u1')).toEqual(before);
  });

  it('AC-S13: card delete cascades spendItems but preserves another card', async () => {
    await store.updateUserCreditData('u1', data => ({
      ...data, spendItems: [{ ...itemInput, amount: 0, id: 'si_000000000001' }, { ...itemInput, cardId: otherCard.id, amount: 0, id: 'si_000000000002' }]
    }));
    expect((await call(cards, 'DELETE', { cardId: card.id })).status).toBe(200);
    expect((await store.getUserCreditData('u1')).spendItems).toEqual([expect.objectContaining({ cardId: otherCard.id })]);
  });
});
