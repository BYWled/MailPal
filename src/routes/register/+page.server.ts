import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { countUsers, putUser, putSystemSettings, getSystemSettings } from '$lib/kv.js';
import { hashPassword, generateTotpSecret } from '$lib/crypto.js';
import { createSession, COOKIE_NAME, COOKIE_MAX_AGE } from '$lib/auth.js';
import type { User } from '$lib/types.js';

export const load: PageServerLoad = async ({ locals }) => {
	const userCount = await countUsers(locals.kv);
	if (userCount > 0) {
		// Only the very first user can register
		throw redirect(302, '/login');
	}
	return { isInitialSetup: true };
};

export const actions: Actions = {
	default: async ({ request, locals, platform, cookies }) => {
		const userCount = await countUsers(locals.kv);
		if (userCount > 0) {
			return fail(403, { error: 'Registration is closed. Please contact administrator.' });
		}

		const data = await request.formData();
		const username = (data.get('username') as string)?.trim().toLowerCase();
		const password = data.get('password') as string;
		const confirmPassword = data.get('confirmPassword') as string;

		if (!username || username.length < 3 || username.length > 32) {
			return fail(400, { error: 'Username must be between 3 and 32 characters' });
		}

		if (!/^[a-z0-9_.-]+$/.test(username)) {
			return fail(400, { error: 'Username can only contain letters, numbers, hyphens, underscores and dots' });
		}

		if (!password || password.length < 8) {
			return fail(400, { error: 'Password must be at least 8 characters long' });
		}

		if (password !== confirmPassword) {
			return fail(400, { error: 'Passwords do not match' });
		}

		// Hash password and generate 2FA secret
		const passwordHash = await hashPassword(password);
		const twoFactorSecret = generateTotpSecret();

		const superadminUser: User = {
			username,
			passwordHash,
			role: 'superadmin',
			createdAt: Date.now(),
			twoFactorSecret,
			twoFactorEnabled: false
		};

		await putUser(locals.kv, superadminUser);

		// Initialize system settings if not set
		const settings = await getSystemSettings(locals.kv);
		await putSystemSettings(locals.kv, settings);

		// Issue session with twoFactorPending = true
		const sessionSecret = platform?.env?.SESSION_SECRET || platform?.env?.AUTH_PASSWORD;
		const sealed = await createSession(
			{
				username,
				role: 'superadmin',
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
};
