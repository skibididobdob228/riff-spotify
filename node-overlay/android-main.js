// Riff's backend on Android (nodejs-mobile). Starts the same server.js as on desktop, plus a small
// HTTP endpoint for what Electron's main process answered over IPC (plugins, themes, cache, folders).
// Writes {port, ipcPort, token} to RIFF_ANDROID_SESSION once both are listening.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const electron = require('electron');

// In nodejs-mobile, Node exiting takes the whole app down: report start-up failures to Android instead
function reportFailure(e) {
  console.error('Riff failed to start', e);
  try { fs.writeFileSync(process.env.RIFF_ANDROID_SESSION, JSON.stringify({ error: String(e && e.stack || e) })); } catch (_) {}
  setInterval(() => {}, 1 << 30);
}

let platform, startServer, getServerToken, log, tail;
try {
  platform = require('./platform');
  ({ startServer, getServerToken } = require('./server'));
  ({ log, tail } = require('./logger'));
} catch (e) {
  reportFailure(e);
  return;
}
// A bad request shouldn't stop the music
process.on('uncaughtException', (e) => { console.error('uncaught', e); try { log('error', `uncaught: ${e && e.stack || e}`); } catch (_) {} });
process.on('unhandledRejection', (e) => { console.error('unhandled rejection', e); });

const { handlers, setPendingPaths } = electron.android;
const handle = (channel, fn) => handlers.set(channel, (event, ...args) => fn(...args));

require('./plugins').register(() => null);
require('./themes').register(() => null);

const AUDIO_EXT = /\.(opus|webm|m4a|mp3)$/i;

function dirSize(dir, filter) {
  let size = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (filter && !filter.test(f)) continue;
      try { size += fs.statSync(path.join(dir, f)).size; } catch (e) {}
    }
  } catch (e) {}
  return size;
}

function clearDir(dir, filter) {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (filter && !filter.test(f)) continue;
      try { fs.unlinkSync(path.join(dir, f)); } catch (e) {}
    }
  } catch (e) {}
}

handle('get-cache-size', () => ({ audio: dirSize(platform.CACHE_DIR, AUDIO_EXT) + dirSize(platform.THUMBNAILS_DIR), web: 0 }));
handle('clear-cache', () => {
  clearDir(platform.CACHE_DIR, AUDIO_EXT);
  clearDir(platform.THUMBNAILS_DIR);
  return true;
});
handle('get-data-dir', () => ({ dir: platform.DATA_DIR, defaultDir: platform.DEFAULT_DATA_DIR, isCustom: false }));
handle('get-download-dir', () => {
  const custom = platform.resolveDownloadDir();
  return { dir: custom || process.env.RIFF_ANDROID_DOWNLOADS, defaultDir: process.env.RIFF_ANDROID_DOWNLOADS, isCustom: !!custom };
});
handle('set-download-dir', (payload) => {
  platform.setDownloadDir(null);
  return { ok: true, dir: process.env.RIFF_ANDROID_DOWNLOADS, reset: true };
});
handle('get-diagnostics', () => {
  const lines = [`Riff ${process.env.RIFF_APP_VERSION} (Android)`, `Node ${process.versions.node} ${process.arch}`, `Data ${platform.DATA_DIR}`];
  for (const name of ['yt-dlp', 'ffmpeg']) lines.push(`${name}: ${platform.resolveBinary(name) || 'NOT FOUND'}`);
  lines.push('--- last log lines ---', ...tail(60));
  return lines.join('\n');
});
handle('log-error', (data) => {
  try { log(data && data.level === 'warn' ? 'warn' : 'error', `[renderer] ${data && data.message}${data && data.stack ? '\n' + data.stack : ''}`); } catch (e) {}
});
// Same as Electron's import-audio-files, from files Android already copied for us
handle('import-audio-files', async (paths) => {
  fs.mkdirSync(platform.LIBRARY_DIR, { recursive: true });
  const out = [];
  for (const src of paths || []) {
    const st = fs.statSync(src);
    const ext = path.extname(src).slice(1).toLowerCase();
    const id = 'local_' + crypto.createHash('sha1').update(path.basename(src) + st.size).digest('hex').slice(0, 12);
    const file = `${id}.${ext}`;
    const dest = path.join(platform.LIBRARY_DIR, file);
    if (!fs.existsSync(dest)) await fs.promises.copyFile(src, dest);
    out.push({ id, file, ext, name: path.basename(src, path.extname(src)) });
    try { fs.unlinkSync(src); } catch (e) {}
  }
  return out;
});
// Background media for the custom background setting, kept in the data folder
handle('pick-media', async (paths) => {
  const src = paths && paths[0];
  if (!src) return null;
  const dir = path.join(platform.DATA_DIR, 'media');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${Date.now()}-${path.basename(src)}`);
  await fs.promises.copyFile(src, dest);
  try { fs.unlinkSync(src); } catch (e) {}
  return pathToFileURL(dest).href;
});

function startIpcServer(token) {
  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') return send(204, {});
    if (req.method !== 'POST' || req.headers['x-riff-token'] !== token) return send(403, { error: 'forbidden' });
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1024 * 1024) req.destroy(); });
    req.on('end', async () => {
      try {
        const { channel, args, paths } = JSON.parse(body || '{}');
        const fn = handlers.get(channel);
        if (!fn) return send(404, { error: `no handler for ${channel}` });
        if (paths) setPendingPaths(paths);
        const result = await fn({ sender: null }, ...(args || []));
        send(200, { result: result === undefined ? null : result });
      } catch (e) {
        send(500, { error: String(e && e.message || e) });
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

(async () => {
  const port = await startServer();
  const token = getServerToken();
  const ipcPort = await startIpcServer(token);
  const sessionPath = process.env.RIFF_ANDROID_SESSION;
  fs.writeFileSync(sessionPath + '.tmp', JSON.stringify({ port, ipcPort, token }));
  fs.renameSync(sessionPath + '.tmp', sessionPath);
  console.log(`Riff ready: server ${port}, ipc ${ipcPort}`);
})().catch(reportFailure);
