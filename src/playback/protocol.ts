export interface PlayParams {
  catalogId?: string;
  globalId?: string;
  kind?: string;
  isLibrary?: boolean;
}

export interface NowPlayingPayload {
  name?: string;
  artistName?: string;
  albumName?: string;
  artworkUrl?: string;
  durationInMillis?: number;
  url?: string;
  genreNames?: string[];
  trackId?: string;
  trackNumber?: number;
  audioTraits?: string[];
  targetBitrate?: number;
  discNumber?: number;
  composerName?: string;
  releaseDate?: string;
  contentRating?: string;
  itemType?: string;
  containerId?: string;
  containerType?: string;
  containerName?: string;
  playParams?: PlayParams;
  isrc?: string;
  queueLength?: number;
  queueIndex?: number;
}

export const PlaybackState = {
  None: 0,
  Loading: 1,
  Playing: 2,
  Paused: 3,
  Stopped: 4,
  Ended: 5,
  Seeking: 6,
  Waiting: 7,
  Stalled: 8,
  Completed: 9,
} as const;

export type StablePlaybackState = 'stopped' | 'paused' | 'playing';
export type MprisPlaybackStatus = 'Stopped' | 'Paused' | 'Playing';

export interface PlaybackSnapshot {
  version: 1;
  revision: number;
  rawState: number;
  stableState: StablePlaybackState;
  mprisStatus: MprisPlaybackStatus;
  isPlaying: boolean;
  positionUs: number;
  metadata: NowPlayingPayload | null;
  queueLength: number;
  queueIndex: number;
  repeatMode: number | null;
  shuffleMode: number | null;
  volume: number | null;
}

export function isPlaybackSnapshot(value: unknown): value is PlaybackSnapshot {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const snapshot = value as Record<string, unknown>;
  const metadata = snapshot.metadata;
  return snapshot.version === 1
    && isFiniteNumber(snapshot.revision)
    && isFiniteNumber(snapshot.rawState)
    && (
      snapshot.stableState === 'stopped'
      || snapshot.stableState === 'paused'
      || snapshot.stableState === 'playing'
    )
    && (
      snapshot.mprisStatus === 'Stopped'
      || snapshot.mprisStatus === 'Paused'
      || snapshot.mprisStatus === 'Playing'
    )
    && typeof snapshot.isPlaying === 'boolean'
    && isFiniteNumber(snapshot.positionUs)
    && (
      metadata === null
      || (typeof metadata === 'object' && !Array.isArray(metadata))
    )
    && isFiniteNumber(snapshot.queueLength)
    && isFiniteNumber(snapshot.queueIndex)
    && isNullableFiniteNumber(snapshot.repeatMode)
    && isNullableFiniteNumber(snapshot.shuffleMode)
    && isNullableFiniteNumber(snapshot.volume);
}

export type PlaybackEvent =
  | { type: 'state'; state: number }
  | {
      type: 'metadata';
      metadata: NowPlayingPayload | null;
      queueLength: number;
      queueIndex: number;
    }
  | { type: 'position'; positionUs: number }
  | { type: 'repeat'; mode: number | null }
  | { type: 'shuffle'; mode: number | null }
  | { type: 'volume'; volume: number | null };

export type PlaybackCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'playPause' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; seconds: number }
  | { type: 'setVolume'; volume: number }
  | { type: 'setRepeat'; mode: number }
  | { type: 'setShuffle'; mode: number };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}
