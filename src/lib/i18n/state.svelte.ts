import type { Locale, TranslationDict } from './types.js';
import en from './locales/en.js';
import zh from './locales/zh.js';

export const COOKIE_LANG = 'mailpal_lang';

const dictionaries: Record<Locale, TranslationDict> = {
	en,
	zh
};

// Svelte 5 module-level reactive state
let currentLocale = $state<Locale>('zh');

/**
 * Get current active locale ('zh' | 'en')
 */
export function getLocale(): Locale {
	return currentLocale;
}

/**
 * Initialize locale from server layout data
 */
export function initLocale(initial: Locale) {
	if (initial === 'zh' || initial === 'en') {
		currentLocale = initial;
	}
}

/**
 * Switch language and save to cookie
 */
export function setLocale(newLocale: Locale) {
	if (newLocale !== 'zh' && newLocale !== 'en') return;
	currentLocale = newLocale;

	if (typeof document !== 'undefined') {
		document.cookie = `${COOKIE_LANG}=${newLocale}; path=/; max-age=31536000; SameSite=Lax`;
		document.documentElement.lang = newLocale;
	}
}

/**
 * Helper to get a nested value from a dictionary
 */
function getNestedValue(obj: any, path: string): string | undefined {
	const parts = path.split('.');
	let curr = obj;
	for (const part of parts) {
		if (curr == null || typeof curr !== 'object') return undefined;
		curr = curr[part];
	}
	return typeof curr === 'string' ? curr : undefined;
}

/**
 * Translate a key with optional interpolation params
 * e.g. t('sidebar.quotaUsed', { used: 2, max: 20 })
 */
export function t(key: string, params?: Record<string, string | number>): string {
	const dict = dictionaries[currentLocale] || dictionaries.en;
	let value = getNestedValue(dict, key);

	// Fallback to English if not found in current dictionary
	if (value === undefined && currentLocale !== 'en') {
		value = getNestedValue(dictionaries.en, key);
	}

	// If still not found, return the key itself
	if (value === undefined) {
		return key;
	}

	// Interpolate parameters {name}
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
		}
	}

	return value;
}
