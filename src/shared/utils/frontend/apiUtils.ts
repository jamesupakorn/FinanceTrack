import { requireActiveUserId } from './sessionClient';

const API_URLS: Record<string, string> = {
	INCOME: '/api/monthly_income',
	EXPENSE: '/api/monthly_expense',
	SAVINGS: '/api/savings',
	TAX: '/api/tax_accumulated',
	SALARY: '/api/salary',
	INVESTMENT: '/api/investment'
};

// year สามารถเป็นค่าว่าง (falsy) ที่ไม่ใช่ string ได้ (0/null/undefined) แล้วคืนค่าเดิมกลับไปเฉยๆ
// จึง return type ต้องเป็น unknown ไม่ใช่ string ถึงจะตรงกับพฤติกรรมจริงของ branch นั้น
const normalizeYearInput = (year: unknown): unknown => {
	if (!year) return year;
	const numericYear = parseInt(year as string, 10);
	if (Number.isNaN(numericYear)) return `${year}`;
	if (numericYear > 2400) {
		return String(numericYear - 543);
	}
	return String(numericYear);
};

const sanitizeTaxAmount = (value: unknown): string => {
	if (value === null || value === undefined) return '0.00';
	const numeric = Number(String(value).replace(/,/g, ''));
	if (Number.isNaN(numeric)) return String(value);
	return numeric.toFixed(2);
};

function buildUrl(path: string, params: Record<string, string | number | undefined | null> = {}): string {
	const [base, queryString] = path.split('?');
	const searchParams = new URLSearchParams(queryString || '');
	Object.entries(params).forEach(([key, value]) => {
		if (value !== undefined && value !== null && value !== '') {
			searchParams.set(key, String(value));
		}
	});
	requireActiveUserId(); // pre-flight guard only — server derives userId from the session cookie, not this
	const serialized = searchParams.toString();
	return serialized ? `${base}?${serialized}` : base;
}

function withUserPayload(payload: Record<string, unknown> = {}): string {
	requireActiveUserId(); // pre-flight guard only — server derives userId from the session cookie, not this
	return JSON.stringify(payload);
}

const getTaxYearPayload = async (year: unknown): Promise<any> => jsonFetch(buildUrl(API_URLS.TAX, { year: normalizeYearInput(year) as string | number | undefined | null }));

const postTaxYearPayload = async (year: unknown, payload: Record<string, unknown>): Promise<any> => jsonFetch(API_URLS.TAX, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: withUserPayload({ year: normalizeYearInput(year), ...payload })
});

const deleteTaxYearPayload = async (year: unknown): Promise<any> => jsonFetch(API_URLS.TAX, {
	method: 'DELETE',
	headers: { 'Content-Type': 'application/json' },
	body: withUserPayload({ year: normalizeYearInput(year) })
});

const CSRF_COOKIE_NAME: string = 'ft_csrf';
const MUTATING_METHODS: Set<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// TD-C02 B3 — handler กลางสำหรับ "session ใช้ไม่ได้แล้ว" (401/403)
// ลงทะเบียนครั้งเดียวจาก SessionContext ตอน mount (รูปแบบตัวแปรระดับโมดูล เหมือน sessionClient.js)
let sessionInvalidHandler: (() => void) | null = null;

/**
 * ลงทะเบียน callback ที่จะถูกเรียกเมื่อ API ตอบ 401/403 (session หมดอายุ / CSRF ไม่ตรง)
 * @param {Function|null} handler
 */
export function setSessionInvalidHandler(handler: (() => void) | null): void {
	sessionInvalidHandler = typeof handler === 'function' ? handler : null;
}

/** อ่าน CSRF token จาก cookie (ft_csrf ตั้งใจไม่เป็น HttpOnly เพื่อให้ JS อ่านได้) */
function readCsrfToken(): string {
	if (typeof document === 'undefined') return '';
	const match = document.cookie
		.split('; ')
		.find(entry => entry.startsWith(`${CSRF_COOKIE_NAME}=`));
	return match ? decodeURIComponent(match.slice(CSRF_COOKIE_NAME.length + 1)) : '';
}

/**
 * เติม X-CSRF-Token ให้ headers ของ request ที่เปลี่ยนข้อมูล
 * export ไว้สำหรับ call site ที่ยังยิง fetch() ตรง ไม่ผ่าน jsonFetch
 * (Layout.js#change_password, ExpenseTable.js#user-bank-accounts) — ไม่งั้นจะโดน 403 หลัง B2
 * @param {object} [headers]
 * @returns {object} headers ชุดใหม่ (ไม่แก้ของเดิม)
 */
