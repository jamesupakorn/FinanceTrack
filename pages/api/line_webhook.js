import crypto from 'crypto';
import { getMongoCollection, isJsonMode } from '../../lib/dataSource';

const { updateUserLineId } = require('../../src/backend/data/userUtils');

export const config = {
  api: {
    bodyParser: false
  }
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (error) => reject(error));
  });
}

function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const hash = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  return hash === signature;
}

function parseLinkCommand(text = '') {
  const normalized = String(text || '').trim();
  if (!normalized) return null;
  const match = normalized.match(/^(?:link|bind|connect)\s+(u\d+)$/i);
  return match ? match[1].toLowerCase() : null;
}

async function updateUserLineIdMongo(userId, lineUserId) {
  const collection = await getMongoCollection('users');
  const now = new Date().toISOString();
  const result = await collection.findOneAndUpdate(
    { id: userId },
    {
      $set: { LineId: lineUserId, updatedAt: now },
      $setOnInsert: { id: userId, createdAt: now }
    },
    { upsert: true, returnDocument: 'after' }
  );
  return result?.value || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (error) {
    return res.status(400).json({ error: 'อ่านข้อมูลไม่สำเร็จ' });
  }

  const signature = req.headers['x-line-signature'];
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  if (!channelSecret) {
    console.error('LINE webhook: LINE_CHANNEL_SECRET is not configured — rejecting request');
    return res.status(500).json({ error: 'LINE_CHANNEL_SECRET is not configured' });
  }
  const isValid = verifySignature(rawBody, signature, channelSecret);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload = {};
  try {
    payload = JSON.parse(rawBody.toString('utf-8'));
  } catch (error) {
    return res.status(400).json({ error: 'JSON ไม่ถูกต้อง' });
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  const linked = [];
  for (const event of events) {
    if (event?.type !== 'message') continue;
    if (event?.message?.type !== 'text') continue;
    const lineUserId = event?.source?.userId;
    const targetUserId = parseLinkCommand(event?.message?.text);
    if (!lineUserId || !targetUserId) continue;
    let updated = null;
    if (isJsonMode()) {
      updated = updateUserLineId(targetUserId, lineUserId);
    } else {
      updated = await updateUserLineIdMongo(targetUserId, lineUserId);
    }
    if (updated) {
      linked.push({ userId: updated.id, lineUserId: updated.LineId });
    }
  }

  console.log('LINE webhook events:', events.map(event => ({
    type: event.type,
    source: event.source,
    message: event.message
  })));
  if (linked.length > 0) {
    console.log('LINE linked users:', linked);
  }

  return res.status(200).json({ ok: true });
}
