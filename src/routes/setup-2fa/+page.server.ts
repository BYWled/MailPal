import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getUser, putUser } from '$lib/kv.js';
import { generateTotpSecret, generateTotpUri, generateQrCodeSvg, verifyTotp } from '$lib/crypto.js';
import { createSession, COOKIE_NAME, COOKIE_MAX_AGE } from '$lib/auth.js';

export const load: PageServerLoad = async ({ locals }) => {
	const username = locals.user?.username;
	if (!username) {
		throw redirect(302, '/login');
	}

	const user = await getUser(locals.kv, username);
	if (!user) {
		throw redirect(302, '/login');
	}

	if (user.twoFactorEnabled && !locals.twoFactorPending) {
		throw redirect(302, '/');
	}

	let secret = user.twoFactorSecret;
	if (!secret) {
		secret = generateTotpSecret();
		user.twoFactorSecret = secret;
		await putUser(locals.kv, user);
	}

	const uri = generateTotpUri(user.username, secret, 'MailPal');
	const qrSvg = generateQrCodeSvg(uri, 220);

	return {
		username: user.username,
		secret,
		uri,
		qrSvg
	};
};

export const actions: Actions = {
	default: async ({ request, locals, platform, cookies }) => {
		const username = locals.user?.username;
		if (!username) {
			return fail(401, { error: 'Session expired. Please log in again.' });
		}

		const user = await getUser(locals.kv, username);
		if (!user || !user.twoFactorSecret) {
			return fail(400, { error: 'User 2FA not configured properly.' });
		}

		const data = await request.formData();
		const rawCode = (data.get('code') as string) || '';
		const code = rawCode
			.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
			.replace(/\D/g, '')
			.trim();

		if (!code || code.length !== 6) {
			return fail(400, { error: 'Please enter a 6-digit numeric verification code / 请输入 6 位纯数字验证码' });
		}

		const isValid = await verifyTotp(code, user.twoFactorSecret);
		if (!isValid) {
			return fail(400, { error: 'Invalid verification code. Ensure your device time is synchronized. / 动态验证码错误，请确保您的设备时间已自动同步。' });
		}

		// Activate 2FA
		user.twoFactorEnabled = true;
		await putUser(locals.kv, user);

		// Issue upgraded session
		const sessionSecret = platform?.env?.SESSION_SECRET || platform?.env?.AUTH_PASSWORD;
		const sealed = await createSession(
			{
				username: user.username,
				role: user.role,
				authenticated: true,
				twoFactorPending: false
			},
			sessionSecret
		);

		cookies.set(COOKIE_NAME, sealed, {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			maxAge: COOKIE_MAX_AGE
		});

		throw redirect(302, '/');
	}
};
