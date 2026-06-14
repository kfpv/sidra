import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import log from 'electron-log/main';
import {
  isPlaybackSnapshot,
  PlaybackState,
  type NowPlayingPayload,
  type PlaybackSnapshot as SharedPlaybackSnapshot,
  type PlayParams,
} from './playback/protocol';
import { initialPlaybackSnapshot } from './playback/reducer';

export {
  PlaybackState,
  type NowPlayingPayload,
  type PlayParams,
} from './playback/protocol';

const playerLog = log.scope('player');

/**
 * Derives a shareable Apple Music URL from the payload, falling back to
 * playParams.catalogId or playParams.globalId when payload.url is absent.
 */
export function getShareUrl(payload: NowPlayingPayload): string | undefined {
  if (payload.url) return payload.url;
  const catalogId = payload.playParams?.catalogId;
  if (catalogId) return `https://music.apple.com/song/${catalogId}`;
  const globalId = payload.playParams?.globalId;
  if (globalId) return `https://music.apple.com/song/${globalId}`;
  return undefined;
}

export type PlaybackStatePayload = { status: boolean; state: number } | null;

export interface PlayerEvents {
  snapshotDidChange: [snapshot: SharedPlaybackSnapshot];
  playbackStateDidChange: [payload: PlaybackStatePayload];
  nowPlayingItemDidChange: [payload: NowPlayingPayload | null];
  /** Playback position in microseconds (from MusicKit.currentPlaybackTime * 1e6 in assets/musicKitHook.js:40). */
  playbackTimeDidChange: [payload: number];
  repeatModeDidChange: [payload: number | null];
  shuffleModeDidChange: [payload: number | null];
  volumeDidChange: [payload: number | null];
}

export interface IntegrationContext {
  player: Player;
  getMainWindow?: () => BrowserWindow | null;
}

// Type-safe EventEmitter wrapper. Provides compile-time payload checking on
// emit, on, once, removeListener, and off while preserving full runtime
// compatibility with Node's EventEmitter.
export class TypedEmitter<Events extends { [K in keyof Events]: unknown[] }> extends EventEmitter {
  override emit<K extends keyof Events & string>(event: K, ...args: Events[K]): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof Events & string>(event: K, listener: (...args: Events[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override once<K extends keyof Events & string>(event: K, listener: (...args: Events[K]) => void): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  override removeListener<K extends keyof Events & string>(event: K, listener: (...args: Events[K]) => void): this {
    return super.removeListener(event, listener as (...args: unknown[]) => void);
  }

  override off<K extends keyof Events & string>(event: K, listener: (...args: Events[K]) => void): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}

export interface PlaybackSnapshot {
  isPlaying: boolean;
  positionUs: number;
  state: number;
}

export class Player extends TypedEmitter<PlayerEvents> {
  private _isPlaying = false;
  private _positionUs = 0;
  private _state = 0;
  private _snapshot = initialPlaybackSnapshot();
  private _metadataKey = 'null';

  constructor() {
    super();
  }

  playbackSnapshot(): PlaybackSnapshot {
    return { isPlaying: this._isPlaying, positionUs: this._positionUs, state: this._state };
  }

  handleSnapshotDidChange(snapshot: SharedPlaybackSnapshot): void {
    if (!isPlaybackSnapshot(snapshot)) {
      playerLog.warn('playbackSnapshotDidChange: invalid payload');
      return;
    }

    const previous = this._snapshot;
    this._snapshot = snapshot;
    this._state = snapshot.rawState;
    this._isPlaying = snapshot.isPlaying;
    this._positionUs = snapshot.positionUs;
    this.emit('snapshotDidChange', snapshot);

    if (snapshot.rawState !== previous.rawState) {
      this.emit('playbackStateDidChange', {
        status: snapshot.rawState === PlaybackState.Playing,
        state: snapshot.rawState,
      });
    }

    const metadataKey = JSON.stringify(snapshot.metadata);
    if (metadataKey !== this._metadataKey) {
      this._metadataKey = metadataKey;
      this.emit('nowPlayingItemDidChange', snapshot.metadata);
    }
    if (snapshot.positionUs !== previous.positionUs) {
      this.emit('playbackTimeDidChange', snapshot.positionUs);
    }
    if (snapshot.repeatMode !== previous.repeatMode) {
      this.emit('repeatModeDidChange', snapshot.repeatMode);
    }
    if (snapshot.shuffleMode !== previous.shuffleMode) {
      this.emit('shuffleModeDidChange', snapshot.shuffleMode);
    }
    if (snapshot.volume !== previous.volume) {
      this.emit('volumeDidChange', snapshot.volume);
    }
  }
}
