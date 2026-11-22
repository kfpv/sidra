import log from 'electron-log/main';
import https from 'https';

const lyricsLog = log.scope('localLyrics');

interface LrcLibResponse {
  syncedLyrics?: string;
  plainLyrics?: string;
}

// ---------------------------------------------------------------------------
// LRC → Apple TTML (line-by-line)
// ---------------------------------------------------------------------------

function formatTtmlTime(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${String(min).padStart(2, '0')}:${sec.toFixed(3).padStart(6, '0')}`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function lrcToTtml(lrc: string, durationSec: number): string {
  const lines = lrc.split('\n');
  const parsed: Array<{ time: number; text: string }> = [];

  for (const line of lines) {
    const match = line.match(/^\[(\d+:\d+\.\d+)\]\s*(.*)/);
    if (match) {
      const text = match[2].trim();
      if (text.length > 0) {
        const [min, sec] = match[1].split(':');
        const time = parseFloat(min) * 60 + parseFloat(sec);
        parsed.push({ time, text });
      }
    }
  }

  if (parsed.length === 0) return '';

  const durStr = formatTtmlTime(durationSec);

  let ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="Line" xml:lang="en"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal" leadingSilence="0"><translations/></iTunesMetadata></metadata></head><body dur="${durStr}"><div>`;

  for (let i = 0; i < parsed.length; i++) {
    const beginSec = parsed[i].time;
    const endSec = i + 1 < parsed.length ? parsed[i + 1].time : durationSec;
    ttml += `<p begin="${formatTtmlTime(beginSec)}" end="${formatTtmlTime(endSec)}">${escapeXml(parsed[i].text)}</p>`;
  }

  ttml += '</div></body></tt>';
  return ttml;
}

function plainLyricsToTtml(plain: string, durationSec: number): string {
  const lines = plain.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return '';

  const durStr = formatTtmlTime(durationSec);
  const interval = durationSec / lines.length;

  let ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="None" xml:lang="en"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal" leadingSilence="0"><translations/></iTunesMetadata></metadata></head><body dur="${durStr}"><div>`;

  for (const line of lines) {
    ttml += `<p>${escapeXml(line)}</p>`;
  }

  ttml += '</div></body></tt>';
  return ttml;
}

// ---------------------------------------------------------------------------
// lrclib API fetch
// ---------------------------------------------------------------------------

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Sidra/0.3.4' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

export async function fetchLocalLyrics(
  trackName: string,
  artistName: string,
  durationSec: number,
): Promise<string> {
  // Returns TTML string, or empty string if no lyrics found
  try {
    const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(trackName)}&artist_name=${encodeURIComponent(artistName)}&duration=${Math.floor(durationSec)}`;
    lyricsLog.debug('fetching lrclib:', trackName, '-', artistName);

    const body = await httpsGet(url);
    const data: LrcLibResponse = JSON.parse(body);

    if (data.syncedLyrics) {
      const ttml = lrcToTtml(data.syncedLyrics, durationSec);
      if (ttml) {
        lyricsLog.info('lrclib synced lyrics found for:', trackName);
        return ttml;
      }
    }

    if (data.plainLyrics) {
      const ttml = plainLyricsToTtml(data.plainLyrics, durationSec);
      if (ttml) {
        lyricsLog.info('lrclib plain lyrics found for:', trackName);
        return ttml;
      }
    }

    lyricsLog.debug('no lrclib lyrics for:', trackName);
    return '';
  } catch (err) {
    lyricsLog.warn('lrclib fetch failed:', trackName, err);
    return '';
  }
}

/** Build an Apple-compatible lyrics JSON response body. */
export function buildLyricsResponse(
  localId: string,
  ttml: string,
): string {
  if (!ttml) {
    return JSON.stringify({ data: [] });
  }

  return JSON.stringify({
    data: [{
      id: localId,
      type: 'syllable-lyrics',
      attributes: {
        playParams: {
          catalogId: localId,
          displayType: 2,
          id: `local_${localId}`,
          kind: 'lyric',
        },
        ttmlLocalizations: ttml,
      },
    }],
  });
}
