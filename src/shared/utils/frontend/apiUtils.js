import { requireActiveUserId } from './sessionClient';

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
	const response = await fetch(url, options);
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
