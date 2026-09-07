<script lang="ts">
	import type { DestinationAddress, Tag } from '$lib/types.js';
	import Dialog from './Dialog.svelte';
	import ColorPicker from './ColorPicker.svelte';
	import { randomSwatchColor, SWATCHES } from '$lib/constants';
	import { t } from '$lib/i18n';

	let {
		open,
		destinations,
		tags,
		onClose,
		onAdded,
		onRemoved,
		onTagCreated,
		onTagDeleted,
		onTagUpdated
	}: {
		open: boolean;
		destinations: DestinationAddress[];
		tags: Tag[];
		onClose: () => void;
		onAdded: (dest: DestinationAddress) => void;
		onRemoved: (email: string) => void;
		onTagCreated: (tag: Tag) => void;
		onTagDeleted: (name: string) => void;
		onTagUpdated: (tag: Tag) => void;
	} = $props();

	let newEmail = $state('');
	let adding = $state(false);
	let addError = $state('');
	let justAdded = $state<string | null>(null);
	let deletingEmail = $state<string | null>(null);

	// Tag form state
	let newTagName = $state('');
	let newTagColor = $state<string | undefined>(randomSwatchColor());
	let addingTag = $state(false);
	let addTagError = $state('');
	let showTagForm = $state(false);
	let showDestinationForm = $state(false);
	let deletingTag = $state<string | null>(null);

	// Cloudflare destination probe state
	interface ProbeInfo {
		id?: string;
		verified: boolean;
		status: 'verified' | 'pending' | 'not_in_cf';
		created?: string;
	}

	let tokenConfigured = $state<boolean | null>(null);
	let probeStatuses = $state<Record<string, ProbeInfo>>({});
	let probing = $state(false);
	let probeError = $state('');
	let addingToCf = $state<Record<string, boolean>>({});
	let cfActionMsg = $state<Record<string, { type: 'success' | 'error'; text: string }>>({});

	async function fetchProbeStatuses() {
		if (probing) return;
		probing = true;
		probeError = '';
		try {
			const res = await fetch('/api/destinations/probe');
			const data = (await res.json()) as any;
			if (res.ok) {
				tokenConfigured = Boolean(data.tokenConfigured);
				if (data.statuses) {
					probeStatuses = { ...data.statuses };
				}
			} else {
				probeError = data.error || 'Failed to probe statuses';
			}
		} catch {
			probeError = 'Network error while probing';
		} finally {
			probing = false;
		}
	}

	async function handleProbeSingle(email: string) {
		try {
			const res = await fetch('/api/destinations/probe', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, action: 'probe' })
			});
			const data = (await res.json()) as any;
			if (res.ok && data.success) {
				probeStatuses = {
					...probeStatuses,
					[email]: {
						id: data.id,
						verified: Boolean(data.verified),
						status: data.status,
						created: data.created
					}
				};
			}
		} catch {
			// ignore
		}
	}

	async function handleAddToCf(email: string) {
		addingToCf = { ...addingToCf, [email]: true };
		cfActionMsg = { ...cfActionMsg, [email]: undefined as any };
		try {
			const res = await fetch('/api/destinations/probe', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, action: 'add_to_cf' })
			});
			const data = (await res.json()) as any;
			if (res.ok && data.success) {
				probeStatuses = {
					...probeStatuses,
					[email]: {
						id: data.id,
						verified: Boolean(data.verified),
						status: data.status,
						created: data.created
					}
				};
				cfActionMsg = {
					...cfActionMsg,
					[email]: { type: 'success', text: t('settingsDialog.addToCfSuccess') }
				};
			} else {
				cfActionMsg = {
					...cfActionMsg,
					[email]: { type: 'error', text: data.error || t('settingsDialog.addToCfFailed', { error: 'Failed' }) }
				};
			}
		} catch (err: any) {
			cfActionMsg = {
				...cfActionMsg,
				[email]: { type: 'error', text: err?.message || 'Network error' }
			};
		} finally {
			addingToCf = { ...addingToCf, [email]: false };
		}
	}

	$effect(() => {
		if (open) {
			fetchProbeStatuses();
		}
	});

	async function handleAdd(e: Event) {
		e.preventDefault();
		adding = true;
		addError = '';
		try {
			const res = await fetch('/api/destinations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: newEmail.trim() })
			});
			const body = await res.json();
			if (!res.ok) {
				addError = body.error ?? t('settingsDialog.failedToAdd');
			} else {
				onAdded(body as DestinationAddress);
				const addedEmail = newEmail.trim();
				justAdded = addedEmail;
				handleProbeSingle(addedEmail);
				newEmail = '';
			}
		} catch {
			addError = t('settingsDialog.networkError');
		} finally {
			adding = false;
			showDestinationForm = false;
		}
	}

	async function handleDelete(email: string) {
		const confirmDelete = confirm(t('settingsDialog.deleteDestConfirm', { email }));
		if (!confirmDelete) return;

		deletingEmail = email;
		try {
			await fetch('/api/destinations/' + encodeURIComponent(email), { method: 'DELETE' });
			onRemoved(email);
			if (justAdded === email) justAdded = null;
		} finally {
			deletingEmail = null;
		}
	}

	async function handleAddTag(e: Event) {
		e.preventDefault();
		if (!newTagName.trim()) return;
		addingTag = true;
		addTagError = '';
		try {
			const res = await fetch('/api/tags', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newTagName.trim(), color: newTagColor ?? '#3b82f6' })
			});
			const body = await res.json();
			if (!res.ok) {
				addTagError = body.error ?? t('settingsDialog.failedToCreateTag');
			} else {
				onTagCreated(body as Tag);
				newTagName = '';
				newTagColor = '#3b82f6';
				showTagForm = false;
			}
		} catch {
			addTagError = t('settingsDialog.networkError');
		} finally {
			addingTag = false;
		}
	}

	async function handleDeleteTag(name: string) {
		const confirmDelete = confirm(t('settingsDialog.deleteTagConfirm', { name }));
		if (!confirmDelete) return;

		deletingTag = name;
		try {
			await fetch('/api/tags/' + encodeURIComponent(name), { method: 'DELETE' });
			onTagDeleted(name);
		} finally {
			deletingTag = null;
		}
	}

	async function handleUpdateTag(tag: Tag) {
		onTagUpdated(tag);
	}

	function handleShowAddTag() {
		newTagName = '';
		newTagColor = randomSwatchColor();
		addTagError = '';
		showTagForm = true;
	}

	function handleShowDestinationForm() {
		newEmail = '';
		addError = '';
		showDestinationForm = true;
	}

	// Password change state
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmNewPassword = $state('');
	let updatingPassword = $state(false);
	let passwordError = $state('');
	let passwordSuccess = $state('');

	async function handleChangePassword(e: Event) {
		e.preventDefault();
		passwordError = '';
		passwordSuccess = '';

		if (!currentPassword) {
			passwordError = t('settingsDialog.currentPassword') + ' required';
			return;
		}
		if (newPassword.length < 8) {
			passwordError = t('settingsDialog.passwordTooShort');
			return;
		}
		if (newPassword !== confirmNewPassword) {
			passwordError = t('settingsDialog.passwordMismatch');
			return;
		}

		updatingPassword = true;
		try {
			const res = await fetch('/api/user/password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ currentPassword, newPassword })
			});
			const data = (await res.json().catch(() => ({}))) as any;
			if (res.ok && data.success) {
				passwordSuccess = t('settingsDialog.passwordChangedSuccess');
				currentPassword = '';
				newPassword = '';
				confirmNewPassword = '';
			} else {
				if (data.error === 'Current password is incorrect') {
					passwordError = t('settingsDialog.currentPasswordIncorrect');
				} else {
					passwordError = data.error || t('settingsDialog.networkError');
				}
			}
		} catch {
			passwordError = t('settingsDialog.networkError');
		} finally {
			updatingPassword = false;
		}
	}

	function handleClose() {
		newEmail = '';
		addError = '';
		justAdded = null;
		newTagName = '';
		newTagColor = '#3b82f6';
		showTagForm = false;
		addTagError = '';
		currentPassword = '';
		newPassword = '';
		confirmNewPassword = '';
		passwordError = '';
		passwordSuccess = '';
		onClose();
	}
