(function() {
	//#region src/playback/protocol.ts
	var PlaybackState = {
		None: 0,
		Loading: 1,
		Playing: 2,
		Paused: 3,
		Stopped: 4,
		Ended: 5,
		Seeking: 6,
		Waiting: 7,
		Stalled: 8,
		Completed: 9
	};
	//#endregion
	//#region src/playback/reducer.ts
	function initialPlaybackSnapshot() {
		return {
			version: 1,
			revision: 0,
			rawState: PlaybackState.None,
			stableState: "stopped",
			mprisStatus: "Stopped",
			isPlaying: false,
			positionUs: 0,
			metadata: null,
			queueLength: 0,
			queueIndex: -1,
			repeatMode: null,
			shuffleMode: null,
			volume: null
		};
	}
	function toMprisPlaybackStatus(state) {
		if (state === PlaybackState.Playing) return "Playing";
		if (state === PlaybackState.Paused || state === PlaybackState.Stopped) return "Paused";
		return "Stopped";
	}
	function toStablePlaybackState(state, previous, hasMetadata) {
		if (state === PlaybackState.Playing) return "playing";
		if (state === PlaybackState.Paused || state === PlaybackState.Stopped || state === PlaybackState.Ended || state === PlaybackState.Completed) return hasMetadata ? "paused" : "stopped";
		if (state === PlaybackState.None) return hasMetadata ? "paused" : "stopped";
		return previous;
	}
	function reducePlayback(snapshot, event) {
		let next;
		switch (event.type) {
			case "state": {
				const stableState = toStablePlaybackState(event.state, snapshot.stableState, snapshot.metadata !== null);
				next = {
					...snapshot,
					rawState: event.state,
					stableState,
					mprisStatus: toMprisPlaybackStatus(event.state),
					isPlaying: stableState === "playing"
				};
				break;
			}
			case "metadata": {
				const metadata = event.metadata === null && event.queueLength > 0 && snapshot.metadata !== null ? snapshot.metadata : event.metadata;
				next = {
					...snapshot,
					metadata,
					queueLength: event.queueLength,
					queueIndex: event.queueIndex,
					stableState: toStablePlaybackState(snapshot.rawState, snapshot.stableState, metadata !== null),
					positionUs: metadata === null ? 0 : snapshot.positionUs
				};
				break;
			}
			case "position":
				next = {
					...snapshot,
					positionUs: event.positionUs
				};
				break;
			case "repeat":
				next = {
					...snapshot,
					repeatMode: event.mode
				};
				break;
			case "shuffle":
				next = {
					...snapshot,
					shuffleMode: event.mode
				};
				break;
			case "volume":
				next = {
					...snapshot,
					volume: event.volume
				};
				break;
		}
		return {
			...next,
			revision: snapshot.revision + 1
		};
	}
	//#endregion
	//#region hook/musicKitHook.ts
	var SNAPSHOT_CHANNEL = "playbackSnapshotDidChange";
	var snapshot = initialPlaybackSnapshot();
	var volumePollTimer = null;
	function publish(event) {
		snapshot = reducePlayback(snapshot, event);
		sendSnapshot(snapshot);
	}
	function sendSnapshot(value) {
		if (window.AMWrapper?.ipcRenderer) {
			window.AMWrapper.ipcRenderer.send(SNAPSHOT_CHANNEL, value);
			return;
		}
		window.SidraAndroid?.postMessage(JSON.stringify({
			channel: SNAPSHOT_CHANNEL,
			data: value
		}));
	}
	function synchroniseSnapshot(mk) {
		const item = mk.nowPlayingItem;
		const events = [
			{
				type: "metadata",
				metadata: item ? mapItem(mk, item) : null,
				queueLength: queueLength(mk),
				queueIndex: mk.nowPlayingItemIndex
			},
			{
				type: "state",
				state: mk.playbackState
			},
			{
				type: "position",
				positionUs: mk.currentPlaybackTime * 1e6
			},
			{
				type: "repeat",
				mode: mk.repeatMode
			},
			{
				type: "shuffle",
				mode: mk.shuffleMode
			},
			{
				type: "volume",
				volume: mk.volume
			}
		];
		for (const event of events) snapshot = reducePlayback(snapshot, event);
		sendSnapshot(snapshot);
	}
	function queueLength(mk) {
		return mk.queue?.length ?? 0;
	}
	function mapItem(mk, item) {
		const attributes = item.attributes;
		const playParams = attributes?.playParams;
		return {
			name: attributes?.name,
			albumName: attributes?.albumName,
			artistName: attributes?.artistName,
			durationInMillis: attributes?.durationInMillis,
			genreNames: attributes?.genreNames,
			artworkUrl: attributes?.artwork?.url?.replace("{w}", "512").replace("{h}", "512"),
			trackId: item.id,
			audioTraits: attributes?.audioTraits,
			trackNumber: attributes?.trackNumber,
			targetBitrate: mk.bitrate,
			url: attributes?.url,
			discNumber: attributes?.discNumber,
			composerName: attributes?.composerName,
			releaseDate: attributes?.releaseDate,
			contentRating: attributes?.contentRating,
			itemType: playParams?.kind,
			containerId: item.container?.id,
			containerType: item.container?.type,
			containerName: item.container?.attributes?.name,
			playParams: playParams ? {
				catalogId: playParams.catalogId,
				globalId: playParams.globalId,
				kind: playParams.kind,
				isLibrary: playParams.isLibrary
			} : void 0,
			isrc: attributes?.isrc,
			queueLength: queueLength(mk),
			queueIndex: mk.nowPlayingItemIndex
		};
	}
	function executeCommand(mk, command) {
		switch (command.type) {
			case "play":
				mk.play();
				break;
			case "pause":
				mk.pause();
				break;
			case "playPause":
				mk.isPlaying ? mk.pause() : mk.play();
				break;
			case "next":
				mk.skipToNextItem();
				break;
			case "previous":
				mk.skipToPreviousItem();
				break;
			case "seek":
				mk.seekToTime(command.seconds);
				break;
			case "setVolume":
				mk.volume = command.volume;
				break;
			case "setRepeat":
				mk.repeatMode = command.mode;
				break;
			case "setShuffle":
				mk.shuffleMode = command.mode;
				break;
		}
	}
	function decodeCommand(channel, args) {
		const type = channel.replace("player:", "");
		switch (type) {
			case "play":
			case "pause":
			case "playPause":
			case "next":
			case "previous": return { type };
			case "seek": return typeof args[0] === "number" ? {
				type,
				seconds: args[0]
			} : null;
			case "setVolume": return typeof args[0] === "number" ? {
				type,
				volume: args[0]
			} : null;
			case "setRepeat":
			case "setShuffle": return typeof args[0] === "number" ? {
				type,
				mode: args[0]
			} : null;
			default: return null;
		}
	}
	function attachToInstance(mk) {
		if (volumePollTimer !== null) window.clearInterval(volumePollTimer);
		mk.addEventListener("playbackStateDidChange", (event) => {
			const state = event.state;
			if (typeof state === "number") publish({
				type: "state",
				state
			});
		});
		mk.addEventListener("nowPlayingItemDidChange", (event) => {
			const item = event.item;
			publish({
				type: "metadata",
				metadata: item ? mapItem(mk, item) : null,
				queueLength: queueLength(mk),
				queueIndex: mk.nowPlayingItemIndex
			});
		});
		mk.addEventListener("playbackTimeDidChange", () => {
			publish({
				type: "position",
				positionUs: mk.currentPlaybackTime * 1e6
			});
		});
		mk.addEventListener("repeatModeDidChange", () => {
			publish({
				type: "repeat",
				mode: mk.repeatMode
			});
		});
		mk.addEventListener("shuffleModeDidChange", () => {
			publish({
				type: "shuffle",
				mode: mk.shuffleMode
			});
		});
		let lastVolume = mk.volume;
		mk.addEventListener("volumeDidChange", () => {
			lastVolume = mk.volume;
			publish({
				type: "volume",
				volume: lastVolume
			});
		});
		volumePollTimer = window.setInterval(() => {
			if (mk.volume === lastVolume) return;
			lastVolume = mk.volume;
			publish({
				type: "volume",
				volume: lastVolume
			});
		}, 250);
		window.__sidraHookedMk = mk;
		synchroniseSnapshot(mk);
		installTrackingPatches(mk);
	}
	var trackerPatched = false;
	var itemLoaderPatched = false;
	function installTrackingPatches(mk) {
		const pc = mk._playbackController;
		if (!trackerPatched) {
			const tracker = pc?.services?.playActivity?._trackers?.[0];
			if (tracker?.play) {
				const origPlay = tracker.play.bind(tracker);
				tracker.play = async function(item, opts) {
					if (item?.id?.startsWith?.("local")) return;
					return origPlay(item, opts);
				};
				trackerPatched = true;
			}
		}
		if (!itemLoaderPatched) {
			const itemLoader = pc?.services?.itemLoader;
			if (itemLoader?.loadItems) {
				const origLoad = itemLoader.loadItems.bind(itemLoader);
				itemLoader.loadItems = async function(options) {
					if (options?.id?.toString().startsWith?.("local") || options?.item?.id?.toString().startsWith?.("local") || Array.isArray(options) && options[0]?.id?.toString().startsWith?.("local")) return [];
					return origLoad(options);
				};
				itemLoaderPatched = true;
			}
		}
	}
	function base64ToBlob(dataBase64, mimeType) {
		const binary = atob(dataBase64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		const blob = new Blob([bytes], { type: mimeType });
		return URL.createObjectURL(blob);
	}
	function buildLocalFileItem(mk, file) {
		const realItem = mk.queue?._queueItems?.[0]?.item;
		const itemProto = realItem ? Object.getPrototypeOf(realItem) : {};
		const blobUrl = base64ToBlob(file.dataBase64, file.mimeType);
		const item = Object.create(itemProto, {
			id: {
				value: file.id,
				writable: true
			},
			type: {
				value: "song",
				writable: true
			},
			playbackType: {
				value: 3,
				writable: true
			},
			canPlay: {
				value: true,
				writable: true
			},
			isPlayable: {
				value: true,
				writable: true
			},
			isReady: {
				value: true,
				writable: true
			},
			isPlaying: {
				value: false,
				writable: true
			},
			isLoading: {
				value: false,
				writable: true
			},
			assetURL: {
				value: blobUrl,
				writable: true
			},
			rawAssetUrl: {
				value: blobUrl,
				writable: true
			},
			previewURL: {
				value: blobUrl,
				writable: true
			}
		});
		item.attributes = {
			name: file.name,
			artistName: file.artist,
			albumName: file.album,
			durationInMillis: file.duration * 1e3,
			artwork: {
				url: "",
				width: 300,
				height: 300,
				bgColor: "333333",
				textColor1: "ffffff",
				textColor2: "ffffff",
				textColor3: "ffffff",
				textColor4: "ffffff",
				hasP3: false
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
			playParams: {
				id: file.id,
				kind: "song"
			},
			releaseDate: "2024-01-01",
			previews: [{ url: blobUrl }]
		};
		item._state = {
			current: 2,
			set: function() {}
		};
		item._eventRegistry = {
			mediaItemStateDidChange: {},
			mediaItemStateWillChange: {}
		};
		item._container = {
			id: "local",
			type: "album",
			name: "Local Files",
			attributes: { name: "Local Files" }
		};
		item._context = { featureName: "local" };
		item.assets = [];
		item.keyURLs = {};
		item.hlsMetadata = {};
		item._releaseDate = /* @__PURE__ */ new Date("2024-01-01");
		return {
			isAutoplay: false,
			item
		};
	}
	function injectLocalFiles(mk, files) {
		installTrackingPatches(mk);
		const q = mk.queue;
		if (!q) {
			console.error("[Sidra] No queue available");
			return;
		}
		if (!q._queueItems?.length) {
			console.warn("[Sidra] Queue is empty — start playing a track first, then add local files");
			return;
		}
		const items = files.map((f) => buildLocalFileItem(mk, f));
		const pos = (q._position ?? 0) + 1;
		q.spliceQueueItems?.(pos, 0, items);
		console.log(`[Sidra] Injected ${items.length} local file(s) at position ${pos}`);
	}
	function start() {
		const waitForMusicKit = window.setInterval(() => {
			if (!window.MusicKit) return;
			window.clearInterval(waitForMusicKit);
			const mk = window.MusicKit.getInstance();
			if (window.__sidraHookedMk === mk) return;
			attachToInstance(mk);
			window.addEventListener("message", (event) => {
				if (event.source !== window) return;
				if (!event.data || event.data.type !== "sidra:command") return;
				const args = Array.isArray(event.data.args) ? event.data.args : [];
				const command = decodeCommand(event.data.channel, args);
				if (command) executeCommand(window.MusicKit.getInstance(), command);
			});
			window.addEventListener("message", (event) => {
				if (event.source !== window) return;
				if (!event.data || event.data.type !== "sidra:localFiles") return;
				const files = event.data.files;
				if (Array.isArray(files)) injectLocalFiles(window.MusicKit.getInstance(), files);
			});
			window.setInterval(() => {
				try {
					const current = window.MusicKit.getInstance();
					if (current !== window.__sidraHookedMk) attachToInstance(current);
					if (!trackerPatched || !itemLoaderPatched) installTrackingPatches(current);
				} catch {}
			}, 5e3);
		}, 500);
	}
	start();
	//#endregion
})();
