import { describe, expect, it } from 'vitest';
import { isPlaybackSnapshot, PlaybackState } from '../src/playback/protocol';
import {
  initialPlaybackSnapshot,
  reducePlayback,
  toMprisPlaybackStatus,
} from '../src/playback/reducer';

describe('playback reducer', () => {
  it('preserves stable playing state through transient MusicKit states', () => {
    let state = initialPlaybackSnapshot();
    state = reducePlayback(state, {
      type: 'metadata',
      metadata: { name: 'Track' },
      queueLength: 1,
      queueIndex: 0,
    });
    state = reducePlayback(state, { type: 'state', state: PlaybackState.Playing });

    for (const transient of [
      PlaybackState.Seeking,
      PlaybackState.Waiting,
      PlaybackState.Stalled,
      PlaybackState.Loading,
    ]) {
      state = reducePlayback(state, { type: 'state', state: transient });
      expect(state.stableState).toBe('playing');
      expect(state.isPlaying).toBe(true);
    }
  });

  it('retains completed single-item queue metadata', () => {
    let state = initialPlaybackSnapshot();
    state = reducePlayback(state, {
      type: 'metadata',
      metadata: { name: 'Usseewa', artistName: 'Ado' },
      queueLength: 1,
      queueIndex: 0,
    });
    state = reducePlayback(state, {
      type: 'metadata',
      metadata: null,
      queueLength: 1,
      queueIndex: 0,
    });
    state = reducePlayback(state, {
      type: 'state',
      state: PlaybackState.Completed,
    });

    expect(state.metadata).toMatchObject({ name: 'Usseewa' });
    expect(state.stableState).toBe('paused');
  });

  it('clears metadata when the queue is empty', () => {
    let state = initialPlaybackSnapshot();
    state = reducePlayback(state, {
      type: 'metadata',
      metadata: { name: 'Track' },
      queueLength: 1,
      queueIndex: 0,
    });
    state = reducePlayback(state, {
      type: 'metadata',
      metadata: null,
      queueLength: 0,
      queueIndex: -1,
    });

    expect(state.metadata).toBeNull();
    expect(state.positionUs).toBe(0);
  });

  it('keeps the established MPRIS raw-state mapping', () => {
    expect(toMprisPlaybackStatus(PlaybackState.Playing)).toBe('Playing');
    expect(toMprisPlaybackStatus(PlaybackState.Paused)).toBe('Paused');
    expect(toMprisPlaybackStatus(PlaybackState.Stopped)).toBe('Paused');
    expect(toMprisPlaybackStatus(PlaybackState.Loading)).toBe('Stopped');
    expect(toMprisPlaybackStatus(PlaybackState.Seeking)).toBe('Stopped');
    expect(toMprisPlaybackStatus(PlaybackState.Completed)).toBe('Stopped');
  });

  it('validates the complete snapshot contract at the IPC boundary', () => {
    const snapshot = initialPlaybackSnapshot();

    expect(isPlaybackSnapshot(snapshot)).toBe(true);
    expect(isPlaybackSnapshot({ ...snapshot, stableState: 'buffering' })).toBe(false);
    expect(isPlaybackSnapshot({ ...snapshot, positionUs: Number.NaN })).toBe(false);
    expect(isPlaybackSnapshot({ ...snapshot, metadata: [] })).toBe(false);
  });
});
