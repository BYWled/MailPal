import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	listUsers,
	listDomains,
	listAliases,
	listBlacklist,
	getSystemSettings,
	countUserAliases,
	countUserAliasesOnDomain
} from '$lib/kv.js';
import { syncCloudflareDomainsAndDns } from '$lib/cloudflare.js';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (locals.user?.role !== 'superadmin') {
		throw error(403, 'Forbidden: Superadmin role required');
	}

	let settings = await getSystemSettings(locals.kv);
	const cfToken =
		platform?.env?.CF_API_TOKEN ||
		platform?.env?.CLOUDFLARE_API_TOKEN ||
		settings.cfApiToken;

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

	// Enrich users
	const users = await Promise.all(
		rawUsers.map(async (u) => {
			const aliasCount = await countUserAliases(locals.kv, u.username);
			const domainUsage: Record<string, number> = {};
			await Promise.all(
				domains.map(async (d) => {
					domainUsage[d.domain] = await countUserAliasesOnDomain(locals.kv, u.username, d.domain);
				})
			);
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
		})
	);
	users.sort((a, b) => a.createdAt - b.createdAt);

	// Enrich domains with alias count / 50 limit
	const enrichedDomains = await Promise.all(
		domains.map(async (d) => {
			const aliases = await listAliases(locals.kv, d.domain);
			return {
				...d,
				aliasCount: aliases.length,
				maxAliases: 50 // Enforced 50 per domain
			};
		})
	);
	enrichedDomains.sort((a, b) => a.createdAt - b.createdAt);

	blacklist.sort((a, b) => b.createdAt - a.createdAt);

	return {
		users,
		domains: enrichedDomains,
		blacklist,
		settings,
		hasEnvCfToken: Boolean(platform?.env?.CF_API_TOKEN || platform?.env?.CLOUDFLARE_API_TOKEN),
		hasConfiguredToken: Boolean(cfToken),
		currentUser: locals.user
	};
};
