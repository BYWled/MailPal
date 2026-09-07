<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type TabType = 'users' | 'domains' | 'blacklist' | 'settings';
	let activeTab = $state<TabType>('users');

	// Local reactive state
	let users = $state(data.users);
	let domains = $state(data.domains);
	let blacklist = $state(data.blacklist);
	let settings = $state(data.settings);

	// User creation modal state
	let showCreateUserModal = $state(false);
	let newUsername = $state('');
	let newPassword = $state('');
	let newMaxAliases = $state('');
	let createUserError = $state('');
	let creatingUser = $state(false);

	// Edit user quota modal state
	let editingUser = $state<any | null>(null);
	let editQuotaValue = $state<number | string>('');
	let savingQuota = $state(false);

	// Reset password modal state
	let resettingUser = $state<any | null>(null);
	let resetNewPassword = $state('');
	let resettingPassword = $state(false);
	let resetPasswordMsg = $state('');

	// DNS Import state
	let zoneInputText = $state('');
	let parsingDns = $state(false);
	let dnsPreview = $state<{ domain: string | null; names: string[]; totalRecords: number } | null>(null);
	let dnsImportDomain = $state<string>('');
	let importingDns = $state(false);
	let dnsSuccessMsg = $state('');
	let dnsErrorMsg = $state('');

	// Cloudflare API Auto-fetch state
	let cfFetchDomain = $state(data.domains.length > 0 ? data.domains[0].domain : '');
	let cfApiTokenInput = $state('');
	let fetchingCfDns = $state(false);
	let cfDnsResult = $state<{ zoneId: string; zoneName: string; totalRecords: number; extractedNames: string[] } | null>(null);
	let importingCfDns = $state(false);
	let cfDnsSuccessMsg = $state('');
	let cfDnsErrorMsg = $state('');

	// Manual blacklist state
	let manualPattern = $state('');
	let manualDomain = $state('');
	let manualDesc = $state('');
	let addingManual = $state(false);
	let manualError = $state('');

	// Settings state
	let defaultQuotaInput = $state(data.settings.defaultUserAliasQuota);
	let cfTokenSettingInput = $state(data.settings.cfApiToken ?? '');
	let savingSettings = $state(false);
	let settingsSavedMsg = $state('');

	// ── Users Actions ────────────────────────────────────────────────────────
	async function handleCreateUser(e: Event) {
		e.preventDefault();
		createUserError = '';
		creatingUser = true;

		try {
			const res = await fetch('/api/admin/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					username: newUsername.trim(),
					password: newPassword,
					maxAliases: newMaxAliases ? Number(newMaxAliases) : null
				})
			});
			const body = await res.json();
			if (!res.ok) {
				createUserError = body.error ?? 'Failed to create user';
			} else {
				users = [
					...users,
					{
						username: body.username,
						role: body.role,
						createdAt: body.createdAt,
						maxAliases: body.maxAliases ?? settings.defaultUserAliasQuota,
						customQuota: body.maxAliases != null,
						aliasCount: 0,
						twoFactorEnabled: false
					}
				];
				showCreateUserModal = false;
				newUsername = '';
				newPassword = '';
				newMaxAliases = '';
			}
		} catch {
			createUserError = 'Network error';
		} finally {
			creatingUser = false;
		}
	}

	async function handleSaveQuota() {
		if (!editingUser) return;
		savingQuota = true;
		try {
			const val = editQuotaValue === '' ? null : Number(editQuotaValue);
			const res = await fetch(`/api/admin/users/${editingUser.username}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ maxAliases: val })
			});
			if (res.ok) {
				const updated = await res.json();
				users = users.map((u) =>
					u.username === editingUser.username
						? {
								...u,
								maxAliases: updated.maxAliases ?? settings.defaultUserAliasQuota,
								customQuota: updated.maxAliases != null
							}
						: u
				);
				editingUser = null;
			}
		} finally {
			savingQuota = false;
		}
	}

	async function handleResetPassword() {
		if (!resettingUser || !resetNewPassword) return;
		resettingPassword = true;
		resetPasswordMsg = '';
		try {
			const res = await fetch(`/api/admin/users/${resettingUser.username}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password: resetNewPassword })
			});
			if (res.ok) {
				resetPasswordMsg = 'Password updated successfully!';
				setTimeout(() => {
					resettingUser = null;
					resetNewPassword = '';
					resetPasswordMsg = '';
				}, 1200);
			} else {
				const body = await res.json();
				resetPasswordMsg = body.error ?? 'Failed to update password';
			}
		} finally {
			resettingPassword = false;
		}
	}

	async function handleDeleteUser(username: string) {
		if (username === data.currentUser?.username) {
			alert('You cannot delete your own superadmin account.');
			return;
		}
		if (!confirm(`Are you sure you want to delete user "${username}"?`)) return;

		const res = await fetch(`/api/admin/users/${username}`, { method: 'DELETE' });
		if (res.ok) {
			users = users.filter((u) => u.username !== username);
		} else {
			const body = await res.json();
			alert(body.error ?? 'Failed to delete user');
		}
	}

	// ── Domains Actions ──────────────────────────────────────────────────────
	async function handleDeleteDomain(domain: string) {
		if (!confirm(`Delete domain "${domain}" and all its aliases? This action cannot be undone.`)) return;
		const res = await fetch(`/api/domains/${encodeURIComponent(domain)}`, { method: 'DELETE' });
		if (res.ok) {
			domains = domains.filter((d) => d.domain !== domain);
		} else {
			alert('Failed to delete domain');
		}
	}

	async function handleToggleDomain(d: any) {
		const res = await fetch(`/api/domains/${encodeURIComponent(d.domain)}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ enabled: !d.enabled })
		});
		if (res.ok) {
			const updated = await res.json();
			domains = domains.map((item) => (item.domain === d.domain ? { ...item, enabled: updated.enabled } : item));
		}
	}

	// ── DNS Blacklist Import ─────────────────────────────────────────────────
	async function handlePreviewDns() {
		if (!zoneInputText.trim()) return;
		parsingDns = true;
		dnsErrorMsg = '';
		dnsSuccessMsg = '';
		try {
			const res = await fetch('/api/admin/blacklist', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'dns_preview',
					zoneText: zoneInputText,
					domain: dnsImportDomain || undefined
				})
			});
			const body = await res.json();
			if (!res.ok) {
				dnsErrorMsg = body.error ?? 'Failed to parse DNS records';
			} else {
				dnsPreview = body;
				if (body.domain && !dnsImportDomain) {
					dnsImportDomain = body.domain;
				}
			}
		} catch {
			dnsErrorMsg = 'Failed to parse DNS records';
		} finally {
			parsingDns = false;
		}
	}

	async function handleConfirmDnsImport() {
		if (!zoneInputText.trim()) return;
		importingDns = true;
		dnsErrorMsg = '';
		dnsSuccessMsg = '';
		try {
			const res = await fetch('/api/admin/blacklist', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'dns_import',
					zoneText: zoneInputText,
					domain: dnsImportDomain || undefined
				})
			});
			const body = await res.json();
			if (!res.ok) {
				dnsErrorMsg = body.error ?? 'Failed to import DNS blacklist';
			} else {
				dnsSuccessMsg = `Successfully imported ${body.importedCount} blacklist entries!`;
				// Refresh blacklist list
				const fresh = await fetch('/api/admin/blacklist');
				if (fresh.ok) {
					blacklist = await fresh.json();
				}
				dnsPreview = null;
				zoneInputText = '';
			}
		} catch {
			dnsErrorMsg = 'Failed to import DNS blacklist';
		} finally {
			importingDns = false;
		}
	}

	// ── Cloudflare API Auto-fetch Actions ─────────────────────────────────────
	async function handleFetchCfDns() {
		if (!cfFetchDomain.trim()) return;
		fetchingCfDns = true;
		cfDnsErrorMsg = '';
		cfDnsSuccessMsg = '';
		cfDnsResult = null;
		try {
			const res = await fetch('/api/admin/blacklist', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'cf_fetch',
					domain: cfFetchDomain.trim(),
					apiToken: cfApiTokenInput.trim() || undefined
				})
			});
			const body = await res.json();
			if (!res.ok) {
				cfDnsErrorMsg = body.error ?? 'Failed to fetch DNS records from Cloudflare API';
			} else {
				cfDnsResult = body;
			}
		} catch {
			cfDnsErrorMsg = 'Network error while contacting Cloudflare API';
		} finally {
			fetchingCfDns = false;
		}
	}

	async function handleImportCfDns() {
		if (!cfDnsResult || !cfFetchDomain.trim()) return;
		importingCfDns = true;
		cfDnsErrorMsg = '';
		cfDnsSuccessMsg = '';
		try {
			const res = await fetch('/api/admin/blacklist', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'cf_import',
					domain: cfFetchDomain.trim(),
					apiToken: cfApiTokenInput.trim() || undefined,
					names: cfDnsResult.extractedNames
				})
			});
			const body = await res.json();
			if (!res.ok) {
				cfDnsErrorMsg = body.error ?? 'Failed to import Cloudflare DNS blacklist';
			} else {
				cfDnsSuccessMsg = `Successfully imported ${body.importedCount} blacklist entries from Cloudflare DNS!`;
				// Refresh blacklist list
				const fresh = await fetch('/api/admin/blacklist');
				if (fresh.ok) {
					blacklist = await fresh.json();
				}
				cfDnsResult = null;
			}
		} catch {
			cfDnsErrorMsg = 'Failed to import DNS blacklist';
		} finally {
			importingCfDns = false;
		}
	}

	// ── Manual Blacklist Add / Delete ────────────────────────────────────────
	async function handleAddManual(e: Event) {
		e.preventDefault();
		if (!manualPattern.trim()) return;
		addingManual = true;
		manualError = '';
		try {
			const res = await fetch('/api/admin/blacklist', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					pattern: manualPattern.trim(),
					domain: manualDomain.trim() || undefined,
					description: manualDesc.trim() || undefined
				})
			});
			const body = await res.json();
			if (!res.ok) {
				manualError = body.error ?? 'Failed to add rule';
			} else {
				blacklist = [body, ...blacklist];
				manualPattern = '';
				manualDomain = '';
				manualDesc = '';
			}
		} catch {
			manualError = 'Network error';
		} finally {
			addingManual = false;
		}
	}

	async function handleDeleteBlacklist(id: string) {
		const res = await fetch(`/api/admin/blacklist/${encodeURIComponent(id)}`, { method: 'DELETE' });
		if (res.ok) {
			blacklist = blacklist.filter((b) => b.id !== id);
		}
	}

	// ── Settings Save ────────────────────────────────────────────────────────
	async function handleSaveSettings(e: Event) {
		e.preventDefault();
		savingSettings = true;
		settingsSavedMsg = '';
		try {
			const res = await fetch('/api/admin/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					defaultUserAliasQuota: Number(defaultQuotaInput),
					maxAliasesPerDomain: 50,
					cfApiToken: cfTokenSettingInput.trim() || null
				})
			});
			if (res.ok) {
				const body = await res.json();
				settings = body;
				settingsSavedMsg = 'Settings saved successfully!';
				setTimeout(() => {
					settingsSavedMsg = '';
				}, 2500);
			}
		} finally {
			savingSettings = false;
		}
	}
</script>

<svelte:head>
	<title>Admin Console — MailPal</title>
</svelte:head>

<div class="min-h-screen bg-app-bg text-app-text flex flex-col">
	<!-- Top Bar -->
	<header class="border-b border-app-border bg-app-surface px-6 py-4 flex items-center justify-between">
		<div class="flex items-center gap-3">
			<a href="/" class="p-1.5 rounded-lg hover:bg-app-hover text-app-muted hover:text-app-text transition-colors" title="Back to Dashboard">
				<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
				</svg>
			</a>
			<div>
				<div class="flex items-center gap-2">
					<h1 class="text-lg font-bold">MailPal Admin Console</h1>
					<span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-app-accent/20 text-app-accent">
						SUPERADMIN
					</span>
				</div>
				<p class="text-xs text-app-muted">System management, user quotas, domains & DNS blacklist</p>
			</div>
		</div>

		<div class="flex items-center gap-3">
			<span class="text-xs text-app-muted">
				Signed in as <strong class="text-app-text">{data.currentUser?.username}</strong>
			</span>
			<a
				href="/"
				class="px-3 py-1.5 rounded-lg border border-app-border bg-app-surface hover:bg-app-hover text-xs font-medium transition-colors"
			>
				Open MailPal Dashboard →
			</a>
		</div>
	</header>

	<!-- Main Container -->
	<div class="max-w-6xl w-full mx-auto p-6 flex-1 flex flex-col">
		<!-- Navigation Tabs -->
		<div class="flex items-center gap-2 border-b border-app-border mb-6">
			<button
				onclick={() => (activeTab = 'users')}
				class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2
					{activeTab === 'users' ? 'border-app-accent text-app-accent' : 'border-transparent text-app-muted hover:text-app-text'}"
			>
				<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
				</svg>
				User Accounts & Quotas ({users.length})
			</button>

			<button
				onclick={() => (activeTab = 'domains')}
				class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2
					{activeTab === 'domains' ? 'border-app-accent text-app-accent' : 'border-transparent text-app-muted hover:text-app-text'}"
			>
				<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
				</svg>
				All Domains ({domains.length})
			</button>

			<button
				onclick={() => (activeTab = 'blacklist')}
				class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2
					{activeTab === 'blacklist' ? 'border-app-accent text-app-accent' : 'border-transparent text-app-muted hover:text-app-text'}"
			>
				<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
				</svg>
				DNS Anti-Conflict & Blacklist ({blacklist.length})
			</button>

			<button
				onclick={() => (activeTab = 'settings')}
				class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2
					{activeTab === 'settings' ? 'border-app-accent text-app-accent' : 'border-transparent text-app-muted hover:text-app-text'}"
			>
				<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
				</svg>
				Settings
			</button>
		</div>

		<!-- Tab 1: Users & Quotas -->
		{#if activeTab === 'users'}
			<div class="space-y-4">
				<div class="flex items-center justify-between">
					<div>
						<h2 class="text-base font-semibold">User Accounts</h2>
						<p class="text-xs text-app-muted">
							Create users, adjust alias creation quotas, and manage authentication.
						</p>
					</div>
					<button
						onclick={() => (showCreateUserModal = true)}
						class="px-3.5 py-2 rounded-lg bg-app-accent hover:brightness-110 text-app-bg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md"
					>
						<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
						</svg>
						Create User
					</button>
				</div>

				<div class="bg-app-surface border border-app-border rounded-xl overflow-hidden shadow">
					<table class="w-full text-left text-sm">
						<thead class="bg-app-hover/50 text-xs text-app-muted uppercase tracking-wider border-b border-app-border">
							<tr>
								<th class="px-4 py-3 font-semibold">Username</th>
								<th class="px-4 py-3 font-semibold">Role</th>
								<th class="px-4 py-3 font-semibold">Alias Usage / Quota</th>
								<th class="px-4 py-3 font-semibold">2FA Status</th>
								<th class="px-4 py-3 font-semibold">Created</th>
								<th class="px-4 py-3 font-semibold text-right">Actions</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-app-border/50">
							{#each users as u (u.username)}
								<tr class="hover:bg-app-hover/30 transition-colors">
									<td class="px-4 py-3.5 font-medium flex items-center gap-2">
										<div class="w-7 h-7 rounded-full bg-app-accent/15 text-app-accent flex items-center justify-center text-xs font-bold uppercase">
											{u.username.slice(0, 2)}
										</div>
										<span>{u.username}</span>
										{#if u.username === data.currentUser?.username}
											<span class="text-[10px] text-app-muted font-normal">(You)</span>
										{/if}
									</td>
									<td class="px-4 py-3.5">
										{#if u.role === 'superadmin'}
											<span class="px-2 py-0.5 rounded text-xs font-semibold bg-purple-500/20 text-purple-400">
												Superadmin
											</span>
										{:else}
											<span class="px-2 py-0.5 rounded text-xs font-medium bg-slate-500/20 text-slate-300">
												User
											</span>
										{/if}
									</td>
									<td class="px-4 py-3.5">
										<div class="flex items-center gap-3">
											<div class="w-24 bg-app-hover rounded-full h-2 overflow-hidden">
												<div
													class="bg-app-accent h-full rounded-full transition-all"
													style="width: {Math.min(100, (u.aliasCount / (u.maxAliases || 1)) * 100)}%"
												></div>
											</div>
											<span class="text-xs font-mono">
												{u.aliasCount} / {u.maxAliases}
												{#if !u.customQuota}
													<span class="text-[10px] text-app-muted">(default)</span>
												{/if}
											</span>
										</div>
									</td>
									<td class="px-4 py-3.5">
										{#if u.twoFactorEnabled}
											<span class="inline-flex items-center gap-1 text-xs text-emerald-400">
												<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
												</svg>
												Bound
											</span>
										{:else}
											<span class="inline-flex items-center gap-1 text-xs text-amber-400">
												<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
												</svg>
												Pending 1st Login
											</span>
										{/if}
									</td>
									<td class="px-4 py-3.5 text-xs text-app-muted">
										{new Date(u.createdAt).toLocaleDateString()}
									</td>
									<td class="px-4 py-3.5 text-right space-x-2">
										<button
											onclick={() => {
												editingUser = u;
												editQuotaValue = u.customQuota ? u.maxAliases : '';
											}}
											class="text-xs text-app-accent hover:underline"
										>
											Edit Quota
										</button>

										<button
											onclick={() => {
												resettingUser = u;
												resetNewPassword = '';
											}}
											class="text-xs text-app-muted hover:text-app-text"
										>
											Password
										</button>

										{#if u.username !== data.currentUser?.username}
											<button
												onclick={() => handleDeleteUser(u.username)}
												class="text-xs text-red-400 hover:text-red-300"
											>
												Delete
											</button>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}

		<!-- Tab 2: Domains -->
		{#if activeTab === 'domains'}
			<div class="space-y-4">
				<div class="flex items-center justify-between">
					<div>
						<h2 class="text-base font-semibold">Cross-User Domain Management</h2>
						<p class="text-xs text-app-muted">
							As Superadmin, you can inspect, modify, and delete all users' domains.
							Each domain is strictly capped at <strong class="text-amber-400">50 aliases</strong> max.
						</p>
					</div>
				</div>

				<div class="bg-app-surface border border-app-border rounded-xl overflow-hidden shadow">
					<table class="w-full text-left text-sm">
						<thead class="bg-app-hover/50 text-xs text-app-muted uppercase tracking-wider border-b border-app-border">
							<tr>
								<th class="px-4 py-3 font-semibold">Domain</th>
								<th class="px-4 py-3 font-semibold">Owner</th>
								<th class="px-4 py-3 font-semibold">Aliases / 50 Limit</th>
								<th class="px-4 py-3 font-semibold">Default Target</th>
								<th class="px-4 py-3 font-semibold">Wildcard</th>
								<th class="px-4 py-3 font-semibold">Status</th>
								<th class="px-4 py-3 font-semibold text-right">Actions</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-app-border/50">
							{#each domains as d (d.domain)}
								<tr class="hover:bg-app-hover/30 transition-colors">
									<td class="px-4 py-3.5 font-medium">
										<a href="/domains/{d.domain}" class="hover:text-app-accent transition-colors flex items-center gap-1.5">
											<span class="w-2 h-2 rounded-full" style="background-color: {d.color || '#3b82f6'}"></span>
											{d.domain}
										</a>
									</td>
									<td class="px-4 py-3.5 text-xs">
										{#if d.ownerUsername}
											<span class="font-mono bg-app-hover px-2 py-0.5 rounded border border-app-border">
												{d.ownerUsername}
											</span>
										{:else}
											<span class="text-app-muted italic">System / Unassigned</span>
										{/if}
									</td>
									<td class="px-4 py-3.5">
										<div class="flex items-center gap-3">
											<div class="w-24 bg-app-hover rounded-full h-2 overflow-hidden">
												<div
													class="h-full rounded-full transition-all {d.aliasCount >= 50 ? 'bg-red-500' : 'bg-app-accent'}"
													style="width: {(d.aliasCount / 50) * 100}%"
												></div>
											</div>
											<span class="text-xs font-mono {d.aliasCount >= 50 ? 'text-red-400 font-bold' : ''}">
												{d.aliasCount} / 50
											</span>
										</div>
									</td>
									<td class="px-4 py-3.5 text-xs text-app-muted truncate max-w-[150px]">
										{d.targetEmail}
									</td>
									<td class="px-4 py-3.5 text-xs">
										{d.wildcardEnabled ? 'Enabled' : 'Disabled'}
									</td>
									<td class="px-4 py-3.5">
										<button
											onclick={() => handleToggleDomain(d)}
											class="text-xs px-2 py-0.5 rounded {d.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}"
										>
											{d.enabled ? 'Active' : 'Disabled'}
										</button>
									</td>
									<td class="px-4 py-3.5 text-right space-x-2">
										<a
											href="/domains/{d.domain}"
											class="text-xs text-app-accent hover:underline"
										>
											View Aliases
										</a>
										<button
											onclick={() => handleDeleteDomain(d.domain)}
											class="text-xs text-red-400 hover:text-red-300"
										>
											Delete
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}

		<!-- Tab 3: Blacklist & DNS Import -->
		{#if activeTab === 'blacklist'}
			<div class="space-y-6">
				<!-- Cloudflare API Auto-Sync Card -->
				<div class="bg-app-surface border border-orange-500/30 rounded-xl p-6 shadow relative overflow-hidden">
					<div class="absolute -top-10 -right-10 w-40 h-40 bg-orange-500/5 rounded-full blur-2xl pointer-events-none"></div>

					<div class="flex items-start justify-between mb-4">
						<div>
							<div class="flex items-center gap-2">
								<svg class="w-5 h-5 text-orange-400" viewBox="0 0 24 24" fill="currentColor">
									<path d="M18.8 9.5a5.5 5.5 0 00-10.6-1.5A5.002 5.002 0 003 13c0 2.76 2.24 5 5 5h10.5a4.5 4.5 0 00.3-9z" />
								</svg>
								<h3 class="text-sm font-bold text-app-text">Cloudflare API 自动同步 DNS 黑名单</h3>
								<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-orange-500/20 text-orange-400 border border-orange-500/30">
									Recommended
								</span>
							</div>
							<p class="text-xs text-app-muted mt-1">
								直接通过 Cloudflare API v4 读取该域名已解析的所有 DNS 子域名记录，自动提取前缀并加入防冲突黑名单。
							</p>
						</div>
					</div>

					<div class="space-y-4">
						<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<label for="cf-fetch-domain" class="block text-xs font-medium text-app-text mb-1">选择目标域名 *</label>
								<div class="relative">
									{#if domains.length > 0}
										<select
											id="cf-fetch-domain"
											bind:value={cfFetchDomain}
											class="w-full px-3 py-2 text-xs rounded-lg border border-app-border bg-app-hover text-app-text outline-none focus:border-orange-500"
										>
											{#each domains as d}
												<option value={d.domain}>{d.domain}</option>
											{/each}
										</select>
									{:else}
										<input
											id="cf-fetch-domain"
											type="text"
											bind:value={cfFetchDomain}
											placeholder="e.g. wled.top"
											class="w-full px-3 py-2 text-xs rounded-lg border border-app-border bg-app-hover text-app-text outline-none focus:border-orange-500"
										/>
									{/if}
								</div>
							</div>

							<div>
								<label for="cf-api-token" class="block text-xs font-medium text-app-text mb-1">
									Cloudflare API Token
									{#if data.hasEnvCfToken}
										<span class="text-[11px] text-emerald-400 font-normal">（已检测到环境变量，可留空）</span>
									{:else if settings.cfApiToken}
										<span class="text-[11px] text-emerald-400 font-normal">（已配置全局 Token，可留空）</span>
									{:else}
										<span class="text-[11px] text-amber-400 font-normal">（如未在设置中配置，请在此输入）</span>
									{/if}
								</label>
								<input
									id="cf-api-token"
									type="password"
									bind:value={cfApiTokenInput}
									placeholder={data.hasEnvCfToken || settings.cfApiToken ? '使用系统配置 Token（或在此填入以临时覆盖）' : '输入 Cloudflare API Token...'}
									class="w-full px-3 py-2 text-xs rounded-lg border border-app-border bg-app-hover text-app-text font-mono outline-none focus:border-orange-500"
								/>
							</div>
						</div>

						<div class="flex items-center justify-between">
							<span class="text-xs text-app-muted">
								权限要求：Zone.Zone:Read + Zone.DNS:Read
							</span>
							<button
								type="button"
								onclick={handleFetchCfDns}
								disabled={fetchingCfDns || !cfFetchDomain.trim()}
								class="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow disabled:opacity-50"
							>
								{#if fetchingCfDns}
									<svg class="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
										<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
										<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
									</svg>
									正在从 Cloudflare API 拉取...
								{:else}
									<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
									</svg>
									从 Cloudflare 获取 DNS 记录
								{/if}
							</button>
						</div>

						{#if cfDnsErrorMsg}
							<p class="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{cfDnsErrorMsg}</p>
						{/if}
						{#if cfDnsSuccessMsg}
							<p class="text-xs text-emerald-400 bg-emerald-400/10 px-3 py-2 rounded-lg">{cfDnsSuccessMsg}</p>
						{/if}

						{#if cfDnsResult}
							<div class="p-4 rounded-lg bg-app-hover/80 border border-orange-500/30 space-y-3">
								<div class="flex items-center justify-between text-xs">
									<div class="text-app-muted">
										Cloudflare Zone: <strong class="text-app-text">{cfDnsResult.zoneName}</strong> ({cfDnsResult.zoneId.slice(0, 8)}...) · 共读取到 <strong class="text-app-text">{cfDnsResult.totalRecords}</strong> 条 DNS 记录，已提取出 <strong class="text-orange-400 font-bold">{cfDnsResult.extractedNames.length}</strong> 个子域名前缀：
									</div>
									<button
										type="button"
										onclick={handleImportCfDns}
										disabled={importingCfDns || cfDnsResult.extractedNames.length === 0}
										class="px-3.5 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold transition-all disabled:opacity-50 shadow"
									>
										{importingCfDns ? '正在导入...' : `一键批量导入 ${cfDnsResult.extractedNames.length} 个规则`}
									</button>
								</div>

								<div class="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1 bg-app-surface/60 rounded border border-app-border">
									{#each cfDnsResult.extractedNames as name}
										<span class="px-2 py-0.5 rounded bg-orange-500/10 border border-orange-500/20 text-xs font-mono text-orange-300">
											{name}
										</span>
									{/each}
									{#if cfDnsResult.extractedNames.length === 0}
										<span class="text-xs text-app-muted italic p-1">该域名下仅存在根域名或无可用二级子域名前缀</span>
									{/if}
								</div>
							</div>
						{/if}
					</div>
				</div>

				<!-- DNS Zone File Importer Card (Manual Fallback) -->
				<div class="bg-app-surface border border-app-border rounded-xl p-6 shadow">
					<div class="flex items-start justify-between mb-4">
						<div>
							<h3 class="text-sm font-bold flex items-center gap-2">
								<svg class="w-4 h-4 text-app-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
								</svg>
								手动导入 DNS 区域文件 (BIND / Cloudflare Export Zone)
							</h3>
							<p class="text-xs text-app-muted mt-1">
								Paste Cloudflare / BIND exported zone records below to automatically extract hostname and subdomain prefixes (e.g. <code>api-admin</code>, <code>pan</code>, <code>status</code>) and add them to the blacklist, preventing conflicting email aliases.
							</p>
						</div>
					</div>

					<div class="space-y-3">
						<textarea
							bind:value={zoneInputText}
							rows="6"
							class="w-full p-3 font-mono text-xs rounded-lg border border-app-border bg-app-hover text-app-text placeholder:text-app-muted/60 focus:outline-none focus:border-app-accent"
							placeholder=";; Paste DNS zone records here, e.g.&#10;;; Domain: wled.top.&#10;api-admin.wled.top.  1  IN  A  104.46.230.35&#10;pan.wled.top.        1  IN  A  104.46.230.35&#10;status.wled.top.     1  IN  A  104.46.230.35&#10;mirror.wled.top.     1  IN  CNAME bywled.github.io."
						></textarea>

						<div class="flex flex-wrap items-center justify-between gap-3">
							<div class="flex items-center gap-2">
								<label for="scope-domain" class="text-xs text-app-muted">Scope domain:</label>
								<input
									id="scope-domain"
									type="text"
									bind:value={dnsImportDomain}
									placeholder="e.g. wled.top (empty for global)"
									class="px-2.5 py-1.5 text-xs rounded border border-app-border bg-app-hover text-app-text outline-none focus:border-app-accent"
								/>
							</div>

							<div class="flex items-center gap-2">
								<button
									onclick={handlePreviewDns}
									disabled={parsingDns || !zoneInputText.trim()}
									class="px-3 py-1.5 rounded-lg border border-app-border bg-app-hover hover:bg-app-border text-xs font-medium transition-colors disabled:opacity-50"
								>
									{parsingDns ? 'Parsing...' : 'Preview Extracted Names'}
								</button>
								{#if dnsPreview}
									<button
										onclick={handleConfirmDnsImport}
										disabled={importingDns}
										class="px-3.5 py-1.5 rounded-lg bg-app-accent hover:brightness-110 text-app-bg text-xs font-semibold transition-all disabled:opacity-50 shadow"
									>
										{importingDns ? 'Importing...' : `Import ${dnsPreview.names.length} Names to Blacklist`}
									</button>
								{/if}
							</div>
						</div>

						{#if dnsErrorMsg}
							<p class="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{dnsErrorMsg}</p>
						{/if}
						{#if dnsSuccessMsg}
							<p class="text-xs text-emerald-400 bg-emerald-400/10 px-3 py-2 rounded-lg">{dnsSuccessMsg}</p>
						{/if}

						{#if dnsPreview}
							<div class="mt-3 p-3 rounded-lg bg-app-hover/70 border border-app-border/80">
								<div class="text-xs text-app-muted mb-2">
									Detected Domain: <strong class="text-app-text">{dnsPreview.domain || 'Global'}</strong> · Found <strong class="text-app-accent">{dnsPreview.names.length}</strong> unique local-parts from {dnsPreview.totalRecords} DNS records:
								</div>
								<div class="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1">
									{#each dnsPreview.names as name}
										<span class="px-2 py-0.5 rounded bg-app-surface border border-app-border text-xs font-mono text-app-text">
											{name}
										</span>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				</div>

				<!-- Manual Blacklist Rule Add -->
				<div class="bg-app-surface border border-app-border rounded-xl p-6 shadow">
					<h3 class="text-sm font-bold mb-1">Add Blacklist Rule Manually</h3>
					<p class="text-xs text-app-muted mb-4">
						Prevent users from creating aliases matching specific words, system names, or patterns.
					</p>

					<form onsubmit={handleAddManual} class="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
						<div>
							<label for="manual-pattern" class="block text-xs font-medium text-app-text mb-1">Pattern / Local-Part *</label>
							<input
								id="manual-pattern"
								bind:value={manualPattern}
								required
								placeholder="e.g. admin or support"
								class="w-full px-3 py-2 text-xs rounded-lg border border-app-border bg-app-hover text-app-text outline-none focus:border-app-accent"
							/>
						</div>
						<div>
							<label for="manual-domain" class="block text-xs font-medium text-app-text mb-1">Domain (optional)</label>
							<input
								id="manual-domain"
								bind:value={manualDomain}
								placeholder="Leave empty for all domains"
								class="w-full px-3 py-2 text-xs rounded-lg border border-app-border bg-app-hover text-app-text outline-none focus:border-app-accent"
							/>
						</div>
						<div>
							<label for="manual-desc" class="block text-xs font-medium text-app-text mb-1">Description (optional)</label>
							<input
								id="manual-desc"
								bind:value={manualDesc}
								placeholder="Reason for blocking"
								class="w-full px-3 py-2 text-xs rounded-lg border border-app-border bg-app-hover text-app-text outline-none focus:border-app-accent"
							/>
						</div>
						<div>
							<button
								type="submit"
								disabled={addingManual}
								class="w-full py-2 px-3 rounded-lg bg-app-accent hover:brightness-110 text-app-bg text-xs font-semibold transition-all disabled:opacity-50"
							>
								{addingManual ? 'Adding...' : 'Add Rule'}
							</button>
						</div>
					</form>
					{#if manualError}
						<p class="text-xs text-red-400 mt-2">{manualError}</p>
					{/if}
				</div>

				<!-- Blacklist Table -->
				<div class="bg-app-surface border border-app-border rounded-xl overflow-hidden shadow">
					<table class="w-full text-left text-sm">
						<thead class="bg-app-hover/50 text-xs text-app-muted uppercase tracking-wider border-b border-app-border">
							<tr>
								<th class="px-4 py-3 font-semibold">Blocked Local-Part</th>
								<th class="px-4 py-3 font-semibold">Domain Scope</th>
								<th class="px-4 py-3 font-semibold">Source</th>
								<th class="px-4 py-3 font-semibold">Description</th>
								<th class="px-4 py-3 font-semibold text-right">Actions</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-app-border/50">
							{#each blacklist as item (item.id)}
								<tr class="hover:bg-app-hover/30 transition-colors">
									<td class="px-4 py-2.5 font-mono text-xs font-semibold text-red-400">
										{item.pattern}
									</td>
									<td class="px-4 py-2.5 text-xs text-app-muted">
										{item.domain || 'Global (All domains)'}
									</td>
									<td class="px-4 py-2.5 text-xs">
										<span class="px-1.5 py-0.5 rounded text-[11px] {item.source === 'cloudflare_api' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30 font-medium' : item.source === 'dns_import' ? 'bg-sky-500/20 text-sky-400' : 'bg-purple-500/20 text-purple-400'}">
											{item.source === 'cloudflare_api' ? 'Cloudflare API' : item.source === 'dns_import' ? 'Zone File' : 'Manual'}
										</span>
									</td>
									<td class="px-4 py-2.5 text-xs text-app-muted truncate max-w-[200px]">
										{item.description || '—'}
									</td>
									<td class="px-4 py-2.5 text-right">
										<button
											onclick={() => handleDeleteBlacklist(item.id)}
											class="text-xs text-red-400 hover:text-red-300"
										>
											Delete
										</button>
									</td>
								</tr>
							{/each}
							{#if blacklist.length === 0}
								<tr>
									<td colspan="5" class="px-4 py-6 text-center text-xs text-app-muted italic">
										No blacklist rules created yet.
									</td>
								</tr>
							{/if}
						</tbody>
					</table>
				</div>
			</div>
		{/if}

		<!-- Tab 4: System Settings -->
		{#if activeTab === 'settings'}
			<div class="max-w-xl bg-app-surface border border-app-border rounded-xl p-6 shadow space-y-6">
				<div>
					<h2 class="text-base font-semibold">System Quotas & Limits</h2>
					<p class="text-xs text-app-muted mt-0.5">Configure system-wide limits for users and domains.</p>
				</div>

				<form onsubmit={handleSaveSettings} class="space-y-4">
					<div>
						<label for="default-quota" class="block text-sm font-medium text-app-text mb-1">
							Default User Alias Quota
						</label>
						<input
							id="default-quota"
							type="number"
							min="1"
							bind:value={defaultQuotaInput}
							required
							class="w-full px-3 py-2 rounded-lg border border-app-border bg-app-hover text-sm text-app-text outline-none focus:border-app-accent"
						/>
						<p class="text-xs text-app-muted mt-1">
							Maximum number of email aliases each normal user is allowed to create (unless individually overridden).
						</p>
					</div>

					<div>
						<label for="cf-token-setting" class="block text-sm font-medium text-app-text mb-1">
							Cloudflare API Token
						</label>
						<input
							id="cf-token-setting"
							type="password"
							bind:value={cfTokenSettingInput}
							placeholder="cf_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
							class="w-full px-3 py-2 rounded-lg border border-app-border bg-app-hover text-sm font-mono text-app-text outline-none focus:border-app-accent"
						/>
						<p class="text-xs text-app-muted mt-1">
							{#if data.hasEnvCfToken}
								<span class="text-emerald-400 font-medium">✓ 已检测到环境变量 CF_API_TOKEN。</span> 可留空直接使用环境变量，或在此输入以覆盖。
							{:else}
								用于自动连接 Cloudflare API 读取域名的全部 DNS 记录以导入防冲突黑名单。权限：<strong class="text-app-text">Zone.Zone:Read</strong> 与 <strong class="text-app-text">Zone.DNS:Read</strong>。
							{/if}
						</p>
					</div>

					<div class="p-4 rounded-lg bg-app-hover/50 border border-app-border">
						<div class="text-sm font-medium text-app-text">Max Aliases Per Domain</div>
						<div class="text-2xl font-bold font-mono text-app-accent mt-1">50</div>
						<p class="text-xs text-app-muted mt-1">
							Every domain is strictly limited to at most 50 email aliases in total to prevent resource overuse.
						</p>
					</div>

					{#if settingsSavedMsg}
						<p class="text-xs text-emerald-400 bg-emerald-400/10 px-3 py-2 rounded-lg">{settingsSavedMsg}</p>
					{/if}

					<button
						type="submit"
						disabled={savingSettings}
						class="py-2 px-4 rounded-lg bg-app-accent hover:brightness-110 text-app-bg text-sm font-semibold transition-all disabled:opacity-50"
					>
						{savingSettings ? 'Saving...' : 'Save Settings'}
					</button>
				</form>
			</div>
		{/if}
	</div>
</div>

<!-- Modal: Create User -->
{#if showCreateUserModal}
	<div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
		<div class="bg-app-surface border border-app-border rounded-2xl p-6 max-w-md w-full shadow-2xl">
			<h3 class="text-base font-bold mb-1">Create New User</h3>
			<p class="text-xs text-app-muted mb-4">
				New users will be forced to scan QR and bind 2FA upon their initial login.
			</p>

			<form onsubmit={handleCreateUser} class="space-y-4">
				<div>
					<label for="create-username" class="block text-xs font-medium text-app-text mb-1">Username *</label>
					<input
						id="create-username"
						type="text"
						required
						bind:value={newUsername}
						placeholder="e.g. alice"
						class="w-full px-3 py-2 rounded-lg border border-app-border bg-app-hover text-sm text-app-text outline-none focus:border-app-accent"
					/>
				</div>

				<div>
					<label for="create-password" class="block text-xs font-medium text-app-text mb-1">Initial Password * (min 8 chars)</label>
					<input
						id="create-password"
						type="password"
						required
						minlength="8"
						bind:value={newPassword}
						placeholder="••••••••••••"
						class="w-full px-3 py-2 rounded-lg border border-app-border bg-app-hover text-sm text-app-text outline-none focus:border-app-accent"
					/>
				</div>

				<div>
					<label for="create-max-aliases" class="block text-xs font-medium text-app-text mb-1">Allowed Alias Quota (optional)</label>
					<input
						id="create-max-aliases"
						type="number"
						min="1"
						bind:value={newMaxAliases}
						placeholder="Leave blank for system default ({settings.defaultUserAliasQuota})"
						class="w-full px-3 py-2 rounded-lg border border-app-border bg-app-hover text-sm text-app-text outline-none focus:border-app-accent"
					/>
				</div>

				{#if createUserError}
					<p class="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded">{createUserError}</p>
				{/if}

				<div class="flex items-center justify-end gap-2 pt-2">
					<button
						type="button"
						onclick={() => (showCreateUserModal = false)}
						class="px-3 py-2 rounded-lg text-xs text-app-muted hover:text-app-text"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={creatingUser}
						class="px-4 py-2 rounded-lg bg-app-accent hover:brightness-110 text-app-bg text-xs font-semibold shadow disabled:opacity-50"
					>
						{creatingUser ? 'Creating...' : 'Create Account'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Modal: Edit Quota -->
{#if editingUser}
	<div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
		<div class="bg-app-surface border border-app-border rounded-2xl p-6 max-w-sm w-full shadow-2xl">
			<h3 class="text-base font-bold mb-1">Edit Alias Quota</h3>
			<p class="text-xs text-app-muted mb-4">
				Adjust alias quota for <strong class="text-app-text">{editingUser.username}</strong>.
			</p>

			<div class="space-y-4">
				<div>
					<label for="edit-quota-value" class="block text-xs font-medium text-app-text mb-1">
						Max Allowed Aliases
					</label>
					<input
						id="edit-quota-value"
						type="number"
						min="0"
						bind:value={editQuotaValue}
						placeholder="Leave blank for default ({settings.defaultUserAliasQuota})"
						class="w-full px-3 py-2 rounded-lg border border-app-border bg-app-hover text-sm text-app-text outline-none focus:border-app-accent"
					/>
					<p class="text-[11px] text-app-muted mt-1">Currently used: {editingUser.aliasCount} aliases</p>
				</div>

				<div class="flex items-center justify-end gap-2 pt-2">
					<button
						type="button"
						onclick={() => (editingUser = null)}
						class="px-3 py-2 rounded-lg text-xs text-app-muted hover:text-app-text"
					>
						Cancel
					</button>
					<button
						type="button"
						onclick={handleSaveQuota}
						disabled={savingQuota}
						class="px-4 py-2 rounded-lg bg-app-accent hover:brightness-110 text-app-bg text-xs font-semibold shadow disabled:opacity-50"
					>
						{savingQuota ? 'Saving...' : 'Save Quota'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Modal: Reset Password -->
{#if resettingUser}
	<div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
		<div class="bg-app-surface border border-app-border rounded-2xl p-6 max-w-sm w-full shadow-2xl">
			<h3 class="text-base font-bold mb-1">Reset Password</h3>
			<p class="text-xs text-app-muted mb-4">
				Set new password for <strong class="text-app-text">{resettingUser.username}</strong>.
			</p>

			<div class="space-y-4">
				<div>
					<label for="reset-new-password" class="block text-xs font-medium text-app-text mb-1">
						New Password (min 8 chars)
					</label>
					<input
						id="reset-new-password"
						type="password"
						minlength="8"
						bind:value={resetNewPassword}
						placeholder="••••••••••••"
						class="w-full px-3 py-2 rounded-lg border border-app-border bg-app-hover text-sm text-app-text outline-none focus:border-app-accent"
					/>
				</div>

				{#if resetPasswordMsg}
					<p class="text-xs text-amber-400 bg-amber-400/10 px-3 py-2 rounded">{resetPasswordMsg}</p>
				{/if}

				<div class="flex items-center justify-end gap-2 pt-2">
					<button
						type="button"
						onclick={() => (resettingUser = null)}
						class="px-3 py-2 rounded-lg text-xs text-app-muted hover:text-app-text"
					>
						Cancel
					</button>
					<button
						type="button"
						onclick={handleResetPassword}
						disabled={resettingPassword || !resetNewPassword}
						class="px-4 py-2 rounded-lg bg-app-accent hover:brightness-110 text-app-bg text-xs font-semibold shadow disabled:opacity-50"
					>
						{resettingPassword ? 'Updating...' : 'Update Password'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
