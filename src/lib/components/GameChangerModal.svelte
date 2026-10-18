<script lang="ts">
  import { deckStore } from '../state/deck.svelte';

  let { isOpen, onClose }: { isOpen: boolean; onClose: () => void } = $props();
</script>

{#if isOpen}
  <div class="modal modal-open z-50 p-2 sm:p-4">
    <div class="modal-box max-w-lg bg-base-100 border border-warning/30 shadow-2xl p-4 sm:p-6 w-full max-h-[92dvh] flex flex-col">
      <div class="flex items-center justify-between pb-3 border-b border-base-300">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-full bg-warning text-warning-content flex items-center justify-center font-bold">
            ⚡
          </div>
          <div>
            <h3 class="font-bold text-lg text-base-content">Game Changers</h3>
            <p class="text-xs text-base-content/60">
              Flagged by Scryfall for <span class="font-semibold text-base-content uppercase">{deckStore.format}</span>
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
          The following cards in this deck are flagged as game changers by Scryfall — cards that significantly impact the format:
        </p>

        <div class="space-y-1.5 max-h-72 overflow-y-auto mt-2">
          {#each deckStore.gameChangerCards as card}
            <div class="flex items-center justify-between p-2.5 bg-warning/10 border border-warning/20 rounded-xl text-xs">
              <div>
                <span class="font-bold text-base-content">{card.name}</span>
                <span class="text-base-content/60 ml-2">({card.scryfall?.type_line || 'Card'})</span>
              </div>
              <span class="badge badge-sm badge-warning font-mono">
                {card.targetCount}x
              </span>
            </div>
          {/each}
        </div>
      </div>

      <div class="modal-action mt-6 pt-3 border-t border-base-300">
        <button onclick={onClose} class="btn btn-sm btn-neutral">
          Got It
        </button>
      </div>
    </div>
  </div>
{/if}