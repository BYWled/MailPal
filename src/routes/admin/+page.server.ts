import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	listUsers,
	listDomains,
	listAliases,
	listBlacklist,
	getSystemSettings
} from '$lib/kv.js';
import { syncCloudflareDomainsAndDns } from '$lib/cloudflare.js';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (locals.user?.role !== 'superadmin') {
		throw error(403, 'Forbidden: Superadmin role required');
	}

	let settings = await getSystemSettings(locals.kv);
	const cfToken =
		settings.cfApiToken ||
		platform?.env?.CF_API_TOKEN ||
		platform?.env?.CLOUDFLARE_API_TOKEN;

	const intervalHours = settings.autoSyncIntervalHours ?? 6;
	const intervalMs = intervalHours * 60 * 60 * 1000;
	const lastSync = settings.lastSyncStatus?.lastSyncTime ?? 0;
	const isDue =
		settings.autoSyncEnabled !== false &&
		Boolean(cfToken) &&
		Date.now() - lastSync > intervalMs;

	if (isDue && cfToken) {
		try {
			await syncCloudflareDomainsAndDns(locals.kv, cfToken.trim(), locals.user.username);
			settings = await getSystemSettings(locals.kv);
		} catch (e) {
			console.error('Periodic domain & DNS auto-sync failed on page load:', e);
		}
	}

	const [rawUsers, domains, blacklist] = await Promise.all([
		listUsers(locals.kv),
		listDomains(locals.kv),
		listBlacklist(locals.kv)
	]);

	// Load aliases for all domains once in parallel
	const allAliasesByDomain = new Map<string, import('$lib/types.js').AliasConfig[]>();
	await Promise.all(
		domains.map(async (d) => {
			const aliases = await listAliases(locals.kv, d.domain);
			allAliasesByDomain.set(d.domain.toLowerCase().trim(), aliases);
		})
	);
	const allAliases = Array.from(allAliasesByDomain.values()).flat();

	// Enrich users completely in-memory
	const users = rawUsers.map((u) => {
		const normUser = u.username.toLowerCase().trim();
		const aliasCount = allAliases.filter(
			(a) => a.createdBy?.toLowerCase().trim() === normUser
		).length;
		const domainUsage: Record<string, number> = {};
		for (const d of domains) {
			const domainAliases = allAliasesByDomain.get(d.domain.toLowerCase().trim()) || [];
			domainUsage[d.domain] = domainAliases.filter(
				(a) => a.createdBy?.toLowerCase().trim() === normUser
			).length;
		}
		return {
			username: u.username,
			role: u.role,
			createdAt: u.createdAt,
			maxAliases: u.maxAliases ?? settings.defaultUserAliasQuota,
			customQuota: u.maxAliases != null,
			domainQuotas: u.domainQuotas ?? {},
			domainUsage,
			aliasCount,
			twoFactorEnabled: u.twoFactorEnabled
		};
	});
	users.sort((a, b) => a.createdAt - b.createdAt);

	// Enrich domains with alias count / 50 limit in-memory
	const enrichedDomains = domains.map((d) => {
		const aliases = allAliasesByDomain.get(d.domain.toLowerCase().trim()) || [];
		return {
			...d,
			aliasCount: aliases.length,
			maxAliases: 50 // Enforced 50 per domain
		};
	});
	enrichedDomains.sort((a, b) => a.createdAt - b.createdAt);

	blacklist.sort((a, b) => b.createdAt - a.createdAt);

	return {
		users,
		domains: enrichedDomains,
		blacklist,
		settings,
		hasEnvCfToken: Boolean(platform?.env?.CF_API_TOKEN || platform?.env?.CLOUDFLARE_API_TOKEN),
		hasEnvCfAccountId: Boolean(platform?.env?.CF_ACCOUNT_ID || platform?.env?.CLOUDFLARE_ACCOUNT_ID),
		hasConfiguredToken: Boolean(cfToken),
		currentUser: locals.user
	};
};
