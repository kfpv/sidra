// Source for assets/musicKitHook.js — do not edit the built file directly.
import {
  type NowPlayingPayload,
  type PlaybackCommand,
  type PlaybackEvent,
  type PlaybackSnapshot,
} from '../src/playback/protocol';
import {
  initialPlaybackSnapshot,
  reducePlayback,
} from '../src/playback/reducer';

interface MusicKitItem {
  id?: string;
  attributes?: {
    name?: string;
    albumName?: string;
    artistName?: string;
    durationInMillis?: number;
    genreNames?: string[];
    artwork?: { url?: string };
    audioTraits?: string[];
    trackNumber?: number;
    url?: string;
    discNumber?: number;
    composerName?: string;
    releaseDate?: string;
    contentRating?: string;
    isrc?: string;
    playParams?: {
      catalogId?: string;
      globalId?: string;
      kind?: string;
      isLibrary?: boolean;
    };
  };
  container?: {
    id?: string;
    type?: string;
    attributes?: { name?: string };
  };
}

interface MusicKitInstance {
  addEventListener(name: string, listener: (event: Record<string, unknown>) => void): void;
  play(): Promise<void>;
  pause(): Promise<void>;
  skipToNextItem(): Promise<void>;
  skipToPreviousItem(): Promise<void>;
  seekToTime(seconds: number): Promise<void>;
  changeToMediaAtIndex(index: number): Promise<void>;
  isPlaying: boolean;
  playbackState: number;
  currentPlaybackTime: number;
  currentPlaybackDuration: number;
  nowPlayingItem?: MusicKitItem | null;
  nowPlayingItemIndex: number;
  queue?: {
    length?: number;
    _queueItems?: Array<{ isAutoplay: boolean; item: MusicKitItem }>;
    _itemIDs?: string[];
    _position?: number;
    spliceQueueItems?: (index: number, deleteCount: number, items: Array<{ isAutoplay: boolean; item: MusicKitItem }>) => void;
  };
  volume: number;
  repeatMode: number;
  shuffleMode: number;
  bitrate?: number;
  _playbackController?: {
    services: {
      playActivity: {
        _trackers?: Array<{ play: (item: unknown, opts?: unknown) => Promise<void> }>;
      };
      itemLoader: {
        loadItems: (options: unknown) => Promise<unknown>;
        services: {
          mediaAPI: {
            fetchFunction: (url: string | { url: string }, opts?: unknown) => Promise<Response>;
          };
        };
      };
    };
  };
}

interface MusicKitGlobal {
  getInstance(): MusicKitInstance;
}

declare global {
  interface Window {
    MusicKit?: MusicKitGlobal;
    AMWrapper?: {
      ipcRenderer: {
        send(channel: string, data?: unknown): void;
      };
    };
    SidraAndroid?: {
      postMessage(message: string): void;
    };
    __sidraHookedMk?: MusicKitInstance;
  }
}

const SNAPSHOT_CHANNEL = 'playbackSnapshotDidChange';
let snapshot = initialPlaybackSnapshot();
let volumePollTimer: number | null = null;

function publish(event: PlaybackEvent): void {
  snapshot = reducePlayback(snapshot, event);
  sendSnapshot(snapshot);
}

function sendSnapshot(value: PlaybackSnapshot): void {
  if (window.AMWrapper?.ipcRenderer) {
    window.AMWrapper.ipcRenderer.send(SNAPSHOT_CHANNEL, value);
    return;
  }
  window.SidraAndroid?.postMessage(JSON.stringify({
    channel: SNAPSHOT_CHANNEL,
    data: value,
  }));
}

function synchroniseSnapshot(mk: MusicKitInstance): void {
  const item = mk.nowPlayingItem;
  const events: PlaybackEvent[] = [
    {
      type: 'metadata',
      metadata: item ? mapItem(mk, item) : null,
      queueLength: queueLength(mk),
      queueIndex: mk.nowPlayingItemIndex,
    },
    { type: 'state', state: mk.playbackState },
    { type: 'position', positionUs: mk.currentPlaybackTime * 1_000_000 },
    { type: 'repeat', mode: mk.repeatMode },
    { type: 'shuffle', mode: mk.shuffleMode },
    { type: 'volume', volume: mk.volume },
  ];
  for (const event of events) snapshot = reducePlayback(snapshot, event);
  sendSnapshot(snapshot);
}

