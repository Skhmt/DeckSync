<script lang="ts">
  import { deckStore } from '../state/deck.svelte';

  const TOAST_DURATION_MS = 5000;

  let toast = $derived(deckStore.verificationToast);

  // Auto-dismiss after a few seconds; the timer restarts whenever a new toast replaces it
  $effect(() => {
    if (!deckStore.verificationToast) return;
    const current = deckStore.verificationToast;
    const id = setTimeout(() => {
      // Only dismiss if this is still the same toast (a newer click may have replaced it)
      if (deckStore.verificationToast === current) {
        deckStore.dismissVerificationToast();
      }
    }, TOAST_DURATION_MS);
    return () => clearTimeout(id);
  });

  let message = $derived(
    toast ? `Marked ${toast.cardName} as ${toast.action === 'found' ? 'found' : 'not found'}` : ''
  );
</script>

{#if toast}
  <div class="fixed bottom-3 sm:bottom-4 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
    <div
      role="status"
      class="animate-toast-in pointer-events-auto flex items-center gap-2 sm:gap-3 bg-base-100 border border-base-300 shadow-xl rounded-full pl-2.5 pr-1 py-1 sm:pl-4 sm:pr-2 sm:py-1.5 max-w-full"
    >
      {#if toast.action === 'found'}
        <span class="w-6 h-6 shrink-0 rounded-full bg-success text-success-content flex items-center justify-center">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      {:else}
        <span class="w-6 h-6 shrink-0 rounded-full bg-error text-error-content flex items-center justify-center">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </span>
      {/if}
      <p class="text-xs sm:text-sm font-medium text-base-content truncate">{message}</p>
      <button
        onclick={() => deckStore.undoVerificationToast()}
        class="btn btn-neutral btn-xs sm:btn-sm rounded-full shrink-0"
        title={toast.action === 'found' ? 'Undo — mark this card as not found again' : 'Undo — mark this card as found again'}
      >
        Undo
      </button>
    </div>
  </div>
{/if}
