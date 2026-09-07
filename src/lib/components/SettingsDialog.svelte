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
				justAdded = newEmail.trim();
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

	function handleClose() {
		newEmail = '';
		addError = '';
		justAdded = null;
		newTagName = '';
		newTagColor = '#3b82f6';
		showTagForm = false;
		addTagError = '';
		onClose();
	}
</script>

<Dialog open={open} title={t('settingsDialog.title')} onClose={handleClose}>
	<div class="p-6 space-y-4">

		<!-- Section header -->
		<div>
			<h3 class="text-sm font-semibold text-app-text mb-0.5">{t('settingsDialog.destinationsTitle')}</h3>
			<p class="text-xs text-app-muted leading-relaxed">
				{t('settingsDialog.destinationsDesc')}
			</p>
		</div>

		<!-- Address list -->
		{#if destinations.length > 0}
			<ul class="space-y-2" aria-label={t('settingsDialog.destinationsTitle')}>
				{#each destinations as dest (dest.email)}
					<li class="flex flex-col gap-2">
						<div class="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-app-hover border border-app-border">
							<!-- Dot indicator -->
							<!-- <span class="w-1.5 h-1.5 rounded-full bg-app-accent/70 shrink-0" aria-hidden="true"></span> -->
							<span class="flex-1 text-sm text-app-text truncate">{dest.email}</span>
							<button
								onclick={() => handleDelete(dest.email)}
								disabled={deletingEmail === dest.email}
								aria-label={t('settingsDialog.removeAddressAria', { email: dest.email })}
								class="p-1 text-app-muted/60 hover:text-red-400 rounded transition-colors disabled:opacity-40 shrink-0"
							>
								<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
								</svg>
							</button>
						</div>

						<!-- Cloudflare setup guide for newly added address -->
						{#if justAdded === dest.email}
							<div class="ml-3 pl-3 border-l-2 border-app-accent/30 space-y-2.5">
								<p class="text-xs font-medium text-app-accent">{t('settingsDialog.verifyInCf')}</p>
								<ol class="space-y-2">
									{#each [
										t('settingsDialog.cfStep1'),
										t('settingsDialog.cfStep2', { email: dest.email }),
										t('settingsDialog.cfStep3')
									] as instruction, i}
										<li class="flex gap-2.5 text-xs text-app-muted leading-relaxed">
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
	</div>
</Dialog>
