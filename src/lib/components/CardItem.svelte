<script lang="ts">
  import type { DeckCardItem } from "../types";
  import { deckStore } from "../state/deck.svelte";
  import { getCardImageUrl } from "../api/scryfall";

  let { card }: { card: DeckCardItem } = $props();

  let activeFaceIndex = $state(0);
  let hasFaces = $derived(
    Boolean(card.scryfall?.card_faces && card.scryfall.card_faces.length > 1),
  );

  let isVerified = $derived(card.verifiedCount >= card.targetCount);
  let isPartiallyVerified = $derived(
    card.verifiedCount > 0 && card.verifiedCount < card.targetCount,
  );
  let isBanned = $derived(
    card.scryfall?.legalities?.[deckStore.format] === "banned",
  );

  let currentImageUrl = $derived(
    getCardImageUrl(card.scryfall, activeFaceIndex),
  );

  function handleCardClick() {
    deckStore.toggleCard(card.id);
  }

  function handleIncrement(e: MouseEvent) {
    e.stopPropagation();
    deckStore.incrementCard(card.id);
  }

  function handleDecrement(e: MouseEvent) {
    e.stopPropagation();
    deckStore.decrementCard(card.id);
  }

  function handleFlip(e: MouseEvent) {
    e.stopPropagation();
    activeFaceIndex = activeFaceIndex === 0 ? 1 : 0;
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  role="button"
  tabindex="0"
  onclick={handleCardClick}
  class="relative rounded-2xl overflow-hidden shadow-md group transition-all duration-200 cursor-pointer select-none border-2 {isVerified
    ? 'border-success/50 card-verified'
    : isPartiallyVerified
      ? 'border-warning'
      : 'border-transparent card-unverified hover:shadow-xl hover:scale-[1.02]'}"
>
  <!-- Card Image or Fallback Container -->
  <div
    class="aspect-[5/7] bg-neutral-900 w-full relative overflow-hidden flex flex-col justify-between"
  >
    {#if currentImageUrl}
      <img
        src={currentImageUrl}
        alt={card.name}
        loading="lazy"
        class="w-full h-full object-cover transition-transform duration-300 pointer-events-none"
      />
    {:else}
      <!-- Fallback when Scryfall image is not available or custom card -->
      <div
        class="w-full h-full p-4 flex flex-col justify-between bg-gradient-to-b from-neutral-800 to-neutral-950 text-neutral-100"
      >
        <div>
          <span
            class="text-xs font-mono uppercase tracking-wider text-neutral-400"
          >
            {card.scryfall?.type_line || "Card"}
          </span>
          <h3 class="font-bold text-base mt-1 line-clamp-3">{card.name}</h3>
        </div>
        <div class="text-xs text-neutral-400">
          {card.scryfall?.mana_cost || ""}
        </div>
      </div>
    {/if}

    <!-- Verified Checkmark Giant Overlay when Verified -->
    {#if isVerified}
      <div
        class="absolute inset-0 bg-black/40 flex items-center justify-center pointer-events-none"
      >
        <div
          class="w-14 h-14 rounded-full bg-success text-success-content flex items-center justify-center shadow-lg border-2 border-white/50"
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
              stroke-width="3.5"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
      </div>
    {/if}

    <!-- Top Right: Banned & Game Changer Badges & Flip Button -->
    <div class="absolute top-2 right-2 z-10 flex flex-col items-end gap-1.5">
      {#if isBanned}
        <span
          class="badge badge-error badge-xs sm:badge-sm font-bold shadow-md uppercase tracking-wider"
        >
          Banned
        </span>
      {/if}

      {#if card.scryfall?.game_changer}
        <span
          class="badge badge-warning badge-xs font-bold shadow-md"
          title="Scryfall Game Changer"
        >
          ⚡ GC
        </span>
      {/if}

      {#if hasFaces}
        <button
          onclick={handleFlip}
          class="btn btn-circle btn-xs bg-black/70 hover:bg-black text-white border-white/30 shadow-md backdrop-blur-xs"
          title="Flip card face"
          aria-label="Flip card face"
        >
          <svg
            class="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2.5"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      {/if}
    </div>

    <!-- Bottom Bar: Multi-copy count & +/- buttons -->
    <div
      class="absolute bottom-2 inset-x-2 z-10 flex items-center justify-between"
    >
      {#if card.targetCount > 1}
        <div
          class="flex items-center gap-1 bg-black/80 backdrop-blur-md rounded-xl p-1 border border-white/20 shadow-md w-full justify-between"
        >
          <!-- Decrement button -->
          <button
            onclick={handleDecrement}
            disabled={card.verifiedCount <= 0}
            class="btn btn-square btn-xs btn-neutral text-white disabled:opacity-30 disabled:bg-transparent"
            title="Decrement verified count"
            aria-label="Decrement count"
          >
            -
          </button>

          <!-- Count Display: Verified / Target -->
          <span
            class="font-bold text-xs px-2 {isVerified
              ? 'text-success'
              : isPartiallyVerified
                ? 'text-warning'
                : 'text-white'}"
          >
            {card.verifiedCount} / {card.targetCount}
          </span>

          <!-- Increment button -->
          <button
            onclick={handleIncrement}
            class="btn btn-square btn-xs btn-neutral text-white"
            title="Increment verified count"
            aria-label="Increment count"
          >
            +
          </button>
        </div>
      {:else}
        <!-- Single copy: compact name bar -->
        <div
          class="bg-black/70 backdrop-blur-xs px-2 py-1 rounded-md text-[11px] font-medium text-white/90 truncate w-full border border-white/10 shadow-xs"
        >
          {card.name}
        </div>
      {/if}
    </div>
  </div>
</div>
