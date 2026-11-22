# Local File Injection into MusicKit Queue

How to inject and play local audio files inside Apple Music's web UI by directly manipulating MusicKit's internal queue data structures.

## Status

Proof of concept — queue injection and tracking patches work on desktop (Electron + CastLabs). API response interception and DOM injection for playlist views proven via CDP. Not wired into Sidra's UI yet.

## Prerequisites

- Sidra running with MusicKit loaded and a track playing (queue must be populated)
- CDP (Chrome DevTools Protocol) access — either Electron `--remote-debugging-port` or Capacitor `webContentsDebuggingEnabled: true`
- A local audio file (tested with `.m4a`)

## How to Reproduce

### 1. Start Sidra with CDP

```bash
just run-cdp
# or
npx electron . --remote-debugging-port=9222
```

Note the DevTools WebSocket URL from stdout (e.g. `DevTools listening on ws://127.0.0.1:57164/devtools/browser/...`).

### 2. Connect to the Apple Music page

```bash
curl -s http://127.0.0.1:<CDP_PORT>/json/list
```

Pick the target with `url: https://music.apple.com/...` (not the plugin manager window).

### 3. Serve the local file

The renderer runs on `https://music.apple.com`, which blocks `fetch()` to `localhost` (mixed content / CORS). Workaround: serve via HTTP on localhost and fetch from the page.

```bash
python3 -m http.server 18932 --directory "/path/to/music/"
```

If the browser blocks mixed-content fetch, the alternative is to read the file in the main process (Node.js / Capacitor) and pass it to the renderer via IPC.

### 4. Create blob URL in the renderer

Connect to the Apple Music page's WebSocket and execute:

```js
fetch("http://127.0.0.1:18932/song.m4a")
  .then(r => r.blob())
  .then(blob => {
    window.__localBlobUrl = URL.createObjectURL(blob);
  });
```

Or, if mixed-content is blocked, pass the file as base64 from the main process:

```js
// Main process reads file, base64-encodes, injects via evaluateJavascript
const b64 = "<base64 data>";
const binary = atob(b64);
const bytes = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
const blob = new Blob([bytes], { type: "audio/m4a" });
window.__localBlobUrl = URL.createObjectURL(blob);
```

### 5. Get a real MusicKit item's prototype

This is the critical step. MusicKit items have methods (`resetState`, `addEventListener`, `dispatchEvent`, etc.) that MusicKit calls internally during playback. Without these on the prototype, `changeToMediaAtIndex` throws `h.resetState is not a function`.

```js
const realItem = window.MusicKit.getInstance().queue._queueItems[0].item;
const itemProto = Object.getPrototypeOf(realItem);
```

### 6. Build and inject the queue item

```js
const mk = window.MusicKit.getInstance();
const q = mk.queue;
const blobUrl = window.__localBlobUrl;

// Create item inheriting the real prototype
const item = Object.create(itemProto, {
  id:            { value: "local-001", writable: true },
  type:          { value: "song", writable: true },
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

// Required fields that MusicKit reads
item.attributes = {
  name: "Song Title",
  artistName: "Artist",
  albumName: "Album",
  durationInMillis: 180000,       // ms
  artwork: {
    url: "",                       // or a real URL
    width: 300, height: 300,
    bgColor: "000000",
    textColor1: "ffffff", textColor2: "ffffff",
    textColor3: "ffffff", textColor4: "ffffff",
    hasP3: false,
  },
  url: blobUrl,
  trackNumber: 1,
  discNumber: 1,
  genreNames: [],
  audioTraits: [],
  audioLocale: "",
  hasLyrics: false,
  hasTimeSyncedLyrics: false,
  isAppleDigitalMaster: false,
  isMasteredForItunes: false,
  playParams: { id: "local-001", kind: "song" },
  releaseDate: "2024-01-01",
  previews: [{ url: blobUrl }],
};

item._state = { current: 2, set: function() {} };
item._eventRegistry = { mediaItemStateDidChange: {}, mediaItemStateWillChange: {} };
item._container = { id: "local", type: "album", name: "Local Files",
                    attributes: { name: "Local Files" } };
item._context = { featureName: "local" };
item.assets = [];
item.keyURLs = {};
item.hlsMetadata = {};
item._releaseDate = new Date("2024-01-01");

// Splice into queue after current track
const pos = q._position + 1;
q.spliceQueueItems(pos, 0, [{ isAutoplay: false, item }]);
```

