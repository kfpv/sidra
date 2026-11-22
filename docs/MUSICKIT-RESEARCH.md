# MusicKit.js API Research

Findings from reverse-engineering Apple Music's web MusicKit.js implementation, covering queue manipulation, library/playlist operations, and cross-platform transfer. This research supports the planned plugin system.

> **Source attribution** is marked where findings originate from either the **Codex session** (initial API exploration) or **OpenCode session** (queue transfer and UI behaviour testing).

---

## 1. MusicKit Instance Surface

The live `MusicKit.getInstance()` exposes a rich API surface across three prototype layers:

### Playback Control

| Method | Description |
|--------|-------------|
| `mk.play()` | Start/resume playback from current queue position |
| `mk.pause()` | Pause playback |
| `mk.playMediaItem(item)` | Jump to a specific queue item and play |
| `mk.skipToNextItem()` | Skip to next queue item |
| `mk.skipToPreviousItem()` | Skip to previous queue item |
| `mk.setQueue({songs, startPlaying})` | Replace entire queue with catalogue IDs |
| `mk.setStationQueue({url})` | Set a radio station queue (requires `https://music.apple.com/station/...`) |
| `mk.stop()` | Stop playback and clear queue |

### Queue Object (`mk.queue`)

| Property/Method | Type | Description |
|-----------------|------|-------------|
| `items` | `QueueItem[]` | All items in the queue |
| `length` | `number` | Queue length |
| `_position` | `number` | Internal position (often `-1`, unreliable) |
| `_itemIDs` | `string[]` | Ordered IDs of queue items |
| `_queueItems` | `QueueItem[]` | Internal queue items array |
| `indexForItem(item)` | `number` | **Reliable** method to find an item's index in the queue |
| `currentItem()` | `QueueItem \| null` | Current item (may return `null` — use `indexForItem` instead) |
| `currentQueueItem()` | `QueueItem \| null` | Current queue item (may return `null`) |
| `nextPlayableItem` | `QueueItem` | Next playable item |
| `nextPlayableItemIndex` | `number` | Index of next playable item |
| `previousPlayableItem` | `QueueItem` | Previous playable item |
| `previousPlayableItemIndex` | `number` | Index of previous playable item |
| `append(item)` | | Add item to queue |
| `appendQueueItems(items)` | | Add items to queue |
| `remove(item)` | | Remove item from queue |
| `removeQueueItems(items)` | | Remove multiple items |
| `splice(index, count, items)` | | Splice queue |
| `spliceQueueItems(...)` | | Splice queue items |
| `clearAfterCurrent()` | | Clear items after current |
| `clear()` | | Clear entire queue |
| `reset()` | | Reset queue state |
| `updateItems(items)` | | Update queue items |
| `findPlayableIndexForward(start, end)` | | Find next playable index |
| `findPlayableIndexBackward(start, end)` | | Find previous playable index |

> **[OpenCode]** `q.index` is `undefined` — never use it. `q.indexForItem(mk.nowPlayingItem)` is the reliable way to get the current playing position.

> **[Codex]** Queue methods discovered via prototype chain: `setQueue`, `playNext`, `playLater`, `playAt`, `updateQueue`, `clearQueue`, `onMediaStateUpdate`, `savePlaybackState`, `restorePlaybackState`.

### Authenticated API Client (`mk.api`)

| Method | Signature |
|--------|-----------|
| `mk.api.get(path, params)` | `GET` request to Apple Music API |
| `mk.api.post(path, params, options)` | `POST` request |
| `mk.api.request(path, params, options)` | Generic request with method/body/headers |

The API client uses Apple's authenticated session (music user token). Requests go through `amp-api.music.apple.com`.

> **[Codex]** The `request()` method signature: `request(e, n, d)` where `e` = path, `n` = params, `d` = `{ method, body, headers }`.

### Events

