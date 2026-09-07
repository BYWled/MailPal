/**
 * Cloudflare API Client for fetching Zone and DNS records directly from Cloudflare.
 * Used for automated DNS anti-conflict synchronization with MailPal alias blacklists.
 */

export interface CloudflareDnsRecord {
	id: string;
	type: string;
	name: string;
	content: string;
	proxied?: boolean;
	ttl?: number;
}

export interface CloudflareZoneInfo {
	id: string;
	name: string;
	status: string;
}

export interface CloudflareFetchDnsResult {
	domain: string;
	zoneId: string;
	records: CloudflareDnsRecord[];
	extractedNames: string[];
	totalRecords: number;
}

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

/**
 * Searches for a Cloudflare Zone by domain name.
 * If the exact domain is a subdomain, attempts to find the parent root zone.
 */
export async function findZoneForDomain(
	token: string,
	domain: string
): Promise<CloudflareZoneInfo | null> {
	const cleanDomain = domain.toLowerCase().trim().replace(/\.+$/, '');
	const domainParts = cleanDomain.split('.');

	// Try progressively from exact domain to parent domains (e.g. mail.wled.top -> wled.top)
	for (let i = 0; i <= domainParts.length - 2; i++) {
		const candidate = domainParts.slice(i).join('.');
		const url = `${CF_API_BASE}/zones?name=${encodeURIComponent(candidate)}&status=active`;
		const res = await fetch(url, {
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json'
			}
		});

		if (!res.ok) {
			const errBody = await res.json().catch(() => ({}));
			const errMsg = errBody.errors?.[0]?.message || `Cloudflare API error (${res.status})`;
			throw new Error(errMsg);
		}

		const data = (await res.json()) as {
			success: boolean;
			result: CloudflareZoneInfo[];
			errors?: Array<{ message: string }>;
		};

		if (data.success && data.result && data.result.length > 0) {
			return data.result[0];
		}
	}

	return null;
}

/**
 * Fetches all DNS records for a given Zone ID using Cloudflare API v4.
 */
export async function fetchAllDnsRecords(
	token: string,
	zoneId: string
): Promise<CloudflareDnsRecord[]> {
	let page = 1;
	const perPage = 500;
	let allRecords: CloudflareDnsRecord[] = [];
	let hasMore = true;

	while (hasMore) {
		const url = `${CF_API_BASE}/zones/${encodeURIComponent(zoneId)}/dns_records?per_page=${perPage}&page=${page}`;
		const res = await fetch(url, {
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json'
			}
		});

		if (!res.ok) {
			const errBody = await res.json().catch(() => ({}));
			const errMsg = errBody.errors?.[0]?.message || `Cloudflare API error (${res.status})`;
			throw new Error(errMsg);
		}

		const data = (await res.json()) as {
			success: boolean;
			result: CloudflareDnsRecord[];
			result_info?: { page: number; total_pages: number; count: number };
		};

		if (!data.success) {
			throw new Error('Failed to retrieve DNS records from Cloudflare API');
		}

		allRecords = allRecords.concat(data.result);

		if (data.result_info && page < data.result_info.total_pages) {
			page++;
		} else {
			hasMore = false;
		}
	}

	return allRecords;
}

/**
 * Extracts hostname and subdomain prefixes from Cloudflare DNS records to prevent alias conflict.
 */
export function extractHostnamesFromDns(domain: string, records: CloudflareDnsRecord[]): string[] {
	const cleanDomain = domain.toLowerCase().trim().replace(/\.+$/, '');
	const extracted = new Set<string>();

	for (const rec of records) {
		if (!rec.name) continue;
		const cleanName = rec.name.toLowerCase().trim().replace(/\.+$/, '');

		// Skip apex domain
		if (cleanName === cleanDomain) continue;

		let localPart: string | null = null;
		if (cleanName.endsWith(`.${cleanDomain}`)) {
			localPart = cleanName.slice(0, -(cleanDomain.length + 1));
		} else if (!cleanName.includes('.')) {
			localPart = cleanName;
		}

		if (localPart) {
			const normalized = localPart.toLowerCase().trim();
			if (/^[a-z0-9._+-]+$/.test(normalized)) {
				extracted.add(normalized);
			}
		}
	}

	return Array.from(extracted).sort();
}

/**
 * High-level helper: Given a domain and Cloudflare API token,
 * automatically locates the zone, downloads all DNS records, and extracts blacklist names.
 */
