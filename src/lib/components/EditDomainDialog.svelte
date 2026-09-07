<script lang="ts">
	import type { DestinationAddress, DomainConfig } from '$lib/types.js';
	import { Switch, AlertDialog } from 'bits-ui';
	import Dialog from './Dialog.svelte';
	import DestinationSelect from './DestinationSelect.svelte';
	import ColorPicker from './ColorPicker.svelte';
	import { t } from '$lib/i18n';

	let {
		open,
		domain,
		destinations,
		onClose,
		onUpdated,
		onDeleted
	}: {
		open: boolean;
		domain: DomainConfig;
		destinations: DestinationAddress[];
		onClose: () => void;
		onUpdated: (domain: DomainConfig) => void;
		onDeleted: (domainName: string) => void;
	} = $props();

	let targetEmail = $state(domain.targetEmail);
	let wildcardEnabled = $state(domain.wildcardEnabled);
	let enabled = $state(domain.enabled);
	let color = $state<string | undefined>(domain.color);
	let saving = $state(false);
	let deleting = $state(false);
	let error = $state('');

	$effect(() => {
		if (open) {
			targetEmail = domain.targetEmail;
			wildcardEnabled = domain.wildcardEnabled;
			enabled = domain.enabled;
			color = domain.color;
			error = '';
		}
	});

	async function submit(e: Event) {
		e.preventDefault();
		saving = true;
		error = '';
		try {
			const res = await fetch(`/api/domains/${domain.domain}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ targetEmail, wildcardEnabled, enabled, color: color ?? null })
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? 'Failed to update domain';
			} else {
				onUpdated(body as DomainConfig);
			}
		} catch {
			error = 'Network error';
		} finally {
			saving = false;
		}
	}

	async function handleDelete() {
		deleting = true;
		try {
			const res = await fetch(`/api/domains/${domain.domain}`, { method: 'DELETE' });
			if (res.ok) onDeleted(domain.domain);
		} finally {
			deleting = false;
		}
	}
</script>

<Dialog {open} title={t('domain.settingsTitle')} subtitle={domain.domain} onClose={onClose}>
	<form onsubmit={submit} class="p-6 space-y-4">
		<div>
			<div class="flex items-center justify-between mb-1.5">
				<label for="ed-target" class="text-sm font-medium text-app-text">
					{t('domain.colorLabel')}
				</label>
			</div>
			<ColorPicker bind:value={color} size={6} />
		</div>

		<div>
			<div class="flex items-center justify-between mb-1.5">
				<label for="ed-target" class="text-sm font-medium text-app-text">
					{t('domain.targetLabel')}
				</label>
			</div>
			<DestinationSelect
				id="ed-target"
				{destinations}
				bind:value={targetEmail}
				placeholder={t('domain.targetPlaceholder')}
			/>
		</div>

		<div class="flex items-center justify-between py-1">
			<div>
				<p class="text-sm font-medium text-app-text">{t('domain.wildcardLabel')}</p>
				<p class="text-xs text-app-muted mt-0.5">{t('domain.wildcardHelp')}</p>
			</div>
			<Switch.Root
				checked={wildcardEnabled}
				onCheckedChange={(v) => (wildcardEnabled = v)}
				class="relative inline-flex h-5 w-9 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-accent
					data-[state=checked]:bg-app-accent data-[state=unchecked]:bg-app-border"
				aria-label={t('domain.wildcardLabel')}
			>
				<Switch.Thumb
					class="block h-3.5 w-3.5 mt-[3px] rounded-full bg-white shadow transition-transform
						data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-[3px]"
				/>
			</Switch.Root>
		</div>

		<div class="flex items-center justify-between py-1">
			<div>
				<p class="text-sm font-medium text-app-text">{t('domain.enabledLabel')}</p>
				<p class="text-xs text-app-muted mt-0.5">{t('domain.enabledHelp')}</p>
			</div>
			<Switch.Root
				checked={enabled}
				onCheckedChange={(v) => (enabled = v)}
				class="relative inline-flex h-5 w-9 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-accent
					data-[state=checked]:bg-app-accent data-[state=unchecked]:bg-app-border"
				aria-label={t('domain.enabledLabel')}
			>
				<Switch.Thumb
					class="block h-3.5 w-3.5 mt-[3px] rounded-full bg-white shadow transition-transform
						data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-[3px]"
				/>
			</Switch.Root>
		</div>

		{#if error}
			<p role="alert" class="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
		{/if}

		<div class="flex justify-between gap-2 pt-1">
			<AlertDialog.Root>
				<AlertDialog.Trigger
					type="button"
					disabled={deleting}
					class="px-4 py-2 text-sm text-red-400 hover:text-red-300 border border-red-400/30 hover:border-red-400/60 rounded-lg transition-colors disabled:opacity-40"
				>
					{deleting ? t('domain.deletingDomain') : t('domain.deleteDomainBtn')}
				</AlertDialog.Trigger>
				<AlertDialog.Portal>
					<AlertDialog.Overlay class="fixed inset-0 bg-black/65 backdrop-blur-sm z-40" />
					<AlertDialog.Content
						class="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-2xl border border-app-border bg-app-surface shadow-2xl w-full max-w-sm text-app-text p-6 focus:outline-none"
					>
						<AlertDialog.Title class="font-semibold text-app-text mb-1">{t('domain.deleteConfirmTitle')}</AlertDialog.Title>
						<AlertDialog.Description class="text-sm text-app-muted mb-5">
							{t('domain.deleteConfirmDesc', { domain: domain.domain })}
						</AlertDialog.Description>
						<div class="flex justify-end gap-2">
							<AlertDialog.Cancel class="px-4 py-2 text-sm text-app-muted hover:text-app-text border border-app-border hover:border-app-hover rounded-lg transition-colors">
								{t('common.cancel')}
							</AlertDialog.Cancel>
							<AlertDialog.Action
								onclick={handleDelete}
								class="px-4 py-2 text-sm font-semibold bg-red-500 hover:bg-red-400 text-white rounded-lg transition-colors"
							>
								{t('common.delete')}
							</AlertDialog.Action>
						</div>
					</AlertDialog.Content>
				</AlertDialog.Portal>
			</AlertDialog.Root>

			<div class="flex gap-2">
				<button
					type="button"
					onclick={onClose}
					class="px-4 py-2 text-sm text-app-muted hover:text-app-text border border-app-border hover:border-app-hover rounded-lg transition-colors"
				>
					{t('common.cancel')}
				</button>
				<button
					type="submit"
					disabled={saving}
					aria-busy={saving}
					class="px-4 py-2 text-sm font-semibold bg-app-accent text-app-bg rounded-lg hover:brightness-110 transition-all disabled:opacity-40"
				>
					{saving ? t('domain.savingDomain') : t('domain.saveDomainBtn')}
				</button>
			</div>
		</div>
	</form>
</Dialog>
