/**
 * Login rate limiter (TD-H10) — throttles pages/api/auth/profile-login.js against PIN brute-forcing.
 *
 * Counting key: composite `${clientIp}|${userId}` (user-confirmed decision, see
 * .pipeline/spec-login-rate-limit-td-h10.md §4) — balances two failure modes:
 *   - IP-only would risk false-locking unrelated users sharing a NAT/CGNAT IP.
 *   - userId-only would let anyone DoS-lock any known account (profile list is public).
 * Composite key does neither at the cost of not stopping an attacker who rotates IPs — accepted
 * tradeoff, see spec §4.
 *
 * Storage:
 *   - `DATA_MODE=mongo` (production): Mongo-backed `loginAttempts` collection, TTL-indexed so idle
 *     documents self-clean (see scripts/setupLoginAttemptsCollection.js). Shared across all warm
 *     Vercel function instances — the real protection.
 *   - anything else (local/JSON-mode dev, the code-level default): in-process `Map` fallback.
 *     ⚠️ This fallback is explicitly WEAKER than the Mongo path, not an equivalent substitute:
 *     it resets on every cold start / hot-reload / restart, and does not share state across
 *     concurrently warm serverless instances. It exists purely so local dev doesn't crash or need
 *     a live Mongo connection — it is a developer convenience, not a production-grade guarantee.
 *
 * Failure mode: if the limiter's own Mongo read/write fails (e.g. connection outage), this module
 * fails OPEN — it returns "not locked" and lets the login attempt proceed to the real password
 * check. Rationale (spec §2, confirmed conservative default since not explicitly re-confirmed by
 * the user beyond the spec's recommendation): the counter is defense-in-depth on top of bcrypt +
 * the password itself, which remains the actual security boundary. A transient Mongo hiccup in this
 * secondary system must not turn into a site-wide login outage for every user.
 */
import { getDbPromise } from '../../../../lib/mongodb';
import dataModeConfig from '../../../../lib/dataMode.config';

const COLLECTION_NAME = 'loginAttempts';

// Tunable constants — starting point taken from the spec's own suggested default
// ("5 failed attempts locks the key for 15 minutes"), not empirically tuned. Revisit if real
// abuse patterns or legitimate-user friction reports come in.
export const FAILURE_THRESHOLD = 5;
export const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// In-memory fallback store for DATA_MODE !== 'mongo'. Module-level singleton is intentional —
// same lifetime as the JS process, cleared on restart/cold-start (see the weaker-fallback note above).
const inMemoryCounters = new Map();

function buildKey(clientIp, userId) {
  return `${clientIp}|${userId}`;
}

/**
 * ตรวจสอบสถานะ lock ปัจจุบันของ key และบันทึกความล้มเหลว 1 ครั้ง (เรียกเฉพาะตอน password ผิด)
 * คืนค่า { locked, lockedUntil, failCount }
 */
export async function checkAndRecordFailure(clientIp, userId) {
  const key = buildKey(clientIp, userId);
  if (dataModeConfig.mode === 'mongo') {
    return checkAndRecordFailureMongo(key);
  }
  return checkAndRecordFailureMemory(key);
}

/**
 * ล้าง counter ของ key เมื่อ login สำเร็จ ไม่ให้ประวัติความล้มเหลวเก่าค้างอยู่
 */
export async function resetCounter(clientIp, userId) {
  const key = buildKey(clientIp, userId);
  if (dataModeConfig.mode === 'mongo') {
    return resetCounterMongo(key);
  }
  inMemoryCounters.delete(key);
  return undefined;
}

/**
 * ตรวจสอบว่า key ถูก lock อยู่หรือไม่ โดย "ไม่" นับเป็นความพยายามใหม่ — ใช้ก่อนเรียก checkUserPassword
 * เพื่อไม่ให้ request ที่ล่วงรู้ว่าโดน lock อยู่แล้วยังคงถูกนับซ้ำ (คืนค่ารูปแบบเดียวกับฟังก์ชันข้างบน)
 */
export async function checkLockStatus(clientIp, userId) {
  const key = buildKey(clientIp, userId);
  if (dataModeConfig.mode === 'mongo') {
    return checkLockStatusMongo(key);
  }
  return checkLockStatusMemory(key);
}