| Event | Fires When |
|-------|-----------|
| `nowPlayingItemDidChange` | Current item changes |
| `playbackStateDidChange` | Playback state changes (play/pause/stop/etc.) |
| `playbackTimeDidChange` | Playback time updates |
| `queueItemsDidChange` | Queue items change |
| `queueDidIndex` | Queue reindexed |
| `queueDidAdd` | Items added to queue |
| `queueDidRemove` | Items removed from queue |
| `mediaItemStateDidChange` | Media item state changes |
| `mediaItemWillChange` | Media item about to change |
| `repeatModeDidChange` | Repeat mode changes |
| `shuffleModeDidChange` | Shuffle mode changes |
| `volumeDidChange` | Volume changes |

---

## 2. Queue Item Structure

A queue item has the following shape:

```json
{
  "id": "1819702890",
  "type": "song",
  "assetURL": "https://aod-ssl.itunes.apple.com/.../mzaf_A1819702890.rphq.aac.wa.m3u8",
  "hlsMetadata": {},
  "attributes": {
    "name": "Tower of Memories",
    "artistName": "ivri",
    "albumName": "Tower of Memories - Single",
    "artwork": {
      "bgColor": "705d5d",
      "hasP3": false,
      "height": 3000,
      "textColor1": "ecd4f6",
      "textColor2": "f6d0b7",
      "textColor3": "d3bcd7",
      "textColor4": "dbb9a5",
      "url": "https://is1-ssl.mzstatic.com/image/thumb/.../{w}x{h}bb.jpg",
      "width": 3000
    },
    "durationInMillis": 208510,
    "genreNames": ["Alternative", "Music"],
    "hasLyrics": true,
    "hasTimeSyncedLyrics": true,
    "isrc": "SGW502501648",
    "playParams": {
      "id": "1819702890",
      "kind": "song"
    },
    "previews": [{ "url": "..." }],
    "releaseDate": "2025-07-10",
    "trackNumber": 1,
    "url": "https://music.apple.com/us/album/tower-of-memories/1819702889?i=1819702890"
  },
  "playbackType": 3,
  "relationships": {
    "albums": { "data": [{ "id": "1819702889", "type": "albums" }] },
    "artists": { "data": [{ "id": "1349563025", "type": "artists" }] }
  },
  "_container": { "id": "1819702890", "name": "song" },
  "_state": { "current": 2 },
  "keyURLs": {
    "hls-key-server-url": "https://play.itunes.apple.com/WebObjects/MZPlay.woa/wa/acquireWebPlaybackLicense",
    "hls-key-cert-url": "https://play.itunes.apple.com/WebObjects/MZPlay.woa/wa/widevineCert",
    "widevine-cert-url": "https://play.itunes.apple.com/WebObjects/MZPlay.woa/wa/widevineCert"
  }
}
```

> **[OpenCode]** After `setQueue({songs: [ids]})`, items retain full attributes (name, artist, artwork, duration, lyrics flags). The data is identical to naturally-loaded items. Container metadata is stripped — `_container` shows `{id, "song"}` instead of `{id, type: "playlist", name: "..."}`.

---

## 3. Queue Manipulation

### Setting a Queue

```js
// Replace entire queue with catalogue IDs (does NOT auto-play)
await mk.setQueue({ songs: ['1819702890', '1851073176', '1770842330'], startPlaying: false });
```

> **[OpenCode]** `setQueue` resolves with `{}` (empty object) on both platforms — no useful return value. Items are fully populated after 500-600ms.

### Inserting into Queue

```js
// Insert after current item
await mk.playNext({ songs: ['12345'] });

// Insert at end of queue
await mk.playLater({ songs: ['12345'] });
```

### Playing from Queue

**Critical UI distinction** (OpenCode):

| Method | Audio | Mini-player UI |
|--------|-------|----------------|
| `mk.playMediaItem(item)` | ✅ Plays correctly | ❌ Stays `is-empty`, no metadata shown |
| `mk.play()` then `mk.skipToNextItem()` | ✅ Plays correctly | ✅ Shows name, artist, artwork |

> **[OpenCode]** `playMediaItem` fires `nowPlayingItemDidChange` and other events, but the Apple Music web UI's Svelte components do not react to it. The mini-player remains in `is-empty` state with no text or artwork. This is a known Apple Music web UI limitation — the Svelte component binds to a different data path than what `playMediaItem` triggers.

