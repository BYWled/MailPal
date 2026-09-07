import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSystemSettings, listDomains, listBlacklist } from '$lib/kv.js';
import { syncCloudflareDomainsAndDns } from '$lib/cloudflare.js';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (locals.user?.role !== 'superadmin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const settings = await getSystemSettings(locals.kv);
	const hasEnvToken = Boolean(platform?.env?.CF_API_TOKEN || platform?.env?.CLOUDFLARE_API_TOKEN);
	const hasConfiguredToken = hasEnvToken || Boolean(settings.cfApiToken);

	const intervalHours = settings.autoSyncIntervalHours ?? 6;
	const intervalMs = intervalHours * 60 * 60 * 1000;
	const lastSync = settings.lastSyncStatus?.lastSyncTime ?? 0;
	const isDue = settings.autoSyncEnabled !== false && hasConfiguredToken && Date.now() - lastSync > intervalMs;

	return json({
		autoSyncEnabled: settings.autoSyncEnabled ?? true,
		autoSyncIntervalHours: intervalHours,
		lastSyncStatus: settings.lastSyncStatus ?? null,
		hasConfiguredToken,
		isDue
	});
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (locals.user?.role !== 'superadmin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const body = await request.json().catch(() => ({}));
	const explicitToken = body.apiToken as string | undefined;

	// Resolve Cloudflare token: explicit -> platform env -> KV system settings
	let token = explicitToken?.trim();
	if (!token) {
		const envToken = platform?.env?.CF_API_TOKEN || platform?.env?.CLOUDFLARE_API_TOKEN;
		if (envToken?.trim()) token = envToken.trim();
	}
	if (!token) {
		const settings = await getSystemSettings(locals.kv);
		if (settings.cfApiToken?.trim()) token = settings.cfApiToken.trim();
	}

	if (!token) {
		return json(
			{
				error:
					'Cloudflare API token not configured. Please configure it in System Settings or provide CF_API_TOKEN in environment secrets. / 未配置 Cloudflare API Token，请在系统设置中填入或配置环境变量。'
			},
			{ status: 400 }
		);
	}

	try {
		const status = await syncCloudflareDomainsAndDns(locals.kv, token, locals.user.username);
		const [domains, blacklist] = await Promise.all([
			listDomains(locals.kv),
			listBlacklist(locals.kv)
		]);

		return json({
			success: true,
			status,
			domains,
			blacklistCount: blacklist.length
		});
	} catch (err: any) {
		return json(
			{
				error: err.message || 'Failed to synchronize with Cloudflare API / 同步 Cloudflare 失败'
			},
			{ status: 500 }
		);
	}
};
