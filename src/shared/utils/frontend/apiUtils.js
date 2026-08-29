import { requireActiveUserId } from './sessionClient';
import { withApiTokenHeaders } from './apiToken';

const API_URLS = {
	INCOME: '/api/monthly_income',
	EXPENSE: '/api/monthly_expense',
	SAVINGS: '/api/savings',
	TAX: '/api/tax_accumulated',
	SALARY: '/api/salary',
	INVESTMENT: '/api/investment'
};

const normalizeYearInput = (year) => {
	if (!year) return year;
	const numericYear = parseInt(year, 10);
	if (Number.isNaN(numericYear)) return `${year}`;
	if (numericYear > 2400) {
		return String(numericYear - 543);
	}
	return String(numericYear);
};

const sanitizeTaxAmount = (value) => {
	if (value === null || value === undefined) return '0.00';
	const numeric = Number(String(value).replace(/,/g, ''));
	if (Number.isNaN(numeric)) return String(value);
	return numeric.toFixed(2);
};

function buildUrl(path, params = {}) {
	const [base, queryString] = path.split('?');
	const searchParams = new URLSearchParams(queryString || '');
	Object.entries(params).forEach(([key, value]) => {
		if (value !== undefined && value !== null && value !== '') {
			searchParams.set(key, value);
		}
	});
	searchParams.set('userId', requireActiveUserId());
	const serialized = searchParams.toString();
	return serialized ? `${base}?${serialized}` : base;
}

function withUserPayload(payload = {}) {
	return JSON.stringify({ ...payload, userId: requireActiveUserId() });
}

const getTaxYearPayload = async (year) => jsonFetch(buildUrl(API_URLS.TAX, { year: normalizeYearInput(year) }));

const postTaxYearPayload = async (year, payload) => jsonFetch(API_URLS.TAX, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: withUserPayload({ year: normalizeYearInput(year), ...payload })
});

const deleteTaxYearPayload = async (year) => jsonFetch(API_URLS.TAX, {
	method: 'DELETE',
	headers: { 'Content-Type': 'application/json' },
	body: withUserPayload({ year: normalizeYearInput(year) })
});

async function jsonFetch(url, options = {}) {
	const mergedOptions = {
		...options,
		headers: withApiTokenHeaders(options.headers || {})
	};
	const response = await fetch(url, mergedOptions);
	let data;
	try {
		data = await response.json();
	} catch (err) {
		data = null;
	}
	if (!response.ok) {
		const message = data?.error || 'ไม่สามารถเชื่อมต่อ API ได้';
		throw new Error(message);
	}
	return data;
}

export const incomeAPI = {
	getByMonth: async (month) => jsonFetch(buildUrl(API_URLS.INCOME, { month })),
	getAll: async () => {
		const months = await jsonFetch(buildUrl(API_URLS.INCOME));
		return { months };
	},
	save: async (month, values) => jsonFetch(API_URLS.INCOME, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ month, values })
	})
};

export const expenseAPI = {
	getByMonth: async (month) => jsonFetch(buildUrl(API_URLS.EXPENSE, { month })),
	getAll: async () => {
		const months = await jsonFetch(buildUrl(API_URLS.EXPENSE));
		return { months };
	},
	save: async (month, values) => jsonFetch(API_URLS.EXPENSE, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ month, expense_data: values })
	})
};

export const savingsAPI = {
	getByMonth: async (month) => jsonFetch(buildUrl(API_URLS.SAVINGS, { month })),
	getAll: async () => {
		const months = await jsonFetch(buildUrl(API_URLS.SAVINGS));
		return { months };
	},
	saveList: async (month, savings_list) => jsonFetch(API_URLS.SAVINGS, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ month, savings_list })
	}),
	saveAccumulated: async (month, total_savings) => jsonFetch(API_URLS.SAVINGS, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ month, total_savings })
	}),
	confirmTransfer: async (month, amount, savingsBase) => jsonFetch(API_URLS.SAVINGS, {
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
	getAll: async () => jsonFetch(buildUrl(API_URLS.TAX)),
	getByYear: getTaxYearPayload,
	saveYearly: async (year, data) => {
		const payload = typeof data === 'object' && data !== null
			? data
			: { accumulated_tax: data };
		return postTaxYearPayload(year, payload);
	},
	deleteYear: deleteTaxYearPayload,
	updateMonthlyTax: async (year, month, value) => {
		const normalizedYear = normalizeYearInput(year);
		const monthKey = String(month).padStart(2, '0');
		let monthlyTax = {};
		try {
			const data = await getTaxYearPayload(normalizedYear);
			monthlyTax = { ...(data?.[normalizedYear]?.monthly_tax || {}) };
		} catch (error) {
			monthlyTax = {};
		}
		monthlyTax[monthKey] = sanitizeTaxAmount(value);
		return postTaxYearPayload(normalizedYear, { monthly_tax: monthlyTax });
	},
	updateMonthlyDeductionFields: async (year, month, { tax, provident, income } = {}) => {
		const hasTax = tax !== undefined;
		const hasProvident = provident !== undefined;
		const hasIncome = income !== undefined;
		if (!hasTax && !hasProvident && !hasIncome) {
			return { success: true, skipped: true };
		}

		const normalizedYear = normalizeYearInput(year);
		const monthKey = String(month).padStart(2, '0');
		let monthlyTax = {};
		let monthlyProvident = {};
		let monthlyIncome = {};

		try {
			const data = await getTaxYearPayload(normalizedYear);
			monthlyTax = { ...(data?.[normalizedYear]?.monthly_tax || {}) };
			monthlyProvident = { ...(data?.[normalizedYear]?.monthly_provident || {}) };
			monthlyIncome = { ...(data?.[normalizedYear]?.monthly_income || {}) };
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
	getByMonth: async (month) => jsonFetch(buildUrl(API_URLS.SALARY, { month })),
	getAll: async () => {
		const months = await jsonFetch(buildUrl(API_URLS.SALARY));
		return { months };
	},
	save: async (month, income, deduct, note = '') => jsonFetch(API_URLS.SALARY, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ month, income, deduct, note })
	}),
	delete: async (month) => jsonFetch(buildUrl(API_URLS.SALARY, { month }), {
		method: 'DELETE'
	})
};

