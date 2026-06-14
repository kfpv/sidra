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
  isPlaying: boolean;
  playbackState: number;
  currentPlaybackTime: number;
  currentPlaybackDuration: number;
  nowPlayingItem?: MusicKitItem | null;
  nowPlayingItemIndex: number;
  queue?: { length?: number };
  volume: number;
  repeatMode: number;
  shuffleMode: number;
  bitrate?: number;
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

    window.setInterval(() => {
      try {
        const current = window.MusicKit!.getInstance();
        if (current !== window.__sidraHookedMk) attachToInstance(current);
      } catch {
        // MusicKit may throw while replacing its singleton.
      }
    }, 5000);
  }, 500);
}

start();
