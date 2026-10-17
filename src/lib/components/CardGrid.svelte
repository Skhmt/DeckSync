<script lang="ts">
  import { deckStore } from '../state/deck.svelte';
  import CardItem from './CardItem.svelte';
</script>

<div class="space-y-8 pb-16">
  {#if deckStore.displayedGroups.length === 0 || deckStore.displayedCards.length === 0}
    <div class="text-center py-16 px-4 bg-base-200/50 rounded-2xl border border-dashed border-base-300">
      <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-base-300 flex items-center justify-center text-base-content/40">
        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h3 class="text-base font-semibold text-base-content">No cards match your filter</h3>
      <p class="text-xs text-base-content/60 mt-1">Try changing the filter mode or clearing your search term.</p>
    </div>
  {:else}
    {#each deckStore.displayedGroups as group, i}
      {#if group.cards.length > 0}
        <section id="category-{i}" class="space-y-3">
          {#if deckStore.groupByType}
            <div class="flex items-center justify-between border-b border-base-300 pb-1.5 sm:pb-2">
              <div class="flex items-center gap-1.5 sm:gap-2">
                <h2 class="text-sm sm:text-base md:text-lg font-bold text-base-content tracking-wide uppercase">
                  {group.title}
                </h2>
                <span class="badge badge-xs sm:badge-sm badge-neutral font-mono">
                  {group.cards.reduce((sum, c) => sum + c.targetCount, 0)}
                </span>
              </div>
              <span class="text-[11px] sm:text-xs text-base-content/60">
                {group.cards.reduce((sum, c) => sum + c.verifiedCount, 0)} / {group.cards.reduce((sum, c) => sum + c.targetCount, 0)} verified
              </span>
            </div>
          {/if}

          <!-- Responsive Card Grid: mobile 2 columns, tablet 3-4, desktop 5-6 -->
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-4">
            {#each group.cards as card (card.id)}
              <CardItem {card} />
            {/each}
          </div>
        </section>
      {/if}
    {/each}
  {/if}
</div>

