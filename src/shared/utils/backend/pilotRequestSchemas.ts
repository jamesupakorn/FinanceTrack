import { z } from 'zod';
import type { NextApiRequest, NextApiResponse } from 'next';

export interface ValidationIssue {
  path: (string | number)[];
  code: string;
  message: string;
}

function parseAmount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

const dailyExpenseItemSchema = z
  .looseObject({
    id: z.union([z.string(), z.number()]).optional(),
    name: z.string().refine(value => value.trim().length > 0, { message: 'item name is required' }),
    // the editing UI holds amount as string | number; numeric strings are stored as-is
    amount: z
      .union([z.number(), z.string()])
      .refine(value => parseAmount(value) >= 0, { message: 'item amount must be >= 0' }),
    category: z.enum(['fixed', 'misc']),
    frequency: z.string().nullable().optional()
  })
  .superRefine((item, ctx) => {
    if (item.category === 'fixed' && item.frequency !== 'daily' && item.frequency !== 'weekly') {
      ctx.addIssue({
        code: 'custom',
        path: ['frequency'],
        message: 'fixed items must have frequency: daily or weekly'
      });
    }
    if (item.category === 'misc' && item.frequency != null) {
      ctx.addIssue({
        code: 'custom',
        path: ['frequency'],
        message: 'misc items must have frequency: null'
      });
    }
  });

export const dailyExpensePutBodySchema = z.strictObject({
  month: z.string().min(1),
  items: z.array(dailyExpenseItemSchema)
});

// expense_data keys are user-defined expense names plus metadata (__removeKeys, bankAccounts)
export const monthlyExpensePostBodySchema = z.strictObject({
  month: z.string().min(1),
  expense_data: z.record(z.string(), z.unknown())
});

// ADR-028: key ถูกใช้เป็น Mongo field path จึงจำกัดอักขระ ('.' และ '$' ห้าม) และกันชื่อ field ที่สงวนไว้
const RESERVED_EXPENSE_KEYS = new Set([
  'month', '_id', 'id', 'userId', 'bankAccounts', 'accountSummary', 'totalActualPaid',
  'actual', 'constructor', 'prototype', 'toString', 'hasOwnProperty'
]);

export const expenseRowKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,100}$/, 'invalid row key')
  .refine(key => !RESERVED_EXPENSE_KEYS.has(key) && !key.startsWith('__'), 'reserved row key');

export const monthlyExpensePatchBodySchema = z.strictObject({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM'),
  key: expenseRowKeySchema,
  paid: z.boolean(),
  row: z.strictObject({
    name: z.string().max(200),
    actual: z.union([z.number().finite(), z.string().max(40)]),
    account: z.string().max(200),
    dueDay: z.union([z.string().max(20), z.number().int()])
  }).optional()
});

export function toValidationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map(issue => ({
    path: issue.path.map(segment => (typeof segment === 'number' ? segment : String(segment))),
    code: issue.code,
    message: issue.message
  }));
}

/**
 * Parses req.body with the schema. On failure sends 400 {error, issues} (no submitted values) and
 * returns null; callers must use the returned data, never req.body.
 */
export function parseRequestBody<T extends z.ZodType>(
  req: NextApiRequest,
  res: NextApiResponse,
  schema: T
): z.infer<T> | null {
  const result = schema.safeParse(req.body);
  if (result.success) return result.data;
  res.status(400).json({ error: 'Validation failed', issues: toValidationIssues(result.error) });
  return null;
}
