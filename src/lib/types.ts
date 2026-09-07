export interface DomainConfig {
	domain: string;
	targetEmail: string;
	wildcardEnabled: boolean;
	enabled: boolean;
	createdAt: number;
	color?: string;
	ownerUsername?: string; // username of the user who owns this domain
}

export interface DestinationAddress {
	email: string;
	createdAt: number;
	createdBy?: string; // username of user who added this destination
	verified?: boolean; // true if verified in Cloudflare Email Routing
	verificationStatus?: 'verified' | 'pending' | 'not_in_cf' | 'no_token';
}

export interface Tag {
	name: string;
	color: string; // hex, e.g. "#3b82f6"
	createdAt: number;
}

export interface LogEntry {
	at: number;             // Unix ms
	action: 'forwarded' | 'blocked';
	from: string;           // sender address
	to: string;             // destination / would-be destination
}

export interface AliasConfig {
	localPart: string;
	domain: string;
	targetEmail: string | null; // null = inherit from domain
	enabled: boolean;
	createdAt: number;
	forwardedCount: number;
	blockedCount: number;
	lastUsedAt: number | null;
	autoCreated: boolean;
	note?: string;
	tags?: string[];
	expiresAt?: number;    // Unix ms — worker rejects after this timestamp
	maxForwards?: number;  // worker auto-disables when forwardedCount >= this
	createdBy?: string;    // username of the creator
	isOtherUser?: boolean; // true if this alias belongs to another user (for privacy masking)
}

export interface User {
	username: string; // unique lowercase username
	passwordHash: string; // PBKDF2 hash: pbkdf2$iterations$salt$hash
	role: 'superadmin' | 'user';
	createdAt: number;
	updatedAt?: number;
	maxAliases?: number; // fallback/default per-user quota across domains
	domainQuotas?: Record<string, number>; // per-domain quota map: { [domain]: maxAliases }
	twoFactorSecret?: string; // base32 TOTP secret
	twoFactorEnabled: boolean;
}

export interface SyncStatus {
	lastSyncTime: number;
	lastSyncResult: 'success' | 'error';
	lastSyncMessage: string;
	syncedZonesCount: number;
	newDomainsAddedCount: number;
	syncedDnsRulesCount: number;
}

export interface SystemSettings {
	defaultUserAliasQuota: number; // default per-user alias quota (default: 20)
	maxAliasesPerDomain: number; // max aliases per domain (default: 50)
	cfApiToken?: string; // Cloudflare API token for fetching DNS records
	autoSyncEnabled?: boolean; // periodic auto-sync enabled
	autoSyncIntervalHours?: number; // interval in hours (1, 6, 12, 24; default: 6)
	lastSyncStatus?: SyncStatus;
}

export interface BlacklistEntry {
	id: string; // unique ID e.g. `${domain || 'global'}:${pattern}`
	pattern: string; // blacklisted local-part pattern (lowercase)
	domain?: string; // specific domain or undefined/empty for global
	source?: 'manual' | 'dns_import' | 'cloudflare_api';
	description?: string;
	createdAt: number;
}