export function withCsrfHeaders(headers: Record<string, string> = {}): Record<string, string> {
	const csrfToken = readCsrfToken();
	return csrfToken ? { ...headers, 'X-CSRF-Token': csrfToken } : { ...headers };
}

function notifySessionInvalid(): void {
	if (!sessionInvalidHandler) return;
	try {
		sessionInvalidHandler();
	} catch (err) {
		console.error('session invalid handler ทำงานไม่สำเร็จ', err);
	}
}

async function jsonFetch(url: string, options: RequestInit = {}): Promise<any> {
	// แนบ CSRF token เฉพาะ method ที่เปลี่ยนข้อมูล — GET ฝั่ง server ยกเว้นไว้ (spec §Decision B)
	const headers = MUTATING_METHODS.has(String(options.method || 'GET').toUpperCase())
		? withCsrfHeaders((options.headers || {}) as Record<string, string>)
		: { ...(options.headers || {}) };
	const mergedOptions = {
		...options,
		headers
	};
	const response = await fetch(url, mergedOptions);
	let data;
	try {
		data = await response.json();
	} catch (err) {
		data = null;
	}
	if (!response.ok) {
		// 401 = ไม่มี/หมดอายุ session, 403 = CSRF ไม่ตรง — ทั้งคู่แปลว่า request นี้เชื่อถือไม่ได้
		// ในฐานะผู้ใช้คนปัจจุบัน จึงพากลับไปล็อกอินใหม่ แล้วค่อย throw ให้ .catch() เดิมทำงานตามปกติ
		if (response.status === 401 || response.status === 403) {
			notifySessionInvalid();
		}
		const message = data?.error || 'ไม่สามารถเชื่อมต่อ API ได้';
		throw new Error(message);
	}
	return data;
}

export const incomeAPI = {
	getByMonth: async (month: string): Promise<any> => jsonFetch(buildUrl(API_URLS.INCOME, { month })),
	getAll: async (): Promise<{ months: any }> => {
		const months = await jsonFetch(buildUrl(API_URLS.INCOME));
		return { months };
	},
	save: async (month: string, values: Record<string, unknown>): Promise<any> => jsonFetch(API_URLS.INCOME, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ month, values })
	})
};

export const expenseAPI = {
	getByMonth: async (month: string): Promise<any> => jsonFetch(buildUrl(API_URLS.EXPENSE, { month })),
	getAll: async (): Promise<{ months: any }> => {
		const months = await jsonFetch(buildUrl(API_URLS.EXPENSE));
		return { months };
	},
	save: async (month: string, values: Record<string, unknown>): Promise<any> => jsonFetch(API_URLS.EXPENSE, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ month, expense_data: values })
	})
};

export const savingsAPI = {
	getByMonth: async (month: string): Promise<any> => jsonFetch(buildUrl(API_URLS.SAVINGS, { month })),
	getAll: async (): Promise<{ months: any }> => {
		const months = await jsonFetch(buildUrl(API_URLS.SAVINGS));
		return { months };
	},
	saveList: async (month: string, savings_list: unknown): Promise<any> => jsonFetch(API_URLS.SAVINGS, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ month, savings_list })
	}),
	saveAccumulated: async (month: string, total_savings: unknown): Promise<any> => jsonFetch(API_URLS.SAVINGS, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ month, total_savings })
	}),
	confirmTransfer: async (month: string, amount: number | string, savingsBase: number): Promise<any> => jsonFetch(API_URLS.SAVINGS, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({
			month,
			transfer: {
				amount,
				key: `transferable-savings:${month}:${Math.round(savingsBase * 100)}`
			}
		})
	})
};

