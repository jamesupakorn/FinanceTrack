import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { validateApiRequest } from '../../src/shared/utils/backend/apiRequestValidation';
import { getMongoCollection, isJsonMode } from '../../lib/dataSource';
import { updateUserLineId } from '../../lib/userStore';
import { withAudit } from '../../lib/auditedMutation';

export const config = {
  api: {
    bodyParser: false
  }
};

interface LineWebhookEvent {
  type?: unknown;
  message?: { type?: unknown; text?: unknown };
  source?: { userId?: unknown };
}

function getRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (error: Error) => reject(error));
  });
}

function verifySignature(rawBody: Buffer, signature: unknown, secret: string): boolean {
  if (!signature || !secret) return false;
  const expectedSignature = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const providedSignature = Buffer.from(String(signature), 'base64');
  return safeEqual(expectedSignature, providedSignature);
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b) || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function parseLinkCommand(text: unknown = ''): string | null {
  const normalized = String(text || '').trim();
  if (!normalized) return null;
  const match = normalized.match(/^(?:link|bind|connect)\s+(u\d+)$/i);
  return match ? match[1].toLowerCase() : null;
}

async function updateUserLineIdMongo(userId: string, lineUserId: string) {
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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let rawBody: Buffer;
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

  let payload: { events?: unknown };
  try {
    payload = JSON.parse(rawBody.toString('utf-8'));
  } catch (error) {
    return res.status(400).json({ error: 'JSON ไม่ถูกต้อง' });
  }
  req.body = payload;
  if (!validateApiRequest(req, res, 'line_webhook')) return;

  const events: LineWebhookEvent[] = Array.isArray(payload.events) ? payload.events as LineWebhookEvent[] : [];
  const linked = [];
  for (const event of events) {
    if (event?.type !== 'message') continue;
    if (event?.message?.type !== 'text') continue;
    const lineUserId = event?.source?.userId;
    const targetUserId = parseLinkCommand(event?.message?.text);
    if (typeof lineUserId !== 'string' || !lineUserId || !targetUserId) continue;
    let updated = null;
    if (isJsonMode()) {
      updated = await updateUserLineId(targetUserId, lineUserId);
    } else {
      updated = await updateUserLineIdMongo(targetUserId, lineUserId);
    }
    if (updated) {
      linked.push({ userId: updated.id, lineUserId: updated.LineId });
    }
  }

  console.log('LINE webhook events:', {
    count: events.length,
    types: events.map(event => event.type)
  });
  if (linked.length > 0) {
    console.log('LINE linked users:', linked.length);
  }

  return res.status(200).json({ ok: true });
}

export default withAudit(handler, { source: 'line_webhook' });