### 7. Play it

```js
await mk.changeToMediaAtIndex(pos);
// or
await mk.skipToNextItem();
```

## Queue Internal Structure

```
mk.queue
├── _queueItems[]          # Array of { isAutoplay, item } wrappers
├── _itemIDs[]             # Parallel array of string IDs
├── _position              # Current track index
├── _dispatcher            # Event bus (publishes queueModified, etc.)
├── playbackMode           # 0=sequential, 1=...
├── repeatable             # { canSetRepeatMode, _repeatMode }
└── _isRestricted

Queue prototype methods:
  append, appendQueueItems, spliceQueueItems, remove, clear, reset,
  item(index), queueItem(index), indexForItem, updateItems,
  clearAfterCurrent, findPlayableIndexForward, findPlayableIndexBackward

Queue wrapper: { isAutoplay: boolean, item: MediaItem }
```

## Item Internal Structure

```
item (inherits from real MusicKit MediaItem prototype)
├── id                    # Unique string
├── type                  # "song", "musicVideo", etc.
├── playbackType          # 3 = on-demand
├── canPlay               # boolean
├── isPlayable            # boolean
├── isReady               # boolean
├── assetURL              # Audio stream URL (blob: for local files)
├── rawAssetUrl           # Same as assetURL
├── previewURL            # Required — MusicKit validates this exists
├── attributes
│   ├── name, artistName, albumName
│   ├── durationInMillis
│   ├── artwork { url, width, height, bgColor, textColor1-4, hasP3 }
│   ├── url
│   ├── trackNumber, discNumber
│   ├── genreNames[], audioTraits[]
│   ├── playParams { id, kind }
│   ├── releaseDate
│   └── previews[{ url }]
├── _state { current: 2 }            # 2 = ready
├── _eventRegistry { mediaItemStateDidChange, mediaItemStateWillChange }
├── _container { id, type, name, attributes }
├── _context { featureName }
├── assets[]
├── keyURLs{}
├── hlsMetadata{}
├── _releaseDate
└── Methods (from prototype):
    resetState, addEventListener, dispatchEvent, removeEventListener,
    beginMonitoringStateDidChange, endMonitoringStateDidChange,
    beginMonitoringStateWillChange, endMonitoringStateWillChange,
    isEqual, restrict, notSupported, updateFromLoadError,
    _removePlayableData, toString, _handleGlobalStorageEvent,
    dispatchDistributedEvent
```

## Key Insight: Why `Object.create(itemProto)` Is Required

MusicKit's playback engine calls methods on queue items during track transitions:

1. `changeToMediaAtIndex(pos)` → calls `item.resetState()` to clear previous state
2. The item must have `addEventListener`, `dispatchEvent` for state change notifications
3. Without these methods on the prototype chain, playback silently fails with `playbackState: 4` (error)

A plain object with the right properties but wrong prototype will:
- ✅ Insert into the queue (spliceQueueItems accepts it)
- ✅ Show up in the queue UI
- ❌ Fail to play (`h.resetState is not a function`)

Using `Object.create(realItemPrototype)` inherits all 18+ methods from a real MusicKit item. Only the data properties need to be overridden.

## Platform Differences

### Electron (Desktop)

- File read: Node.js `fs.readFileSync` in main process
- Pass to renderer: `webContents.executeJavaScript()` or IPC channel
- Base64 encoding works well for files under ~10MB
- `URL.createObjectURL(blob)` creates `blob:https://music.apple.com/...` URLs

### Android (Capacitor)

- File read: Capacitor `Filesystem.readFile()` or `WebViewAssetLoader`
- Pass to renderer: Capacitor bridge `postMessage()` or `evaluateJavascript()`
- `webContentsDebuggingEnabled: true` in `capacitor.config.ts` for CDP access
- Same blob URL approach works in WebView

## What Doesn't Work

- **Direct `mk.setQueue({ url: blobUrl })`** — MusicKit validates URLs against Apple CDN
- **Plain object queue item** — Missing prototype methods causes `resetState is not a function`
- **`fetch()` from renderer to localhost** — Blocked by mixed content policy on `https://music.apple.com`
- **`file://` URLs as `assetURL`** — MusicKit's asset resolver rejects non-HTTPS URLs

## Network Requests That Fire for Local Items

When a local item plays, MusicKit fires three categories of requests to Apple servers using the user's auth token. All requests include the session's `Bearer` JWT in the `authorization` header.

