/** @jest-environment node */
// Integration test against a real (ephemeral, in-process) MongoDB instance — see
// .pipeline/spec-td-c01-api-coverage-6.md for why mongodb-memory-server (not a mocked collection) was
// chosen: `updateUserLineIdMongo`'s upsert-vs-update branching is a real conditional-write operation, and
// a mocked collection would prove nothing about whether it genuinely creates a new document vs. preserves
// an existing one's unrelated fields. `crypto` is likewise never mocked — the HMAC-SHA256 signature check
// is real cryptography, computed the same way the LINE platform would, so a regression in
// `verifySignature`'s comparison logic is actually caught.
//
// This route's trust model (raw-body HMAC signature via `X-Line-Signature`) is materially different from
// every other tested route's session-cookie+CSRF `makeReqRes` pattern, so this file uses its own
// route-specific `sendWebhook` helper instead of reusing prior slices' `makeReqRes`.
import crypto from 'crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMocks } from 'node-mocks-http';

const TEST_SECRET = 'test-line-channel-secret';

let mongod;
let handler;
let getDbPromise;
let db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();

  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';
  process.env.LINE_CHANNEL_SECRET = TEST_SECRET;

  jest.resetModules();

  handler = require('../../pages/api/line_webhook').default;
  ({ getDbPromise } = require('../../lib/mongodb'));
  db = await getDbPromise();
}, 60000);

afterAll(async () => {
  if (db?.client) {
    await db.client.close();
  }
  if (mongod) {
    await mongod.stop();
  }
});

beforeEach(async () => {
  if (db) {
    await db.collection('users').deleteMany({});
  }
  // Restore the secret before every test — test 2 deliberately deletes it to exercise the
  // "misconfigured secret" case and must not leak that deletion into a later test.
  process.env.LINE_CHANNEL_SECRET = TEST_SECRET;
});

function computeSignature(bodyString, secret = TEST_SECRET) {
  return crypto.createHmac('sha256', secret).update(bodyString).digest('base64');
}

/**
 * Sends a webhook request through the real raw-body stream path.
 * `req.send(bodyString)` is `node-mocks-http`'s own mechanism for triggering a mock request's
 * `'data'`/`'end'` events — exactly what the route's `getRawBody(req)` is waiting on. `handler(req,
 * res)` must be invoked (but not yet awaited) BEFORE `req.send(...)`, because `getRawBody`'s Promise
 * executor (which calls `req.on('data'|'end'|'error', ...)`) runs synchronously the instant the handler
 * calls it, ahead of the `await` that would otherwise suspend — so the listeners are guaranteed to be
 * attached by the time this function calls `req.send(...)` in the same synchronous tick. Inverting this
 * order (awaiting the handler before sending the body) would hang indefinitely.
 */
async function sendWebhook({ bodyString, signature, headers = {}, method = 'POST' } = {}) {
  const { req, res } = createMocks({
    method,
    headers: {
      ...(signature !== undefined ? { 'x-line-signature': signature } : {}),
      ...headers
    }
  });
  const pending = handler(req, res);
  if (method === 'POST') {
    req.send(bodyString ?? '');
  }
  await pending;
  return { req, res };
}

function linkPayload(events) {
  return JSON.stringify({ events });
}

function messageEvent({ userId = 'test-line-user-id', text }) {
  return { type: 'message', source: { userId }, message: { type: 'text', text } };
}

