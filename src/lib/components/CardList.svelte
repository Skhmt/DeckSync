<script lang="ts">
  import { deckStore } from "../state/deck.svelte";
  import type { DeckCardItem } from "../types";

  function handleRowClick(card: DeckCardItem) {
    deckStore.toggleCard(card.id);
  }

  function handleCheckboxClick(e: MouseEvent, card: DeckCardItem) {
    e.stopPropagation();
    if (card.verifiedCount >= card.targetCount || card.verifiedCount > 0) {
      deckStore.unverifyCard(card.id);
    } else {
      deckStore.toggleCard(card.id);
    }
  }

  function handleIncrement(e: MouseEvent, card: DeckCardItem) {
    e.stopPropagation();
    deckStore.incrementCard(card.id);
  }

  function handleDecrement(e: MouseEvent, card: DeckCardItem) {
    e.stopPropagation();
    deckStore.decrementCard(card.id);
  }
</script>

<div class="space-y-6 pb-16">
  {#if deckStore.displayedGroups.length === 0 || deckStore.displayedCards.length === 0}
    <div
      class="text-center py-16 px-4 bg-base-200/50 rounded-2xl border border-dashed border-base-300"
    >
      <div
        class="w-16 h-16 mx-auto mb-4 rounded-full bg-base-300 flex items-center justify-center text-base-content/40"
      >
        <svg
          class="w-8 h-8"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <h3 class="text-base font-semibold text-base-content">
        No cards match your filter
      </h3>
      <p class="text-xs text-base-content/60 mt-1">
        Try changing the filter mode or clearing your search term.
      </p>
    </div>
  {:else}
    {#each deckStore.displayedGroups as group}
      {#if group.cards.length > 0}
        <section class="space-y-2">
          {#if deckStore.groupByType}
            <div
              class="flex items-center justify-between border-b border-base-300 pb-1.5 px-2"
            >
              <div class="flex items-center gap-2">
                <h2
                  class="text-sm font-bold text-base-content tracking-wide uppercase"
                >
                  {group.title}
                </h2>
                <span class="badge badge-xs badge-neutral font-mono">
                  {group.cards.reduce((sum, c) => sum + c.targetCount, 0)}
                </span>
              </div>
              <span class="text-xs text-base-content/60">
                {group.cards.reduce((sum, c) => sum + c.verifiedCount, 0)} / {group.cards.reduce(
                  (sum, c) => sum + c.targetCount,
                  0,
                )}
              </span>
            </div>
          {/if}

          <!-- List container -->
          <div
            class="bg-base-100 rounded-xl border border-base-300 overflow-hidden divide-y divide-base-200 shadow-xs"
          >
            {#each group.cards as card (card.id)}
              {@const isVerified = card.verifiedCount >= card.targetCount}
              {@const isPartiallyVerified =
                card.verifiedCount > 0 && card.verifiedCount < card.targetCount}
              {@const isBanned =
                card.scryfall?.legalities?.[deckStore.format] === "banned"}

              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <div
                role="button"
                tabindex="0"
                onclick={() => handleRowClick(card)}
                class="flex items-center justify-between px-3 py-2.5 transition-colors cursor-pointer select-none {isVerified
                  ? 'bg-base-200/40 opacity-50 grayscale'
                  : isPartiallyVerified
                    ? 'bg-warning/5 hover:bg-warning/10'
                    : 'hover:bg-base-200/70'}"
              >
                <!-- Left: Checkbox & Name & Badges -->
                <div class="flex items-center gap-3 min-w-0 pr-2">
                  <!-- Checkbox -->
                  <button
                    onclick={(e) => handleCheckboxClick(e, card)}
                    class="w-6 h-6 rounded flex items-center justify-center shrink-0 border transition-all {isVerified
                      ? 'bg-success text-success-content border-success'
                      : isPartiallyVerified
                        ? 'bg-warning text-warning-content border-warning'
                        : 'border-base-content/30 hover:border-base-content'}"
                    title={isVerified
                      ? "Un-verify card (set to 0)"
                      : "Verify card"}
                    aria-label="Verify checkbox"
                  >
                    {#if isVerified}
                      <svg
                        class="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="3"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    {:else if isPartiallyVerified}
                      <span class="text-[10px] font-bold"
                        >{card.verifiedCount}</span
                      >
                    {/if}
                  </button>

                  <!-- Card info -->
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span
                        class="font-medium text-sm text-base-content truncate {isVerified
                          ? 'line-through text-base-content/60'
                          : ''}"
                      >
                        {card.name}
                      </span>
                      {#if isBanned}
                        <span
                          class="badge badge-error badge-xs font-bold uppercase"
                          >Banned</span
                        >
                      {/if}
                      {#if card.scryfall?.game_changer}
                        <span class="badge badge-warning badge-xs font-bold"
                          >⚡ GC</span
                        >
                      {/if}
                    </div>
                    <div
                      class="text-xs text-base-content/50 truncate flex items-center gap-2"
                    >
                      <span>{card.scryfall?.type_line || "Card"}</span>
                      {#if card.scryfall?.mana_cost}
                        <span class="font-mono text-[11px]"
                          >{card.scryfall.mana_cost}</span
                        >
                      {/if}
                    </div>
                  </div>
                </div>

                <!-- Right: Counter controls -->
                <div class="flex items-center gap-2 shrink-0">
                  {#if card.targetCount > 1}
                    <div
                      class="flex items-center gap-1 bg-base-200 rounded-lg p-0.5 border border-base-300"
                    >
                      <button
                        onclick={(e) => handleDecrement(e, card)}
                        disabled={card.verifiedCount <= 0}
                        class="btn btn-xs btn-square btn-ghost disabled:opacity-30"
                        title="Decrement count"
                        aria-label="Decrement count"
                      >
                        -
                      </button>
                      <span
                        class="font-bold text-xs px-1.5 min-w-[2.5rem] text-center {isVerified
                          ? 'text-success'
                          : isPartiallyVerified
                            ? 'text-warning'
                            : 'text-base-content'}"
                      >
                        {card.verifiedCount}/{card.targetCount}
                      </span>
                      <button
                        onclick={(e) => handleIncrement(e, card)}
                        class="btn btn-xs btn-square btn-ghost"
                        title="Increment count"
                        aria-label="Increment count"
                      >
                        +
                      </button>
                    </div>
                  {:else}
                    <div
                      class="px-2 py-0.5 rounded text-xs font-mono font-medium {isVerified
                        ? 'bg-success/20 text-success'
                        : 'bg-base-200 text-base-content/60'}"
                    >
                      {card.verifiedCount} / 1
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}
    {/each}
  {/if}
</div>