export async function fetchAndExtractDnsRecords(
	domain: string,
	token: string
): Promise<CloudflareFetchDnsResult> {
	const zone = await findZoneForDomain(token, domain);
	if (!zone) {
		throw new Error(`Zone for domain "${domain}" not found in your Cloudflare account.`);
	}

	const records = await fetchAllDnsRecords(token, zone.id);
	const extractedNames = extractHostnamesFromDns(domain, records);

	return {
		domain,
		zoneId: zone.id,
		records,
		extractedNames,
		totalRecords: records.length
	};
}

/**
 * Lists all active Zones associated with the Cloudflare API token.
 */
export async function listAllZones(token: string): Promise<CloudflareZoneInfo[]> {
	let page = 1;
	const perPage = 50;
	let allZones: CloudflareZoneInfo[] = [];
	let hasMore = true;

	while (hasMore) {
		const url = `${CF_API_BASE}/zones?status=active&per_page=${perPage}&page=${page}`;
		const res = await fetch(url, {
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json'
			}
		});

		if (!res.ok) {
			const errBody = (await res.json().catch(() => ({}))) as any;
			const errMsg = errBody.errors?.[0]?.message || `Cloudflare API error (${res.status})`;
			throw new Error(errMsg);
		}

		const data = (await res.json()) as {
			success: boolean;
			result: CloudflareZoneInfo[];
			result_info?: { page: number; total_pages: number; count: number };
		};

		if (!data.success) {
			throw new Error('Failed to retrieve zones from Cloudflare API');
		}

		allZones = allZones.concat(data.result);

		if (data.result_info && page < data.result_info.total_pages) {
			page++;
		} else {
			hasMore = false;
		}
	}

	return allZones;
}

/**
 * Fully synchronizes all domains and DNS records from Cloudflare:
 * 1. Discovers all active zones in Cloudflare account;
 * 2. Registers any missing domains in MailPal;
 * 3. Fetches DNS records for each zone and upserts anti-conflict blacklist rules;
 * 4. Records sync status and statistics in KV system settings.
 */
export async function syncCloudflareDomainsAndDns(
	kv: import('@cloudflare/workers-types').KVNamespace,
	token: string,
	ownerUsername?: string
): Promise<import('./types.js').SyncStatus> {
	const { listDomains, putDomain, listBlacklist, putBlacklist, getSystemSettings, putSystemSettings } = await import(
		'./kv.js'
	);

	try {
		const zones = await listAllZones(token);
		const [existingDomains, existingBlacklist] = await Promise.all([
			listDomains(kv),
			listBlacklist(kv)
		]);

		const existingDomainMap = new Map<string, import('./types.js').DomainConfig>();
		for (const d of existingDomains) {
			existingDomainMap.set(d.domain.toLowerCase(), d);
		}

		const existingBlacklistIds = new Set<string>();
		for (const b of existingBlacklist) {
			existingBlacklistIds.add(b.id.toLowerCase().trim());
			// Also index domain:pattern if id format differs
			if (b.domain && b.pattern) {
				existingBlacklistIds.add(`${b.domain.toLowerCase().trim()}:${b.pattern.toLowerCase().trim()}`);
			}
		}

		let newDomainsAddedCount = 0;
		let syncedDnsRulesCount = 0;

		for (const zone of zones) {
			const domainName = zone.name.toLowerCase().trim().replace(/\.+$/, '');
			if (!domainName) continue;

			// 1. If domain does not exist in MailPal, register it
			if (!existingDomainMap.has(domainName)) {
				const fallbackEmail = ownerUsername
					? `${ownerUsername}@${domainName}`
					: `admin@${domainName}`;
				const newDomain: import('./types.js').DomainConfig = {
					domain: domainName,
					targetEmail: fallbackEmail,
					wildcardEnabled: false,
					enabled: true,
					createdAt: Date.now(),
					ownerUsername: ownerUsername || 'admin'
				};
				await putDomain(kv, newDomain);
				existingDomainMap.set(domainName, newDomain);
				newDomainsAddedCount++;
			}

			// 2. Fetch all DNS records for this zone and extract subdomains
			const records = await fetchAllDnsRecords(token, zone.id);
			const names = extractHostnamesFromDns(domainName, records);

			// 3. Upsert into blacklist only if not already existing
			const now = Date.now();
			for (const name of names) {
				const ruleKey = `${domainName}:${name}`.toLowerCase().trim();
				if (!existingBlacklistIds.has(ruleKey)) {
					const entry: import('./types.js').BlacklistEntry = {
						id: `${domainName}:${name}`,
						pattern: name,
						domain: domainName,
						source: 'cloudflare_api',
						description: `Auto-synced from Cloudflare DNS records for ${domainName}`,
						createdAt: now
					};
					await putBlacklist(kv, entry);
					existingBlacklistIds.add(ruleKey);
					syncedDnsRulesCount++;
				}
			}
		}

		const status: import('./types.js').SyncStatus = {
			lastSyncTime: Date.now(),
			lastSyncResult: 'success',
			lastSyncMessage: `Synced ${zones.length} domain(s), added ${newDomainsAddedCount} new domain(s), and updated ${syncedDnsRulesCount} DNS anti-conflict rule(s).`,
			syncedZonesCount: zones.length,
			newDomainsAddedCount,
			syncedDnsRulesCount
		};

		const settings = await getSystemSettings(kv);
		await putSystemSettings(kv, {
			...settings,
			lastSyncStatus: status
		});

		return status;
	} catch (err: any) {
		const errorStatus: import('./types.js').SyncStatus = {
			lastSyncTime: Date.now(),
			lastSyncResult: 'error',
			lastSyncMessage: err?.message || 'Failed to sync with Cloudflare API',
			syncedZonesCount: 0,
			newDomainsAddedCount: 0,
			syncedDnsRulesCount: 0
		};

		try {
			const settings = await getSystemSettings(kv);
			await putSystemSettings(kv, {
				...settings,
				lastSyncStatus: errorStatus
			});
		} catch {
			// ignore secondary kv error
		}

		throw err;
	}
}

