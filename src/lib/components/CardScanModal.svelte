<script lang="ts">
  import { deckStore } from '../state/deck.svelte';
  import { getCardImageUrl, identifyScannedCard, matchDeckCard } from '../api/scryfall';
  import {
    NAME_REGION,
    SET_REGION,
    captureFrame,
    initScanner,
    recognizeNameRegion,
    recognizeSetRegion
  } from '../ocr/cardScanner';
  import type { SetCodeParse } from '../ocr/parse';
  import type { CardScanOutcome, ScryfallCard } from '../types';
  import { cameraIconSvg, checkIconSvg, warningIconSvg, xmarkIconSvg } from '../icons';

  let { isOpen, onClose }: { isOpen: boolean; onClose: () => void } = $props();

  type Phase = 'starting' | 'live' | 'processing' | 'result' | 'camera_error';

  let phase = $state<Phase>('starting');
  let statusText = $state('Starting camera...');
  let cameraError = $state('');
  let outcome = $state<CardScanOutcome | null>(null);

  let videoEl: HTMLVideoElement | null = $state(null);
  let stream: MediaStream | null = null;
  let videoAspect = $state(4 / 3);

  // A "snap" is a short burst of frames captured back-to-back (invisible to the
  // user) — voting across the burst keeps single-photo scans reliable.
  const BURST_FRAMES = 3;
  const BURST_INTERVAL_MS = 150;

  // Bumped on every scan and on close so in-flight async work bails out
  let scanToken = 0;

  const foundCard = $derived(outcome?.card ?? null);
  const foundDeckCard = $derived(outcome?.deckCard ?? null);

  // --- Camera lifecycle -------------------------------------------------

  $effect(() => {
    if (!isOpen) return;

    outcome = null;
    cameraError = '';
    openCamera();

    // Warm up the OCR engine in the background so the first scan is snappy
    void initScanner().catch(err => console.warn('OCR engine failed to initialize:', err));

    return () => {
      scanToken++;
      stopStream();
    };
  });

  // Re-attach a running stream whenever the <video> element (re)appears in the
  // DOM. The element is unmounted while the result panel is shown, so without
  // this "Try Again" would mount a fresh video element with no source — a
  // black screen even though the camera stream is still alive.
  $effect(() => {
    const el = videoEl;
    const s = stream;
    if (el && s && el.srcObject !== s) {
      el.srcObject = s;
      void el.play().catch(() => {});
    }
  });

  async function openCamera() {
    const token = ++scanToken;
    phase = 'starting';
    statusText = 'Starting camera...';

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('unsupported');
      }
      const s = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1440 }
        }
      });

      if (token !== scanToken) {
        // Modal was closed while the permission prompt was open
        s.getTracks().forEach(t => t.stop());
        return;
      }

      stream = s; // the attach $effect wires it to the <video> element
      phase = 'live';
    } catch (err) {
      if (token !== scanToken) return;
      cameraError = friendlyCameraError(err);
      phase = 'camera_error';
    }
  }

  function stopStream() {
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    if (videoEl) videoEl.srcObject = null;
  }

  function friendlyCameraError(err: unknown): string {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return 'Camera access was denied. Allow camera permission for this site, then try again.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'No camera was found on this device.';
    }
    if (name === 'NotReadableError') {
      return 'The camera is busy in another app. Close it and try again.';
    }
    if (name === 'OverconstrainedError') {
      return 'This camera does not support the requested settings. Try again or use a different device.';
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return 'This browser does not support camera access.';
    }
    return 'Could not start the camera. Please try again.';
  }

  // --- Capture -------------------------------------------------------------

  function nextFrame(): Promise<void> {
    return new Promise(r => setTimeout(r, BURST_INTERVAL_MS));
  }

  /** Captures a short burst of frames back-to-back, then scans them. */
  async function handleSnap() {
    if (!videoEl || phase !== 'live') return;
    const frames: HTMLCanvasElement[] = [];
    for (let i = 0; i < BURST_FRAMES; i++) {
      frames.push(captureFrame(videoEl));
      if (i < BURST_FRAMES - 1) await nextFrame();
    }
    void runScan(frames);
  }

  // --- Scan pipeline ------------------------------------------------------

  async function runScan(frames: HTMLCanvasElement[]) {
    const token = ++scanToken;
    phase = 'processing';
    statusText = 'Reading set code & collector number...';

    let bestSet: { frame: HTMLCanvasElement; text: string; confidence: number; parsed: SetCodeParse | null } | null = null;
    let nameRead: { text: string; confidence: number; name?: string } | null = null;

    try {
      // Pass 1 — bottom-left corner of every burst frame (small crop, fast).
      // A confident parseable read is enough; no need to OCR the rest.
      for (const frame of frames) {
        const read = await recognizeSetRegion(frame);
        if (token !== scanToken) return;
        if (!bestSet || read.confidence > bestSet.confidence) {
          bestSet = { frame, text: read.text, confidence: read.confidence, parsed: read.parsed };
        }
        if (read.parsed && read.confidence >= 60) break;
      }

      // Pass 2 — name bar of every burst frame (fallback for older cards that
      // don't print a set code, and as a candidate name for the printing lookup).
      // The highest-confidence reading wins.
      statusText = 'Reading card name...';
      for (const frame of frames) {
        const read = await recognizeNameRegion(frame);
        if (token !== scanToken) return;
        if (!nameRead || read.confidence > nameRead.confidence) nameRead = read;
      }

      // Pass 3 — resolve the card on Scryfall (the only network step)
      statusText = 'Looking up card on Scryfall...';
      const card: ScryfallCard | null = await identifyScannedCard({
        name: nameRead?.name,
        setCode: bestSet?.parsed?.setCode,
        collectorNumber: bestSet?.parsed?.collectorNumber
      });
      if (token !== scanToken) return;

      outcome = {
        card,
        deckCard: card ? matchDeckCard(deckStore.cards, card) ?? null : null,
        ocrSetRaw: bestSet?.text || undefined,
        ocrNameRaw: nameRead?.text || undefined
      };
    } catch (err) {
      console.error('Card scan failed:', err);
      outcome = {
        card: null,
        deckCard: null,
        ocrSetRaw: bestSet?.text || undefined,
        ocrNameRaw: nameRead?.text || undefined,
        error: err instanceof Error ? err.message : 'Something went wrong while scanning.'
      };
    }

    if (token === scanToken) phase = 'result';
  }

  // --- Result actions ------------------------------------------------------

  function handleAccept() {
    const deckCard = foundDeckCard;
    if (!deckCard) return;

    const previousCount = deckCard.verifiedCount;
    deckStore.incrementCard(deckCard.id);
    // Reuse the shared undo toast so a misclick can be reverted
    deckStore.verificationToast = {
      cardId: deckCard.id,
      cardName: deckCard.name,
      previousCount,
      action: 'found'
    };
    handleClose();
  }

  function handleRetry() {
    outcome = null;
    if (stream && stream.getVideoTracks().some(t => t.readyState === 'live')) {
      phase = 'live'; // camera is still running — go straight back to it
    } else {
      openCamera();
    }
  }

  function handleClose() {
    scanToken++;
    onClose();
  }

  function handleVideoMetadata() {
    if (videoEl && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
      videoAspect = videoEl.videoWidth / videoEl.videoHeight;
    }
  }