### 1. Catalog Lookup

```
GET https://amp-api.music.apple.com/v1/catalog/{storefront}/songs/{item.id}
Origin: https://music.apple.com
```

- Fires immediately when a track starts playing
- Uses the item's `id` field (e.g. `local-track-1`) as a catalog resource ID
- Returns `404` for injected items since they don't exist in Apple's catalog
- Includes `art[url]=f&fields[albums]=name,url,editorialVideo&fields[artists]=name` query params
- Purpose: resolves full metadata (artwork URLs, artist links, album info) for the now-playing item

### 2. Play Activity Tracking

```
POST https://universal-activity-service.itunes.apple.com/play
Referer: https://music.apple.com/
authorization: Bearer <JWT>
Content-Type: application/json
```

- Fires when playback starts (both local and real tracks)
- Body contains play event data: item ID, timestamps, playback position, event type
- This is the primary analytics call — records that the user played something
- Same endpoint fires for legitimate Apple Music tracks

### 3. Telemetry / Performance Reporting

```
POST https://xp.apple.com/report/2/xp_its_music_main
POST https://xp.apple.com/report/2/xp_amp_music_perf
Referer: https://music.apple.com/
```

- General Apple telemetry — usage stats, performance metrics
- Fires for all playback events (local and real)
- Low-sensitivity data (page load times, feature usage)

### Summary

| Request | Fires for local? | Fires for real? | Contains auth? | Sensitivity |
|---------|-------------------|-----------------|----------------|-------------|
| Catalog lookup (`amp-api`) | Yes (404) | Yes (200) | Yes | Medium — reveals item ID |
| Play tracking (`universal-activity-service`) | Yes | Yes | Yes | High — records play event |
| Telemetry (`xp.apple.com`) | Yes | Yes | No | Low |

### How to Block

Options (not yet implemented):

1. **Patch `fetch`/`XMLHttpRequest`** in the renderer — intercept requests to `universal-activity-service.itunes.apple.com` and `xp.apple.com`, return fake 200 responses
2. **Electron `webRequest` API** — `webContents.session.webRequest.onBeforeRequest` to filter by URL pattern before the request leaves the process
3. **Capacitor `shouldInterceptRequest`** — Android WebView equivalent of request interception
4. **Root-cause patch** — find the MusicKit JS functions that dispatch these requests and patch them to skip catalog lookup / play tracking for items with `local-*` IDs

Option 4 is cleanest — avoids network round-trips entirely. The catalog lookup is likely dispatched from MusicKit's item loader (`services.itemLoader` or `_storekit`), and play tracking from the playback controller's state change handler.

## MusicKit Internal Dispatch Chain

### Play Tracking (`universal-activity-service.itunes.apple.com/play`)

```
MPAFTracker.play(itemDescriptor, position)
  → activityTracker.play(descriptor, position)
    → activityTracker.send(descriptors, descriptor)
      → sender.send(descriptors)            [cookie jar batching]
        → PlayActivitySender.send(data)     [actual HTTP]
          → POST https://universal-activity-service.itunes.apple.com/play
            Body: { client_id, event_type, data: [...time-measured-descriptors] }
            Headers: authorization: Bearer <JWT>, Content-Type: application/json
```

**Key classes:**
- `MPAFTracker` (index 0 in `playActivity._trackers[]`) — decides whether to track via `shouldTrackPlayActivity()`
- `activityTracker` — builds timeline of play events (play/pause/stop/scrub/skip)
- `PlayActivitySender` — the actual HTTP sender; holds `_clientId`, `_eventType`, `_accessToken`, `_musicUserToken`; `url` getter returns the endpoint

**`shouldTrackPlayActivity(item, options)` logic:**
```js
hasAuthorization() &&          // user is logged in
!options?.playbackType !== preview &&  // not a preview
(alwaysSendForActivityType(type) || mediaRequiresPlayActivity(item))
```
Local items with `playbackType: 3` (on-demand) will pass this check and be tracked.

### Catalog Lookup (`amp-api.music.apple.com/v1/catalog/...`)

```
itemLoader.loadItems(options)
  → itemLoader.buildRequest(options)
    → mediaAPI.createRequest(options)
      → GET https://amp-api.music.apple.com/v1/catalog/{storefront}/songs/{item.id}
        Headers: authorization: Bearer <JWT>, media-user-token: <token>
```

