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
