/**
 * DNS Zone File Parser for BIND / Cloudflare exported DNS records.
 * Parses resource records (A, AAAA, CNAME, TXT, MX, etc.) to extract
 * hostname / subdomain prefixes as blacklisted alias local-parts.
 */

export interface DnsParseResult {
	domain: string | null;
	extractedNames: string[];
	totalRecordsFound: number;
}

export function parseDnsZone(zoneText: string, fallbackDomain?: string): DnsParseResult {
	let detectedDomain: string | null = null;
	const extractedSet = new Set<string>();
	let totalRecordsFound = 0;

	// 1. Try to detect domain from comments or $ORIGIN
	// Example header: ";; Domain:     wled.top."
	const domainHeaderMatch = zoneText.match(/^;;\s*Domain:\s*([^\s;]+)/mi);
	if (domainHeaderMatch && domainHeaderMatch[1]) {
		detectedDomain = domainHeaderMatch[1].trim().replace(/\.+$/, '').toLowerCase();
	}

	const originMatch = zoneText.match(/^\$ORIGIN\s+([^\s;]+)/mi);
	if (!detectedDomain && originMatch && originMatch[1]) {
		detectedDomain = originMatch[1].trim().replace(/\.+$/, '').toLowerCase();
	}

	// 2. Parse lines
	const lines = zoneText.split(/\r?\n/);
	const dnsTypes = new Set([
		'A',
		'AAAA',
		'CNAME',
		'MX',
		'TXT',
		'NS',
		'SOA',
		'SRV',
		'PTR',
		'CAA',
		'HTTPS',
		'SVCB'
	]);

	for (const rawLine of lines) {
		const trimmed = rawLine.trim();
		if (!trimmed) continue;

		// Check SOA line for domain if still unknown
		if (!detectedDomain) {
			const soaMatch = trimmed.match(/^([^\s;]+)\s+(?:\d+\s+)?(?:IN\s+)?SOA/i);
			if (soaMatch && soaMatch[1]) {
				detectedDomain = soaMatch[1].trim().replace(/\.+$/, '').toLowerCase();
			}
		}

		// Skip comments
		if (trimmed.startsWith(';') || trimmed.startsWith('#')) continue;

		// Remove trailing comment
		const contentWithoutComment = rawLine.split(';')[0].trim();
		if (!contentWithoutComment) continue;

		const tokens = contentWithoutComment.split(/\s+/);
		if (tokens.length < 2) continue;

		// Check if one of tokens is a valid DNS record type
		const typeIdx = tokens.findIndex((t) => dnsTypes.has(t.toUpperCase()));
		if (typeIdx === -1) continue;

		totalRecordsFound++;

		// First token is usually the domain/hostname
		const rawName = tokens[0].toLowerCase();
		if (rawName === '@') continue;

		const cleanName = rawName.replace(/\.+$/, '');
		const targetDomain = detectedDomain || fallbackDomain?.toLowerCase().replace(/\.+$/, '');

		let localPart: string | null = null;

		if (targetDomain) {
			if (cleanName === targetDomain) {
				// Apex domain record (e.g. wled.top.)
				continue;
			}
			if (cleanName.endsWith(`.${targetDomain}`)) {
				localPart = cleanName.slice(0, -(targetDomain.length + 1));
			} else if (!cleanName.includes('.')) {
				localPart = cleanName;
			}
		} else {
			// No target domain known, take the first label if it looks like a subdomain
			const parts = cleanName.split('.');
			if (parts.length > 1) {
				localPart = parts[0];
			} else {
				localPart = cleanName;
			}
		}

		if (localPart) {
			// Clean and normalize
			const normalized = localPart.toLowerCase().trim();
			// Ensure valid email local-part characters
			if (/^[a-z0-9._+-]+$/.test(normalized)) {
				extractedSet.add(normalized);
			}
		}
	}

	const extractedNames = Array.from(extractedSet).sort();

	return {
		domain: detectedDomain || fallbackDomain || null,
		extractedNames,
		totalRecordsFound
	};
}