**Key classes:**
- `itemLoader` — `services.itemLoader` on the playback controller
- `MediaAPI` (`itemLoader.services.mediaAPI`) — holds `host: 'amp-api.music.apple.com'`, `developerToken`, `mediaUserToken`, `storefrontId`
- `MediaAPI.createRequest()` builds the URL and delegates to `MediaAPI.makeRequest()`

**Why local items trigger this:** MusicKit's playback engine resolves item IDs through the catalog API before loading audio. For real items, this returns metadata + streaming URLs. For local items (ID = `local-001`), it returns 404 but the request still fires with auth tokens.

### Patch Points

| Request | Patch target | Check |
|---------|-------------|-------|
| Play tracking | `MPAFTracker.play()` or `activityTracker.send()` | `item.id.startsWith('local')` → skip |
| Catalog lookup | `itemLoader.loadItems()` or `MediaAPI.createRequest()` | `item.id.startsWith('local')` → return cached/noop |
| Telemetry (`xp.apple.com`) | `request.fetch()` or `MediaAPI.fetch()` | URL contains `xp.apple.com` → noop |

The `MPAFTracker.play()` method is the earliest intercept point for play tracking — patching there avoids building the entire descriptor timeline. For catalog lookup, patching `itemLoader.loadItems()` avoids the network call entirely.

### Working Patch (proven via CDP network monitoring)

```js
const mk = window.MusicKit.getInstance();
const pc = mk._playbackController;
const pa = pc.services.playActivity;
const tracker = pa._trackers[0];        // MPAFTracker
const itemLoader = pc.services.itemLoader;
const mediaAPI = itemLoader.services.mediaAPI;

// Patch 1: Block play tracking for local items
const origPlay = tracker.play.bind(tracker);
tracker.play = async function(item, opts) {
    if (item?.id?.startsWith?.('local')) return;
    return origPlay(item, opts);
};

// Patch 2: Skip catalog lookup for local items
const origLoad = itemLoader.loadItems.bind(itemLoader);
itemLoader.loadItems = async function(options) {
    if (options?.id?.startsWith?.('local') ||
        options?.item?.id?.startsWith?.('local') ||
        (Array.isArray(options) && options[0]?.id?.startsWith?.('local'))) {
        return [];
    }
    return origLoad(options);
};

// Patch 3: Block xp.apple.com telemetry
const origFetch = mediaAPI.fetchFunction;
mediaAPI.fetchFunction = function(url, opts) {
    const urlStr = typeof url === 'string' ? url : url?.url || '';
    if (urlStr.includes('xp.apple.com')) {
        return Promise.resolve(new Response('', { status: 200 }));
    }
    return origFetch.call(this, url, opts);
};
```

**Result:** Zero Apple network requests during local file playback (verified via CDP `Network.enable` monitoring). Real Apple Music tracks are unaffected — the patches only trigger for items with IDs starting with `local`.

## Playlist View Data Flow

The playlist UI is a Svelte app that fetches data via Apple's REST API and renders it using `songs-list-row` components.

### API Endpoints

| Endpoint | Purpose | Response format |
|----------|---------|-----------------|
| `GET /v1/me/library/playlists/{id}?include=tracks&limit[n]=N` | Playlist metadata + first N tracks | `{data: [{relationships: {tracks: {data: [track...]}}}], resources: {songs: {...}}}` |
| `GET /v1/me/library/playlists/{id}/tracks?offset=N` | Paginated track listing | `{data: [{type: "library-songs", id, attributes: {name, artistName, artwork, durationInMillis, playParams}}]}` |
| `GET /v1/catalog/{country}?ids[songs]=...` | Catalog enrichment | `{data: [{type: "songs", id}], resources: {songs: {id: {attributes: {...}}}}}` |

### Track Object Format (from playlist API)

```json
{
  "id": "i.EXAMPLE_SONG_SONG",
  "type": "library-songs",
  "attributes": {
    "name": "inversion",
    "artistName": "ivri",
    "albumName": "the star factory",
    "artwork": {
      "url": "https://is1-ssl.mzstatic.com/image/thumb/.../{w}x{h}bb.jpg",
      "width": 1200,
      "height": 1200,
      "hasP3": false
    },
    "durationInMillis": 139000,
    "genreNames": ["Alternative"],
    "playParams": {
      "catalogId": "1707294101",
      "id": "i.EXAMPLE_SONG_SONG",
      "isLibrary": true,
      "kind": "song",
      "reporting": true,
      "reportingId": "1707294101"
    },
    "releaseDate": "2023-09-14",
    "trackNumber": 3,
    "discNumber": 1,
    "hasLyrics": false
  }
}
```

