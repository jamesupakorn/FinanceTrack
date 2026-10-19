import { validateApiRequest } from '../../src/shared/utils/backend/apiRequestValidation';
import type { NextApiRequest, NextApiResponse } from 'next';

type ValidationError = { error: string; issues: Array<{ path: string; message: string }> };

function createResponse(): {
  statusCode: number;
  body?: ValidationError;
  status(code: number): ReturnType<typeof createResponse>;
  json(payload: ValidationError): ReturnType<typeof createResponse>;
} {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: ValidationError) {
      this.body = payload;
      return this;
    }
  };
}

describe('API request validation', () => {
  it('returns a structured 400 when a known auth field has the wrong type', () => {
    const req = {
      method: 'POST',
      query: {},
      body: { userId: { $ne: null }, password: 'secret' }
    };
    const res = createResponse();

    expect(validateApiRequest(req as NextApiRequest, res as unknown as NextApiResponse, 'auth/profile-login')).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: expect.any(String),
      issues: [{ path: 'userId', message: expect.any(String) }]
    });
  });

  it('rejects a non-object body for routes using the shared request envelope', () => {
    const req = { method: 'POST', query: {}, body: [] };
    const res = createResponse();

    expect(validateApiRequest(req as NextApiRequest, res as unknown as NextApiResponse, 'monthly_income')).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.body!.issues[0].path).toBe('');
  });

  it('keeps legacy month values and nested metadata intact for route-level validation', () => {
    const body = {
      month: '2026-10a',
      expense_data: { __removeKeys: ['coffee'] },
      metadata: { source: 'legacy-client' }
    };
    const req = { method: 'POST', query: {}, body };
    const res = createResponse();

    expect(validateApiRequest(req as NextApiRequest, res as unknown as NextApiResponse, 'monthly_expense')).toBe(true);
    expect(req.body).toBe(body);
    expect(res.statusCode).toBe(200);
  });
});