function queueLength(mk: MusicKitInstance): number {
  return mk.queue?.length ?? 0;
}

function mapItem(mk: MusicKitInstance, item: MusicKitItem): NowPlayingPayload {
  const attributes = item.attributes;
  const playParams = attributes?.playParams;
  return {
    name: attributes?.name,
    albumName: attributes?.albumName,
    artistName: attributes?.artistName,
    durationInMillis: attributes?.durationInMillis,
    genreNames: attributes?.genreNames,
    artworkUrl: attributes?.artwork?.url
      ?.replace('{w}', '512')
      .replace('{h}', '512'),
    trackId: item.id,
    audioTraits: attributes?.audioTraits,
    trackNumber: attributes?.trackNumber,
    targetBitrate: mk.bitrate,
    url: attributes?.url,
    discNumber: attributes?.discNumber,
    composerName: attributes?.composerName,
    releaseDate: attributes?.releaseDate,
    contentRating: attributes?.contentRating,
    itemType: playParams?.kind,
    containerId: item.container?.id,
    containerType: item.container?.type,
    containerName: item.container?.attributes?.name,
    playParams: playParams ? {
      catalogId: playParams.catalogId,
      globalId: playParams.globalId,
      kind: playParams.kind,
      isLibrary: playParams.isLibrary,
    } : undefined,
    isrc: attributes?.isrc,
    queueLength: queueLength(mk),
    queueIndex: mk.nowPlayingItemIndex,
  };
}

function executeCommand(mk: MusicKitInstance, command: PlaybackCommand): void {
  switch (command.type) {
    case 'play':
      void mk.play();
      break;
    case 'pause':
      void mk.pause();
      break;
    case 'playPause':
      void (mk.isPlaying ? mk.pause() : mk.play());
      break;
    case 'next':
      void mk.skipToNextItem();
      break;
    case 'previous':
      void mk.skipToPreviousItem();
      break;
    case 'seek':
      void mk.seekToTime(command.seconds);
      break;
    case 'setVolume':
      mk.volume = command.volume;
      break;
    case 'setRepeat':
      mk.repeatMode = command.mode;
      break;
    case 'setShuffle':
      mk.shuffleMode = command.mode;
      break;
  }
}

function decodeCommand(channel: string, args: unknown[]): PlaybackCommand | null {
  const type = channel.replace('player:', '');
  switch (type) {
    case 'play':
    case 'pause':
    case 'playPause':
    case 'next':
    case 'previous':
      return { type };
    case 'seek':
      return typeof args[0] === 'number' ? { type, seconds: args[0] } : null;
    case 'setVolume':
      return typeof args[0] === 'number' ? { type, volume: args[0] } : null;
    case 'setRepeat':
    case 'setShuffle':
      return typeof args[0] === 'number' ? { type, mode: args[0] } : null;
    default:
      return null;
  }
}

function attachToInstance(mk: MusicKitInstance): void {
  if (volumePollTimer !== null) window.clearInterval(volumePollTimer);

  mk.addEventListener('playbackStateDidChange', event => {
    const state = event.state;
    if (typeof state === 'number') publish({ type: 'state', state });
  });
  mk.addEventListener('nowPlayingItemDidChange', event => {
    const item = event.item as MusicKitItem | null | undefined;
    publish({
      type: 'metadata',
      metadata: item ? mapItem(mk, item) : null,
      queueLength: queueLength(mk),
      queueIndex: mk.nowPlayingItemIndex,
    });
  });
  mk.addEventListener('playbackTimeDidChange', () => {
    publish({ type: 'position', positionUs: mk.currentPlaybackTime * 1_000_000 });
  });
  mk.addEventListener('repeatModeDidChange', () => {
    publish({ type: 'repeat', mode: mk.repeatMode });
  });
  mk.addEventListener('shuffleModeDidChange', () => {
    publish({ type: 'shuffle', mode: mk.shuffleMode });
  });

  let lastVolume = mk.volume;
  mk.addEventListener('volumeDidChange', () => {
    lastVolume = mk.volume;
    publish({ type: 'volume', volume: lastVolume });
  });
  volumePollTimer = window.setInterval(() => {
    if (mk.volume === lastVolume) return;
    lastVolume = mk.volume;
    publish({ type: 'volume', volume: lastVolume });
  }, 250);

  window.__sidraHookedMk = mk;
  synchroniseSnapshot(mk);

  // Install tracking patches. The window.fetch patch (telemetry) installs
  // immediately. The MusicKit-internal patches (tracker, itemLoader) retry
  // via the interval until _playbackController.services is populated.
  installTrackingPatches(mk);
}

