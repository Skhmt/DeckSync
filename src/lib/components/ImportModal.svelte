<script lang="ts">
  import { deckStore } from '../state/deck.svelte';

  let { isOpen, onClose }: { isOpen: boolean; onClose: () => void } = $props();

  let activeTab = $state<'paste' | 'url'>('paste');
  let pasteText = $state('');
  let deckNameInput = $state('');
  let urlInput = $state('');
  let errorMessage = $state('');
  let isImporting = $state(false);

  let detectedPlatform = $derived.by(() => {
    const val = urlInput.trim().toLowerCase();
    if (val.includes('moxfield.com')) return 'Moxfield';
    if (val.includes('archidekt.com')) return 'Archidekt';
    if (val.includes('mtggoldfish.com')) return 'MTGGoldfish';
    if (val.includes('tappedout.net')) return 'TappedOut';
    if (val.startsWith('http')) return 'Web Deck';
    return null;
  });

  async function handleImportPaste() {
    if (!pasteText.trim()) {
      errorMessage = 'Please paste a decklist first.';
      return;
    }
    errorMessage = '';
    isImporting = true;
    try {
      await deckStore.loadFromText(pasteText, deckNameInput.trim() || undefined);
      onClose();
    } catch (err: any) {
      errorMessage = err.message || 'Failed to parse decklist.';
    } finally {
      isImporting = false;
    }
  }

  async function handleImportUrl() {
    if (!urlInput.trim()) {
      errorMessage = 'Please enter a valid deck URL.';
      return;
    }
    errorMessage = '';
    isImporting = true;
    try {
      await deckStore.loadFromUrl(urlInput.trim());
      onClose();
    } catch (err: any) {
      errorMessage = err.message || 'Failed to import from URL. Please try copying and pasting the decklist text.';
    } finally {
      isImporting = false;
    }
  }

</script>

{#if isOpen}
  <div class="modal modal-open z-50">
    <div class="modal-box max-w-2xl bg-base-100 border border-base-300 shadow-2xl p-6">
      <!-- Modal Header -->
      <div class="flex items-center justify-between pb-3 border-b border-base-300">
        <div>
          <h3 class="font-bold text-lg text-base-content">Import Decklist</h3>
          <p class="text-xs text-base-content/60 mt-0.5">
            Moxfield, Archidekt, MTGGoldfish, TappedOut, MTG Arena & plain text
          </p>
        </div>
        <button
          onclick={onClose}
          class="btn btn-sm btn-circle btn-ghost"
          aria-label="Close modal"
        >
          ✕
        </button>
      </div>

      <!-- Tabs -->
      <div class="tabs tabs-boxed bg-base-200 mt-4 p-1">
        <button
          class="tab flex-1 font-medium {activeTab === 'paste' ? 'tab-active' : ''}"
          onclick={() => { activeTab = 'paste'; errorMessage = ''; }}
        >
          Paste Decklist
        </button>
        <button
          class="tab flex-1 font-medium {activeTab === 'url' ? 'tab-active' : ''}"
          onclick={() => { activeTab = 'url'; errorMessage = ''; }}
        >
          Import from URL
        </button>
      </div>

      <!-- Error Message -->
      {#if errorMessage}
        <div class="alert alert-error text-xs py-2 mt-3 shadow-xs">
          <span>{errorMessage}</span>
        </div>
      {/if}

      <!-- Tab Content: Paste -->
      {#if activeTab === 'paste'}
        <div class="space-y-3 mt-4">
          <div>
            <label for="deck-name-input" class="label text-xs font-semibold py-1">Deck Name (Optional)</label>
            <input
              id="deck-name-input"
              type="text"
              placeholder="e.g. Atraxa Counters"
              class="input input-bordered input-sm w-full bg-base-200/50"
              bind:value={deckNameInput}
            />
          </div>

          <div>
            <div class="py-1">
              <label for="decklist-textarea" class="label text-xs font-semibold py-0">Decklist Text</label>
            </div>
            <textarea
              id="decklist-textarea"
              placeholder="1 Sol Ring&#10;1 Command Tower&#10;3 Forest&#10;4 Lightning Bolt"
              rows="8"
              class="textarea textarea-bordered w-full font-mono text-xs bg-base-200/50"
              bind:value={pasteText}
            ></textarea>
          </div>
        </div>
      {:else}
        <!-- Tab Content: URL -->
        <div class="space-y-4 mt-4">
          <div>
            <label for="deck-url-input" class="label text-xs font-semibold py-1">Supported Deck URL</label>
            <div class="relative">
              <input
                id="deck-url-input"
                type="url"
                placeholder="https://www.moxfield.com/decks/..."
                class="input input-bordered input-sm w-full bg-base-200/50 pr-24"
                bind:value={urlInput}
              />
              {#if detectedPlatform}
                <span class="absolute right-2 top-1/2 -translate-y-1/2 badge badge-sm badge-primary">
                  {detectedPlatform}
                </span>
              {/if}
            </div>
          </div>

          <div class="bg-base-200/50 p-3 rounded-xl border border-base-300 text-xs text-base-content/70 space-y-1.5">
            <p class="font-semibold text-base-content">Supported URL sources:</p>
            <ul class="list-disc list-inside space-y-0.5 text-[11px]">
              <li><strong>Moxfield:</strong> <code>moxfield.com/decks/&lt;id&gt;</code></li>
              <li><strong>Archidekt:</strong> <code>archidekt.com/decks/&lt;id&gt;</code></li>
              <li><strong>MTGGoldfish:</strong> <code>mtggoldfish.com/deck/&lt;id&gt;</code></li>
              <li><strong>TappedOut:</strong> <code>tappedout.net/mtg-decks/&lt;slug&gt;</code></li>
            </ul>
            <p class="text-[11px] text-base-content/50 pt-1">
              Note: DeckSync uses CORS proxies to fetch public deck data. If a provider blocks third-party proxies, simply use their export button to copy and paste the text list.
            </p>
          </div>
        </div>
      {/if}

      <!-- Modal Footer -->
      <div class="modal-action mt-6 pt-3 border-t border-base-300">
        <button
          onclick={onClose}
          class="btn btn-sm btn-ghost"
          disabled={isImporting}
        >
          Cancel
        </button>

        {#if activeTab === 'paste'}
          <button
            onclick={handleImportPaste}
            class="btn btn-sm btn-primary gap-2"
            disabled={isImporting || !pasteText.trim()}
          >
            {#if isImporting}
              <span class="loading loading-spinner loading-xs"></span>
              <span>Loading Deck...</span>
            {:else}
              <span>Import & Verify</span>
            {/if}
          </button>
        {:else}
          <button
            onclick={handleImportUrl}
            class="btn btn-sm btn-primary gap-2"
            disabled={isImporting || !urlInput.trim()}
          >
            {#if isImporting}
              <span class="loading loading-spinner loading-xs"></span>
              <span>Fetching Deck...</span>
            {:else}
              <span>Fetch Deck</span>
            {/if}
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