export interface CloudflareDestinationAddress {
	id: string;
	email: string;
	verified: string | null; // ISO timestamp if verified, null if pending
	created: string;
	modified?: string;
}

/**
 * Resolves the Cloudflare Account ID for the provided API token.
 * Tries GET /accounts first, then falls back to extracting account.id from GET /zones.
 */
export async function getCloudflareAccountId(
	token: string,
	preferredAccountId?: string | null
): Promise<string | null> {
	if (preferredAccountId?.trim()) {
		return preferredAccountId.trim();
	}

	const cleanToken = token.trim();
	if (!cleanToken) return null;

	// 1. Try GET /accounts
	try {
		const res = await fetch(`${CF_API_BASE}/accounts?per_page=20`, {
			headers: {
				Authorization: `Bearer ${cleanToken}`,
				'Content-Type': 'application/json'
			}
		});
		if (res.ok) {
			const body = (await res.json().catch(() => ({}))) as any;
			if (body.success && Array.isArray(body.result) && body.result.length > 0 && body.result[0].id) {
				return body.result[0].id;
			}
		}
	} catch {
		// fallback to zones
	}

	// 2. Fallback: try GET /zones
	try {
		const res = await fetch(`${CF_API_BASE}/zones?status=active&per_page=20`, {
			headers: {
				Authorization: `Bearer ${cleanToken}`,
				'Content-Type': 'application/json'
			}
		});
		if (res.ok) {
			const body = (await res.json().catch(() => ({}))) as any;
			if (body.success && Array.isArray(body.result) && body.result.length > 0 && body.result[0].account?.id) {
				return body.result[0].account.id;
			}
		}
	} catch {
		// ignore
	}

	return null;
}

/**
 * Lists all destination addresses configured in Cloudflare Email Routing for an account.
 */
