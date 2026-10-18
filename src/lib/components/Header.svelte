<script lang="ts">
  import { deckStore } from "../state/deck.svelte";
  import type { MTGFormat } from "../types";

  let {
    headerHeight = $bindable(60),
    onOpenImport,
    onOpenHistory,
    onOpenBanned,
  }: {
    headerHeight?: number;
    onOpenImport: () => void;
    onOpenHistory: () => void;
    onOpenBanned: () => void;
  } = $props();

  const formats: { value: MTGFormat; label: string }[] = [
    { value: "commander", label: "Commander / EDH" },
    { value: "standard", label: "Standard" },
    { value: "modern", label: "Modern" },
    { value: "pioneer", label: "Pioneer" },
    { value: "legacy", label: "Legacy" },
    { value: "vintage", label: "Vintage" },
    { value: "pauper", label: "Pauper" },
    { value: "oathbreaker", label: "Oathbreaker" },
  ];

  const colorStyles: Record<
    string,
    { bg: string; text: string; label: string }
  > = {
    W: { bg: "bg-amber-100", text: "text-amber-900", label: "White" },
    U: { bg: "bg-blue-500", text: "text-white", label: "Blue" },
    B: { bg: "bg-neutral-800", text: "text-neutral-200", label: "Black" },
    R: { bg: "bg-red-500", text: "text-white", label: "Red" },
    G: { bg: "bg-emerald-600", text: "text-white", label: "Green" },
  };

  let isLoggingSuccess = $state(false);

  async function handleLogVerification() {
    await deckStore.logVerification();
    isLoggingSuccess = true;
    setTimeout(() => {
      isLoggingSuccess = false;
    }, 2500);
  }
</script>

<header
  bind:clientHeight={headerHeight}
  class="bg-base-200 border-b border-base-100 shadow-sm sticky top-0 z-30"