</script>

{#if isOpen}
  <div class="fixed inset-0 z-50 bg-black flex flex-col">
    <!-- Top bar -->
    <div class="flex items-center justify-between px-2 sm:px-4 py-2.5 text-white/90 shrink-0">
      <button
        onclick={handleClose}
        class="btn btn-circle btn-ghost btn-sm text-white/70 hover:text-white"
        aria-label="Close scanner"
      >
        ✕
      </button>
      <div class="flex items-center gap-2">
        <span class="w-4 h-4">{@html cameraIconSvg}</span>
        <h2 class="font-bold text-sm sm:text-base">Scan a Card</h2>
      </div>
      <span class="w-6"></span>
    </div>

    <!-- Result panel -->
    {#if phase === 'result'}
      <div class="flex-1 min-h-0 overflow-y-auto flex items-center justify-center px-3 sm:px-4 pb-4">
        <div class="w-full max-w-sm bg-base-100 rounded-2xl border border-base-300 shadow-2xl p-4 sm:p-5">
          {#if foundCard}
            <!-- Card identified -->
            <div class="flex gap-3.5 items-start">
              <img
                src={getCardImageUrl(foundCard)}
                alt={foundCard.name}
                class="w-20 h-auto rounded-lg border border-base-300 shadow-md shrink-0"
              />
              <div class="min-w-0 flex-1">
                <h3 class="font-bold text-sm sm:text-base leading-snug">{foundCard.name}</h3>
                <p class="text-[11px] text-base-content/60 mt-0.5 truncate">{foundCard.type_line || 'Card'}</p>
                {#if foundCard.set}
                  <p class="text-[11px] font-mono text-base-content/70 mt-1">
                    #{foundCard.collector_number ?? '?'} · {foundCard.set.toUpperCase()}
                  </p>
                {/if}
              </div>
            </div>

            {#if foundDeckCard}
              <div class="mt-3 flex items-center gap-2 text-xs bg-success/10 border border-success/30 text-success rounded-xl px-3 py-2">
                <span class="w-4 h-4 shrink-0">{@html checkIconSvg}</span>
                In this deck — {foundDeckCard.verifiedCount} of {foundDeckCard.targetCount} verified
              </div>
            {:else}
              <div class="mt-3 flex items-center gap-2 text-xs bg-warning/10 border border-warning/30 rounded-xl px-3 py-2">
                <span class="w-4 h-4 shrink-0">{@html warningIconSvg}</span>
                This card isn't in your loaded deck
              </div>
            {/if}

            <div class="mt-4 flex gap-2.5">
              <button
                onclick={handleAccept}
                disabled={!foundDeckCard}
                title={foundDeckCard ? 'Mark one copy as found' : 'Only cards in this deck can be verified'}
                class="btn btn-primary btn-sm flex-1 gap-1.5"
              >
                <span class="w-3.5 h-3.5 shrink-0">{@html checkIconSvg}</span>
                Accept
              </button>
              <button onclick={handleClose} class="btn btn-outline btn-sm flex-1 gap-1.5">
                <span class="w-3.5 h-3.5 shrink-0">{@html xmarkIconSvg}</span>
                Wrong Card
              </button>
            </div>
          {:else}
            <!-- Identification failed -->
            <div class="flex flex-col items-center text-center gap-2 py-2">
              <div class="w-10 h-10 rounded-full bg-error/15 text-error flex items-center justify-center">
                <span class="w-5 h-5">{@html warningIconSvg}</span>
              </div>
              <h3 class="font-bold text-base">Couldn't Identify Card</h3>
              <p class="text-xs text-base-content/60">
                {outcome?.error
                  ? outcome.error
                  : 'Try better lighting, hold the card flat, and make sure it fills the frame.'}
              </p>
              {#if outcome?.ocrSetRaw || outcome?.ocrNameRaw}
                <div class="w-full text-left bg-base-200 rounded-lg p-2.5 mt-1 space-y-1">
                  <p class="text-[10px] uppercase tracking-wider text-base-content/40 font-semibold">What the scanner read</p>
                  {#if outcome?.ocrSetRaw}
                    <p class="text-xs font-mono truncate">bottom-left: “{outcome.ocrSetRaw}”</p>
                  {/if}
                  {#if outcome?.ocrNameRaw}
                    <p class="text-xs font-mono truncate">top: “{outcome.ocrNameRaw}”</p>
                  {/if}
                </div>
              {/if}
            </div>
            <div class="mt-4 flex gap-2.5">
              <button onclick={handleRetry} class="btn btn-primary btn-sm flex-1">Try Again</button>
              <button onclick={handleClose} class="btn btn-outline btn-sm flex-1">Cancel</button>
            </div>
          {/if}
        </div>
      </div>
    {:else}
      <!-- Camera view -->
      <div class="flex-1 min-h-0 flex items-center justify-center px-2 sm:px-4 pb-2">
        <div class="relative max-w-full" style="aspect-ratio: {videoAspect}; height: 100%;">
          <video
            bind:this={videoEl}
            autoplay
            playsinline
            muted
            onloadedmetadata={handleVideoMetadata}
            class="w-full h-full object-fill rounded-xl bg-black"
          ></video>

          <!-- Framing guide (mirrors the OCR crop regions) -->
          {#if phase === 'live'}
            <div class="absolute inset-0 pointer-events-none">
              <div class="absolute left-[3%] right-[3%] top-[2.5%] bottom-[2.5%] rounded-lg border-2 border-dashed border-white/40"></div>
              <div
                class="absolute rounded-md border border-primary/70 bg-primary/10"
                style="left: {NAME_REGION.x0 * 100}%; top: {NAME_REGION.y0 * 100}%; width: {(NAME_REGION.x1 - NAME_REGION.x0) * 100}%; height: {(NAME_REGION.y1 - NAME_REGION.y0) * 100}%;"
              >
                <span class="absolute left-1 top-0.5 text-[9px] font-medium text-white/70 bg-black/40 rounded px-1">card name</span>
              </div>
              <div
                class="absolute rounded-md border border-primary/70 bg-primary/10"
                style="left: {SET_REGION.x0 * 100}%; top: {SET_REGION.y0 * 100}%; width: {(SET_REGION.x1 - SET_REGION.x0) * 100}%; height: {(SET_REGION.y1 - SET_REGION.y0) * 100}%;"
              >
                <span class="absolute left-1 top-0.5 text-[9px] font-medium text-white/70 bg-black/40 rounded px-1">set code & #</span>
              </div>
            </div>
          {/if}

          <!-- Processing overlay -->
          {#if phase === 'processing'}
            <div class="absolute inset-0 rounded-xl bg-black/80 flex flex-col items-center justify-center gap-3 text-white px-6">
              <div class="w-10 h-10 rounded-full border-[3px] border-primary border-t-transparent animate-spin"></div>
              <p class="text-sm font-medium text-center">{statusText}</p>
              <p class="text-[11px] text-white/50 text-center">OCR runs on your device — no photos leave this phone.</p>
            </div>
          {/if}

          <!-- Starting overlay -->
          {#if phase === 'starting'}
            <div class="absolute inset-0 rounded-xl bg-black flex flex-col items-center justify-center gap-3">
              <div class="w-10 h-10 rounded-full border-[3px] border-white/60 border-t-transparent animate-spin"></div>
              <p class="text-sm text-white/70">{statusText}</p>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Bottom controls -->
    <div class="shrink-0 px-4 pt-2 pb-[max(env(safe-area-inset-bottom),12px)]">
      {#if phase === 'live'}
        <div class="flex items-center justify-center">
          <!-- Snap a photo (a short burst is captured automatically for reliability) -->
          <button
            onclick={handleSnap}
            class="flex flex-col items-center gap-1.5 group"
            title="Capture a photo of the card"
          >
            <span class="w-16 h-16 rounded-full border-4 border-white/80 bg-white/20 group-hover:bg-white/30 flex items-center justify-center transition-colors">
              <span class="w-12 h-12 rounded-full bg-white/90"></span>
            </span>
            <span class="text-[10px] text-white/60">Snap</span>
          </button>
        </div>
        <p class="text-center text-[11px] text-white/40 mt-3 leading-snug">
          Line the card up in the frame — its set code & number (bottom-left) or name (top) will be read.
        </p>
      {:else if phase === 'camera_error'}
        <div class="flex flex-col items-center gap-3 text-white/80 py-4 px-6 text-center">
          <p class="text-sm">{cameraError}</p>
          <div class="flex gap-2">
            <button onclick={openCamera} class="btn btn-primary btn-sm">Retry</button>
            <button onclick={handleClose} class="btn btn-ghost btn-sm text-white/70">Close</button>
          </div>
        </div>
      {:else if phase === 'processing'}
        <p class="text-center text-[11px] text-white/40 py-2">Hold the card steady — analyzing locally…</p>
      {/if}
    </div>
  </div>
{/if}
