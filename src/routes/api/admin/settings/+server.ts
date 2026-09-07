import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSystemSettings, putSystemSettings } from '$lib/kv.js';
import type { SystemSettings } from '$lib/types.js';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (locals.user?.role !== 'superadmin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const settings = await getSystemSettings(locals.kv);
	const hasEnvToken = Boolean(platform?.env?.CF_API_TOKEN || platform?.env?.CLOUDFLARE_API_TOKEN);

	return json({
		...settings,
		hasEnvToken,
		hasConfiguredToken: hasEnvToken || Boolean(settings.cfApiToken)
	});
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (locals.user?.role !== 'superadmin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const current = await getSystemSettings(locals.kv);
	const body = await request.json().catch(() => ({}));
	const {
		defaultUserAliasQuota,
		maxAliasesPerDomain,
		cfApiToken,
		autoSyncEnabled,
		autoSyncIntervalHours
	} = body as Partial<SystemSettings>;

	const updated: SystemSettings = {
		defaultUserAliasQuota:
			defaultUserAliasQuota != null && !isNaN(Number(defaultUserAliasQuota))
				? Math.max(1, Number(defaultUserAliasQuota))
				: current.defaultUserAliasQuota,
		maxAliasesPerDomain:
			maxAliasesPerDomain != null && !isNaN(Number(maxAliasesPerDomain))
				? Math.min(50, Math.max(1, Number(maxAliasesPerDomain)))
				: 50, // strictly capped at 50
		cfApiToken: cfApiToken !== undefined ? (cfApiToken?.trim() || undefined) : current.cfApiToken,
		autoSyncEnabled: autoSyncEnabled !== undefined ? Boolean(autoSyncEnabled) : (current.autoSyncEnabled ?? true),
		autoSyncIntervalHours:
			autoSyncIntervalHours != null && !isNaN(Number(autoSyncIntervalHours))
				? Math.max(1, Number(autoSyncIntervalHours))
				: (current.autoSyncIntervalHours ?? 6),
		lastSyncStatus: current.lastSyncStatus
	};

	await putSystemSettings(locals.kv, updated);
	return json(updated);
};