</script>

<Dialog open={open} title={t('settingsDialog.title')} onClose={handleClose}>
	<div class="p-6 space-y-4">

		<!-- Section header -->
		<div class="flex items-center justify-between">
			<div>
				<h3 class="text-sm font-semibold text-app-text mb-0.5">{t('settingsDialog.destinationsTitle')}</h3>
				<p class="text-xs text-app-muted leading-relaxed">
					{t('settingsDialog.destinationsDesc')}
				</p>
			</div>
			{#if tokenConfigured}
				<button
					type="button"
					onclick={fetchProbeStatuses}
					disabled={probing}
					class="shrink-0 ml-2 px-2.5 py-1 text-xs rounded-lg border border-app-border bg-app-hover text-app-muted hover:text-app-text flex items-center gap-1.5 transition-colors disabled:opacity-50"
					title={t('settingsDialog.refreshProbeBtn')}
				>
					<svg class="w-3.5 h-3.5 {probing ? 'animate-spin' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
					</svg>
					<span>{probing ? t('settingsDialog.refreshingProbe') : t('settingsDialog.refreshProbeBtn')}</span>
				</button>
			{/if}
		</div>

		<!-- Address list -->
		{#if destinations.length > 0}
			<ul class="space-y-2.5" aria-label={t('settingsDialog.destinationsTitle')}>
				{#each destinations as dest (dest.email)}
					{@const probe = probeStatuses[dest.email.toLowerCase()] ?? probeStatuses[dest.email]}
					<li class="flex flex-col gap-2 p-3 rounded-lg bg-app-hover/60 border border-app-border/80 transition-all">
						<div class="flex items-center gap-2 justify-between flex-wrap">
							<div class="flex items-center gap-2 min-w-0 flex-1">
								<span class="text-sm font-medium text-app-text truncate">{dest.email}</span>

								<!-- Probe Status Badge -->
								{#if probe}
									{#if probe.status === 'verified'}
										<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
											<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
											</svg>
											{t('settingsDialog.statusVerified')}
										</span>
									{:else if probe.status === 'pending'}
										<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
											<svg class="w-3 h-3 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<circle cx="12" cy="12" r="9" stroke-width="2" />
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 7v5l3 3" />
											</svg>
											{t('settingsDialog.statusPending')}
										</span>
									{:else if probe.status === 'not_in_cf'}
										<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/15 text-rose-400 border border-rose-500/30">
											<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<circle cx="12" cy="12" r="9" stroke-width="2" />
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01" />
											</svg>
											{t('settingsDialog.statusNotInCf')}
										</span>
									{/if}
								{:else if tokenConfigured === false}
									<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-app-muted bg-app-border/40">
										{t('settingsDialog.statusNoToken')}
									</span>
								{:else if probing}
									<span class="inline-flex items-center gap-1 text-[11px] text-app-muted">
										<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
										</svg>
										{t('settingsDialog.refreshingProbe')}
									</span>
								{/if}
							</div>

							<div class="flex items-center gap-1.5 shrink-0">
								{#if probe?.status === 'not_in_cf' && tokenConfigured}
									<button
										type="button"
										onclick={() => handleAddToCf(dest.email)}
										disabled={addingToCf[dest.email]}
										class="px-2.5 py-1 text-xs font-semibold rounded-md bg-app-accent hover:brightness-110 text-app-bg transition-all disabled:opacity-50 flex items-center gap-1 shadow-sm"
									>
										{#if addingToCf[dest.email]}
											<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
											</svg>
											<span>{t('settingsDialog.addingToCf')}</span>
										{:else}
											<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
											</svg>
											<span>{t('settingsDialog.addToCfBtn')}</span>
										{/if}
									</button>
								{:else if probe?.status === 'pending'}
									<button
										type="button"
										onclick={() => handleProbeSingle(dest.email)}
										class="px-2.5 py-1 text-xs rounded border border-app-border bg-app-hover text-app-muted hover:text-app-text transition-colors"
									>
										{t('settingsDialog.refreshProbeBtn')}
									</button>
								{/if}

								<button
									onclick={() => handleDelete(dest.email)}
									disabled={deletingEmail === dest.email}
									aria-label={t('settingsDialog.removeAddressAria', { email: dest.email })}
									class="p-1.5 text-app-muted/60 hover:text-red-400 rounded transition-colors disabled:opacity-40 shrink-0 ml-1"
								>
									<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
									</svg>
								</button>
							</div>
						</div>

						<!-- Status description or feedback message -->
						{#if cfActionMsg[dest.email]}
							<div class="text-xs px-2.5 py-1.5 rounded {cfActionMsg[dest.email].type === 'success' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' : 'bg-red-500/10 text-red-300 border border-red-500/20'}">
								{cfActionMsg[dest.email].text}
							</div>
						{:else if probe?.status === 'pending'}
							<p class="text-[11px] text-amber-400/90 leading-relaxed bg-amber-400/5 px-2.5 py-1.5 rounded border border-amber-400/20">
								{t('settingsDialog.pendingDesc')}
							</p>
						{:else if probe?.status === 'not_in_cf'}
							<p class="text-[11px] text-app-muted leading-relaxed">
								{t('settingsDialog.notInCfDesc')}
							</p>
						{/if}

						<!-- Cloudflare setup guide for newly added address when no token -->
						{#if justAdded === dest.email && (!tokenConfigured || probe?.status === 'not_in_cf')}
							<div class="ml-2 pl-3 border-l-2 border-app-accent/30 space-y-2 pt-1">
								<p class="text-xs font-medium text-app-accent">{t('settingsDialog.verifyInCf')}</p>
								<ol class="space-y-1.5">
									{#each [
										t('settingsDialog.cfStep1'),
										t('settingsDialog.cfStep2', { email: dest.email }),
										t('settingsDialog.cfStep3')
									] as instruction, i}
										<li class="flex gap-2 text-xs text-app-muted leading-relaxed">
											<span class="flex-none w-4 h-4 rounded-full border border-app-border text-[10px] font-bold flex items-center justify-center mt-px text-app-muted/70" aria-hidden="true">
												{i + 1}
											</span>
											{instruction}
										</li>
									{/each}
								</ol>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-sm text-app-muted text-center py-4 rounded-lg border border-dashed border-app-border">
				{t('settingsDialog.noDestinations')}
			</p>
		{/if}

		{#if showDestinationForm}
			<!-- Add address form -->
			<form onsubmit={handleAdd} class="space-y-2">
				<label for="dest-email" class="block text-xs font-medium text-app-muted">
					{t('settingsDialog.addDestination')}
				</label>
				<div class="flex gap-2">
					<input
						id="dest-email"
						type="email"
						bind:value={newEmail}
						placeholder="you@gmail.com"
						required
						class="flex-1 px-3 py-1.5 rounded-lg border border-app-border bg-app-hover text-sm text-app-text placeholder:text-app-muted focus:outline-none focus:border-app-accent/60 transition-colors"
					/>
					<button
						type="submit"
						disabled={adding || !newEmail.trim()}
						aria-busy={adding}
						class="px-4 py-1.5 text-xs font-semibold bg-app-accent text-app-bg rounded-lg hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
					>
						{adding ? t('settingsDialog.adding') : t('settingsDialog.add')}
					</button>
					<button
						type="button"
						onclick={() => { showDestinationForm = false; addError = ''; }}
						class="p-2 text-xs text-app-muted hover:text-app-text border border-app-border hover:border-app-hover rounded-lg transition-colors"
					>
						<!-- Close icon -->
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
				{#if addError}
					<p role="alert" class="text-xs text-red-400">{addError}</p>
				{/if}
			</form>
		{:else}
			<button
				type="button"
				onclick={handleShowDestinationForm}
				class="text-xs text-app-accent hover:underline underline-offset-2 ml-2"
			>
				+ {t('settingsDialog.addDestination')}
			</button>
		{/if}

		<div class="border-t border-app-border"></div>

		<!-- Tags section -->
		<div>
			<h3 class="text-sm font-semibold text-app-text mb-0.5">{t('settingsDialog.tagsTitle')}</h3>
			<p class="text-xs text-app-muted leading-relaxed">
				{t('settingsDialog.tagsDesc')}
			</p>
		</div>

		{#if tags.length > 0}
			<ul class="space-y-2" aria-label={t('settingsDialog.tagsTitle')}>
				{#each tags as tag (tag.name)}
					<li class="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-app-hover border border-app-border">
						<ColorPicker bind:value={tag.color} size={3} onChange={(value) => { if (value) handleUpdateTag({ ...tag, color: value }); }} />
						<span class="flex-1 text-sm text-app-text">{tag.name}</span>
						<button
							onclick={() => handleDeleteTag(tag.name)}
							disabled={deletingTag === tag.name}
							aria-label={t('settingsDialog.deleteTagAria', { name: tag.name })}
							class="p-1 text-app-muted/60 hover:text-red-400 rounded transition-colors disabled:opacity-40 shrink-0"
						>
							<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
							</svg>
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-sm text-app-muted text-center py-4 rounded-lg border border-dashed border-app-border">
				{t('settingsDialog.noTags')}
			</p>
		{/if}

		{#if showTagForm}
			<form onsubmit={handleAddTag} class="space-y-2 pl-3">
				<div class="flex gap-2 items-center">
					<ColorPicker bind:value={newTagColor} />
					<input
						type="text"
						bind:value={newTagName}
						placeholder={t('settingsDialog.tagNamePlaceholder')}
						required
						class="flex-1 px-3 py-1.5 w-full rounded-lg border border-app-border bg-app-hover text-sm text-app-text placeholder:text-app-muted focus:outline-none focus:border-app-accent/60 transition-colors"
					/>
					<button
						type="submit"
						disabled={addingTag || !newTagName.trim()}
						aria-busy={addingTag}
						class="px-3 py-2 text-xs font-semibold bg-app-accent text-app-bg rounded-lg hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
					>
						{addingTag ? t('settingsDialog.saving') : t('settingsDialog.save')}
					</button>
					<button
						type="button"
						onclick={() => { showTagForm = false; addTagError = ''; }}
						class="p-2 text-xs text-app-muted hover:text-app-text border border-app-border hover:border-app-hover rounded-lg transition-colors"
					>
						<!-- Close icon -->
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
				{#if addTagError}
					<p role="alert" class="text-xs text-red-400">{addTagError}</p>
				{/if}
			</form>
		{:else}
			<button
				type="button"
				onclick={handleShowAddTag}
				class="text-xs text-app-accent hover:underline underline-offset-2 ml-2"
			>
				+ {t('settingsDialog.addTag')}
			</button>
		{/if}

		<div class="border-t border-app-border"></div>

		<!-- Account Security / Password Change -->
		<div>
			<h3 class="text-sm font-semibold text-app-text mb-0.5">{t('settingsDialog.accountTitle')}</h3>
			<p class="text-xs text-app-muted leading-relaxed">
				{t('settingsDialog.accountDesc')}
			</p>
		</div>

		<form onsubmit={handleChangePassword} class="space-y-3 bg-app-hover/40 p-3.5 rounded-lg border border-app-border/70">
			<div>
				<label for="current-password" class="block text-xs font-medium text-app-muted mb-1">
					{t('settingsDialog.currentPassword')}
				</label>
				<input
					id="current-password"
					type="password"
					bind:value={currentPassword}
					placeholder="••••••••"
					required
					autocomplete="current-password"
					class="w-full px-3 py-1.5 rounded-lg border border-app-border bg-app-surface text-sm text-app-text placeholder:text-app-muted focus:outline-none focus:border-app-accent/60 transition-colors"
				/>
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
				<div>
					<label for="new-password" class="block text-xs font-medium text-app-muted mb-1">
						{t('settingsDialog.newPassword')}
					</label>
					<input
						id="new-password"
						type="password"
						bind:value={newPassword}
						placeholder="••••••••"
						required
						minlength="8"
						autocomplete="new-password"
						class="w-full px-3 py-1.5 rounded-lg border border-app-border bg-app-surface text-sm text-app-text placeholder:text-app-muted focus:outline-none focus:border-app-accent/60 transition-colors"
					/>
				</div>
				<div>
					<label for="confirm-new-password" class="block text-xs font-medium text-app-muted mb-1">
						{t('settingsDialog.confirmNewPassword')}
					</label>
					<input
						id="confirm-new-password"
						type="password"
						bind:value={confirmNewPassword}
						placeholder="••••••••"
						required
						minlength="8"
						autocomplete="new-password"
						class="w-full px-3 py-1.5 rounded-lg border border-app-border bg-app-surface text-sm text-app-text placeholder:text-app-muted focus:outline-none focus:border-app-accent/60 transition-colors"
					/>
				</div>
			</div>

			{#if passwordError}
				<p role="alert" class="text-xs text-red-400">{passwordError}</p>
			{/if}
			{#if passwordSuccess}
				<p role="status" class="text-xs text-emerald-400">{passwordSuccess}</p>
			{/if}

			<div class="flex justify-end pt-1">
				<button
					type="submit"
					disabled={updatingPassword || !currentPassword || !newPassword || !confirmNewPassword}
					aria-busy={updatingPassword}
					class="px-3.5 py-1.5 text-xs font-semibold bg-app-accent text-app-bg rounded-lg hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
				>
					{updatingPassword ? t('settingsDialog.changingPassword') : t('settingsDialog.changePasswordBtn')}
				</button>
			</div>
		</form>
	</div>
</Dialog>
