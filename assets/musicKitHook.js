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
			window.setInterval(() => {
				try {
					const current = window.MusicKit.getInstance();
					if (current !== window.__sidraHookedMk) attachToInstance(current);
				} catch {}
			}, 5e3);
		}, 500);
	}
	start();
	//#endregion
})();