export const taxAPI = {
	getAll: async (): Promise<any> => jsonFetch(buildUrl(API_URLS.TAX)),
	getByYear: getTaxYearPayload,
	saveYearly: async (year: unknown, data: unknown): Promise<any> => {
		const payload = typeof data === 'object' && data !== null
			? data
			: { accumulated_tax: data };
		return postTaxYearPayload(year, payload as Record<string, unknown>);
	},
	deleteYear: deleteTaxYearPayload,
	updateMonthlyTax: async (year: unknown, month: number | string, value: unknown): Promise<any> => {
		const normalizedYear = normalizeYearInput(year);
		const monthKey = String(month).padStart(2, '0');
		let monthlyTax: Record<string, string> = {};
		try {
			const data = await getTaxYearPayload(normalizedYear);
			monthlyTax = { ...(data?.[normalizedYear as string]?.monthly_tax || {}) };
		} catch (error) {
			monthlyTax = {};
		}
		monthlyTax[monthKey] = sanitizeTaxAmount(value);
		return postTaxYearPayload(normalizedYear, { monthly_tax: monthlyTax });
	},
	updateMonthlyDeductionFields: async (
		year: unknown,
		month: number | string,
		{ tax, provident, income }: { tax?: number | string; provident?: number | string; income?: number | string } = {}
	): Promise<any> => {
		const hasTax = tax !== undefined;
		const hasProvident = provident !== undefined;
		const hasIncome = income !== undefined;
		if (!hasTax && !hasProvident && !hasIncome) {
			return { success: true, skipped: true };
		}

		const normalizedYear = normalizeYearInput(year);
		const monthKey = String(month).padStart(2, '0');
		let monthlyTax: Record<string, string> = {};
		let monthlyProvident: Record<string, string> = {};
		let monthlyIncome: Record<string, string> = {};

		try {
			const data = await getTaxYearPayload(normalizedYear);
			monthlyTax = { ...(data?.[normalizedYear as string]?.monthly_tax || {}) };
			monthlyProvident = { ...(data?.[normalizedYear as string]?.monthly_provident || {}) };
			monthlyIncome = { ...(data?.[normalizedYear as string]?.monthly_income || {}) };
		} catch (error) {
			monthlyTax = {};
			monthlyProvident = {};
			monthlyIncome = {};
		}

		if (hasTax) {
			monthlyTax[monthKey] = sanitizeTaxAmount(tax);
		}
		if (hasProvident) {
			monthlyProvident[monthKey] = sanitizeTaxAmount(provident);
		}
		if (hasIncome) {
			monthlyIncome[monthKey] = sanitizeTaxAmount(income);
		}

		return postTaxYearPayload(normalizedYear, {
			...(hasTax ? { monthly_tax: monthlyTax } : {}),
			...(hasProvident ? { monthly_provident: monthlyProvident } : {}),
			...(hasIncome ? { monthly_income: monthlyIncome } : {})
		});
	}
};

export const salaryAPI = {
	getByMonth: async (month: string): Promise<any> => jsonFetch(buildUrl(API_URLS.SALARY, { month })),
	getAll: async (): Promise<{ months: any }> => {
		const months = await jsonFetch(buildUrl(API_URLS.SALARY));
		return { months };
	},
	save: async (month: string, income: unknown, deduct: unknown, note: string = ''): Promise<any> => jsonFetch(API_URLS.SALARY, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ month, income, deduct, note })
	}),
	delete: async (month: string): Promise<any> => jsonFetch(buildUrl(API_URLS.SALARY, { month }), {
		method: 'DELETE'
	})
};

export const investmentAPI = {
	getAll: async (): Promise<any> => jsonFetch(buildUrl(API_URLS.INVESTMENT)),
	getByMonth: async (month: string): Promise<any> => jsonFetch(buildUrl(API_URLS.INVESTMENT, { month })),
	saveList: async (month: string, investments: unknown): Promise<any> => jsonFetch(API_URLS.INVESTMENT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ month, investments })
	})
};

export const savingsGoalsAPI = {
	getAll: async (): Promise<any> => jsonFetch(buildUrl('/api/savings-goals')),
	create: async (payload: Record<string, unknown>): Promise<any> => jsonFetch('/api/savings-goals', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload(payload)
	}),
	saveAllocations: async (allocations: unknown): Promise<any> => jsonFetch('/api/savings-goals', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ allocations })
	}),
	update: async (id: string, payload: Record<string, unknown>): Promise<any> => jsonFetch('/api/savings-goals', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ goalId: id, ...payload })
	}),
	delete: async (id: string): Promise<any> => jsonFetch('/api/savings-goals', {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ goalId: id })
	})
};

export const dailyExpenseAPI = {
	// raw:true skips the fixed-only carry-forward the endpoint applies for the normal editing
	// view when a month has no saved doc yet — used by MonthManager's "copy from previous
	// month" so it copies what was actually saved, not a synthesized preview.
	getByMonth: async (month: string, { raw }: { raw?: boolean } = {}): Promise<any> => jsonFetch(buildUrl('/api/daily_expenses', { month, raw: raw ? '1' : undefined })),
	save: async (month: string, items: unknown): Promise<any> => jsonFetch('/api/daily_expenses', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ month, items })
	})
};

/**
 * บัญชีธนาคาร + เกณฑ์สุขภาพงบประมาณ ของผู้ใช้ — ทั้งคู่อยู่บน endpoint เดียวกัน (user-bank-accounts.js)
 * ใช้ buildUrl/withUserPayload/jsonFetch เหมือน API อื่นทุกตัว — ไม่ผ่าน SessionContext.js:82 ที่ยัง
 * เป็น bare fetch() ไม่แนบ token (F-1) จึงไม่ได้รับผลจากบั๊กนั้น
 */