**Working approach for jumping to a specific queue position:**
```js
mk.play(); // Start from index 0
// Then skipToNextItem() N times to reach target index
for (let i = 0; i < targetIndex; i++) {
  mk.skipToNextItem();
}
```

### Radio Station Queue

```js
await mk.setStationQueue({ url: 'https://music.apple.com/station/...' });
```

> **[OpenCode]** Only works with `https://music.apple.com/station/...` format. Playlist URLs are rejected.

---

## 4. Cross-Platform Queue Transfer

> **[OpenCode]** All findings in this section are from OpenCode's CDP testing between desktop (Electron) and Android (Capacitor WebView).

### Transfer Protocol

1. **Snapshot** the source queue (IDs, current index, modes)
2. **Trim** to remaining songs: `ids.slice(index)`
3. **Reconstruct** on target with `setQueue` + `play()`

### Snapshot Extraction

```js
function takeSnapshot() {
  const mk = MusicKit.getInstance();
  const q = mk.queue;
  return {
    shuffleMode: mk.shuffleMode,
    repeatMode: mk.repeatMode,
    index: q.indexForItem(mk.nowPlayingItem),
    ids: q.items.map(i => i.id),
  };
}
```

### Reconstruction (Target Device)

```js
async function restoreQueue(snapshot) {
  const mk = MusicKit.getInstance();
  const remaining = snapshot.ids.slice(snapshot.index);
  await mk.setQueue({ songs: remaining, startPlaying: false });
  mk.play();
}
```

This avoids the skip loop entirely — `setQueue` puts the target song at index 0, `play()` starts there. Trimmed queue loses the "already played" songs, which is acceptable for handoff.

### Getting Current Index

```js
// Reliable — works on both platforms
const index = mk.queue.indexForItem(mk.nowPlayingItem);

// Unreliable
mk.queue.index; // undefined
mk.queue._position; // often -1
mk.queue.currentItem(); // may return null
```

### Bidirectional Transfer Results

| Direction | Result |
|-----------|--------|
| Desktop → Android | ✅ PASS (8 songs, correct position, same track playing) |
| Android → Desktop | ✅ PASS (8 songs, correct position, same track playing) |

### What Transfers

| Property | Transferred? | Notes |
|----------|-------------|-------|
| Remaining tracks | ✅ | `ids.slice(currentIndex)` — already-played tracks are trimmed |
| Track order | ✅ | Same order (post-shuffle) |
| Current position | ✅ | Target track becomes index 0 |
| Shuffle mode | ✅ | `mk.shuffleMode` |
| Repeat mode | ✅ | `mk.repeatMode` |
| Track metadata (name, artist, album, artwork) | ✅ | Full `attributes` preserved |
| Audio stream | ✅ | Each platform fetches its own HLS stream |
| Container/playlist source | ❌ | Lost after `setQueue` |
| Already-played tracks | ❌ | Trimmed — not transferred |

---

## 5. Library API Operations

> **[Codex]** All findings in this section are from the Codex session's CDP exploration of the authenticated MusicKit API.

### Authentication

The `mk.api` client uses Apple's authenticated session. No developer token or music user token management needed — the web session handles it.

### Read Playlists

```js
const response = await mk.api.get('/v1/me/library/playlists', {
  limit: 10,
  include: 'catalog'
});
```

**Response shape** (differs from public REST docs):
```json
{
  "data": [
    {
      "id": "p.EXAMPLE_PLAYLIST",
      "type": "library-playlists",
      "href": "/v1/me/library/playlists/p.EXAMPLE_PLAYLIST",
      "attributes": {
        "name": "Favourite Songs",
        "canEdit": false,
        "canDelete": false,
        "hasCatalog": true,
        "dateAdded": "2024-01-01T00:00:00Z",
        "lastModifiedDate": "2024-01-02T00:00:00Z",
        "playParams": {
          "globalId": "pl.u-EXAMPLE",
          "id": "p.EXAMPLE_PLAYLIST",
          "isLibrary": true,
          "kind": "playlist"
        }
      }
    }
  ]
}
```

