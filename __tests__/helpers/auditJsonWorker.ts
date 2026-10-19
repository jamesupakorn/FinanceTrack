/* Child-process worker for the multi-process JSON lock test; run through tsx, never by jest. */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAudit } from '../../lib/auditedMutation';
import { updateUserData } from '../../src/backend/data/userUtils';

const iterations = Number(process.argv[2] || 10);

const handler = withAudit(async (_req, res) => {
  updateUserData('salary.json', 'u1', (bucket: Record<string, unknown>) => ({
    ...bucket,
    counter: Number(bucket.counter || 0) + 1
  }));
  res.status(201).json({ ok: true });
}, { source: 'multi_process_test' });

async function main() {
  let ok = 0;
  const errors: string[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const res: Record<string, unknown> = { statusCode: 200 };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = () => res;
    res.send = res.json;
    res.end = () => res;
    res.setHeader = () => res;
    const req = { method: 'POST', cookies: {}, headers: {}, query: {}, body: {} } as unknown as NextApiRequest;
    await handler(req, res as unknown as NextApiResponse);
    if (res.statusCode === 201) ok += 1; else errors.push(String(res.statusCode));
  }
  process.stdout.write(JSON.stringify({ ok, errors }));
}

main().catch(error => {
  process.stderr.write(String(error?.stack || error));
  process.exit(1);
});
