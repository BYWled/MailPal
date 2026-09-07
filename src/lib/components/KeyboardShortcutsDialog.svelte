<script lang="ts">
	import { t } from '$lib/i18n';

	let { show, onClose }: { show: boolean; onClose: () => void } = $props();

	const SHORTCUTS = $derived<[string, string][]>([
		['/', t('shortcuts.focusSearch')],
		['c', t('shortcuts.focusCreate')],
		['j / k', t('shortcuts.navigate')],
		['s', t('shortcuts.toggleExpand')],
		['e', t('shortcuts.enableFocused')],
		['d', t('shortcuts.disableFocused')],
		['t', t('shortcuts.toggleEnable')],
		['Backspace', t('shortcuts.deleteFocused')],
		['x', t('shortcuts.toggleSelect')],
		['Escape', t('shortcuts.clearClose')],
		['?', t('shortcuts.showHelp')],
	]);
</script>

{#if show}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-center justify-center"
		onclick={onClose}
	>
		<div
			class="rounded-2xl border border-app-border bg-app-surface shadow-2xl w-full max-w-sm p-6 text-app-text"
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			aria-label={t('shortcuts.title')}
			tabindex="-1"
		>
			<div class="flex items-center justify-between mb-4">
				<h2 class="font-semibold text-base">{t('shortcuts.title')}</h2>
				<button
					onclick={onClose}
					class="p-1 rounded text-app-muted hover:text-app-text hover:bg-app-hover transition-colors"
					aria-label="Close"
				>
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
			<dl class="space-y-2.5">
				{#each SHORTCUTS as [key, desc]}
					<div class="flex items-center justify-between gap-4">
						<dt class="text-sm text-app-muted">{desc}</dt>
						<dd>
							{#each key.split(' / ') as k, i}
								<kbd class="inline-flex items-center px-1.5 py-0.5 rounded border border-app-border bg-app-hover text-xs font-mono text-app-text">{k}</kbd>
								{#if i < key.split(' / ').length - 1}<span class="text-app-muted text-xs mx-0.5">/</span>{/if}
							{/each}
						</dd>
					</div>
				{/each}
			</dl>
		</div>
	</div>
{/if}
