import { redirect, error, type Handle } from '@sveltejs/kit';
import { readSession, COOKIE_NAME } from '$lib/auth.js';
import { countUsers } from '$lib/kv.js';
import { DemoKV, type DemoDelta } from '$lib/demo-kv.js';

const DEMO_STATE_COOKIE = 'demo_state';

const SECURITY_HEADERS: Record<string, string> = {
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
};

export const handle: Handle = async ({ event, resolve }) => {
	const platform = event.platform;
	const demoMode = platform?.env?.DEMO_MODE;
	const isDemoModeEnabled = demoMode === '1' || demoMode === 'true';

	// ── 1. Setup KV binding ──────────────────────────────────────────────────
	if (isDemoModeEnabled) {
		let savedDelta: DemoDelta | undefined;
		const raw = event.cookies.get(DEMO_STATE_COOKIE);
		if (raw) {
			try {
				const parsed: unknown = JSON.parse(raw);
				if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
					savedDelta = parsed as DemoDelta;
				}
			} catch {
				// ignore corrupt cookie
			}
		}

		const demoKV = new DemoKV(savedDelta);
		event.locals.kv = demoKV as unknown as App.Locals['kv'];
		event.locals.demo = true;
	} else if (platform?.env?.KV) {
		event.locals.kv = platform.env.KV;
	} else {
		// Local development fallback
		event.locals.kv = new DemoKV() as unknown as App.Locals['kv'];
	}

	event.locals.authMode = 'password';

	// ── 2. Check initial setup state (0 users = initial setup) ───────────────
	const userCount = await countUsers(event.locals.kv);
	const isInitialSetup = userCount === 0;
	event.locals.isInitialSetup = isInitialSetup;

	// ── 3. Read session token ────────────────────────────────────────────────
	const sealed = event.cookies.get(COOKIE_NAME);
	const sessionSecret = platform?.env?.SESSION_SECRET || platform?.env?.AUTH_PASSWORD;
	const session = await readSession(sealed, sessionSecret);

	if (session && session.username) {
		event.locals.user = {
			username: session.username,
			role: session.role
		};
		event.locals.twoFactorPending = session.twoFactorPending === true;
		event.locals.authenticated = session.authenticated === true && !session.twoFactorPending;
	} else {
		event.locals.authenticated = false;
		event.locals.twoFactorPending = false;
	}

	// ── 4. Route protection & redirection rules ──────────────────────────────
	const pathname = event.url.pathname;
	const isRegisterRoute = pathname === '/register';
	const isLoginRoute = pathname === '/login';
	const isLogoutRoute = pathname === '/logout';
	const is2FaRoute = pathname === '/setup-2fa';
	const isApiRoute = pathname.startsWith('/api/');
	const isAdminRoute =
		pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin/');

	// Rule A: If initial setup (0 users):
	if (isInitialSetup) {
		// Only /register, /setup-2fa, and /logout (or static assets) are allowed
		if (!isRegisterRoute && !is2FaRoute && !isLogoutRoute && !pathname.startsWith('/api/auth/')) {
			if (isApiRoute) {
				return new Response(JSON.stringify({ error: 'Initial setup required' }), {
					status: 403,
					headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS }
				});
			}
			throw redirect(302, '/register');
		}
	} else {
		// Rule B: Public registration is closed once at least 1 user exists!
		if (isRegisterRoute) {
			throw redirect(302, '/login');
		}
	}

	// Rule C: Mandatory 2FA binding enforcement
	if (event.locals.twoFactorPending) {
		// User has entered password but NOT finished 2FA binding / verification
		const is2FaAllowed =
			is2FaRoute ||
			isLogoutRoute ||
			pathname === '/api/auth/2fa/verify' ||
			pathname === '/api/auth/status';
		if (!is2FaAllowed) {
			if (isApiRoute) {
				return new Response(JSON.stringify({ error: '2FA verification required' }), {
					status: 403,
					headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS }
				});
			}
			throw redirect(302, '/setup-2fa');
		}
	}

	// Rule D: Unauthenticated users cannot access protected routes
	if (!event.locals.authenticated) {
		const isPublicRoute =
			isLoginRoute || isRegisterRoute || isLogoutRoute || is2FaRoute || pathname.startsWith('/api/auth/');
		if (!isPublicRoute) {
			if (isApiRoute) {
				return new Response(JSON.stringify({ error: 'Unauthorized' }), {
					status: 401,
					headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS }
				});
			}
			throw redirect(302, '/login');
		}
	}

	// Rule E: Fully authenticated users visiting login/register should go to dashboard
	if (event.locals.authenticated && (isLoginRoute || isRegisterRoute)) {
		throw redirect(302, '/');
	}

	// Rule F: Superadmin access restriction
	if (isAdminRoute && event.locals.user?.role !== 'superadmin') {
		if (isApiRoute) {
			return new Response(JSON.stringify({ error: 'Forbidden: Superadmin role required' }), {
				status: 403,
				headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS }
			});
		}
		throw error(403, 'Forbidden: Superadmin access required');
	}

	const response = await resolve(event);

	// Persist demo state if in demo mode
	if (isDemoModeEnabled && event.locals.kv) {
		const demoKV = event.locals.kv as unknown as DemoKV;
		if (typeof demoKV.getDelta === 'function') {
			const deltaJson = JSON.stringify(demoKV.getDelta());
			response.headers.append(
				'Set-Cookie',
				`${DEMO_STATE_COOKIE}=${encodeURIComponent(deltaJson)}; Path=/; SameSite=Lax; Max-Age=604800; Secure`
			);
		}
	}

	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		response.headers.set(key, value);
	}
	return response;
};