// ---------------------------------------------------------------------------
// Local file injection
// ---------------------------------------------------------------------------

interface LocalFileDescriptor {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
  dataBase64: string;
  mimeType: string;
}

let trackerPatched = false;
let itemLoaderPatched = false;
let globalFetchPatched = false;

// Store original fetch before any patches so lrclib fetches use the real native fetch.
const origFetchGlobal = window.fetch;

function installTrackingPatches(mk: MusicKitInstance): void {
  const pc = mk._playbackController;

  // Patch 1: Block play tracking for local items (MPAFTracker.play).
  // Prevents play activity from being constructed — source-level block.
  if (!trackerPatched) {
    const tracker = pc?.services?.playActivity?._trackers?.[0];
    if (tracker?.play) {
      const origPlay = tracker.play.bind(tracker);
      tracker.play = async function (item: unknown, opts?: unknown) {
        if ((item as { id?: string })?.id?.startsWith?.('local')) return;
        return origPlay(item, opts);
      };
      trackerPatched = true;
    }
  }

  // Patch 2: Skip catalog lookup for local items (itemLoader.loadItems).
  // Returns empty array so MusicKit never constructs an amp-api request.
  if (!itemLoaderPatched) {
    const itemLoader = pc?.services?.itemLoader;
    if (itemLoader?.loadItems) {
      const origLoad = itemLoader.loadItems.bind(itemLoader);
      itemLoader.loadItems = async function (options: unknown) {
        if ((options as Record<string, unknown>)?.id?.toString().startsWith?.('local') ||
            (options as Record<string, unknown>)?.item?.id?.toString().startsWith?.('local') ||
            (Array.isArray(options) && options[0]?.id?.toString().startsWith?.('local'))) {
          return [];
        }
        return origLoad(options);
      };
      itemLoaderPatched = true;
    }
  }

  // Network-level blocking (amp-api local catalog lookups, xp.apple.com telemetry)
  // is handled by Electron webRequest.onBeforeRequest in main.ts — the only
  // reliable layer since mediaAPI.fetchFunction is [native code] that bypasses
  // window.fetch.

  // Patch 3: Intercept requests for local items via window.fetch.
  // Catches lyrics (→ lrclib), favourites (→ local config), and blocks
  // everything else with local- IDs. Real track requests pass through.
  if (!globalFetchPatched) {
    const origFetch = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === 'string' ? input
        : input instanceof URL ? input.href
        : input?.url ?? '';

      // Lyrics for local items → fetch from lrclib
      if (url.includes('amp-api.music.apple.com') && url.includes('lyrics') && url.includes('local-')) {
        return fetchLocalLyrics(url);
      }

      // Favourites/unfavourites for local items → save locally via IPC
      if (url.includes('amp-api.music.apple.com') && url.includes('/me/favorites') && init?.body) {
        const body = init.body as string;
        const localMatch = body.match(/local-[a-z0-9]+/i);
        if (localMatch) {
          const isDelete = init.method === 'DELETE';
          const id = localMatch[0];
          const channel = isDelete ? 'localFiles:unfavourite' : 'localFiles:favourite';
          if (window.AMWrapper?.ipcRenderer) {
            window.AMWrapper.ipcRenderer.send(channel, id);
          } else if (window.SidraAndroid?.postMessage) {
            window.SidraAndroid.postMessage(JSON.stringify({ channel, data: id }));
          }
          return Promise.resolve(new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }));
        }
      }

      return origFetch.call(window, input, init);
    };
    globalFetchPatched = true;
  }
}

