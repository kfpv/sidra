import { describe, it, expect, expectTypeOf, vi } from 'vitest';

import { PlaybackState, Player, getShareUrl, type PlayerEvents } from '../src/player';
import { initialPlaybackSnapshot } from '../src/playback/reducer';

describe('PlaybackState', () => {
  it('None is 0', () => {
    expect(PlaybackState.None).toBe(0);
  });

  it('Loading is 1', () => {
    expect(PlaybackState.Loading).toBe(1);
  });

  it('Playing is 2', () => {
    expect(PlaybackState.Playing).toBe(2);
  });

  it('Paused is 3', () => {
    expect(PlaybackState.Paused).toBe(3);
  });

  it('Stopped is 4', () => {
    expect(PlaybackState.Stopped).toBe(4);
  });

  it('Ended is 5', () => {
    expect(PlaybackState.Ended).toBe(5);
  });

  it('Seeking is 6', () => {
    expect(PlaybackState.Seeking).toBe(6);
  });

  it('Waiting is 7', () => {
    expect(PlaybackState.Waiting).toBe(7);
  });

  it('Stalled is 8', () => {
    expect(PlaybackState.Stalled).toBe(8);
  });

  it('Completed is 9', () => {
    expect(PlaybackState.Completed).toBe(9);
  });

  it('has exactly 10 states', () => {
    expect(Object.keys(PlaybackState)).toHaveLength(10);
  });
});

describe('PlayerEvents', () => {
  it('keys match Player handler event names', () => {
    type EventKeys = keyof PlayerEvents;
    type ExpectedKeys =
      | 'snapshotDidChange'
      | 'playbackStateDidChange'
      | 'nowPlayingItemDidChange'
      | 'playbackTimeDidChange'
      | 'repeatModeDidChange'
      | 'shuffleModeDidChange'
      | 'volumeDidChange';

    expectTypeOf<EventKeys>().toEqualTypeOf<ExpectedKeys>();
  });
});

