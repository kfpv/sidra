# Sidra Android experiment

This is a feasibility shell for running `music.apple.com` in Android System
WebView. It is intentionally isolated from Sidra's Electron package and uses
Bun for dependency management.

The experiment must prove these behaviours on a physical, Google-certified
Android device before shared application code is extracted:

- Apple ID sign-in and two-factor authentication
- Widevine-protected full-track playback
- persistent authentication after process termination
- playback with the screen locked and the app backgrounded
- recovery after audio focus changes

## Requirements

- Bun 1.3 or newer
- Node.js 22 or newer for the Capacitor CLI
- Android SDK
- JDK supported by the generated Android Gradle Plugin

The repository's `.nvmrc` selects Node 24.

## Commands

Run these from this directory:

```sh
bun install
bun run doctor
bun run build
bun run run
```

The debug APK is written under
`android/app/build/outputs/apk/debug/app-debug.apk`.

Inspect logs with:

```sh
adb logcat -s SidraAndroid chromium
```

Messages prefixed with `[Sidra Android]` report page loads, WebView
capabilities, MusicKit availability and playback events.

## Security boundary

This branch loads remote Apple content as an explicit experiment. Navigation
inside the WebView is restricted to the Apple Music and Apple authentication
hosts in `capacitor.config.ts`. Links to other hosts are sent to Android's
default browser.
