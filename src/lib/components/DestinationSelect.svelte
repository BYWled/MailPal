<script lang="ts">
	import type { DestinationAddress } from '$lib/types.js';
	import { Select } from 'bits-ui';
	import { t } from '$lib/i18n';

	let {
		destinations,
		value = $bindable(),
		placeholder,
		allowEmpty = false,
		emptyLabel,
		id
	}: {
		destinations: DestinationAddress[];
		value: string;
		placeholder?: string;
		allowEmpty?: boolean;
		emptyLabel?: string;
		id?: string;
	} = $props();

	const resolvedPlaceholder = $derived(placeholder ?? t('destSelect.placeholder'));
	const resolvedEmptyLabel = $derived(emptyLabel ?? t('destSelect.emptyLabel'));

	const items = $derived([
		...(allowEmpty ? [{ value: '', label: resolvedEmptyLabel }] : []),
		...destinations.map((d) => ({ value: d.email, label: d.email }))
	]);

	const selectedLabel = $derived(
		value === '' && allowEmpty
			? resolvedEmptyLabel
			: (items.find((i) => i.value === value)?.label ?? value)
	);
</script>

<Select.Root
	type="single"
	{value}
	onValueChange={(v) => (value = v ?? '')}
	{items}
>
	<Select.Trigger
		{id}
		class="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-app-border bg-app-hover text-sm
			{value || allowEmpty ? 'text-app-text' : 'text-app-muted'}
			focus:outline-none focus:border-app-accent/60 transition-colors cursor-pointer
			disabled:opacity-50 disabled:cursor-not-allowed"
		disabled={destinations.length === 0 && !allowEmpty}
	>
		<span class="truncate">
			{#if destinations.length === 0 && !allowEmpty}
				{t('destSelect.noDestinations')}
			{:else}
				{value ? selectedLabel : resolvedPlaceholder}
			{/if}
		</span>
		<svg class="w-3.5 h-3.5 text-app-muted shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
		</svg>
	</Select.Trigger>

	<Select.Content
		class="z-50 w-[var(--bits-select-anchor-width)] rounded-xl border border-app-border bg-app-surface shadow-xl overflow-hidden"
		sideOffset={4}
	>
		<Select.Viewport class="p-1">
			{#each items as item (item.value)}
				<Select.Item
					value={item.value}
					label={item.label}
					class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer outline-none
						data-[highlighted]:bg-app-hover data-[highlighted]:text-app-text
						data-[selected]:text-app-accent
						{item.value === '' ? 'text-app-muted italic' : 'text-app-text'}
						transition-colors"
				>
					{#if item.value !== ''}
						<span class="w-1.5 h-1.5 rounded-full bg-app-accent/60 shrink-0" aria-hidden="true"></span>
					{/if}
					{item.label}
				</Select.Item>
			{/each}
		</Select.Viewport>
	</Select.Content>
</Select.Root>

{#if destinations.length === 0 && !allowEmpty}
	<p class="text-xs text-app-muted mt-1.5">
		{t('destSelect.addInSettingsPrefix')}
		<span class="text-app-accent">{t('destSelect.settings')}</span>
		{t('destSelect.addInSettingsSuffix')}
	</p>
{/if}
