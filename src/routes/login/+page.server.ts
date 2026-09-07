import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { countUsers, getUser } from '$lib/kv.js';
import { verifyPassword, verifyTotp } from '$lib/crypto.js';
import { createSession, COOKIE_NAME, COOKIE_MAX_AGE } from '$lib/auth.js';

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

		const data = await request.formData();
		const username = (data.get('username') as string)?.trim().toLowerCase();
		const password = data.get('password') as string;
		const totpCode = (data.get('totpCode') as string)?.trim();

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
			const sessionSecret = platform?.env?.SESSION_SECRET || platform?.env?.AUTH_PASSWORD;
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

		// If 2FA is enabled, verify TOTP code
		if (!totpCode) {
			// Prompt for 2FA code
			return {
				requires2Fa: true,
				username: user.username
			};
		}

		if (!/^\d{6}$/.test(totpCode)) {
			return fail(400, {
				error: 'Please enter a 6-digit numeric verification code',
				requires2Fa: true,
				username: user.username
			});
		}

		const isTotpValid = await verifyTotp(totpCode, user.twoFactorSecret);
		if (!isTotpValid) {
			return fail(401, {
				error: 'Invalid 2FA verification code',
				requires2Fa: true,
				username: user.username
			});
		}

		// Login successful: issue full authenticated session
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
