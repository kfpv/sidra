import {
  PlaybackState,
  type MprisPlaybackStatus,
  type PlaybackEvent,
  type PlaybackSnapshot,
  type StablePlaybackState,
} from './protocol';

export function initialPlaybackSnapshot(): PlaybackSnapshot {
  return {
    version: 1,
    revision: 0,
    rawState: PlaybackState.None,
    stableState: 'stopped',
    mprisStatus: 'Stopped',
    isPlaying: false,
    positionUs: 0,
    metadata: null,
    queueLength: 0,
    queueIndex: -1,
    repeatMode: null,
    shuffleMode: null,
    volume: null,
  };
}

export function toMprisPlaybackStatus(state: number): MprisPlaybackStatus {
  if (state === PlaybackState.Playing) return 'Playing';
  if (state === PlaybackState.Paused || state === PlaybackState.Stopped) {
    return 'Paused';
  }
  return 'Stopped';
}

export function toStablePlaybackState(
  state: number,
  previous: StablePlaybackState,
  hasMetadata: boolean,
): StablePlaybackState {
  if (state === PlaybackState.Playing) return 'playing';
  if (
    state === PlaybackState.Paused
    || state === PlaybackState.Stopped
    || state === PlaybackState.Ended
    || state === PlaybackState.Completed
  ) {
    return hasMetadata ? 'paused' : 'stopped';
  }
  if (state === PlaybackState.None) {
    return hasMetadata ? 'paused' : 'stopped';
  }
  return previous;
}

export function reducePlayback(
  snapshot: PlaybackSnapshot,
  event: PlaybackEvent,
): PlaybackSnapshot {
  let next: PlaybackSnapshot;

  switch (event.type) {
    case 'state': {
      const stableState = toStablePlaybackState(
        event.state,
        snapshot.stableState,
        snapshot.metadata !== null,
      );
      next = {
        ...snapshot,
        rawState: event.state,
        stableState,
        mprisStatus: toMprisPlaybackStatus(event.state),
        isPlaying: stableState === 'playing',
      };
      break;
    }
    case 'metadata': {
      const retainCompletedItem =
        event.metadata === null
        && event.queueLength > 0
        && snapshot.metadata !== null;
      const metadata = retainCompletedItem ? snapshot.metadata : event.metadata;
      next = {
        ...snapshot,
        metadata,
        queueLength: event.queueLength,
        queueIndex: event.queueIndex,
        stableState: toStablePlaybackState(
          snapshot.rawState,
          snapshot.stableState,
          metadata !== null,
        ),
        positionUs: metadata === null ? 0 : snapshot.positionUs,
      };
      break;
    }
    case 'position':
      next = { ...snapshot, positionUs: event.positionUs };
      break;
    case 'repeat':
      next = { ...snapshot, repeatMode: event.mode };
      break;
    case 'shuffle':
      next = { ...snapshot, shuffleMode: event.mode };
      break;
    case 'volume':
      next = { ...snapshot, volume: event.volume };
      break;
  }

  return { ...next, revision: snapshot.revision + 1 };
}