>
  <div
    class="max-w-7xl mx-auto px-3 sm:px-4 py-2 sm:py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2 sm:gap-3"
  >
    <!-- Top Row on Mobile: Brand, Title & Actions -->
    <div class="flex items-center justify-between gap-2 w-full md:w-auto">
      <!-- Brand & Deck Title -->
      <div class="flex items-center gap-2 sm:gap-3 min-w-0">
        <img
          src={`${import.meta.env.BASE_URL}icon.png`}
          alt="DeckSync"
          class="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl shadow-md object-contain shrink-0"
        />
        <div class="min-w-0">
          <div class="flex items-center gap-1.5 sm:gap-2">
            <h1
              class="text-sm sm:text-lg md:text-xl font-bold tracking-tight text-base-content truncate max-w-[130px] xs:max-w-[190px] sm:max-w-xs md:max-w-md"
            >
              {deckStore.deckName || "DeckSync"}
            </h1>
            {#if deckStore.cards.length > 0}
              <span class="badge badge-xs sm:badge-sm badge-neutral shrink-0 font-mono">
                {deckStore.totalVerifiedCards}/{deckStore.totalExpectedCards}
                <span class="hidden sm:inline ml-0.5">Verified</span>
              </span>
            {/if}
          </div>
          <p class="text-[11px] text-base-content/60 hidden md:block">
            MTG Physical Deck Checklist & Verifier
          </p>
        </div>
      </div>

      <!-- Actions on Mobile (pushed to right) -->
      <div class="flex items-center gap-1.5 sm:gap-2 shrink-0 md:hidden">
        <button
          onclick={onOpenImport}
          class="btn btn-primary btn-xs sm:btn-sm gap-1 shadow-sm"
          title="Import Decklist"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          <span class="text-xs">Import</span>
        </button>

        {#if deckStore.cards.length > 0}
          <button
            onclick={handleLogVerification}
            class="btn btn-outline btn-xs sm:btn-sm px-2 gap-1"
            disabled={isLoggingSuccess}
            title="Save verification log"
          >
            {#if isLoggingSuccess}
              <span class="text-success font-bold text-xs">✓</span>
            {:else}
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
            {/if}
          </button>
        {/if}

        <button
          onclick={onOpenHistory}
          class="btn btn-ghost btn-xs sm:btn-sm btn-square"
          title="Verification History & Logs"
          aria-label="Verification History"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Format & Summary Badges -->
    <div class="flex flex-wrap items-center gap-1.5 sm:gap-2">
      <!-- Format Selector -->
      <div class="flex items-center gap-1">
        <label
          for="format-select"
          class="text-xs font-semibold text-base-content/70 hidden lg:inline"
        >Format:</label>
        <select
          id="format-select"
          class="select select-bordered select-xs sm:select-sm font-medium bg-base-100"
          value={deckStore.format}
          onchange={(e) =>
            (deckStore.format = e.currentTarget.value as MTGFormat)}
        >
          {#each formats as fmt}
            <option value={fmt.value}>{fmt.label}</option>
          {/each}
        </select>
      </div>

      <!-- Color Identity Badges -->
      {#if deckStore.deckColorIdentity.length > 0}
        <div
          class="flex items-center gap-0.5 sm:gap-1 px-1.5 py-0.5 sm:px-2 sm:py-1 bg-base-100 rounded-lg border border-base-300"
          title="Deck Color Identity"
        >
          {#each deckStore.deckColorIdentity as color}
            <span
              class="w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center font-bold text-[10px] sm:text-xs shadow-xs {colorStyles[
                color
              ]?.bg || 'bg-base-300'} {colorStyles[color]?.text ||
                'text-base-content'}"
              title={colorStyles[color]?.label || color}
            >
              {color}
            </span>
          {/each}
        </div>
      {/if}

      <!-- Game Changer Count Badge (Commander / EDH only) -->
      {#if deckStore.isCommander && deckStore.gameChangerCount > 0}
        <div
          class="badge badge-warning badge-xs sm:badge-sm md:badge-md gap-1 font-semibold shadow-xs"
          title="Cards flagged as game changers by Scryfall"
        >
          <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path
              d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"
            />
          </svg>
          <span>{deckStore.gameChangerCount} <span class="hidden sm:inline">Game Changer{deckStore.gameChangerCount === 1 ? "" : "s"}</span><span class="sm:hidden">GC</span></span>
        </div>
      {/if}

      <!-- Banned Cards Alert -->
      {#if deckStore.bannedCards.length > 0}
        <button
          onclick={onOpenBanned}
          class="btn btn-error btn-xs sm:btn-sm gap-1 animate-pulse"
          title="Click to see banned cards found in this deck"
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
              stroke-width="2"
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
          {deckStore.bannedCards.length} Banned!
        </button>
      {/if}

      <!-- Card Count Validation Alert -->
      {#if !deckStore.cardCountValidation.isValid && deckStore.cards.length > 0}
        <div
          class="badge badge-error badge-xs sm:badge-sm md:badge-md gap-1 font-semibold"
          title={deckStore.cardCountValidation.message}
        >
          <svg
            class="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>Count: {deckStore.totalExpectedCards}</span>
        </div>
      {/if}
    </div>

    <!-- Actions on Desktop (hidden on mobile, shown on md+) -->
    <div class="hidden md:flex items-center gap-2">
      <button
        onclick={onOpenImport}
        class="btn btn-primary btn-sm gap-1.5 shadow-sm"
      >
        <svg
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
          />
        </svg>
        <span>Import</span>
      </button>

      {#if deckStore.cards.length > 0}
        <button
          onclick={handleLogVerification}
          class="btn btn-outline btn-sm gap-1.5"
          disabled={isLoggingSuccess}
          title="Save this verification checkpoint to permanent local log"
        >
          {#if isLoggingSuccess}
            <span
              class="text-success font-bold text-xs flex items-center gap-1"
            >
              ✓ Logged!
            </span>
          {:else}
            <svg
              class="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
              />
            </svg>
            <span class="hidden sm:inline">Save Log</span>
          {/if}
        </button>
      {/if}

      <button
        onclick={onOpenHistory}
        class="btn btn-ghost btn-sm btn-square"
        title="Verification History & Logs"
        aria-label="Verification History"
      >
        <svg
          class="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </button>
    </div>
  </div>

  <!-- Progress bar across entire deck -->
  {#if deckStore.cards.length > 0}
    <div class="w-full bg-base-300 h-1.5 overflow-hidden">
      <div
        class="bg-success h-full transition-all duration-300 ease-out"
        style="width: {deckStore.verificationPercentage}%"
      ></div>
    </div>
  {/if}
</header>
