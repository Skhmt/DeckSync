<script lang="ts">
  import { deckStore } from '../state/deck.svelte';
  import { getCardImageUrl, identifyScannedCard, lookupCardById, matchDeckCard } from '../api/scryfall';
  import { isCardDataReady } from '../data/cardData';
  import { ensureCardHashes } from '../data/cardHashes';
  import {
    CARD_ZONE,
    NAME_REGION,
    SET_REGION,
    captureFrame,
    initScanner,
    recognizeNameRegion,
    recognizeSetRegion
  } from '../ocr/cardScanner';
  import { identifyByHash } from '../ocr/hashScanner';
  import type { SetCodeParse } from '../ocr/parse';
  import type { CardScanOutcome, DeckCardItem, ScryfallCard } from '../types';
  import { cameraIconSvg, checkIconSvg, warningIconSvg, xmarkIconSvg } from '../icons';

  let { isOpen, onClose }: { isOpen: boolean; onClose: () => void } = $props();

  type Phase = 'starting' | 'live' | 'processing' | 'result' | 'camera_error';

  let phase = $state<Phase>('starting');
  let statusText = $state('Starting camera...');
  let cameraError = $state('');
  let outcome = $state<CardScanOutcome | null>(null);

  let videoEl: HTMLVideoElement | null = $state(null);
  // Reactive on purpose: the attach $effect below must re-run both when the
  // stream arrives (first open) and when the <video> element remounts (retry).
  let stream = $state<MediaStream | null>(null);
  let videoAspect = $state(4 / 3);

  // A "snap" is a short burst of frames captured back-to-back (invisible to the
  // user) — voting across the burst keeps single-photo scans reliable.
  const BURST_FRAMES = 3;
  const BURST_INTERVAL_MS = 150;

  // Bumped on every scan and on close so in-flight async work bails out
  let scanToken = 0;

  // --- Continuous mode ------------------------------------------------------
  // Pacing between attempts — tesseract itself is the bottleneck, this is just
  // the idle gap before the next frame is grabbed.
  const CONTINUOUS_PACING_MS = 700;
  // A found card stays suppressed while it sits in frame: for at most this long,
  // or until a couple of attempts read nothing (i.e. the card moved away).
  const HIT_COOLDOWN_MS = 8000;
  const REARM_AFTER_MISSES = 2;

  type ScanMode = 'snap' | 'continuous';
  let scanMode = $state<ScanMode>('snap');

  // Continuous mode: a card was identified and is awaiting the user's decision.
  // The camera keeps running behind it — if a different card is found, this is
  // replaced automatically (the old modal goes away on its own).
  interface PendingHit {
    key: string;
    card: ScryfallCard;
    deckCard: DeckCardItem | null;
  }
  let pendingHit = $state<PendingHit | null>(null);
  // True while a continuous attempt is OCR-ing / looking up (drives the status)
  let continuousBusy = $state(false);

  // Dedup bookkeeping (plain lets — internal, never rendered)
  let lastHitKey = '';
  let lastHitAt = 0;
  let missesSinceHit = 0;

  const foundCard = $derived(outcome?.card ?? null);
  const foundDeckCard = $derived(outcome?.deckCard ?? null);

  // Map card-zone-relative region fractions onto full-frame fractions, so the
  // framing guide overlays line up exactly with what the OCR crops.
  const zoneX = (r: number) => CARD_ZONE.x0 + r * (CARD_ZONE.x1 - CARD_ZONE.x0);
  const zoneY = (r: number) => CARD_ZONE.y0 + r * (CARD_ZONE.y1 - CARD_ZONE.y0);
  const zoneW = (r: number) => r * (CARD_ZONE.x1 - CARD_ZONE.x0);
  const zoneH = (r: number) => r * (CARD_ZONE.y1 - CARD_ZONE.y0);

  // --- Camera lifecycle -------------------------------------------------

  $effect(() => {
    if (!isOpen) return;

    outcome = null;
    cameraError = '';
    pendingHit = null;
    openCamera();

    // Warm up the OCR engine in the background so the first scan is snappy
    void initScanner().catch(err => console.warn('OCR engine failed to initialize:', err));
    void ensureCardHashes(); // warm the pHash index so the first snap can use it

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

  // Continuous mode: while the camera is live, attempts run back-to-back —
  // capture one frame, OCR the set-code corner, and only if that doesn't
  // resolve, OCR the name bar, then look the card up on Scryfall. Tesseract
  // paces the loop; no two attempts ever overlap. Leaving the effect (mode
  // switch, close, or phase change) bumps scanToken so an in-flight attempt
  // discards its result instead of firing a stale toast.
  $effect(() => {
    const active = isOpen && scanMode === 'continuous' && phase === 'live';
    if (!active) return;

    continuousBusy = false;
    let cancelled = false;
    void (async () => {
      while (!cancelled) {
        await continuousAttempt();
        if (cancelled) return;
        await sleep(CONTINUOUS_PACING_MS);
      }
    })();

    return () => {
      cancelled = true;
      scanToken++;
      continuousBusy = false;
    };
  });

  function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  /** One continuous-mode attempt: single frame, lazy OCR (corner first, name bar only if needed). */
  async function continuousAttempt() {
    const token = scanToken;
    if (!videoEl || phase !== 'live') return;
    continuousBusy = true;

    try {
      const frame = captureFrame(videoEl);

      // Fastest channel first — pHash against the local index (offline, ~ms).
      // Only when it finds nothing do we spend tesseract time on OCR.
      const hashResult = await hashChannel([frame], token);
      if (token !== scanToken) return;
      if (hashResult.card) {
        handleContinuousHit(hashResult.card);
        return;
      }

      // Fast path — bottom-left corner only (small crop, fast)
      const setRead = await recognizeSetRegion(frame);
      if (token !== scanToken) return;

      let card: ScryfallCard | null = null;
      // The parsed corner is validated against the local printings map inside
      // identifyScannedCard — free, no API call for unknown pairs — so a parse
      // is worth passing through on every attempt. Without the database loaded,
      // keep the old tesseract-confidence gate (the network lookup isn't free).
      if (setRead.parsed && (isCardDataReady() || setRead.confidence >= 60)) {
        card = await identifyScannedCard({
          setCode: setRead.parsed.setCode,
          collectorNumber: setRead.parsed.collectorNumber
        });
        if (token !== scanToken) return;
      }

      // Fallback — name bar (older cards without a printed set code, or a corner
      // read that didn't resolve to a printing). Set info is passed along so the
      // lookup can still do an in-set search.
      if (!card) {
        const nameRead = await recognizeNameRegion(frame);
        if (token !== scanToken) return;
        card = await identifyScannedCard({
          name: nameRead.name,
          setCode: setRead.parsed?.setCode,
          collectorNumber: setRead.parsed?.collectorNumber
        });
      }

      if (token !== scanToken) return;
      if (card) {
        handleContinuousHit(card);
      } else {
        noteContinuousMiss();
      }
    } catch (err) {
      console.warn('Continuous scan attempt failed:', err);
      noteContinuousMiss();
    } finally {
      if (token === scanToken) continuousBusy = false;
    }
  }

  /** A couple of empty reads in a row means the card left the frame — re-arm the dedup. */
  function noteContinuousMiss() {
    if (lastHitKey) {
      missesSinceHit++;
      if (missesSinceHit >= REARM_AFTER_MISSES) lastHitKey = '';
    }
  }

  /** A card was identified in continuous mode: dedup, then pop the confirm modal. */
  function handleContinuousHit(card: ScryfallCard) {
    const key = card.id || `${card.name}|${card.set ?? ''}`;
    const now = Date.now();
    if (key === lastHitKey && now - lastHitAt < HIT_COOLDOWN_MS) return;
    lastHitKey = key;
    lastHitAt = now;
    missesSinceHit = 0;

    // A confirmation is already up for this exact card — keep showing it
    if (pendingHit?.key === key) return;

    // A different card was found: replace the pending confirmation (if any),
    // which dismisses the previous modal automatically.
    const deckCard = matchDeckCard(deckStore.cards, card) ?? null;
    pendingHit = { key, card, deckCard };
    buzz(80);
  }

  /** User confirmed the capture: mark one copy as found (undoable via toast). */
  function confirmPendingHit() {
    const hit = pendingHit;
    if (!hit?.deckCard) return;
    deckStore.recordCameraScan(hit.deckCard.id);
    dismissPendingHit(hit.key);
    buzz(120);
  }

  /** User declined: dismiss the modal without marking anything. */
  function declinePendingHit() {
    const hit = pendingHit;
    if (!hit) return;
    dismissPendingHit(hit.key);
    buzz([40, 60]);
  }

  function dismissPendingHit(key: string) {
    pendingHit = null;
    // Restart the cooldown so a card we just decided on doesn't re-prompt immediately
    lastHitKey = key;
    lastHitAt = Date.now();
  }

  function buzz(pattern: number | number[]) {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      // Haptics unsupported — ignore
    }
  }

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

  /** Result of one identification channel (pHash or OCR). */
  interface ChannelResult {
    card: ScryfallCard | null;
    method: 'ocr' | 'hash';
    ocrSetRaw?: string;
    ocrNameRaw?: string;
    error?: string;
  }

  /**
   * Hash channel — pHash of the art region matched against the local index.
   * Offline and fast (typically well under 100 ms); resolves a null card when
   * nothing matches closely enough so the OCR channel can take over.
   */
  async function hashChannel(frames: HTMLCanvasElement[], token: number): Promise<ChannelResult> {
    try {
      const match = await identifyByHash(frames, videoAspect);
      if (!match) return { card: null, method: 'hash' };
      const card = await lookupCardById(match.entry.id);
      if (token !== scanToken) return { card: null, method: 'hash' };
      return { card, method: 'hash' };
    } catch (err) {
      console.warn('Hash identification failed:', err);
      return { card: null, method: 'hash' };
    }
  }

  /** OCR channel — tesseract pipeline: corner first, name bar as fallback. */
  async function ocrPipeline(frames: HTMLCanvasElement[], token: number): Promise<ChannelResult> {
    let bestSet: { frame: HTMLCanvasElement; text: string; confidence: number; parsed: SetCodeParse | null } | null = null;
    let nameRead: { text: string; confidence: number; name?: string } | null = null;

    // The hash channel may win first — never touch the UI after that.
    const setStatus = (t: string) => {
      if (token === scanToken && phase === 'processing') statusText = t;
    };

    try {
      // Pass 1 — bottom-left corner of every burst frame (small crop, fast).
      // A confident parseable read is enough; no need to OCR the rest.
      for (const frame of frames) {
        const read = await recognizeSetRegion(frame);
        if (token !== scanToken) return { card: null, method: 'ocr' };
        if (!bestSet || read.confidence > bestSet.confidence) {
          bestSet = { frame, text: read.text, confidence: read.confidence, parsed: read.parsed };
        }
        if (read.parsed && read.confidence >= 60) break;
      }

      let card: ScryfallCard | null = null;

      // Pass 2a — when the local printings map confirms the parsed set + number,
      // resolve directly by Scryfall id (IndexedDB cache first — often zero API
      // calls) and skip the slow name-bar OCR entirely.
      if (!card && bestSet?.parsed && isCardDataReady()) {
        setStatus('Matching set code & collector number...');
        card = await identifyScannedCard({
          setCode: bestSet.parsed.setCode,
          collectorNumber: bestSet.parsed.collectorNumber
        });
        if (token !== scanToken) return { card: null, method: 'ocr' };
      }

      // Pass 2b — name bar of every burst frame (older cards without a printed
      // set code, an unconfirmed corner read, or an id fetch that failed). The
      // highest-confidence reading wins.
      if (!card) {
        setStatus('Reading card name...');
        for (const frame of frames) {
          const read = await recognizeNameRegion(frame);
          if (token !== scanToken) return { card: null, method: 'ocr' };
          if (!nameRead || read.confidence > nameRead.confidence) nameRead = read;
        }

        // Pass 3 — resolve the card. Validated against the local database first,
        // so this is a network step only for readings that look real.
        setStatus('Looking up card on Scryfall...');
        card = await identifyScannedCard({
          name: nameRead?.name,
          setCode: bestSet?.parsed?.setCode,
          collectorNumber: bestSet?.parsed?.collectorNumber
        });
      }

      return {
        card,
        method: 'ocr',
        ocrSetRaw: bestSet?.text || undefined,
        ocrNameRaw: nameRead?.text || undefined
      };
    } catch (err) {
      console.error('Card scan failed:', err);
      return {
        card: null,
        method: 'ocr',
        ocrSetRaw: bestSet?.text || undefined,
        ocrNameRaw: nameRead?.text || undefined,
        error: err instanceof Error ? err.message : 'Something went wrong while scanning.'
      };
    }
  }

  async function runScan(frames: HTMLCanvasElement[]) {
    const token = ++scanToken;
    phase = 'processing';
    statusText = 'Reading set code & collector number...';

    // Two channels race on the same frames — pHash (fast, offline) and OCR.
    // Whichever finds a card first wins; if it comes up empty, the other gets
    // its turn before we report failure.
    const tagged = [
      hashChannel(frames, token).then(r => ({ m: 'hash' as const, r })),
      ocrPipeline(frames, token).then(r => ({ m: 'ocr' as const, r }))
    ];
    const settled: Partial<Record<'hash' | 'ocr', ChannelResult>> = {};
    while (Object.keys(settled).length < 2 && !settled.hash?.card && !settled.ocr?.card) {
      const t = await Promise.race(tagged);
      settled[t.m] = t.r;
    }

    const winner = settled.hash?.card ? settled.hash : settled.ocr?.card ? settled.ocr : null;
    const ocr = settled.ocr;
    outcome = {
      card: winner?.card ?? null,
      deckCard: winner?.card ? matchDeckCard(deckStore.cards, winner.card) ?? null : null,
      ocrSetRaw: ocr?.ocrSetRaw,
      ocrNameRaw: ocr?.ocrNameRaw,
      method: winner?.method,
      error: winner ? undefined : (ocr?.error ?? 'Could not identify the card. Try better lighting or a steadier hold.')
    };

    if (token === scanToken) phase = 'result';
  }

  // --- Result actions ------------------------------------------------------

  function handleAccept() {
    const deckCard = foundDeckCard;
    if (!deckCard) return;

    // Record the capture (verifies one copy + tracks repeat captures) and
    // surface the shared undo toast so a misclick can be reverted
    deckStore.recordCameraScan(deckCard.id);
    // Stay in the scanner so the next card can be photographed right away.
    handleRetry();
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
              <button onclick={handleRetry} class="btn btn-outline btn-sm flex-1 gap-1.5">
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
              <div
                class="absolute rounded-lg border-2 border-dashed border-white/40"
                style="left: {CARD_ZONE.x0 * 100}%; top: {CARD_ZONE.y0 * 100}%; width: {(CARD_ZONE.x1 - CARD_ZONE.x0) * 100}%; height: {(CARD_ZONE.y1 - CARD_ZONE.y0) * 100}%;"
              ></div>
              <div
                class="absolute rounded-md border border-primary/70 bg-primary/10"
                style="left: {zoneX(NAME_REGION.x0) * 100}%; top: {zoneY(NAME_REGION.y0) * 100}%; width: {zoneW(NAME_REGION.x1 - NAME_REGION.x0) * 100}%; height: {zoneH(NAME_REGION.y1 - NAME_REGION.y0) * 100}%;"
              >
                <span class="absolute left-1 top-0.5 text-[9px] font-medium text-white/70 bg-black/40 rounded px-1">card name</span>
              </div>
              <div
                class="absolute rounded-md border border-primary/70 bg-primary/10"
                style="left: {zoneX(SET_REGION.x0) * 100}%; top: {zoneY(SET_REGION.y0) * 100}%; width: {zoneW(SET_REGION.x1 - SET_REGION.x0) * 100}%; height: {zoneH(SET_REGION.y1 - SET_REGION.y0) * 100}%;"
              >
                <span class="absolute left-1 top-0.5 text-[9px] font-medium text-white/70 bg-black/40 rounded px-1">set code & #</span>
              </div>
            </div>
          {/if}

          <!-- Continuous mode: confirm a found card (camera keeps running behind it) -->
          {#if scanMode === 'continuous' && pendingHit}
            <div class="absolute inset-x-0 bottom-2 z-20 flex justify-center px-2 pointer-events-none">
              <div
                role="dialog"
                aria-label="Confirm scanned card"
                class="animate-toast-in pointer-events-auto w-full max-w-sm bg-base-100 rounded-2xl border border-base-300 shadow-2xl p-3.5 sm:p-4"
              >
                <div class="flex gap-3 items-start">
                  <img
                    src={getCardImageUrl(pendingHit.card)}
                    alt={pendingHit.card.name}
                    class="w-14 h-auto rounded-md border border-base-300 shadow-sm shrink-0"
                  />
                  <div class="min-w-0 flex-1">
                    <h3 class="font-bold text-sm leading-snug">{pendingHit.card.name}</h3>
                    <p class="text-[11px] text-base-content/60 mt-0.5 truncate">{pendingHit.card.type_line || 'Card'}</p>
                  </div>
                </div>

                {#if pendingHit.deckCard}
                  <div class="mt-2.5 flex items-center gap-2 text-xs bg-success/10 border border-success/30 text-success rounded-lg px-2.5 py-1.5">
                    <span class="w-3.5 h-3.5 shrink-0">{@html checkIconSvg}</span>
                    In your deck — {pendingHit.deckCard.verifiedCount} of {pendingHit.deckCard.targetCount} found so far
                  </div>
                {:else}
                  <div class="mt-2.5 flex items-center gap-2 text-xs bg-warning/10 border border-warning/30 rounded-lg px-2.5 py-1.5">
                    <span class="w-3.5 h-3.5 shrink-0">{@html warningIconSvg}</span>
                    Not in your deck — nothing to mark
                  </div>
                {/if}

                <div class="mt-3 flex gap-2">
                  {#if pendingHit.deckCard}
                    <button
                      onclick={confirmPendingHit}
                      title="Mark one copy as found"
                      class="btn btn-primary btn-sm flex-1 gap-1.5"
                    >
                      <span class="w-3.5 h-3.5 shrink-0">{@html checkIconSvg}</span>
                      Add
                    </button>
                  {/if}
                  <button onclick={declinePendingHit} class="btn btn-outline btn-sm flex-1 gap-1.5">
                    <span class="w-3.5 h-3.5 shrink-0">{@html xmarkIconSvg}</span>
                    Decline
                  </button>
                </div>
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
        <div class="flex flex-col items-center gap-3">
          <!-- Fixed-height row so toggling modes doesn't shift the layout -->
          <div class="h-24 flex items-center justify-center">
            {#if scanMode === 'snap'}
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
            {:else}
              <!-- Continuous: the scanner works on its own; this is just a live status -->
              <div class="flex flex-col items-center gap-2" title="Scanning automatically — no tap needed">
                <span class="w-16 h-16 rounded-full border-4 border-success/70 bg-success/15 flex items-center justify-center">
                  <span class="w-3.5 h-3.5 rounded-full bg-success animate-pulse"></span>
                </span>
                <span class="text-[10px] text-white/60">{continuousBusy ? 'Reading card…' : 'Scanning'}</span>
              </div>
            {/if}
          </div>

          <!-- Scan mode toggle -->
          <div class="join bg-black/40 p-0.5 rounded-lg border border-white/20">
            <button
              onclick={() => { scanMode = 'snap'; pendingHit = null; }}
              class="join-item btn btn-xs font-medium {scanMode === 'snap' ? 'btn-primary' : 'btn-ghost text-white/70'}"
              title="Tap the shutter to scan one card at a time"
            >
              Snap
            </button>
            <button
              onclick={() => { scanMode = 'continuous'; pendingHit = null; }}
              class="join-item btn btn-xs font-medium {scanMode === 'continuous' ? 'btn-primary' : 'btn-ghost text-white/70'}"
              title="Keep the camera running — confirm each card as it's found"
            >
              Continuous
            </button>
          </div>

          <p class="text-center text-[11px] text-white/40 leading-snug">
            {scanMode === 'snap'
              ? 'Fit the card inside the dashed frame — you can hold the phone a bit farther away.'
              : "Hold a card inside the frame — you'll get a prompt to add or decline it."}
          </p>
        </div>
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
