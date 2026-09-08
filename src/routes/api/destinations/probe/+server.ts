import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSystemSettings, listDestinationsForUser, getDestination } from '$lib/kv.js';
import {
	getCloudflareAccountId,
	listCloudflareDestinationAddresses,
	createCloudflareDestinationAddress,
	resolveCloudflareToken,
	resolveCloudflareAccountId
} from '$lib/cloudflare.js';

interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

const cfAddressesCache = new Map<string, CacheEntry<any[]>>();

function getCachedCfAddresses(key: string): any[] | undefined {
	const entry = cfAddressesCache.get(key);
	if (!entry) return undefined;
	if (Date.now() > entry.expiresAt) {
		cfAddressesCache.delete(key);
		return undefined;
	}
	return entry.value;
}

function setCachedCfAddresses(key: string, value: any[], ttlMs = 30_000): void {
	cfAddressesCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function invalidateCfAddressesCache(key?: string): void {
	if (key) cfAddressesCache.delete(key);
	else cfAddressesCache.clear();
}

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const settings = await getSystemSettings(locals.kv);
	const token = resolveCloudflareToken(platform, settings);

	if (!token) {
		return json({
			tokenConfigured: false,
			message: 'Cloudflare API token is not configured',
			statuses: {}
		});
	}

	const explicitAccountId = resolveCloudflareAccountId(platform, settings);
	let accountId: string | null = null;

	try {
		accountId = await getCloudflareAccountId(token, explicitAccountId);
		if (!accountId) {
			return json({
				tokenConfigured: true,
				error:
					'未能自动解析到 Cloudflare Account ID。若您的 API Token 仅包含 Email Routing 权限，请在「管理后台 -> 系统设置」中填写您的 Cloudflare Account ID（可在 Cloudflare 控制台任意域名右侧栏或 URL 中获取）。',
				tokenHint: `${token.slice(0, 4)}...${token.slice(-4)}`,
				tokenSource: settings.cfApiToken ? 'settings' : 'environment',
				statuses: {}
			});
		}

		let cfAddresses = getCachedCfAddresses(accountId);
		if (!cfAddresses) {
			cfAddresses = await listCloudflareDestinationAddresses(token, accountId);
			setCachedCfAddresses(accountId, cfAddresses, 30_000);
		}

		const destinations = await listDestinationsForUser(locals.kv, locals.user);

		const cfMap = new Map<string, { id: string; verified: boolean; status: 'verified' | 'pending'; created: string }>();
		for (const addr of cfAddresses) {
			const isVerified = Boolean(addr.verified);
			cfMap.set(addr.email.toLowerCase(), {
				id: addr.id,
				verified: isVerified,
				status: isVerified ? 'verified' : 'pending',
				created: addr.created
			});
		}

		const statuses: Record<string, { id?: string; verified: boolean; status: 'verified' | 'pending' | 'not_in_cf'; created?: string }> = {};
		for (const d of destinations) {
			const key = d.email.toLowerCase();
			const info = cfMap.get(key);
			if (info) {
				statuses[d.email] = info;
			} else {
				statuses[d.email] = {
					verified: false,
					status: 'not_in_cf'
				};
			}
		}

		return json({
			tokenConfigured: true,
			accountId,
			statuses
		});
	} catch (err: any) {
		const isAuth = Boolean(err?.isAuthError || err?.message?.includes('Authentication error'));
		return json({
			tokenConfigured: true,
			authError: isAuth,
			error: err?.message || 'Failed to probe Cloudflare destination addresses',
			accountId: (err as any)?.accountId || accountId,
			tokenHint: token ? `${token.slice(0, 4)}...${token.slice(-4)}` : null,
			tokenSource: settings.cfApiToken ? 'settings' : 'environment',
			statuses: {}
		});
	}
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => ({}))) as {
		email?: string;
		action?: 'probe' | 'add_to_cf';
	};

	const email = body.email?.toLowerCase().trim();
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return json({ error: 'A valid email address is required' }, { status: 400 });
	}

	if (locals.user.role !== 'superadmin') {
		const existing = await getDestination(locals.kv, email);
		if (existing && existing.createdBy && existing.createdBy !== locals.user.username) {
			return json({ error: 'Forbidden' }, { status: 403 });
		}
	}

	const settings = await getSystemSettings(locals.kv);
	const token = resolveCloudflareToken(platform, settings);

	if (!token) {
		return json(
			{
				error: 'Cloudflare API token not configured. Please configure it in System Settings or environment secrets.'
			},
			{ status: 400 }
		);
	}

	const explicitAccountId = resolveCloudflareAccountId(platform, settings);
	let accountId: string | null = null;

	try {
		accountId = await getCloudflareAccountId(token, explicitAccountId);
		if (!accountId) {
			return json(
				{
					error:
						'未能自动解析到 Cloudflare Account ID。请在「管理后台 -> 系统设置」中填写您的 Cloudflare Account ID。'
				},
				{ status: 400 }
			);
		}

		if (body.action === 'add_to_cf') {
			const created = await createCloudflareDestinationAddress(token, accountId, email);
			invalidateCfAddressesCache(accountId);
			const isVerified = Boolean(created.verified);
			return json({
				success: true,
				email,
				id: created.id,
				verified: isVerified,
				status: isVerified ? 'verified' : 'pending',
				created: created.created,
				message: 'Added to Cloudflare. Verification email has been sent.'
			});
		}

		// Default: probe
		let cfAddresses = getCachedCfAddresses(accountId);
		if (!cfAddresses) {
			cfAddresses = await listCloudflareDestinationAddresses(token, accountId);
			setCachedCfAddresses(accountId, cfAddresses, 30_000);
		}
		const match = cfAddresses.find((a) => a.email.toLowerCase() === email);

		if (match) {
			const isVerified = Boolean(match.verified);
			return json({
				success: true,
				email,
				id: match.id,
				verified: isVerified,
				status: isVerified ? 'verified' : 'pending',
				created: match.created
			});
		}

		return json({
			success: true,
			email,
			verified: false,
			status: 'not_in_cf'
		});
	} catch (err: any) {
		const isAuth = Boolean(err?.isAuthError || err?.message?.includes('Authentication error'));
		return json(
			{
				error: err?.message || 'Failed to interact with Cloudflare API',
				authError: isAuth,
				accountId: (err as any)?.accountId || accountId,
				tokenHint: token ? `${token.slice(0, 4)}...${token.slice(-4)}` : null,
				tokenSource: settings.cfApiToken ? 'settings' : 'environment'
			},
			{ status: isAuth ? 403 : 500 }
		);
	}
};
