import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserWindow } from 'electron';

import { Player, PlaybackState } from '../src/player';
import type { IntegrationContext } from '../src/player';
import { initialPlaybackSnapshot } from '../src/playback/reducer';
import type { PlaybackSnapshot } from '../src/playback/protocol';
import * as wedgeDetector from '../src/wedgeDetector';

function makeSnapshot(overrides: Partial<PlaybackSnapshot>): PlaybackSnapshot {
  return {
    ...initialPlaybackSnapshot(),
    revision: 1,
    rawState: PlaybackState.Playing,
    stableState: 'playing',
    mprisStatus: 'Playing',
    isPlaying: true,
    ...overrides,
  };
}

describe('wedgeDetector', () => {
  let player: Player;
  let mockWin: { webContents: { send: ReturnType<typeof vi.fn> } };
  let getMainWindow: () => BrowserWindow | null;

  beforeEach(() => {
    vi.useFakeTimers();
    player = new Player();
    mockWin = {
      webContents: {
        send: vi.fn(),
      },
    };
    getMainWindow = () => mockWin as unknown as BrowserWindow;

    const ctx: IntegrationContext = { player, getMainWindow };
    wedgeDetector.init(ctx);
  });

  afterEach(() => {
    wedgeDetector.reset();
    vi.useRealTimers();
  });

  it('fires skip after STALL_THRESHOLD_MS of stalled playback', () => {
    player.handleSnapshotDidChange(makeSnapshot({}));

    vi.advanceTimersByTime(6000);

    expect(mockWin.webContents.send).toHaveBeenCalledWith(
      'player:next'
    );
  });

  it('does not fire skip before stall threshold', () => {
    player.handleSnapshotDidChange(makeSnapshot({}));

    vi.advanceTimersByTime(4000);

    expect(mockWin.webContents.send).not.toHaveBeenCalled();
  });

  it('does not fire skip when position advances', () => {
    player.handleSnapshotDidChange(makeSnapshot({}));

    for (let i = 1; i <= 8; i++) {
      vi.advanceTimersByTime(1000);
      player.handleSnapshotDidChange(makeSnapshot({ positionUs: i * 1_000_000, revision: i + 1 }));
    }

    expect(mockWin.webContents.send).not.toHaveBeenCalled();
  });

  it('respects MAX_SKIP_ATTEMPTS (3)', () => {
    player.handleSnapshotDidChange(makeSnapshot({}));

    vi.advanceTimersByTime(6000);
    expect(mockWin.webContents.send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(6000);
    expect(mockWin.webContents.send).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(6000);
    expect(mockWin.webContents.send).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(6000);
    expect(mockWin.webContents.send).toHaveBeenCalledTimes(3);
  });

  it('reset() clears state and stops timer', () => {
    player.handleSnapshotDidChange(makeSnapshot({}));

    vi.advanceTimersByTime(3000);

    wedgeDetector.reset();

    vi.advanceTimersByTime(10000);

    expect(mockWin.webContents.send).not.toHaveBeenCalled();
  });

  it('track change resets skip counter', () => {
    player.handleSnapshotDidChange(makeSnapshot({}));

    vi.advanceTimersByTime(6000);
    vi.advanceTimersByTime(6000);
    expect(mockWin.webContents.send).toHaveBeenCalledTimes(2);

    player.handleSnapshotDidChange(makeSnapshot({
      metadata: { name: 'New Track', durationInMillis: 180000 },
      queueLength: 1,
      queueIndex: 0,
      revision: 3,
    }));

    vi.advanceTimersByTime(6000);
    expect(mockWin.webContents.send).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(6000);
    expect(mockWin.webContents.send).toHaveBeenCalledTimes(4);
  });

  it('does not fire skip when playback is paused', () => {
    player.handleSnapshotDidChange(makeSnapshot({}));
    vi.advanceTimersByTime(2000);

    player.handleSnapshotDidChange(makeSnapshot({
      rawState: PlaybackState.Paused,
      stableState: 'paused',
      mprisStatus: 'Paused',
      isPlaying: false,
      revision: 2,
    }));

    vi.advanceTimersByTime(10000);

    expect(mockWin.webContents.send).not.toHaveBeenCalled();
  });

  it('does not fire skip near end of track (within END_SAFETY_MARGIN_MS)', () => {
    player.handleSnapshotDidChange(makeSnapshot({
      metadata: { name: 'Track', durationInMillis: 200000 },
      queueLength: 1,
      queueIndex: 0,
    }));
    player.handleSnapshotDidChange(makeSnapshot({
      metadata: { name: 'Track', durationInMillis: 200000 },
      queueLength: 1,
      queueIndex: 0,
      positionUs: 191_000_000,
      revision: 2,
    }));

    vi.advanceTimersByTime(10000);

    expect(mockWin.webContents.send).not.toHaveBeenCalled();
  });

  it('requires getMainWindow in context', () => {
    const playerOnly: IntegrationContext = { player: new Player() };
    expect(() => wedgeDetector.init(playerOnly)).toThrow('wedgeDetector requires getMainWindow');
  });
});