export const investmentAPI = {
	getAll: async () => jsonFetch(buildUrl(API_URLS.INVESTMENT)),
	getByMonth: async (month) => jsonFetch(buildUrl(API_URLS.INVESTMENT, { month })),
	saveList: async (month, investments) => jsonFetch(API_URLS.INVESTMENT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ month, investments })
	})
};

export const savingsGoalsAPI = {
	getAll: async () => jsonFetch(buildUrl('/api/savings-goals')),
	create: async (payload) => jsonFetch('/api/savings-goals', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload(payload)
	}),
	saveAllocations: async (allocations) => jsonFetch('/api/savings-goals', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ allocations })
	}),
	update: async (id, payload) => jsonFetch('/api/savings-goals', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ goalId: id, ...payload })
	}),
	delete: async (id) => jsonFetch('/api/savings-goals', {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ goalId: id })
	})
};

export const dailyExpenseAPI = {
	getByMonth: async (month) => jsonFetch(buildUrl('/api/daily_expenses', { month })),
	save: async (month, items) => jsonFetch('/api/daily_expenses', {
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
	get: async () => jsonFetch(buildUrl('/api/user-bank-accounts')),
	saveThresholds: async (budgetThresholds) => jsonFetch('/api/user-bank-accounts', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: withUserPayload({ budgetThresholds })
	})
};

const CREDIT_CARDS_URL = '/api/credit-cards';
const CREDIT_CARD_PLANS_URL = '/api/credit-cards/plans';
const CREDIT_CARD_REVOLVING_URL = '/api/credit-cards/revolving';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * บัตรเครดิต & แผนผ่อนชำระ
 * ใช้ buildUrl / withUserPayload เหมือน API อื่น ทำให้ userId + Bearer token แนบไปเองเสมอ
 */
export const creditCardAPI = {
	getCards: async () => jsonFetch(buildUrl(CREDIT_CARDS_URL)),
	saveCard: async (card) => jsonFetch(CREDIT_CARDS_URL, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: withUserPayload({ card })
	}),
	deleteCard: async (cardId) => jsonFetch(CREDIT_CARDS_URL, {
		method: 'DELETE',
		headers: JSON_HEADERS,
		body: withUserPayload({ cardId })
	}),
	getPlans: async (filters = {}) => jsonFetch(buildUrl(CREDIT_CARD_PLANS_URL, filters)),
	createPlan: async (plan) => jsonFetch(CREDIT_CARD_PLANS_URL, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: withUserPayload({ plan })
	}),
	updatePlan: async (planId, patch) => jsonFetch(CREDIT_CARD_PLANS_URL, {
		method: 'PUT',
		headers: JSON_HEADERS,
		body: withUserPayload({ planId, patch })
	}),
	setInstallmentPaid: async (planId, installmentNo, paid) => jsonFetch(CREDIT_CARD_PLANS_URL, {
		method: 'PATCH',
		headers: JSON_HEADERS,
		body: withUserPayload({ planId, installmentNo, paid })
	}),
	cancelPlan: async (planId) => jsonFetch(CREDIT_CARD_PLANS_URL, {
		method: 'DELETE',
		headers: JSON_HEADERS,
		body: withUserPayload({ planId, mode: 'cancel' })
	}),
	deletePlan: async (planId) => jsonFetch(CREDIT_CARD_PLANS_URL, {
		method: 'DELETE',
		headers: JSON_HEADERS,
		body: withUserPayload({ planId, mode: 'delete' })
	}),
	// ยอดใช้จ่ายหมุนเวียน — ตัวเลขทั้งหมด server คำนวณให้ client ส่งได้แค่ newSpend / paymentAction
	getRevolving: async (filters = {}) => jsonFetch(buildUrl(CREDIT_CARD_REVOLVING_URL, filters)),
	saveRevolvingSpend: async (cardId, month, newSpend) => jsonFetch(CREDIT_CARD_REVOLVING_URL, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: withUserPayload({ cycle: { cardId, month, newSpend } })
	}),
	setRevolvingAction: async (cardId, month, paymentAction) => jsonFetch(CREDIT_CARD_REVOLVING_URL, {
		method: 'PATCH',
		headers: JSON_HEADERS,
		body: withUserPayload({ cardId, month, paymentAction })
	}),
	deleteRevolvingCycle: async (cardId, month) => jsonFetch(CREDIT_CARD_REVOLVING_URL, {
		method: 'DELETE',
		headers: JSON_HEADERS,
		body: withUserPayload({ cardId, month })
	}),
	// metadata สำหรับตกแต่งแถว cci_ ใน ExpenseTable — ล้มเหลวแล้วคืน [] ไม่ทำให้หน้ารายจ่ายพัง
	getMonthInstallments: async (month) => {
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