export const userSettingsAPI = {
	get: async (): Promise<any> => jsonFetch(buildUrl('/api/user-bank-accounts')),
	saveThresholds: async (budgetThresholds: unknown): Promise<any> => jsonFetch('/api/user-bank-accounts', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ budgetThresholds })
	})
};

const CREDIT_CARDS_URL: string = '/api/credit-cards';
const CREDIT_CARD_PLANS_URL: string = '/api/credit-cards/plans';
const CREDIT_CARD_REVOLVING_URL: string = '/api/credit-cards/revolving';
const JSON_HEADERS: Record<string, string> = { 'Content-Type': 'application/json' };

/**
 * บัตรเครดิต & แผนผ่อนชำระ
 * ใช้ buildUrl / withUserPayload เหมือน API อื่น ทำให้ userId + Bearer token แนบไปเองเสมอ
 */
export const creditCardAPI = {
	getCards: async (): Promise<any> => jsonFetch(buildUrl(CREDIT_CARDS_URL)),
	saveCard: async (card: Record<string, unknown>): Promise<any> => jsonFetch(CREDIT_CARDS_URL, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: withUserPayload({ card })
	}),
	deleteCard: async (cardId: string): Promise<any> => jsonFetch(CREDIT_CARDS_URL, {
		method: 'DELETE',
		headers: JSON_HEADERS,
		body: withUserPayload({ cardId })
	}),
	getPlans: async (filters: Record<string, string | number | undefined | null> = {}): Promise<any> => jsonFetch(buildUrl(CREDIT_CARD_PLANS_URL, filters)),
	createPlan: async (plan: Record<string, unknown>): Promise<any> => jsonFetch(CREDIT_CARD_PLANS_URL, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: withUserPayload({ plan })
	}),
	updatePlan: async (planId: string, patch: Record<string, unknown>): Promise<any> => jsonFetch(CREDIT_CARD_PLANS_URL, {
		method: 'PUT',
		headers: JSON_HEADERS,
		body: withUserPayload({ planId, patch })
	}),
	setInstallmentPaid: async (planId: string, installmentNo: number | string, paid: boolean): Promise<any> => jsonFetch(CREDIT_CARD_PLANS_URL, {
		method: 'PATCH',
		headers: JSON_HEADERS,
		body: withUserPayload({ planId, installmentNo, paid })
	}),
	cancelPlan: async (planId: string): Promise<any> => jsonFetch(CREDIT_CARD_PLANS_URL, {
		method: 'DELETE',
		headers: JSON_HEADERS,
		body: withUserPayload({ planId, mode: 'cancel' })
	}),
	deletePlan: async (planId: string): Promise<any> => jsonFetch(CREDIT_CARD_PLANS_URL, {
		method: 'DELETE',
		headers: JSON_HEADERS,
		body: withUserPayload({ planId, mode: 'delete' })
	}),
	// ยอดใช้จ่ายหมุนเวียน — ตัวเลขทั้งหมด server คำนวณให้ client ส่งได้แค่ newSpend / paymentAction
	getRevolving: async (filters: Record<string, string | number | undefined | null> = {}): Promise<any> => jsonFetch(buildUrl(CREDIT_CARD_REVOLVING_URL, filters)),
	saveRevolvingSpend: async (cardId: string, month: string, newSpend: number | string): Promise<any> => jsonFetch(CREDIT_CARD_REVOLVING_URL, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: withUserPayload({ cycle: { cardId, month, newSpend } })
	}),
	setRevolvingAction: async (cardId: string, month: string, paymentAction: string): Promise<any> => jsonFetch(CREDIT_CARD_REVOLVING_URL, {
		method: 'PATCH',
		headers: JSON_HEADERS,
		body: withUserPayload({ cardId, month, paymentAction })
	}),
	deleteRevolvingCycle: async (cardId: string, month: string): Promise<any> => jsonFetch(CREDIT_CARD_REVOLVING_URL, {
		method: 'DELETE',
		headers: JSON_HEADERS,
		body: withUserPayload({ cardId, month })
	}),
	// metadata สำหรับตกแต่งแถว cci_ ใน ExpenseTable — ล้มเหลวแล้วคืน [] ไม่ทำให้หน้ารายจ่ายพัง
	getMonthInstallments: async (month: string | number | undefined | null): Promise<any[]> => {
		if (!month) return [];
		try {
			const data = await jsonFetch(buildUrl(CREDIT_CARD_PLANS_URL, { month }));
			return Array.isArray(data?.items) ? data.items : [];
		} catch (error) {
			console.warn('Could not load installment metadata:', error);
			return [];
		}
	}
};
