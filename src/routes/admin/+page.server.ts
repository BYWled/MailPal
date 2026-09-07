import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	listUsers,
	listDomains,
	listAliases,
	listBlacklist,
	getSystemSettings,
	countUserAliases
} from '$lib/kv.js';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (locals.user?.role !== 'superadmin') {
		throw error(403, 'Forbidden: Superadmin role required');
	}

	const [rawUsers, domains, blacklist, settings] = await Promise.all([
		listUsers(locals.kv),
		listDomains(locals.kv),
		listBlacklist(locals.kv),
		getSystemSettings(locals.kv)
	]);

	// Enrich users
	const users = await Promise.all(
		rawUsers.map(async (u) => {
			const aliasCount = await countUserAliases(locals.kv, u.username);
			return {
				username: u.username,
				role: u.role,
				createdAt: u.createdAt,
				maxAliases: u.maxAliases ?? settings.defaultUserAliasQuota,
				customQuota: u.maxAliases != null,
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
		currentUser: locals.user
	};
};