// ---------------------------------------------------------------------------
// lrclib lyrics
// ---------------------------------------------------------------------------

function lrcToTtml(lrc: string, durationSec: number): string {
  const lines = lrc.split('\n');
  const parsed: Array<{ time: number; text: string }> = [];

  for (const line of lines) {
    const match = line.match(/^\[(\d+:\d+\.\d+)\]\s*(.*)/);
    if (match) {
      const text = match[2].trim();
      if (text.length > 0) {
        const [min, sec] = match[1].split(':');
        const time = parseFloat(min) * 60 + parseFloat(sec);
        parsed.push({ time, text });
      }
    }
  }

  if (parsed.length === 0) return '';

  const durStr = formatTtmlTime(durationSec);

  let ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="Line" xml:lang="en"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal" leadingSilence="0"><translations/></iTunesMetadata></metadata></head><body dur="${durStr}"><div>`;

  for (let i = 0; i < parsed.length; i++) {
    const beginSec = parsed[i].time;
    const endSec = i + 1 < parsed.length ? parsed[i + 1].time : durationSec;
    ttml += `<p begin="${formatTtmlTime(beginSec)}" end="${formatTtmlTime(endSec)}">${escapeXml(parsed[i].text)}</p>`;
  }

  ttml += '</div></body></tt>';
  return ttml;
}

function formatTtmlTime(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${String(min).padStart(2, '0')}:${sec.toFixed(3).padStart(6, '0')}`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function fetchLocalLyrics(url: string): Promise<Response> {
  // Extract item ID from URL: /songs/local-xxx/syllable-lyrics
  const idMatch = url.match(/\/songs\/(local-[^/]+)\//);
  if (!idMatch) return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const localId = idMatch[1];

  // Find the item in the queue to get name/artist/duration
  const mk = window.MusicKit?.getInstance();
  const item = mk?.queue?._queueItems?.find(qi => qi.item?.id === localId)?.item;
  if (!item?.attributes) return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const { name, artistName, durationInMillis } = item.attributes;
  const duration = (durationInMillis || 0) / 1000;

  try {
    const lrclibUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(name || '')}&artist_name=${encodeURIComponent(artistName || '')}&duration=${Math.floor(duration)}`;
    const resp = await origFetchGlobal(lrclibUrl);
    if (!resp.ok) return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const data = await resp.json();
    const lrc = data.syncedLyrics || data.plainLyrics;
    if (!lrc) return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const ttml = data.syncedLyrics ? lrcToTtml(data.syncedLyrics, duration) : '';
    const plainText = data.plainLyrics || '';

    const response = {
      data: [{
        id: localId,
        type: 'syllable-lyrics',
        attributes: {
          playParams: { catalogId: localId, displayType: 2, id: `local_${localId}`, kind: 'lyric' },
          ttmlLocalizations: ttml || `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Line" xml:lang="en"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal" leadingSilence="0"><translations/></iTunesMetadata></metadata></head><body><div><p begin="0:00.000" end="0:05.000">${escapeXml(plainText.split('\n')[0] || '')}</p></div></body></tt>`,
        }
      }]
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
}

function base64ToBlob(dataBase64: string, mimeType: string): string {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType });
  return URL.createObjectURL(blob);
}

