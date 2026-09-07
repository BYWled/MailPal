import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { countUsers, getUser } from '$lib/kv.js';
import { verifyPassword, verifyTotp } from '$lib/crypto.js';
import {
	createSession,
	COOKIE_NAME,
	COOKIE_MAX_AGE,
	createTwoFactorLoginToken,
	verifyTwoFactorLoginToken
} from '$lib/auth.js';

export const load: PageServerLoad = async ({ locals }) => {
	const userCount = await countUsers(locals.kv);
	if (userCount === 0) {
		throw redirect(302, '/register');
	}
	if (locals.authenticated) {
		throw redirect(302, '/');
	}
	if (locals.twoFactorPending) {
		throw redirect(302, '/setup-2fa');
	}
	return {};
};

export const actions: Actions = {
	default: async ({ request, locals, platform, cookies }) => {
		const userCount = await countUsers(locals.kv);
		if (userCount === 0) {
			throw redirect(302, '/register');
		}

		const sessionSecret = platform?.env?.SESSION_SECRET || platform?.env?.AUTH_PASSWORD;
		const data = await request.formData();
		const token = (data.get('token') as string)?.trim();
		const rawTotpCode = (data.get('totpCode') as string) || '';
		const totpCode = rawTotpCode
			.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
			.replace(/\D/g, '')
			.trim();

		// ── Step 2: 2FA Verification Submission ──────────────────────────────
		if (token) {
			const username = await verifyTwoFactorLoginToken(token, sessionSecret);
			if (!username) {
				return fail(400, {
					error: '2FA session expired. Please sign in again / 验证会话已过期，请重新输入账号密码登录'
				});
			}

			const user = await getUser(locals.kv, username);
			if (!user || !user.twoFactorSecret) {
				return fail(400, {
					error: 'User 2FA not properly configured / 用户未完成 2FA 配置'
				});
			}

			if (!totpCode || !/^\d{6}$/.test(totpCode)) {
				return fail(400, {
					error: 'Please enter a 6-digit numeric verification code / 请输入 6 位纯数字验证码',
					requires2Fa: true,
					username: user.username,
					token
				});
			}

			const isTotpValid = await verifyTotp(totpCode, user.twoFactorSecret);
			if (!isTotpValid) {
				return fail(401, {
					error: 'Invalid 2FA verification code / 动态验证码错误，请重新输入',
					requires2Fa: true,
					username: user.username,
					token
				});
			}

			// 2FA passed: Issue full authenticated session
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

		// ── Step 1: Username and Password Submission ─────────────────────────
		const username = (data.get('username') as string)?.trim().toLowerCase();
		const password = data.get('password') as string;

		if (!username || !password) {
			return fail(400, { error: 'Username and password are required' });
		}

		const user = await getUser(locals.kv, username);
		if (!user) {
			return fail(401, { error: 'Invalid username or password' });
		}

		const isPasswordValid = await verifyPassword(password, user.passwordHash);
		if (!isPasswordValid) {
			return fail(401, { error: 'Invalid username or password' });
		}

		// Check if 2FA is bound
		if (!user.twoFactorEnabled || !user.twoFactorSecret) {
			// User must bind 2FA before completing login
			const sealed = await createSession(
				{
					username: user.username,
					role: user.role,
					authenticated: false,
					twoFactorPending: true
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

			throw redirect(302, '/setup-2fa');
		}

		// 2FA is enabled: generate a sealed 5-minute 2FA temporary token
		const twoFactorToken = await createTwoFactorLoginToken(user.username, sessionSecret);
		return {
			requires2Fa: true,
			username: user.username,
			token: twoFactorToken
		};
	}
};
