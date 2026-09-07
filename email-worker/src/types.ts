export interface DomainConfig {
	domain: string;
	targetEmail: string;
	wildcardEnabled: boolean;
	enabled: boolean;
	createdAt: number;
	color?: string;
	ownerUsername?: string;
}

export interface AliasConfig {
	localPart: string;
	domain: string;
	targetEmail: string | null;
	enabled: boolean;
	createdAt: number;
	forwardedCount: number;
	blockedCount: number;
	lastUsedAt: number | null;
	autoCreated: boolean;
	note?: string;
	tags?: string[];
	expiresAt?: number;
	maxForwards?: number;
	createdBy?: string;
	isOtherUser?: boolean;
}
