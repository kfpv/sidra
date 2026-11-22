const http = require('http');
const fs = require('fs');
const ws = require('ws');

const audioPath = process.argv[2];
if (!audioPath) {
  console.error('Usage: node test-inject.js /path/to/audio.m4a');
  process.exit(1);
}
const buf = fs.readFileSync(audioPath);
const b64 = buf.toString('base64');

const fd = JSON.stringify({
  id: 'local-t1',
  name: 'Example Song',
  artist: 'Example Artist',
  album: 'Local Files',
  duration: 152.625,
  dataBase64: b64,
  mimeType: 'audio/mp4'
});

http.get('http://localhost:61669/json', (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const pages = JSON.parse(d);
    const pageWs = pages[0]?.webSocketDebuggerUrl;
    if (!pageWs) { console.error('No pages'); process.exit(1); }

    const socket = new ws(pageWs);
    const logs = [];

    socket.on('open', () => {
      socket.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.method === 'Runtime.consoleAPICalled') {
          const t = m.params?.args?.map(a => a.value || a.description).join(' ');
          if (t && t.includes('[Sidra]')) logs.push(t);
        }
        if (m.id === 2) {
          console.log('Queue:', m.result?.result?.value);
        }
      });

      socket.send(JSON.stringify({ id: 0, method: 'Runtime.enable' }));

      const expr = `window.postMessage({type:"sidra:localFiles",files:[JSON.parse(${JSON.stringify(fd)})]},"*")`;
      socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr } }));

      setTimeout(() => {
        socket.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: {
          expression: `JSON.stringify({
            isPlaying: window.MusicKit?.getInstance()?.isPlaying,
            qLen: window.MusicKit?.getInstance()?.queue?._queueItems?.length,
            items: (window.MusicKit?.getInstance()?.queue?._queueItems || []).slice(0, 3).map(q => ({
              id: q.item?.id,
              name: q.item?.attributes?.name,
              artist: q.item?.attributes?.artistName,
              url: (q.item?.assetURL || '').substring(0, 40)
            }))
          })`,
          returnByValue: true
        }}));
      }, 3000);

      setTimeout(() => {
        console.log('=== Console logs ===');
        logs.forEach(l => console.log(l));
        socket.close();
        process.exit(0);
      }, 5000);
    });

    socket.on('error', (e) => { console.error(e.message); process.exit(1); });
  });
});
