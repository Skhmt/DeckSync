<script lang="ts">
  import { deckStore } from '../state/deck.svelte';

  let {
    headerHeight = 60,
    filterHeight = $bindable(56),
  }: {
    headerHeight?: number;
    filterHeight?: number;
  } = $props();

  const filterOptions: { id: 'all' | 'not_found' | 'found'; label: string; shortLabel: string; count?: number }[] = $derived([
    { id: 'all', label: 'Full Deck', shortLabel: 'All', count: deckStore.totalExpectedCards },
    { id: 'not_found', label: 'Only Not Found', shortLabel: 'Missing', count: deckStore.totalExpectedCards - deckStore.totalVerifiedCards },
    { id: 'found', label: 'Only Found', shortLabel: 'Found', count: deckStore.totalVerifiedCards }
  ]);
</script>

<div
  bind:clientHeight={filterHeight}
  class="bg-base-200/90 backdrop-blur-md border-b border-base-300 py-2 sm:py-2.5 px-3 sm:px-4 sticky z-20 shadow-xs transition-[top] duration-150"
  style="top: {headerHeight}px;"
>
  <div class="max-w-7xl mx-auto flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2 sm:gap-3">
    <!-- View Filters: Full Deck / Only Not Found / Only Found -->
    <div class="w-full md:w-auto">
      <div class="join bg-base-100 p-0.5 rounded-lg border border-base-300 shadow-xs w-full sm:w-auto grid grid-cols-3 sm:flex">
        {#each filterOptions as opt}
          <button
            class="join-item btn btn-xs sm:btn-sm font-medium transition-all px-1.5 sm:px-3 {deckStore.filterMode === opt.id ? 'btn-primary shadow-xs' : 'btn-ghost'}"
            onclick={() => deckStore.filterMode = opt.id}
          >
            <span class="hidden sm:inline">{opt.label}</span>
            <span class="sm:hidden">{opt.shortLabel}</span>
            <span class="badge badge-xs {deckStore.filterMode === opt.id ? 'badge-primary-content text-primary' : 'badge-neutral'}">
              {opt.count ?? 0}
            </span>
          </button>
        {/each}
      </div>
    </div>

    <!-- Search + Grouping + View Layout Toggles -->
    <div class="flex items-center justify-between md:justify-end gap-1.5 sm:gap-2 w-full md:w-auto">
      <!-- Search Input -->
      <div class="relative flex-1 sm:w-48 md:w-56">
        <input
          type="text"
          placeholder="Filter cards..."
          class="input input-bordered input-sm w-full pr-7 bg-base-100 text-xs sm:text-sm"
          bind:value={deckStore.searchQuery}
        />
        {#if deckStore.searchQuery}
          <button
            onclick={() => deckStore.searchQuery = ''}
            class="absolute right-2 top-1/2 -translate-y-1/2 text-base-content/40 hover:text-base-content text-xs p-1"
            aria-label="Clear search"
          >
            ✕
          </button>
        {/if}
      </div>

      <!-- Group By Type vs Flat Alphabetical Toggle -->
      <button
        onclick={() => deckStore.groupByType = !deckStore.groupByType}
        class="btn btn-sm {deckStore.groupByType ? 'btn-neutral' : 'btn-outline'} gap-1 px-2 sm:px-3 shrink-0"
        title={deckStore.groupByType ? 'Grouped by card type, then alphabetical' : 'Flat alphabetical list (ignoring type)'}
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7" />
        </svg>
        <span class="hidden sm:inline">{deckStore.groupByType ? 'By Type' : 'Flat A-Z'}</span>
      </button>

      <!-- View Switcher (Grid vs List) -->
      <div class="join bg-base-100 rounded-lg border border-base-300 shrink-0">
        <button
          onclick={() => deckStore.viewMode = 'grid'}
          class="join-item btn btn-sm px-2.5 {deckStore.viewMode === 'grid' ? 'btn-neutral' : 'btn-ghost'}"
          title="Visual card grid view"
          aria-label="Grid view"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
        </button>
        <button
          onclick={() => deckStore.viewMode = 'list'}
          class="join-item btn btn-sm px-2.5 {deckStore.viewMode === 'list' ? 'btn-neutral' : 'btn-ghost'}"
          title="Text-based list view"
          aria-label="List view"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
        </button>
      </div>

      <!-- Quick Check/Uncheck Menu -->
      <div class="dropdown dropdown-end shrink-0">
        <div tabindex="0" role="button" class="btn btn-sm btn-ghost btn-square" aria-label="More checklist actions">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
          </svg>
        </div>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <ul tabindex="0" class="dropdown-content menu p-2 shadow-lg bg-base-100 rounded-box w-44 z-50 border border-base-300">
          <li>
            <button onclick={() => deckStore.checkAll()} class="text-xs">
              ✓ Check All Cards
            </button>
          </li>
          <li>
            <button onclick={() => deckStore.uncheckAll()} class="text-xs text-error">
              ✕ Reset Checklist (0)
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</div>