> **[Codex]** The `mk.api.get()` returns a response object with `.json`, `.text`, `.status` properties — not the parsed data directly. Use `response.json.data` to access the playlist list.

### Read Playlist Tracks

```js
const response = await mk.api.get('/v1/me/library/playlists/{id}/tracks', { limit: 25 });
```

### Create Playlist

```js
const response = await mk.api.request('/v1/me/library/playlists', {}, {
  method: 'POST',
  body: JSON.stringify({
    attributes: {
      name: 'Sidra API Test',
      description: { standard: 'Created by Sidra' }
    }
  }),
  headers: { 'Content-Type': 'application/json' }
});
// Returns HTTP 201 with playlist data
```

> **[Codex]** Confirmed working. Creates a playlist with `canDelete: true, canEdit: true`. Returns the new playlist's ID and attributes.

### Add Tracks to Playlist

```js
await mk.api.request('/v1/me/library/playlists/{id}/tracks', {}, {
  method: 'POST',
  body: JSON.stringify({
    data: [{ id: '1440812146', type: 'songs' }]
  }),
  headers: { 'Content-Type': 'application/json' }
});
```

> **[Codex]** Returns HTTP 204 (empty body). **Apple's MusicKit wrapper incorrectly tries to JSON-parse the empty response** and throws `SyntaxError: Unexpected end of JSON input`. The mutation succeeds despite the error. Read the playlist back to verify.

### Remove Tracks from Playlist (Private API)

```js
await mk.api.request(
  `/v1/me/library/playlists/{id}/tracks?ids[library-songs]=<librarySongId>&mode=all`,
  {},
  { method: 'DELETE' }
);
```

> **[Codex]** This is a **private API** discovered by reverse-engineering Apple's web bundle (`index~6da982354d.js`). The `mode=all` query parameter is required. Without it, the server returns 400: "No mode supplied on the request". Returns HTTP 204 (empty body, same wrapper bug).

### Delete Playlist

```js
await mk.api.request('/v1/me/library/playlists/{id}', {}, { method: 'DELETE' });
```

> **[Codex]** Returns empty body (wrapper throws). The playlist is tombstoned server-side: `lastModifiedDate` resets to `1970-01-01T00:00:00Z`, `canDelete` and `canEdit` become `false`. The playlist still appears in list reads until cache expires. Apple's web client uses the same endpoint.

---

## 6. Comparison with Official MusicKit API

### What Apple Documents vs What Works

| Operation | Official MusicKit API | Web MusicKit.js (Unofficial) |
|-----------|----------------------|------------------------------|
| Read library playlists | ✅ Documented | ✅ `mk.api.get('/v1/me/library/playlists')` |
| Read playlist tracks | ✅ Documented | ✅ `mk.api.get('/v1/.../tracks')` |
| Create playlist | ✅ Documented | ✅ `mk.api.request(..., {method:'POST'})` |
| Add tracks to playlist | ✅ Documented | ✅ `mk.api.request(...)` (204 + wrapper bug) |
| Remove tracks from playlist | ❌ Not documented | ✅ Private API with `mode=all` |
| Delete playlist | ❌ Not documented | ✅ `DELETE /v1/me/library/playlists/{id}` |
| Search catalogue | ✅ Documented | ✅ `mk.api.get('/v1/catalog/{storefront}/search')` |
| Read ratings | ✅ Documented | ✅ |
| Apply ratings | ✅ Documented | ✅ |
| Create playlist folders | ✅ Documented | Likely works (not tested) |
| Reorder tracks | ❌ Not documented | Not tested |
| Rename playlist | ❌ Not documented | Not tested |

### Key Differences

1. **Response shape**: `mk.api.get()` returns `{json, text, status}` wrapper, not raw data. Official REST API returns data directly.

