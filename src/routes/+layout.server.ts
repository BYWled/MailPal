import type { LayoutServerLoad } from './$types';
import { COOKIE_LANG } from '$lib/i18n/index.js';
import type { Locale } from '$lib/i18n/types.js';

export const load: LayoutServerLoad = async ({ locals, cookies, request }) => {
	const cookieLang = cookies.get(COOKIE_LANG);
	let lang: Locale = 'zh';
	if (cookieLang === 'en' || cookieLang === 'zh') {
		lang = cookieLang;
	} else {
		const acceptLang = request.headers.get('accept-language')?.toLowerCase() || '';
		if (acceptLang.startsWith('en') && !acceptLang.includes('zh')) {
			lang = 'en';
		} else {
			lang = 'zh';
		}
	}

	return {
		authMode: locals.authMode,
		authenticated: locals.authenticated,
		user: locals.user,
		demo: locals.demo ?? false,
		lang
	};
};
