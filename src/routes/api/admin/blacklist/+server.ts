import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listBlacklist, putBlacklist, blacklistKey, getSystemSettings } from '$lib/kv.js';
import { parseDnsZone } from '$lib/dns-parser.js';
import { fetchAndExtractDnsRecords } from '$lib/cloudflare.js';
import type { BlacklistEntry } from '$lib/types.js';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (locals.user?.role !== 'superadmin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const domain = url.searchParams.get('domain') || undefined;
	const entries = await listBlacklist(locals.kv, domain);
	entries.sort((a, b) => b.createdAt - a.createdAt);
	return json(entries);
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (locals.user?.role !== 'superadmin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const body = await request.json().catch(() => ({}));
	const { action } = body;

	async function resolveCfToken(explicitToken?: string): Promise<string | null> {
		if (explicitToken && explicitToken.trim()) return explicitToken.trim();
		const envToken = platform?.env?.CF_API_TOKEN || platform?.env?.CLOUDFLARE_API_TOKEN;
		if (envToken && envToken.trim()) return envToken.trim();
		const settings = await getSystemSettings(locals.kv);
		if (settings.cfApiToken && settings.cfApiToken.trim()) return settings.cfApiToken.trim();
		return null;
	}

	// 1. Cloudflare API DNS fetch
	if (action === 'cf_fetch') {
		const domain = (body.domain as string)?.trim().toLowerCase();
		if (!domain) {
			return json({ error: 'Domain name is required' }, { status: 400 });
		}
		const token = await resolveCfToken(body.apiToken);
		if (!token) {
			return json(
				{
					error:
						'Cloudflare API token not configured. Please enter an API token with Zone.DNS:Read permission, or set CF_API_TOKEN in environment secrets.'
				},
				{ status: 400 }
			);
		}

		try {
			const result = await fetchAndExtractDnsRecords(domain, token);
			return json({
				success: true,
				domain: result.domain,
				zoneId: result.zoneId,
				totalRecords: result.totalRecords,
				extractedNames: result.extractedNames,
				records: result.records
			});
		} catch (err: any) {
			return json(
				{ error: err.message || 'Failed to fetch DNS records from Cloudflare API' },
				{ status: 500 }
			);
		}
	}

	// 2. Cloudflare API DNS bulk import
	if (action === 'cf_import') {
		const domain = (body.domain as string)?.trim().toLowerCase();
		if (!domain) {
			return json({ error: 'Domain name is required' }, { status: 400 });
		}

		let names: string[] = body.names;
		if (!names || !Array.isArray(names)) {
			const token = await resolveCfToken(body.apiToken);
			if (!token) {
				return json({ error: 'Cloudflare API token not configured.' }, { status: 400 });
			}
			try {
				const result = await fetchAndExtractDnsRecords(domain, token);
				names = result.extractedNames;
			} catch (err: any) {
				return json(
					{ error: err.message || 'Failed to fetch DNS records from Cloudflare API' },
					{ status: 500 }
				);
			}
		}

		const now = Date.now();
		const importedNames: string[] = [];
		for (const name of names) {
			const entry: BlacklistEntry = {
				id: `${domain}:${name}`,
				pattern: name,
				domain,
				source: 'cloudflare_api',
				description: `Automatically fetched from Cloudflare DNS records for ${domain}`,
				createdAt: now
			};
			await putBlacklist(locals.kv, entry);
			importedNames.push(name);
		}

		return json({
			success: true,
			importedCount: importedNames.length,
			domain,
			names: importedNames
		});
	}

	// 1. DNS preview action
	if (action === 'dns_preview') {
		const zoneText = body.zoneText as string;
		const domainOverride = body.domain as string | undefined;
		if (!zoneText || !zoneText.trim()) {
			return json({ error: 'zoneText is required' }, { status: 400 });
		}

		const result = parseDnsZone(zoneText, domainOverride);
		return json({
			domain: result.domain,
			names: result.extractedNames,
			totalRecords: result.totalRecordsFound
		});
	}

	// 2. DNS import action
	if (action === 'dns_import') {
		const zoneText = body.zoneText as string;
		const domainOverride = body.domain as string | undefined;
		if (!zoneText || !zoneText.trim()) {
			return json({ error: 'zoneText is required' }, { status: 400 });
		}

		const result = parseDnsZone(zoneText, domainOverride);
		const targetDomain = result.domain || domainOverride || undefined;

		const importedNames: string[] = [];
		const now = Date.now();

		for (const name of result.extractedNames) {
			const entry: BlacklistEntry = {
				id: `${targetDomain || 'global'}:${name}`,
				pattern: name,
				domain: targetDomain,
				source: 'dns_import',
				description: `Imported from DNS zone records${targetDomain ? ` (${targetDomain})` : ''}`,
				createdAt: now
			};
			await putBlacklist(locals.kv, entry);
			importedNames.push(name);
		}

		return json({
			success: true,
			importedCount: importedNames.length,
			domain: targetDomain,
			names: importedNames
		});
	}

	// 3. Regular single blacklist entry creation
	const pattern = (body.pattern as string)?.trim().toLowerCase();
	const domain = (body.domain as string)?.trim().toLowerCase() || undefined;
	const description = body.description as string | undefined;

	if (!pattern) {
		return json({ error: 'Pattern is required' }, { status: 400 });
	}

	const entry: BlacklistEntry = {
		id: `${domain || 'global'}:${pattern}`,
		pattern,
		domain,
		source: 'manual',
		description,
		createdAt: Date.now()
	};

	await putBlacklist(locals.kv, entry);
	return json(entry, { status: 201 });
};
