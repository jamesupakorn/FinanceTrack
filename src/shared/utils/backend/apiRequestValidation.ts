import { z } from 'zod';
import type { NextApiRequest, NextApiResponse } from 'next';

const query = z.object({}).catchall(z.unknown());
const body = z.object({}).passthrough();

const optionalString = z.string().optional();

const schemas = {
  users: { GET: { query } },
  'auth/logout': { POST: { body } },
  'auth/profile-login': {
    POST: { body: body.extend({ userId: optionalString, password: optionalString }) }
  },
  change_password: {
    POST: { body: body.extend({ currentPassword: optionalString, newPassword: optionalString }) }
  },
  // monthly_expense / daily_expenses body validation lives in pilotRequestSchemas.ts (ADR-027)
  monthly_expense: { GET: { query } },
  monthly_income: { GET: { query }, POST: { body } },
  savings: { GET: { query }, POST: { body } },
  salary: {
    GET: { query },
    DELETE: { query },
    POST: { body }
  },
  investment: { GET: { query }, POST: { body } },
  tax_accumulated: {
    GET: { query },
    POST: { body },
    DELETE: { body }
  },
  daily_expenses: { GET: { query } },
  'user-profile-settings': { GET: { query }, POST: { body } },
  'user-bank-accounts': { GET: { query }, POST: { body } },
  'line_due_notify': { GET: { query }, POST: { body } },
  'line_monthly_summary': { GET: { query }, POST: { body } },
  line_webhook: { POST: { body } },
  'credit-cards': {
    GET: { query },
    POST: { body },
    DELETE: { body }
  },
  'credit-cards/plans': {
    GET: { query },
    POST: { body },
    PUT: { body },
    PATCH: { body },
    DELETE: { body }
  },
  'credit-cards/revolving': {
    GET: { query },
    POST: { body },
    PATCH: { body },
    DELETE: { body }
  },
  'credit-cards/spend-items': {
    GET: { query },
    POST: { body },
    PUT: { body },
    DELETE: { body }
  },
  'savings-goals': {
    GET: { query },
    POST: { body },
    PUT: { body },
    DELETE: { body, query }
  }
} satisfies Record<string, Partial<Record<string, { body?: z.ZodType; query?: z.ZodType }>>>;

export function validateApiRequest(req: NextApiRequest, res: NextApiResponse, route: keyof typeof schemas): boolean {
  if (!req.method) return true;

  const routeSchemas: Partial<Record<string, { body?: z.ZodType; query?: z.ZodType }>> = schemas[route];
  const schemasForMethod = routeSchemas[req.method];
  if (!schemasForMethod) return true;

  const parts = [
    { name: 'query', schema: schemasForMethod.query, input: req.query },
    { name: 'body', schema: schemasForMethod.body, input: req.body }
  ];
  for (const { schema, input } of parts) {
    if (!schema) continue;

    const result = schema.safeParse(input ?? {});
    if (!result.success) {
      const issues = result.error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message
      }));
      res.status(400).json({ error: issues[0]?.message || 'Invalid request', issues });
      return false;
    }
  }

  return true;
}
