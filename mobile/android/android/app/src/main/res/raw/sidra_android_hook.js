(function () {
  'use strict';

  if (location.origin !== 'https://music.apple.com') return;
  if (window.__sidraAndroidDiagnosticsInstalled) return;
  window.__sidraAndroidDiagnosticsInstalled = true;

  const prefix = '[Sidra Android]';
  const log = (message, value) => {
    if (value === undefined) {
      console.info(`${prefix} ${message}`);
    } else {
      console.info(`${prefix} ${message}`, value);
    }
  };

  log('diagnostic hook started');
  log('user agent', navigator.userAgent);
  log('platform', navigator.platform);
  log('Encrypted Media Extensions', {
    mediaKeys: typeof HTMLMediaElement.prototype.setMediaKeys === 'function',
    requestMediaKeySystemAccess:
      typeof navigator.requestMediaKeySystemAccess === 'function',
  });

  if (typeof navigator.requestMediaKeySystemAccess === 'function') {
    navigator
      .requestMediaKeySystemAccess('com.widevine.alpha', [
        {
          initDataTypes: ['cenc'],
          audioCapabilities: [
            { contentType: 'audio/mp4; codecs="mp4a.40.2"' },
          ],
        },
      ])
      .then(() => log('Widevine key-system probe succeeded'))
      .catch((error) => log('Widevine key-system probe failed', error.message));
  }

  const waitForMusicKit = window.setInterval(() => {
    if (!window.MusicKit) return;

    let musicKit;
    try {
      musicKit = window.MusicKit.getInstance();
    } catch (error) {
      return;
    }

    if (!musicKit || typeof musicKit.addEventListener !== 'function') return;
    window.clearInterval(waitForMusicKit);
    log('MusicKit instance found');

    musicKit.addEventListener('playbackStateDidChange', ({ state }) => {
      log('playback state', state);
    });

    musicKit.addEventListener('nowPlayingItemDidChange', ({ item }) => {
      log(
        'now playing',
        item
          ? {
              id: item.id,
              name: item.attributes?.name,
              artistName: item.attributes?.artistName,
              durationInMillis: item.attributes?.durationInMillis,
            }
          : null,
      );
    });

    musicKit.addEventListener('mediaPlaybackError', (error) => {
      log('media playback error', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
      });
    });
  }, 500);

  window.setTimeout(() => {
    if (!window.MusicKit) log('MusicKit not found after 30 seconds');
  }, 30_000);
})();
