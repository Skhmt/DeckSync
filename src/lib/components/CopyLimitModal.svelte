<script lang="ts">
  import { deckStore } from '../state/deck.svelte';
  import type { DeckCardItem } from '../types';
  import { cloneIconSvg } from '../icons';

  let { isOpen, onClose }: { isOpen: boolean; onClose: () => void } = $props();

  const isUniqueFormat = $derived(
    deckStore.format === 'commander' || deckStore.format === 'oathbreaker'
  );

  /** Short explanation of why a card's count exceeds the format's limit */
  function violationReason(card: DeckCardItem): string {
    if (isUniqueFormat) {
      return 'Only one copy of each card is allowed';
    }
    if (card.scryfall?.legalities?.[deckStore.format] === 'restricted') {
      return `Restricted to 1 copy in ${deckStore.format}`;
    }
    return 'Max 4 copies in the main deck';
  }
</script>

{#if isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal modal-open z-50 p-2 sm:p-4" onclick={onClose}>
    <div
      class="modal-box max-w-lg bg-base-100 border border-error/30 shadow-2xl p-4 sm:p-6 w-full max-h-[92dvh] flex flex-col"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between pb-3 border-b border-base-300">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-full bg-error text-error-content flex items-center justify-center">
            <span class="w-4.5 h-4.5">{@html cloneIconSvg}</span>
          </div>
          <div>
            <h3 class="font-bold text-lg text-base-content">Too Many Copies</h3>
            <p class="text-xs text-base-content/60">
              Format: <span class="font-semibold text-base-content uppercase">{deckStore.format}</span>
            </p>
          </div>
        </div>
        <button
          onclick={onClose}
          class="btn btn-sm btn-circle btn-ghost"
          aria-label="Close modal"
        >
          ✕
        </button>
      </div>

      <div class="mt-4 space-y-2">
        <p class="text-xs text-base-content/70">
          {#if isUniqueFormat}
            {deckStore.format === 'oathbreaker' ? 'Oathbreaker' : 'Commander'} decks may only contain one copy of each card (basic lands are unlimited). The following cards exceed that limit:
          {:else}
            You may include up to 4 copies of a non-land card in your main deck — restricted cards are limited to 1, and basic lands are unlimited. Sideboard copies don't count. The following cards exceed their limit:
          {/if}
        </p>

        <div class="space-y-1.5 max-h-72 overflow-y-auto mt-2">
          {#each deckStore.copyLimitViolations as card}
            {@const limit = deckStore.getCopyLimit(card)}
            <div class="flex items-center justify-between p-2.5 bg-error/10 border border-error/20 rounded-xl text-xs">
              <div class="min-w-0">
                <span class="font-bold text-error">{card.name}</span>
                <span class="text-base-content/60 ml-2 truncate inline-block max-w-[180px] align-bottom">({card.scryfall?.type_line || 'Card'})</span>
                <p class="text-base-content/50 mt-0.5">{violationReason(card)}</p>
              </div>
              <span class="badge badge-sm badge-error font-mono shrink-0 ml-2">
                {card.targetCount}x / max {limit ?? 1}
              </span>
            </div>
          {/each}
        </div>
      </div>

    </div>
  </div>
{/if}