2. **Empty response bug**: Apple's MusicKit wrapper (`musickit.js`) tries to `JSON.parse()` empty 204 responses, throwing `SyntaxError`. This affects POST (add tracks) and DELETE (remove tracks, delete playlist). The mutations succeed — catch the error and verify.

3. **Private API for removal**: Track removal requires `?mode=all` query parameter, not documented in Apple's public API. Discovered in Apple's web bundle.

4. **Storefront in URL**: API paths use `/v1/me/library/...` (no storefront prefix). Catalogue searches use `/v1/catalog/{countryCode}/...`.

5. **Auth model**: Web MusicKit.js uses Apple's authenticated web session (music user token baked into the page). No separate developer token management needed. The `mk.api` client handles authentication automatically.

### Implications for Plugin API Design

If the plugin system aims for compatibility with Apple's official MusicKit API:

- **Expose `mk.api` through a typed wrapper** — plugins should not access `mk.api` directly (Apple could change the internal wrapper)
- **Handle the 204 empty response bug** — wrap all POST/DELETE calls to catch `SyntaxError` and verify mutations
- **Document private API usage** — track removal and playlist deletion are undocumented; mark them as "advanced" or "private" capabilities
- **Use catalogue IDs, not library IDs** — for cross-platform transfer, catalogue IDs (`1819702890`) are stable; library IDs (`i.EXAMPLE_SONG`) are per-account

---

## 7. UI Injection Points

> **[Codex]** The web UI uses Svelte components. Plugins should render through Sidra-owned mount points, not directly into Apple's DOM.

### Desktop (Electron)

| Element | Selector | Notes |
|---------|----------|-------|
| Player bar background | `.wrapper amp-chrome-player::before` | `::before` pseudo-element |
| LCD now-playing widget | `amp-lcd { --lcd-bg-color }` | Shadow DOM scoped |
| Side panels | `.side-panel`, `.side-panel-header-wrapper` | Direct `background-color` |
| Page footer | `.scrollable-page > footer` | Direct `background-color` |

### Android (Capacitor)

| Element | Selector | Notes |
|---------|----------|-------|
| Mini-player | `.mini-player` | Svelte component, `is-empty` class when no metadata |
| Mini-player artwork | `.mini-player__artwork` | Uses lazy-loaded `<img>` |
| Mini-player metadata text | `.mini-player__metadata--text` | Shows track name + artist |
| Mini-player controls | `.mini-player__controls` | Play/pause/skip buttons |
| App container | `.app-container` | Has `is-android`, `is-library-page` classes |

> **[OpenCode]** The Android mini-player has different structure from desktop's `amp-chrome-player`. Desktop uses web components (`amp-lcd`, `amp-chrome-player`); Android uses Svelte components (`.mini-player`).

### Recommended Plugin Mount Strategy

Sidra should create stable mount points that survive Apple's SPA navigation:

```html
<div id="sidra-plugin-root">
  <!-- Shadow DOM for plugin UI -->
</div>
```

Plugins render inside Sidra-owned Shadow DOM. A route observer remounts slots when Apple's SPA replaces the page. The same plugin JavaScript and CSS can run on Electron and Android, though responsive layouts may differ.

---

## 8. Known Quirks and Gotchas

1. **`q.index` is `undefined`** — use `q.indexForItem(mk.nowPlayingItem)` instead
2. **`playMediaItem` doesn't update mini-player UI** — for transfer, use trim + `play()` instead
3. **`setQueue` returns `{}`** — no useful return value
4. **Artwork lazy loading** — `1x1.gif` placeholder is normal; the real URL loads via intersection observer
5. **204 empty response crash** — Apple's wrapper throws on empty JSON; mutations still succeed
6. **`mode=all` required** — Track removal needs undocumented query parameter
7. **Playlist tombstoning** — Deleted playlists keep their ID but with `1970-01-01` date and `canDelete: false`
8. **Container metadata lost** — `setQueue({songs})` strips playlist/album source info from items
9. **Already-played tracks trimmed** — Handoff only transfers remaining songs, not the full queue
10. **Node 24 required** — Built-in WebSocket support needed for CDP testing from project directory
