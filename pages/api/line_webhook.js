import crypto from 'crypto';

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
  if (channelSecret) {
    const isValid = verifySignature(rawBody, signature, channelSecret);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  let payload = {};
  try {
    payload = JSON.parse(rawBody.toString('utf-8'));
  } catch (error) {
    return res.status(400).json({ error: 'JSON ไม่ถูกต้อง' });
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  console.log('LINE webhook events:', events.map(event => ({
    type: event.type,
    source: event.source,
    message: event.message
  })));

  return res.status(200).json({ ok: true });
}