// ---------- Mongo-backed implementation ----------

async function checkLockStatusMongo(key) {
  try {
    const db = await getDbPromise();
    const doc = await db.collection(COLLECTION_NAME).findOne({ _id: key });
    const now = new Date();
    const locked = !!(doc?.lockedUntil && doc.lockedUntil > now);
    return { locked, lockedUntil: locked ? doc.lockedUntil : null, failCount: doc?.failCount || 0 };
  } catch (err) {
    // fail-open: ปัญหาโครงสร้างพื้นฐานของ limiter เอง ไม่ควรทำให้ login ทั้งระบบใช้งานไม่ได้
    console.error('[loginRateLimit] Mongo lock-status check failed (failing open):', err?.message || err);
    return { locked: false, lockedUntil: null, failCount: 0 };
  }
}

async function checkAndRecordFailureMongo(key) {
  try {
    const db = await getDbPromise();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + WINDOW_MS);

    // atomic increment — single findOneAndUpdate เลี่ยง race ระหว่าง 2 คำขอที่ fail พร้อมกันบน key เดียวกัน
    const result = await db.collection(COLLECTION_NAME).findOneAndUpdate(
      { _id: key },
      {
        $inc: { failCount: 1 },
        $set: { expiresAt },
        $setOnInsert: { firstFailAt: now }
      },
      { upsert: true, returnDocument: 'after' }
    );

    const doc = result?.value || result; // driver version differences: some return the doc directly
    let lockedUntil = doc?.lockedUntil || null;

    if (doc.failCount >= FAILURE_THRESHOLD && !lockedUntil) {
      lockedUntil = expiresAt;
      await db.collection(COLLECTION_NAME).updateOne({ _id: key }, { $set: { lockedUntil } });
    }

    return {
      locked: lockedUntil ? lockedUntil > now : false,
      lockedUntil,
      failCount: doc.failCount
    };
  } catch (err) {
    console.error('[loginRateLimit] Mongo record-failure failed (failing open):', err?.message || err);
    return { locked: false, lockedUntil: null, failCount: 0 };
  }
}

async function resetCounterMongo(key) {
  try {
    const db = await getDbPromise();
    await db.collection(COLLECTION_NAME).deleteOne({ _id: key });
  } catch (err) {
    // non-fatal: ถ้าล้างไม่สำเร็จ counter เก่าจะยังอยู่ (อาจทำให้ threshold ถึงเร็วกว่าที่ควรใน edge case
    // นี้) แต่ต้องไม่ block การ login ที่สำเร็จแล้ว
    console.warn('[loginRateLimit] Mongo counter reset failed (non-fatal):', err?.message || err);
  }
}

// ---------- In-memory fallback (DATA_MODE !== 'mongo', dev-only) ----------

function checkLockStatusMemory(key) {
  const now = Date.now();
  const entry = inMemoryCounters.get(key);
  const locked = !!(entry?.lockedUntil && entry.lockedUntil > now);
  return {
    locked,
    lockedUntil: locked ? new Date(entry.lockedUntil) : null,
    failCount: entry?.failCount || 0
  };
}

function checkAndRecordFailureMemory(key) {
  const now = Date.now();
  const existing = inMemoryCounters.get(key);
  // เริ่ม window ใหม่ถ้ายังไม่มี entry หรือ window เดิมหมดอายุแล้ว (ไม่มี TTL index ให้ Mongo ช่วย
  // ในโหมดนี้ จึงต้องเช็ค expiry เองตรงนี้)
  const entry = existing && existing.expiresAt > now
    ? existing
    : { failCount: 0, firstFailAt: now, lockedUntil: null, expiresAt: now + WINDOW_MS };

  entry.failCount += 1;
  entry.expiresAt = now + WINDOW_MS;

  if (entry.failCount >= FAILURE_THRESHOLD && !entry.lockedUntil) {
    entry.lockedUntil = now + WINDOW_MS;
  }

  inMemoryCounters.set(key, entry);

  return {
    locked: entry.lockedUntil ? entry.lockedUntil > now : false,
    lockedUntil: entry.lockedUntil ? new Date(entry.lockedUntil) : null,
    failCount: entry.failCount
  };
}