describe('/api/line_webhook (Mongo mode)', () => {
  it('non-POST method (GET) returns 405 with a JSON body, before getRawBody is ever reached', async () => {
    const { res } = await sendWebhook({ method: 'GET' });

    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Method not allowed' });
  });

  it('LINE_CHANNEL_SECRET unset returns 500 and leaves the DB unchanged', async () => {
    const bodyString = linkPayload([messageEvent({ text: 'link u001' })]);
    // The signature check happens after the missing-secret check, so a validly-signed (against the
    // secret that's about to be deleted) request still reaches the 500 branch first.
    const signature = computeSignature(bodyString);
    delete process.env.LINE_CHANNEL_SECRET;

    try {
      const { res } = await sendWebhook({ bodyString, signature });

      expect(res._getStatusCode()).toBe(500);
      expect(JSON.parse(res._getData())).toEqual({ error: 'LINE_CHANNEL_SECRET is not configured' });
      expect(await db.collection('users').countDocuments({})).toBe(0);
    } finally {
      // Belt-and-suspenders: restore even if an assertion above throws, so a failure mid-test can't
      // leak into the next one (in addition to `beforeEach`'s own restore).
      process.env.LINE_CHANNEL_SECRET = TEST_SECRET;
    }
  });

  it('missing X-Line-Signature header returns 401 and leaves the DB unchanged', async () => {
    const bodyString = linkPayload([messageEvent({ text: 'link u001' })]);

    const { res } = await sendWebhook({ bodyString, signature: undefined });

    expect(res._getStatusCode()).toBe(401);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Invalid signature' });
    expect(await db.collection('users').countDocuments({})).toBe(0);
  });

  it('wrong/mismatched signature returns 401 and leaves the DB unchanged', async () => {
    const bodyString = linkPayload([messageEvent({ text: 'link u001' })]);

    const { res } = await sendWebhook({ bodyString, signature: 'not-the-real-signature==' });

    expect(res._getStatusCode()).toBe(401);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Invalid signature' });
    expect(await db.collection('users').countDocuments({})).toBe(0);
  });

  it('a signature computed over a different body than the one actually sent is rejected (401)', async () => {
    const signedBody = linkPayload([messageEvent({ text: 'link u001' })]);
    const signature = computeSignature(signedBody);
    // Differs by whitespace only — proves the check verifies the exact bytes sent, not merely that
    // some valid-looking signature is present.
    const sentBody = `${signedBody} `;

    const { res } = await sendWebhook({ bodyString: sentBody, signature });

    expect(res._getStatusCode()).toBe(401);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Invalid signature' });
  });

  it('malformed JSON body with a valid signature returns 400 and leaves the DB unchanged', async () => {
    const bodyString = '{not valid json';
    const signature = computeSignature(bodyString);

    const { res } = await sendWebhook({ bodyString, signature });

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'JSON ไม่ถูกต้อง' });
    expect(await db.collection('users').countDocuments({})).toBe(0);
  });

  it('valid signature with an empty events array returns 200/{ ok: true } and leaves the DB unchanged', async () => {
    const bodyString = linkPayload([]);
    const signature = computeSignature(bodyString);

    const { res } = await sendWebhook({ bodyString, signature });

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ ok: true });
    expect(await db.collection('users').countDocuments({})).toBe(0);
  });

  it('a non-message event type is ignored', async () => {
    const bodyString = linkPayload([{ type: 'follow', source: { userId: 'x' } }]);
    const signature = computeSignature(bodyString);

    const { res } = await sendWebhook({ bodyString, signature });

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ ok: true });
    expect(await db.collection('users').countDocuments({})).toBe(0);
  });

  it('a message event with a non-text message type is ignored', async () => {
    const bodyString = linkPayload([{ type: 'message', source: { userId: 'x' }, message: { type: 'sticker' } }]);
    const signature = computeSignature(bodyString);

    const { res } = await sendWebhook({ bodyString, signature });

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ ok: true });
    expect(await db.collection('users').countDocuments({})).toBe(0);
  });

  it('parseLinkCommand: non-matching text is ignored (no verb, empty, missing userId token)', async () => {
    const nonMatchingTexts = ['hello', '', 'link'];

    for (const text of nonMatchingTexts) {
      const bodyString = linkPayload([messageEvent({ text })]);
      const signature = computeSignature(bodyString);

      const { res } = await sendWebhook({ bodyString, signature });

      expect(res._getStatusCode()).toBe(200);
      expect(JSON.parse(res._getData())).toEqual({ ok: true });
    }

    expect(await db.collection('users').countDocuments({})).toBe(0);
  });

  it.each([
    ['link u001', 'line-1', 'u001'],
    ['BIND u002', 'line-2', 'u002'],
    ['Connect u003', 'line-3', 'u003']
  ])('parseLinkCommand: verb %s (case-insensitive) creates/links the target user', async (text, lineUserId, targetUserId) => {
    const bodyString = linkPayload([messageEvent({ userId: lineUserId, text })]);
    const signature = computeSignature(bodyString);

    const { res } = await sendWebhook({ bodyString, signature });

    expect(res._getStatusCode()).toBe(200);
    const doc = await db.collection('users').findOne({ id: targetUserId });
    expect(doc?.LineId).toBe(lineUserId);
  });

  it('a successful link creates a new users doc via upsert when none existed', async () => {
    const bodyString = linkPayload([messageEvent({ userId: 'line-abc', text: 'link u010' })]);
    const signature = computeSignature(bodyString);

    const { res } = await sendWebhook({ bodyString, signature });

    expect(res._getStatusCode()).toBe(200);
    const doc = await db.collection('users').findOne({ id: 'u010' });
    expect(doc).not.toBeNull();
    expect(doc.id).toBe('u010');
    expect(doc.LineId).toBe('line-abc');
    expect(typeof doc.createdAt).toBe('string');
    expect(typeof doc.updatedAt).toBe('string');
    expect(new Date(doc.createdAt).toISOString()).toBe(doc.createdAt);
    expect(new Date(doc.updatedAt).toISOString()).toBe(doc.updatedAt);
  });

  it('a successful link on an existing user preserves unrelated fields', async () => {
    await db.collection('users').insertOne({ id: 'u011', displayName: 'ทดสอบ', avatar: 'avatar.png' });
    const bodyString = linkPayload([messageEvent({ userId: 'line-existing', text: 'link u011' })]);
    const signature = computeSignature(bodyString);

    const { res } = await sendWebhook({ bodyString, signature });

    expect(res._getStatusCode()).toBe(200);
    const doc = await db.collection('users').findOne({ id: 'u011' });
    expect(doc.LineId).toBe('line-existing');
    expect(typeof doc.updatedAt).toBe('string');
    expect(doc.displayName).toBe('ทดสอบ');
    expect(doc.avatar).toBe('avatar.png');
  });

  it('a multi-event payload processes each valid-link event independently', async () => {
    const bodyString = linkPayload([
      messageEvent({ userId: 'line-x', text: 'link u020' }),
      messageEvent({ userId: 'line-y', text: 'link u021' })
    ]);
    const signature = computeSignature(bodyString);

    const { res } = await sendWebhook({ bodyString, signature });

    expect(res._getStatusCode()).toBe(200);
    const docA = await db.collection('users').findOne({ id: 'u020' });
    const docB = await db.collection('users').findOne({ id: 'u021' });
    expect(docA?.LineId).toBe('line-x');
    expect(docB?.LineId).toBe('line-y');
  });

  it('a multi-event payload with a mix of matching and non-matching events only links the matching one', async () => {
    const bodyString = linkPayload([
      messageEvent({ text: 'hello' }),
      messageEvent({ userId: 'line-z', text: 'link u022' })
    ]);
    const signature = computeSignature(bodyString);

    const { res } = await sendWebhook({ bodyString, signature });

    expect(res._getStatusCode()).toBe(200);
    const doc = await db.collection('users').findOne({ id: 'u022' });
    expect(doc?.LineId).toBe('line-z');
    expect(await db.collection('users').countDocuments({})).toBe(1);
  });

  it('the success-path response body never reveals link count/details, for both a 0-link and a 2-link request', async () => {
    const zeroLinkBody = linkPayload([]);
    const zeroLinkSignature = computeSignature(zeroLinkBody);
    const { res: zeroLinkRes } = await sendWebhook({ bodyString: zeroLinkBody, signature: zeroLinkSignature });
    expect(JSON.parse(zeroLinkRes._getData())).toEqual({ ok: true });

    const twoLinkBody = linkPayload([
      messageEvent({ userId: 'line-p', text: 'link u030' }),
      messageEvent({ userId: 'line-q', text: 'link u031' })
    ]);
    const twoLinkSignature = computeSignature(twoLinkBody);
    const { res: twoLinkRes } = await sendWebhook({ bodyString: twoLinkBody, signature: twoLinkSignature });
    expect(JSON.parse(twoLinkRes._getData())).toEqual({ ok: true });
  });
});