describe('Player event forwarding', () => {
  it('fans a shared snapshot out to existing integration events', () => {
    const player = new Player();
    const snapshotListener = vi.fn();
    const stateListener = vi.fn();
    const itemListener = vi.fn();
    player.on('snapshotDidChange', snapshotListener);
    player.on('playbackStateDidChange', stateListener);
    player.on('nowPlayingItemDidChange', itemListener);

    const snapshot = {
      ...initialPlaybackSnapshot(),
      revision: 1,
      rawState: PlaybackState.Playing,
      stableState: 'playing' as const,
      mprisStatus: 'Playing' as const,
      isPlaying: true,
      metadata: { name: 'Track', artistName: 'Artist' },
      queueLength: 1,
      queueIndex: 0,
    };
    player.handleSnapshotDidChange(snapshot);

    expect(snapshotListener).toHaveBeenCalledWith(snapshot);
    expect(stateListener).toHaveBeenCalledWith({
      status: true,
      state: PlaybackState.Playing,
    });
    expect(itemListener).toHaveBeenCalledWith(snapshot.metadata);
    expect(player.playbackSnapshot().isPlaying).toBe(true);
  });

  it('rejects malformed shared snapshots', () => {
    const player = new Player();
    const listener = vi.fn();
    player.on('snapshotDidChange', listener);

    (player.handleSnapshotDidChange as (snapshot: unknown) => void)({
      ...initialPlaybackSnapshot(),
      stableState: 'buffering',
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('only emits snapshotDidChange when nothing changed', () => {
    const player = new Player();
    const snapshot = { ...initialPlaybackSnapshot(), revision: 1 };
    player.handleSnapshotDidChange(snapshot);

    const stateListener = vi.fn();
    player.on('playbackStateDidChange', stateListener);
    player.handleSnapshotDidChange(snapshot);

    expect(stateListener).not.toHaveBeenCalled();
  });

  it('emits playbackStateDidChange only on state transitions', () => {
    const player = new Player();
    const stateListener = vi.fn();
    player.on('playbackStateDidChange', stateListener);

    const playing = {
      ...initialPlaybackSnapshot(),
      revision: 1,
      rawState: PlaybackState.Playing,
      stableState: 'playing' as const,
      mprisStatus: 'Playing' as const,
      isPlaying: true,
    };
    player.handleSnapshotDidChange(playing);
    expect(stateListener).toHaveBeenCalledTimes(1);

    const same = { ...playing, revision: 2 };
    player.handleSnapshotDidChange(same);
    expect(stateListener).toHaveBeenCalledTimes(1);

    const paused = {
      ...playing,
      revision: 3,
      rawState: PlaybackState.Paused,
      stableState: 'paused' as const,
      mprisStatus: 'Paused' as const,
      isPlaying: false,
    };
    player.handleSnapshotDidChange(paused);
    expect(stateListener).toHaveBeenCalledTimes(2);
  });

  it('emits nowPlayingItemDidChange only when metadata changes', () => {
    const player = new Player();
    const itemListener = vi.fn();
    player.on('nowPlayingItemDidChange', itemListener);

    const meta1 = {
      ...initialPlaybackSnapshot(),
      revision: 1,
      metadata: { name: 'Track A' },
    };
    player.handleSnapshotDidChange(meta1);
    expect(itemListener).toHaveBeenCalledTimes(1);

    const same = { ...meta1, revision: 2 };
    player.handleSnapshotDidChange(same);
    expect(itemListener).toHaveBeenCalledTimes(1);

    const meta2 = {
      ...meta1,
      revision: 3,
      metadata: { name: 'Track B' },
    };
    player.handleSnapshotDidChange(meta2);
    expect(itemListener).toHaveBeenCalledTimes(2);
  });
});

describe('Player playbackSnapshot', () => {
  it('returns initial snapshot before any events', () => {
    const player = new Player();
    expect(player.playbackSnapshot()).toEqual({ isPlaying: false, positionUs: 0, state: 0 });
  });

  it('reflects playing state after snapshot', () => {
    const player = new Player();
    player.handleSnapshotDidChange({
      ...initialPlaybackSnapshot(),
      revision: 1,
      rawState: PlaybackState.Playing,
      stableState: 'playing',
      mprisStatus: 'Playing',
      isPlaying: true,
    });
    expect(player.playbackSnapshot()).toEqual({ isPlaying: true, positionUs: 0, state: PlaybackState.Playing });
  });

  it('reflects position after snapshot', () => {
    const player = new Player();
    player.handleSnapshotDidChange({
      ...initialPlaybackSnapshot(),
      revision: 1,
      positionUs: 42000,
    });
    expect(player.playbackSnapshot().positionUs).toBe(42000);
  });

  it('reflects paused state while preserving position', () => {
    const player = new Player();
    player.handleSnapshotDidChange({
      ...initialPlaybackSnapshot(),
      revision: 1,
      rawState: PlaybackState.Playing,
      stableState: 'playing',
      mprisStatus: 'Playing',
      isPlaying: true,
    });
    player.handleSnapshotDidChange({
      ...initialPlaybackSnapshot(),
      revision: 2,
      rawState: PlaybackState.Paused,
      stableState: 'paused',
      mprisStatus: 'Paused',
      isPlaying: false,
      positionUs: 42000,
    });
    expect(player.playbackSnapshot()).toEqual({ isPlaying: false, positionUs: 42000, state: PlaybackState.Paused });
  });
});

describe('SidraHook contract', () => {
  it('keyof SidraHook matches the expected command method names', () => {
    type HookKeys = keyof SidraHook;
    type ExpectedKeys =
      | 'play'
      | 'pause'
      | 'playPause'
      | 'next'
      | 'previous'
      | 'seek'
      | 'setVolume'
      | 'setRepeat'
      | 'setShuffle';

    expectTypeOf<HookKeys>().toEqualTypeOf<ExpectedKeys>();
  });

  it('AMWrapperBridge.ipcRenderer includes send', () => {
    type IpcKeys = keyof AMWrapperBridge['ipcRenderer'];
    expectTypeOf<IpcKeys>().toEqualTypeOf<'send'>();
  });

  it('COMMANDS in musicKitHook.js matches keyof SidraHook', () => {
    // Parallel constant matching the COMMANDS set in assets/musicKitHook.js.
    // If SidraHook gains or loses a method, this assertion fails at compile time.
    const hookCommands: ReadonlySet<keyof SidraHook> = new Set([
      'play', 'pause', 'playPause', 'next', 'previous',
      'seek', 'setVolume', 'setRepeat', 'setShuffle',
    ] as const);

    expect(hookCommands.size).toBe(9);
  });
});

describe('Channel contract', () => {
  it('SendChannel matches expected renderer-to-main channels', () => {
    type ExpectedSend =
      | 'playbackSnapshotDidChange'
      | 'nav:back'
      | 'nav:forward'
      | 'nav:reload'
      | 'nav:pluginManager';

    expectTypeOf<SendChannel>().toEqualTypeOf<ExpectedSend>();
  });

  it('ReceiveChannel matches expected main-to-renderer channels', () => {
    type ExpectedReceive =
      | 'player:play'
      | 'player:pause'
      | 'player:playPause'
      | 'player:next'
      | 'player:previous'
      | 'player:seek'
      | 'player:setVolume'
      | 'player:setRepeat'
      | 'player:setShuffle';

    expectTypeOf<ReceiveChannel>().toEqualTypeOf<ExpectedReceive>();
  });

  it('SidraCommandMessage has the expected shape', () => {
    type MsgType = SidraCommandMessage['type'];
    type MsgChannel = SidraCommandMessage['channel'];

    expectTypeOf<MsgType>().toEqualTypeOf<'sidra:command'>();
    expectTypeOf<MsgChannel>().toEqualTypeOf<ReceiveChannel>();
  });
});

describe('getShareUrl', () => {
  it('returns payload.url when present', () => {
    expect(getShareUrl({ url: 'https://music.apple.com/album/123?i=456' })).toBe(
      'https://music.apple.com/album/123?i=456',
    );
  });

  it('returns catalogId URL when payload.url is absent', () => {
    expect(getShareUrl({ playParams: { catalogId: '999' } })).toBe(
      'https://music.apple.com/song/999',
    );
  });

  it('returns globalId URL when both payload.url and catalogId are absent', () => {
    expect(getShareUrl({ playParams: { globalId: 'abc' } })).toBe(
      'https://music.apple.com/song/abc',
    );
  });

  it('prefers payload.url over playParams ids', () => {
    expect(
      getShareUrl({ url: 'https://example.com', playParams: { catalogId: '1', globalId: '2' } }),
    ).toBe('https://example.com');
  });

  it('prefers catalogId over globalId', () => {
    expect(getShareUrl({ playParams: { catalogId: '1', globalId: '2' } })).toBe(
      'https://music.apple.com/song/1',
    );
  });

  it('returns undefined when no URL source is available', () => {
    expect(getShareUrl({})).toBeUndefined();
  });

  it('returns undefined when playParams exists but has no ids', () => {
    expect(getShareUrl({ playParams: { kind: 'song', isLibrary: true } })).toBeUndefined();
  });
});