### DOM Structure

```
[data-testid="tracklist"]  (.songs-list)
├── [data-testid="tracklist-column-header"]  (.songs-list__header)
│   ├── [data-testid="tracklist-column-header-favorite-or-popular"]
│   ├── [data-testid="tracklist-column-header-song"]
│   ├── [data-testid="tracklist-column-header-secondary"]
│   ├── [data-testid="tracklist-column-header-tertiary"]
│   └── [data-testid="tracklist-column-header-time"]
├── [data-testid="track-list-item"]  (.songs-list-row) × N
│   ├── [data-testid="track-column-favorite-or-popular"]
│   ├── [data-testid="track-column-song"]  (artwork + title)
│   ├── [data-testid="track-column-secondary"]  (artist)
│   ├── [data-testid="track-column-tertiary"]  (album)
│   └── [data-testid="track-column-controls"]  (duration + context menu)
└── [data-testid="tracklist-footer"]  (song count + duration)
```

## API Response Interception (Proven)

Fetch patching can inject local tracks into playlist responses. The patch must be installed **before** the Svelte component mounts (i.e., in `assets/musicKitHook.js`) because the component caches its data on mount.

### How to Reproduce

1. Connect to Apple Music page via CDP
2. Install fetch patch:
```js
const origFetch = window.fetch;
window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    const resp = await origFetch.apply(this, args);

    if (url.includes('amp-api.music.apple.com') &&
        url.includes('/v1/me/library/playlists/') &&
        url.includes('include=tracks')) {
        const clone = resp.clone();
        const data = await clone.json();

        if (data.data?.[0]?.relationships?.tracks?.data) {
            const tracks = data.data[0].relationships.tracks.data;
            tracks.unshift({
                id: "local-001",
                type: "library-songs",
                attributes: {
                    name: "Local Track",
                    artistName: "Local Artist",
                    albumName: "Local Album",
                    artwork: { url: "data:image/svg+xml,...", width: 300, height: 300 },
                    durationInMillis: 180000,
                    playParams: { id: "local-001", kind: "song" }
                }
            });
            return new Response(JSON.stringify(data), {
                status: resp.status, statusText: resp.statusText, headers: resp.headers
            });
        }
    }
    return resp;
};
```
3. Navigate to a playlist — local track appears in the list

### Limitation

- Patch must be installed before page load (in hook script)
- Svelte component caches data on mount; post-mount patching doesn't update the UI
- Local tracks in the playlist view don't have click handlers wired up

## DOM Injection Approach (Proven)

Clone an existing track row and modify its content. This works post-mount but requires manual DOM manipulation.

### How to Reproduce

1. Navigate to a playlist
2. Run via CDP:
```js
const tracklist = document.querySelector('[data-testid="tracklist"]');
const template = tracklist.querySelector('[data-testid="track-list-item"]');
const newRow = template.cloneNode(true);

// Modify song name
const songCol = newRow.querySelector('[data-testid="track-column-song"]');
songCol.querySelector('[class*="song-name"]').textContent = "Local Track";

// Modify artist
const artistLink = newRow.querySelector('[data-testid="track-column-secondary"] a');
artistLink.textContent = "Local Artist";

// Modify album
const albumLink = newRow.querySelector('[data-testid="track-column-tertiary"] a');
albumLink.textContent = "Local Album";

// Modify duration
newRow.querySelector('time').textContent = "3:00";

// Insert at top
tracklist.querySelector('[data-testid="tracklist-column-header"]').insertAdjacentElement('afterend', newRow);
```

### Limitation

- Not wired into MusicKit's data model (clicking won't play)
- Re-numbering needed after injection
- Lost on page navigation

## What's Not Yet Solved

- **Queue persistence** — Injected items are lost on page navigation
- **Metadata updates** — `nowPlayingItemDidChange` fires but shows limited data (no artwork URL resolution)
- **Auto-advance** — When a local track ends, MusicKit tries to load the next track through its normal pipeline; if that's also local it may fail
- **Seek accuracy** — `seekToTime()` works but position reporting may lag
- **Mobile integration** — Needs a Capacitor-native file picker to select local files
- **Playlist view integration** — API interception works but must be in hook script; DOM injection works but not wired into playback
