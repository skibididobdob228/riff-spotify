// Riff on Android: stands in for Electron's preload. Builds window.electronAPI from the Java bridge
// (window.RiffAndroidNative) and the Node IPC endpoint started by android-main.js, and mirrors
// navigator.mediaSession into Android's notification and lock screen controls.
(() => {
  const native = window.RiffAndroidNative;
  if (!native) return;
  const session = JSON.parse(native.getSession() || '{}');
  const ipcUrl = `http://127.0.0.1:${session.ipcPort}/ipc`;

  function ipc(channel, args = [], paths) {
    return fetch(ipcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Riff-Token': session.token },
      body: JSON.stringify({ channel, args, paths })
    }).then((r) => r.json()).then((d) => {
      if (d.error) throw new Error(d.error);
      return d.result;
    });
  }
  const invoke = (channel) => (...args) => ipc(channel, args);
  const send = (channel) => (...args) => { ipc(channel, args).catch(() => {}); };

  const listeners = {};
  const on = (name) => (cb) => { (listeners[name] = listeners[name] || []).push(cb); };
  const emit = (name, data) => (listeners[name] || []).forEach((cb) => { try { cb(data); } catch (e) { console.error(e); } });

  let pickSeq = 0;
  const picks = new Map();
  const pickFiles = (accept, multiple) => new Promise((resolve) => {
    const id = String(++pickSeq);
    picks.set(id, resolve);
    native.pickFiles(id, accept, !!multiple);
  });
  // Pick natively, then run the same IPC handler Electron's file dialog would have fed
  const pickThen = (channel, accept, multiple, empty) => async () => {
    const paths = await pickFiles(accept, multiple);
    if (!paths.length) return empty;
    return ipc(channel, [], paths);
  };

  const noop = () => {};
  const resolved = (v) => () => Promise.resolve(v);

  window.electronAPI = {
    serverToken: session.token,
    isAndroid: true,
    isWindows: false,
    getServerPort: resolved(session.port),
    getAppVersion: () => Promise.resolve(native.getAppVersion()),
    minimizeWindow: () => native.moveToBackground(),
    maximizeWindow: noop,
    closeWindow: () => native.moveToBackground(),
    toggleMiniWindow: resolved(false),
    onWindowVisibility: on('window-visibility'),
    setZoomFactor: noop,
    getZoomFactor: () => 1,
    getGpuCompositing: resolved('enabled'),
    restartApp: () => native.restartApp(),
    openExternal: (url) => native.openExternal(url),
    logError: (level, message, stack) => { ipc('log-error', [{ level, message, stack }]).catch(() => {}); },
    openLogsFolder: noop,
    getDiagnostics: invoke('get-diagnostics'),
    getAudioOutputInfo: resolved(null),
    getLauncherInfo: resolved(null),

    pickMedia: pickThen('pick-media', 'image/*,video/*', false, null),
    importAudioFiles: pickThen('import-audio-files', 'audio/*', true, []),

    getCacheSize: invoke('get-cache-size'),
    clearCache: () => { native.clearWebCache(); return ipc('clear-cache'); },
    getDataDir: invoke('get-data-dir'),
    pickDataDir: resolved(null),
    setDataDir: resolved({ ok: false, error: 'The data folder is fixed on Android' }),
    getDownloadDir: invoke('get-download-dir'),
    pickDownloadDir: resolved(null),
    setDownloadDir: resolved({ ok: false, error: 'The download folder is fixed on Android' }),
    resetDownloadDir: () => ipc('set-download-dir', [{ reset: true }]),

    discordRpcUpdate: noop,
    discordRpcClear: noop,
    discordRpcSetEnabled: noop,
    discordRpcGetEnabled: resolved(false),
    discordRpcGetConnected: resolved(false),

    checkForUpdates: resolved({ ok: false, reason: 'android' }),
    updateAction: noop,
    onUpdateAvailable: on('update-available'),
    onUpdateProgress: on('update-progress'),
    onUpdateReady: on('update-ready'),
    onUpdateError: on('update-error'),
    onUpdateNotAvailable: on('update-not-available'),

    setTrayOnClose: noop,
    getMultiInstance: resolved(false),
    setMultiInstance: noop,
    onMediaCommand: on('media-command'),
    setMediaKeys: noop,
    mediaKeysActive: noop,
    welcomeFinish: noop,
    onWelcomeResult: on('welcome-result'),

    listThemes: invoke('themes-list'),
    importThemes: pickThen('themes-import', 'text/css,text/plain,*/*', true, []),
    setThemeEnabled: send('themes-set-enabled'),
    disableAllThemes: send('themes-disable-all'),
    removeTheme: send('themes-remove'),
    getAppCss: invoke('read-app-css'),

    listPlugins: invoke('plugins-list'),
    importPlugins: pickThen('plugins-import', 'application/javascript,text/javascript,text/plain,*/*', true, 0),
    setPluginEnabled: send('plugins-set-enabled'),
    disableAllPlugins: send('plugins-disable-all'),
    removePlugin: send('plugins-remove'),
    openPluginsFolder: noop
  };

  // --- Media Session → Android notification / lock screen ---
  const handlers = {};
  let metadata = null;
  let playbackState = 'none';
  let position = null;
  let pushTimer = null;

  function push() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      const m = metadata || {};
      const art = (m.artwork || []).filter((a) => a && a.src).slice(-1)[0];
      native.media(JSON.stringify({
        title: m.title || '',
        artist: m.artist || '',
        album: m.album || '',
        artwork: art ? new URL(art.src, location.href).href : '',
        state: playbackState,
        position: position ? position.position || 0 : 0,
        duration: position ? position.duration || 0 : 0,
        rate: position ? position.playbackRate || 1 : 1
      }));
    }, 50);
  }

  // Riff sometimes edits metadata.artwork in place, so the fields report changes themselves
  class AndroidMediaMetadata {
    constructor(init = {}) {
      this._d = { title: '', artist: '', album: '', artwork: [], ...init };
    }
  }
  for (const key of ['title', 'artist', 'album', 'artwork']) {
    Object.defineProperty(AndroidMediaMetadata.prototype, key, {
      get() { return this._d[key]; },
      set(v) { this._d[key] = v; if (metadata === this) push(); }
    });
  }
  window.MediaMetadata = AndroidMediaMetadata;

  const mediaSession = {
    get metadata() { return metadata; },
    set metadata(m) { metadata = m; push(); },
    get playbackState() { return playbackState; },
    set playbackState(s) { if (s !== playbackState) { playbackState = s; push(); } },
    setActionHandler(action, fn) { handlers[action] = fn; },
    setPositionState(p) { position = p || null; push(); }
  };
  Object.defineProperty(Navigator.prototype, 'mediaSession', { get: () => mediaSession, configurable: true });

  const MEDIA_ACTIONS = { play: 'play', pause: 'pause', next: 'nexttrack', prev: 'previoustrack', stop: 'stop' };

  // Called from Java
  window.__riffAndroid = {
    resolvePick(id, paths) {
      const resolve = picks.get(id);
      picks.delete(id);
      if (resolve) resolve(paths || []);
    },
    media(cmd, arg) {
      if (cmd === 'seek') {
        if (handlers.seekto) handlers.seekto({ action: 'seekto', seekTime: arg });
        return;
      }
      const action = MEDIA_ACTIONS[cmd];
      if (action && handlers[action]) handlers[action]({ action });
      else emit('media-command', cmd);
    },
    visibility(visible) {
      emit('window-visibility', visible);
    },
    // Back button: the now-playing sheet first, then Riff's Escape handling (dialogs, detail views), then home, then leave the app
    back() {
      if (isPhone() && nowPlayingOpen()) {
        document.getElementById('btn-close-right-panel')?.click();
        return;
      }
      const esc = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
      (document.activeElement || document.body).dispatchEvent(esc);
      if (esc.defaultPrevented) return;
      const active = document.querySelector('.content-view.active');
      if (active && active.id !== 'view-discover') {
        const backBtn = active.querySelector('[id^="btn-back-"]');
        if (backBtn) backBtn.click();
        else document.getElementById('nav-discover')?.click();
        return;
      }
      native.moveToBackground();
    }
  };

  document.documentElement.classList.add('riff-android');

  // On a phone Riff's right panel (cover, lyrics) is a full-screen "now playing" sheet: closed at start,
  // opened by tapping the player. Riff's own buttons do the toggling so its state stays in sync.
  const isPhone = () => window.innerWidth <= 600;
  const nowPlayingOpen = () => {
    const panel = document.getElementById('right-panel');
    return !!panel && !panel.classList.contains('hidden');
  };
  window.addEventListener('load', () => {
    if (isPhone() && nowPlayingOpen()) document.getElementById('btn-close-right-panel')?.click();
    document.getElementById('playbar')?.addEventListener('click', (e) => {
      if (!isPhone() || nowPlayingOpen() || e.target.closest('button, input, .progress-container, [role="slider"]')) return;
      document.getElementById('btn-toggle-lyrics-panel')?.click();
    });
  });
})();