export async function listCloudflareDestinationAddresses(
	token: string,
	accountId: string
): Promise<CloudflareDestinationAddress[]> {
	let page = 1;
	const perPage = 50;
	let all: CloudflareDestinationAddress[] = [];
	let hasMore = true;

	while (hasMore) {
		const url = `${CF_API_BASE}/accounts/${encodeURIComponent(accountId)}/email/routing/addresses?per_page=${perPage}&page=${page}`;
		const res = await fetch(url, {
			headers: {
				Authorization: `Bearer ${token.trim()}`,
				'Content-Type': 'application/json'
			}
		});

		if (!res.ok) {
			const errBody = (await res.json().catch(() => ({}))) as any;
			const firstErr = errBody.errors?.[0];
			const isAuth =
				res.status === 401 ||
				res.status === 403 ||
				firstErr?.code === 10000 ||
				firstErr?.message?.includes('Authentication error');

			const rawMsg = firstErr?.message || `Cloudflare API error (${res.status})`;
			const errCode = firstErr?.code ? ` [Code ${firstErr.code}]` : '';

			let errMsg = `Cloudflare API 错误 (${res.status})${errCode}: ${rawMsg}`;
			if (isAuth) {
				errMsg = `Cloudflare API 鉴权失败 (${res.status})${errCode}: ${rawMsg} (访问的目标 Account ID: ${accountId})。请检查：1. 您的 Token 资源范围（Account Resources）是否包含了该 Account ID；2. 是否在管理后台设置了正确的 Cloudflare Account ID；3. Token 权限是否包含「Account -> Email Routing Addresses: Read/Edit」。`;
			}
			const error = new Error(errMsg);
			(error as any).isAuthError = isAuth;
			(error as any).status = res.status;
			(error as any).accountId = accountId;
			(error as any).rawError = errBody;
			throw error;
		}

		const body = (await res.json()) as {
			success: boolean;
			result: CloudflareDestinationAddress[];
			result_info?: { page: number; total_pages: number; count: number };
		};

		if (!body.success) {
			throw new Error('Failed to retrieve destination addresses from Cloudflare API');
		}

		all = all.concat(body.result || []);

		if (body.result_info && page < body.result_info.total_pages) {
			page++;
		} else {
			hasMore = false;
		}
	}

	return all;
}

/**
 * Submits a destination address to Cloudflare Email Routing and triggers an automated verification email.
 */
export async function createCloudflareDestinationAddress(
	token: string,
	accountId: string,
	email: string
): Promise<CloudflareDestinationAddress> {
	const cleanEmail = email.toLowerCase().trim();
	const url = `${CF_API_BASE}/accounts/${encodeURIComponent(accountId)}/email/routing/addresses`;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token.trim()}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ email: cleanEmail })
	});

	const body = (await res.json().catch(() => ({}))) as any;
	if (!res.ok || !body.success) {
		const firstErr = body.errors?.[0];
		const isAuth =
			res.status === 401 ||
			res.status === 403 ||
			firstErr?.code === 10000 ||
			firstErr?.message?.includes('Authentication error');
		const rawMsg = firstErr?.message || `Failed to add destination address to Cloudflare (${res.status})`;
		const errCode = firstErr?.code ? ` [Code ${firstErr.code}]` : '';

		let errMsg = `Cloudflare API 错误 (${res.status})${errCode}: ${rawMsg}`;
		if (isAuth) {
			errMsg = `Cloudflare API 鉴权失败 (${res.status})${errCode}: ${rawMsg} (访问的目标 Account ID: ${accountId})。请检查当前 Token 是否包含「Account -> Email Routing Addresses: Edit」权限且资源覆盖了该 Account ID。`;
		}
		const error = new Error(errMsg);
		(error as any).isAuthError = isAuth;
		(error as any).status = res.status;
		(error as any).accountId = accountId;
		(error as any).rawError = body;
		throw error;
	}

	return body.result as CloudflareDestinationAddress;
}

/**
 * Helper to resolve the active Cloudflare API Token.
 * Settings configured in Web Admin Console take precedence over environment secrets.
 */
export function resolveCloudflareToken(
	platform: App.Platform | undefined,
	settings: import('./types.js').SystemSettings,
	explicitToken?: string
): string | null {
	if (explicitToken?.trim()) return explicitToken.trim();
	if (settings.cfApiToken?.trim()) return settings.cfApiToken.trim();
	const envToken = platform?.env?.CF_API_TOKEN || platform?.env?.CLOUDFLARE_API_TOKEN;
	if (envToken?.trim()) return envToken.trim();
	return null;
}

/**
 * Helper to resolve the active Cloudflare Account ID.
 */
export function resolveCloudflareAccountId(
	platform: App.Platform | undefined,
	settings: import('./types.js').SystemSettings,
	explicitAccountId?: string
): string | null {
	if (explicitAccountId?.trim()) return explicitAccountId.trim();
	if (settings.cfAccountId?.trim()) return settings.cfAccountId.trim();
	const envAccountId = platform?.env?.CF_ACCOUNT_ID || platform?.env?.CLOUDFLARE_ACCOUNT_ID;
	if (envAccountId?.trim()) return envAccountId.trim();
	return null;
}