function buildLocalFileItem(mk: MusicKitInstance, file: LocalFileDescriptor): { isAutoplay: boolean; item: MusicKitItem } {
  // Get the real MusicKit item prototype from an existing queue item.
  // Doc requirement: "queue must be populated" — without a real item, playback fails.
  const realItem = mk.queue?._queueItems?.[0]?.item;
  const itemProto = realItem ? Object.getPrototypeOf(realItem) : {};

  const blobUrl = base64ToBlob(file.dataBase64, file.mimeType);

  const item = Object.create(itemProto, {
    id:            { value: file.id, writable: true },
    type:          { value: 'song', writable: true },
    playbackType:  { value: 3, writable: true },
    canPlay:       { value: true, writable: true },
    isPlayable:    { value: true, writable: true },
    isReady:       { value: true, writable: true },
    isPlaying:     { value: false, writable: true },
    isLoading:     { value: false, writable: true },
    assetURL:      { value: blobUrl, writable: true },
    rawAssetUrl:   { value: blobUrl, writable: true },
    previewURL:    { value: blobUrl, writable: true },
  });

  item.attributes = {
    name: file.name,
    artistName: file.artist,
    albumName: file.album,
    durationInMillis: file.duration * 1000,
    artwork: {
      url: '',
      width: 300,
      height: 300,
      bgColor: '333333',
      textColor1: 'ffffff',
      textColor2: 'ffffff',
      textColor3: 'ffffff',
      textColor4: 'ffffff',
      hasP3: false,
    },
    url: blobUrl,
    trackNumber: 1,
    discNumber: 1,
    genreNames: [],
    audioTraits: [],
    audioLocale: '',
    hasLyrics: true,
    hasTimeSyncedLyrics: false,
    isAppleDigitalMaster: false,
    isMasteredForItunes: false,
    playParams: { id: file.id, kind: 'song' },
    releaseDate: '2024-01-01',
    previews: [{ url: blobUrl }],
  };

  item._state = { current: 2, set: function () {} };
  item._eventRegistry = { mediaItemStateDidChange: {}, mediaItemStateWillChange: {} };
  item._container = {
    id: 'local',
    type: 'album',
    name: 'Local Files',
    attributes: { name: 'Local Files' },
  };
  item._context = { featureName: 'local' };
  item.assets = [];
  item.keyURLs = {};
  item.hlsMetadata = {};
  item._releaseDate = new Date('2024-01-01');

  return { isAutoplay: false, item };
}

function injectLocalFiles(mk: MusicKitInstance, files: LocalFileDescriptor[]): void {
  installTrackingPatches(mk);

  const q = mk.queue;
  if (!q) {
    console.error('[Sidra] No queue available');
    return;
  }

  const items = files.map(f => buildLocalFileItem(mk, f));

  // Empty queue: start playback directly via mk.play()
  if (!q._queueItems?.length) {
    const playItems = items.map(wi => wi.item);
    void mk.play({ items: playItems });
    console.log(`[Sidra] Empty queue — started playback with ${playItems.length} local file(s)`);
    return;
  }

  const pos = (q._position ?? 0) + 1;
  q.spliceQueueItems?.(pos, 0, items);

  console.log(`[Sidra] Injected ${items.length} local file(s) at position ${pos}`);
}

function start(): void {
  const waitForMusicKit = window.setInterval(() => {
    if (!window.MusicKit) return;
    window.clearInterval(waitForMusicKit);

    const mk = window.MusicKit.getInstance();
    if (window.__sidraHookedMk === mk) return;
    attachToInstance(mk);

    window.addEventListener('message', event => {
      if (event.source !== window) return;
      if (!event.data || event.data.type !== 'sidra:command') return;
      const args = Array.isArray(event.data.args) ? event.data.args : [];
      const command = decodeCommand(event.data.channel, args);
      if (command) executeCommand(window.MusicKit!.getInstance(), command);
    });

    // Handle local files data from main process
    window.addEventListener('message', event => {
      if (event.source !== window) return;
      if (!event.data || event.data.type !== 'sidra:localFiles') return;
      const files = event.data.files;
      if (Array.isArray(files)) {
        injectLocalFiles(window.MusicKit!.getInstance(), files);
      }
    });

    window.setInterval(() => {
      try {
        const current = window.MusicKit!.getInstance();
        if (current !== window.__sidraHookedMk) attachToInstance(current);
        // Retry patches that need _playbackController.services
        if (!trackerPatched || !itemLoaderPatched) installTrackingPatches(current);
      } catch {
        // MusicKit may throw while replacing its singleton.
      }
    }, 5000);
  }, 500);
}

start();
