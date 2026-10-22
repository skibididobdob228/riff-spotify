/**
 * @name Custom colors
 * @author Claude
 * @version 1.1.0
 * @description Любые цвета интерфейса вместо Light/Dark, в том числе из обложки текущего трека. Панель в Settings → Theme.
 */

const SURFACE = new Set([
  '--md-sys-color-background', '--md-sys-color-surface', '--md-sys-color-surface-dim', '--md-sys-color-surface-bright',
  '--md-sys-color-surface-container-lowest', '--md-sys-color-surface-container-low', '--md-sys-color-surface-container',
  '--md-sys-color-surface-container-high', '--md-sys-color-surface-container-highest'
]);
const TEXT = new Set(['--md-sys-color-on-surface', '--md-sys-color-on-surface-variant']);

// Tokens shown in "fine-tune", with labels
const FINE = [
  ['--md-sys-color-background', 'Фон окна'],
  ['--md-sys-color-surface', 'Поверхность'],
  ['--md-sys-color-surface-container-lowest', 'Панели: самые тёмные/светлые'],
  ['--md-sys-color-surface-container-low', 'Панели: уровень 1'],
  ['--md-sys-color-surface-container', 'Панели: уровень 2'],
  ['--md-sys-color-surface-container-high', 'Панели: уровень 3'],
  ['--md-sys-color-surface-container-highest', 'Панели: уровень 4'],
  ['--md-sys-color-surface-bright', 'Яркая поверхность'],
  ['--md-sys-color-primary', 'Акцент'],
  ['--md-sys-color-on-primary', 'Текст на акценте'],
  ['--md-sys-color-primary-container', 'Контейнер акцента'],
  ['--md-sys-color-on-primary-container', 'Текст в контейнере акцента'],
  ['--md-sys-color-secondary-container', 'Выделение (активные кнопки)'],
  ['--md-sys-color-on-secondary-container', 'Текст выделения'],
  ['--md-sys-color-tertiary', 'Третичный цвет'],
  ['--md-sys-color-on-surface', 'Основной текст'],
  ['--md-sys-color-on-surface-variant', 'Второстепенный текст'],
  ['--md-sys-color-outline', 'Обводка'],
  ['--md-sys-color-outline-variant', 'Разделители'],
  ['--md-sys-color-error', 'Ошибки'],
  ['--btn-primary-bg', 'Главные кнопки'],
  ['--btn-primary-fg', 'Текст главных кнопок']
];

const PRESETS = [
  ['Океан', '#0b1e2d', '#4fc3f7'],
  ['Лес', '#0f1f17', '#7bd88f'],
  ['Синтвейв', '#1a0b2e', '#ff2fb9'],
  ['Матрица', '#000a02', '#00ff41'],
  ['Кофе', '#2b1d14', '#d4a373'],
  ['Бордо', '#2a0a12', '#ff6b81'],
  ['Сакура', '#fff0f5', '#d6336c'],
  ['Песок', '#f4ecd8', '#b5651d'],
  ['Мята', '#e8fff5', '#00a884'],
  ['Небо', '#e3f2fd', '#1565c0']
];

// --- color helpers ---
const normHex = (v) => {
  let s = String(v || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(s) ? '#' + s.toLowerCase() : null;
};
const toRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (rgb) => '#' + rgb.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, w) => { const x = toRgb(a), y = toRgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * w)); };
const lum = (h) => {
  const c = toRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const bestOn = (bg) => (contrast(bg, '#ffffff') >= contrast(bg, '#111111') ? '#ffffff' : '#111111');
// Shift `fg` toward black or white until it reads on `bg`
const readable = (bg, fg, min = 4.5) => {
  const target = bestOn(bg);
  for (let w = 0; w <= 1; w += 0.05) { const c = mix(fg, target, w); if (contrast(bg, c) >= min) return c; }
  return target;
};
// HSL with h, s, l all in 0..1
const toHsl = (h) => {
  const [r, g, b] = toRgb(h).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let hh = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hh /= 6;
  }
  return [hh, s, l];
};
const fromHsl = (hh, s, l) => {
  hh = ((hh % 1) + 1) % 1;
  const f = (n) => { const k = (n + hh * 12) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
};
const hueShift = (h, deg) => { const [hh, s, l] = toHsl(h); return fromHsl(hh + deg / 360, s, l); };

// --- colors from cover art ---
// RGBA pixels -> the color covering the most area and the most vivid one
function analyzePixels(data) {
  // 24 hues x 3 lightness bands for colored pixels, plus 3 bands of grays
  const newBin = () => ({ n: 0, v: 0, r: 0, g: 0, b: 0 });
  const bins = Array.from({ length: 72 }, newBin);
  const grays = Array.from({ length: 3 }, newBin);
  let N = 0, chroma = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    N++;
    const [h, s, l] = toHsl(toHex([r, g, b]));
    const band = l < 0.35 ? 0 : l < 0.65 ? 1 : 2;
    let bin;
    if (s < 0.2 || l < 0.1 || l > 0.9) {
      bin = grays[band];
    } else {
      chroma++;
      bin = bins[band * 24 + (Math.floor(h * 24) % 24)];
      bin.v += s * (1 - Math.abs(l - 0.5) * 1.4);
    }
    bin.n++; bin.r += r; bin.g += g; bin.b += b;
  }
  if (!N) return null;
  const binHex = (x) => toHex([x.r / x.n, x.g / x.n, x.b / x.n]);
  let dom = null, domHue = 0, domScore = 0;
  bins.forEach((x, k) => {
    if (!x.n) return;
    const band = k - (k % 24), hue = k % 24;
    const score = x.n + (bins[band + (hue + 23) % 24].n + bins[band + (hue + 1) % 24].n) / 2;
    if (score > domScore) { domScore = score; dom = x; domHue = hue; }
  });
  // Accent: the most vivid color, preferring one that stands apart from the dominant hue
  let vib = null, vibApart = null;
  bins.forEach((x, k) => {
    if (!x.n) return;
    if (!vib || x.v > vib.v) vib = x;
    const d = Math.abs((k % 24) - domHue), dist = Math.min(d, 24 - d);
    if (dist >= 3 && x.n >= N * 0.02 && (!vibApart || x.v > vibApart.v)) vibApart = x;
  });
  vib = vibApart || vib;
  const colorful = chroma / N;
  const gray = grays.reduce((a, x) => (x.n > a.n ? x : a));
  return { dominant: binHex(colorful >= 0.15 && dom ? dom : gray), vibrant: vib && colorful >= 0.03 ? binHex(vib) : null };
}

// Keep hue and saturation, move lightness until text is comfortable to read
function fitBg(c) {
  const dark = lum(c) < 0.25;
  const text = dark ? '#f1f1f4' : '#17171a';
  let [h, s, l] = toHsl(c);
  while (contrast(fromHsl(h, s, l), text) < 6 && l > 0 && l < 1) l += dark ? -0.01 : 0.01;
  return fromHsl(h, s, l);
}

// style: 'cover' (the cover's own color), 'deep' (dark tone), 'light' (light tone)
function coverBase(an, style) {
  const [h, s] = toHsl(an.dominant);
  const bg = style === 'deep' ? fromHsl(h, Math.min(s, 0.6), 0.13)
    : style === 'light' ? fromHsl(h, Math.min(s, 0.75), 0.9)
    : fitBg(an.dominant);
  let accent;
  if (an.vibrant) {
    const [vh, vs, vl] = toHsl(an.vibrant);
    accent = fromHsl(vh, Math.max(vs, 0.55), Math.min(0.72, Math.max(0.42, vl)));
  } else {
    accent = bestOn(bg);
  }
  return { bg, accent: readable(bg, accent, 3) };
}

// --- palette from three base colors ---
function derive(cfg, base = cfg) {
  const bg = base.bg, accent = base.accent;
  const dark = lum(bg) < 0.2;
  const toward = dark ? '#ffffff' : '#000000';
  const away = dark ? '#000000' : '#ffffff';
  const step = (w) => mix(bg, toward, w);
  const text = cfg.text || (dark ? '#f1f1f4' : '#17171a');
  const onPrimary = bestOn(accent);
  const primaryContainer = mix(bg, accent, 0.28);
  const secondaryContainer = mix(step(0.1), accent, 0.22);
  const tertiary = hueShift(accent, 60);
  const t = {
    '--md-sys-color-background': bg,
    '--md-sys-color-surface': bg,
    '--md-sys-color-surface-dim': dark ? bg : step(0.12),
    '--md-sys-color-surface-bright': step(0.2),
    '--md-sys-color-surface-container-lowest': mix(bg, away, 0.3),
    '--md-sys-color-surface-container-low': step(0.04),
    '--md-sys-color-surface-container': step(0.07),
    '--md-sys-color-surface-container-high': step(0.11),
    '--md-sys-color-surface-container-highest': step(0.15),
    '--md-sys-color-surface-variant': step(0.15),
    '--md-sys-color-primary': accent,
    '--md-sys-color-on-primary': onPrimary,
    '--md-sys-color-primary-container': primaryContainer,
    '--md-sys-color-on-primary-container': readable(primaryContainer, accent),
    '--md-sys-color-secondary': mix(accent, text, 0.45),
    '--md-sys-color-secondary-container': secondaryContainer,
    '--md-sys-color-on-secondary-container': readable(secondaryContainer, text),
    '--md-sys-color-tertiary': tertiary,
    '--md-sys-color-tertiary-container': mix(bg, tertiary, 0.22),
    '--md-sys-color-on-surface': text,
    '--md-sys-color-on-surface-variant': readable(step(0.07), mix(text, bg, 0.28), 3.5),
    '--md-sys-color-outline': mix(text, bg, 0.5),
    '--md-sys-color-outline-variant': mix(text, bg, 0.82),
    '--md-sys-color-error': dark ? '#f2b8b5' : '#b3261e',
    '--md-sys-color-on-error': dark ? '#601410' : '#ffffff',
    '--btn-primary-bg': accent,
    '--btn-primary-fg': onPrimary,
    '--btn-primary-hover': mix(accent, onPrimary, 0.12)
  };
  Object.entries(cfg.over || {}).forEach(([k, v]) => { if (normHex(v)) t[k] = v; });
  return { tokens: t, dark };
}

function buildCss(tokens) {
  let out = ':root{';
  for (const [k, v] of Object.entries(tokens)) {
    if (SURFACE.has(k)) out += `${k}:color-mix(in srgb, ${v} var(--ui-alpha), transparent) !important;${k}-solid:${v} !important;`;
    else if (TEXT.has(k)) out += `${k}:color-mix(in srgb, ${v} var(--text-alpha), transparent) !important;${k}-solid:${v} !important;`;
    else out += `${k}:${v} !important;`;
  }
  return out + '}';
}

// --- state ---
// source: 'manual' (bg/accent from cfg) or 'cover' (from the playing track's art)
const DEFAULTS = { on: true, source: 'cover', coverStyle: 'cover', bg: '#1b1530', accent: '#ff7ab6', text: null, over: {} };
let cfg = Object.assign({}, DEFAULTS, Riff.storage.get('cfg', {}));
cfg.over = Object.assign({}, cfg.over);
const save = () => Riff.storage.set('cfg', cfg);

// Riff toggles .theme-light/.theme-dark on <body>; keep them matching our background
// while on, and remember what Riff wanted so it can be restored on turn-off.
const body = document.body;
let riffClasses = { light: body.classList.contains('theme-light'), dark: body.classList.contains('theme-dark') };
let ourClasses = null;
function setBodyClasses(c) {
  body.classList.toggle('theme-light', c.light);
  body.classList.toggle('theme-dark', c.dark);
}
const bodyObserver = new MutationObserver(() => {
  const cur = { light: body.classList.contains('theme-light'), dark: body.classList.contains('theme-dark') };
  if (!ourClasses) { riffClasses = cur; return; }
  if (cur.light === ourClasses.light && cur.dark === ourClasses.dark) return;
  riffClasses = cur;
  setBodyClasses(ourClasses);
});
bodyObserver.observe(body, { attributes: true, attributeFilter: ['class'] });

// --- following the cover of the playing track ---
const coverCache = new Map();
let coverUrl = '';
let coverColors = null; // analyzePixels() result for coverUrl, null while unknown

function currentCoverUrl() {
  const art = document.getElementById('playbar-artwork');
  const src = art && art.getAttribute('src');
  if (src) return art.src;
  const t = Riff.getTrack();
  return (t && (t.localThumbnail || t.thumbnail || t.cover || t.image || t.artworkUrl)) || '';
}

function loadCoverColors(url) {
  return new Promise((resolve) => {
    if (coverCache.has(url)) return resolve(coverCache.get(url));
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let an = null;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 48;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, 48, 48);
        an = analyzePixels(ctx.getImageData(0, 0, 48, 48).data);
      } catch (e) {}
      if (coverCache.size > 100) coverCache.delete(coverCache.keys().next().value);
      coverCache.set(url, an);
      resolve(an);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function updateCover() {
  const url = currentCoverUrl();
  if (url === coverUrl) return;
  coverUrl = url;
  const an = url ? await loadCoverColors(url) : null;
  if (url !== coverUrl) return; // a newer track came in meanwhile
  coverColors = an;
  if (cfg.source === 'cover') apply();
}

const artwork = document.getElementById('playbar-artwork');
const artObserver = new MutationObserver(updateCover);
if (artwork) artObserver.observe(artwork, { attributes: true, attributeFilter: ['src'] });
const offTrack = Riff.on('trackchange', () => setTimeout(updateCover, 50));

function currentBase() {
  if (cfg.source === 'cover' && coverColors) return coverBase(coverColors, cfg.coverStyle);
  return { bg: cfg.bg, accent: cfg.accent };
}

let removeColors = null;
function apply() {
  if (removeColors) { removeColors(); removeColors = null; }
  if (!cfg.on) {
    if (ourClasses) { ourClasses = null; setBodyClasses(riffClasses); }
    refreshUi();
    return;
  }
  const base = currentBase();
  const { tokens, dark } = derive(cfg, base);
  removeColors = Riff.addStyle(buildCss(tokens));
  ourClasses = { light: !dark, dark };
  setBodyClasses(ourClasses);
  refreshUi(tokens, base);
}

// Switch to manual colors, starting from whatever is on screen now
function setManual(changes) {
  const base = currentBase();
  Object.assign(cfg, { bg: base.bg, accent: base.accent }, changes, { source: 'manual' });
  save();
  apply();
}

// --- settings panel ---
const removeUiCss = Riff.addStyle(`
.rcc-root .rcc-hint{font-size:calc(12px*var(--font-scale,1));color:var(--md-sys-color-on-surface-variant);line-height:1.4;margin-top:4px}
.rcc-root.rcc-off .rcc-body{opacity:.45;pointer-events:none}
.rcc-presets{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.rcc-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px 4px 4px;border-radius:999px;border:1px solid var(--md-sys-color-outline-variant);background:var(--md-sys-color-surface-container);color:var(--md-sys-color-on-surface);cursor:pointer;font-size:calc(12px*var(--font-scale,1))}
.rcc-chip:hover{background:var(--md-sys-color-surface-container-highest)}
.rcc-chip i{width:18px;height:18px;border-radius:50%;flex-shrink:0;border:1px solid rgba(127,127,127,.35)}
.rcc-row{display:flex;align-items:center;gap:8px;margin-top:8px}
.rcc-row label{flex:1;min-width:0;font-size:calc(13px*var(--font-scale,1));color:var(--md-sys-color-on-surface)}
.rcc-row input[type=color]{width:38px;height:28px;border:1px solid var(--md-sys-color-outline-variant);padding:2px;background:none;border-radius:8px;cursor:pointer}
.rcc-row input[type=text]{width:84px;font-family:monospace;font-size:12px;background:var(--md-sys-color-surface-container-high);color:var(--md-sys-color-on-surface);border:1px solid var(--md-sys-color-outline-variant);border-radius:8px;padding:5px 8px}
.rcc-mini{border:1px solid var(--md-sys-color-outline-variant);background:transparent;color:var(--md-sys-color-on-surface-variant);border-radius:999px;padding:3px 9px;font-size:11px;cursor:pointer;min-width:52px}
.rcc-mini.rcc-set{background:var(--md-sys-color-secondary-container);color:var(--md-sys-color-on-secondary-container)}
.rcc-mini[hidden]{visibility:hidden;display:inline-block}
.rcc-adv{margin-top:12px}
.rcc-adv summary{cursor:pointer;font-size:calc(13px*var(--font-scale,1));color:var(--md-sys-color-primary)}
.rcc-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.rcc-root .theme-mode-toggle{margin-top:12px}
.rcc-root .theme-mode-btn{flex:1;cursor:pointer}
.rcc-cover{margin-top:8px}
.rcc-root:not(.rcc-src-cover) .rcc-cover{display:none}
.rcc-status{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:calc(12px*var(--font-scale,1));color:var(--md-sys-color-on-surface-variant)}
.rcc-status i{width:16px;height:16px;border-radius:50%;flex-shrink:0;border:1px solid rgba(127,127,127,.35)}
`);

let root = null;
const fineInputs = {};
const baseInputs = {};

function colorRow(label, onPick, extra) {
  const row = document.createElement('div');
  row.className = 'rcc-row';
  row.innerHTML = '<label></label><input type="color"><input type="text" spellcheck="false" maxlength="7">';
  row.querySelector('label').textContent = label;
  const [picker, hex] = row.querySelectorAll('input');
  picker.addEventListener('input', () => { hex.value = picker.value; onPick(picker.value); });
  hex.addEventListener('change', () => { const v = normHex(hex.value); if (v) onPick(v); else refreshUi(); });
  if (extra) row.appendChild(extra);
  return { row, set(v) { picker.value = v; if (document.activeElement !== hex) hex.value = v; } };
}

function buildUi() {
  const group = document.querySelector('.settings-section[data-cat="theme"] > .m3-group');
  if (!group) return false;
  root = document.createElement('div');
  root.className = 'setting-item rcc-root';
  root.innerHTML = `
    <div class="setting-item-top"><span class="setting-name">Свои цвета</span><button class="effect-switch-btn rcc-toggle"><span class="thumb"></span></button></div>
    <div class="rcc-hint">Любые цвета интерфейса. Пока включено, перекрывает Light / Dark / Auto.</div>
    <div class="rcc-body">
      <div class="theme-mode-toggle rcc-source">
        <button class="theme-mode-btn" data-source="manual">Свои цвета</button>
        <button class="theme-mode-btn" data-source="cover">Обложка трека</button>
      </div>
      <div class="rcc-cover">
        <div class="theme-mode-toggle rcc-style">
          <button class="theme-mode-btn" data-style="cover">Как на обложке</button>
          <button class="theme-mode-btn" data-style="deep">Тёмный тон</button>
          <button class="theme-mode-btn" data-style="light">Светлый тон</button>
        </div>
        <div class="rcc-status"><i></i><i></i><span></span></div>
      </div>
      <div class="rcc-presets"></div>
      <div class="rcc-base"></div>
      <details class="rcc-adv"><summary>Тонкая настройка каждого цвета</summary><div class="rcc-fine"></div></details>
      <div class="rcc-actions">
        <button class="btn-outline-pill rcc-random">Случайные цвета</button>
        <button class="btn-outline-pill rcc-reset">Сбросить тонкую настройку</button>
      </div>
    </div>`;

  root.querySelector('.rcc-toggle').addEventListener('click', () => { cfg.on = !cfg.on; save(); apply(); });
  root.querySelectorAll('[data-source]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.source === 'manual') setManual({});
    else { cfg.source = 'cover'; save(); apply(); }
  }));
  root.querySelectorAll('[data-style]').forEach((b) => b.addEventListener('click', () => {
    cfg.coverStyle = b.dataset.style; save(); apply();
  }));

  const presets = root.querySelector('.rcc-presets');
  PRESETS.forEach(([name, bg, accent]) => {
    const chip = document.createElement('button');
    chip.className = 'rcc-chip';
    chip.innerHTML = '<i></i><span></span>';
    chip.querySelector('i').style.background = `linear-gradient(135deg, ${bg} 50%, ${accent} 50%)`;
    chip.querySelector('span').textContent = name;
    chip.addEventListener('click', () => setManual({ bg, accent, text: null, over: {} }));
    presets.appendChild(chip);
  });

  const base = root.querySelector('.rcc-base');
  baseInputs.bg = colorRow('Фон', (v) => setManual({ bg: v }));
  baseInputs.accent = colorRow('Акцент', (v) => setManual({ accent: v }));
  const autoBtn = document.createElement('button');
  autoBtn.className = 'rcc-mini';
  autoBtn.textContent = 'Авто';
  autoBtn.title = 'Подбирать цвет текста под фон автоматически';
  autoBtn.addEventListener('click', () => { cfg.text = null; save(); apply(); });
  baseInputs.text = colorRow('Текст', (v) => { cfg.text = v; save(); apply(); }, autoBtn);
  baseInputs.textAuto = autoBtn;
  [baseInputs.bg, baseInputs.accent, baseInputs.text].forEach((r) => base.appendChild(r.row));

  const fine = root.querySelector('.rcc-fine');
  FINE.forEach(([token, label]) => {
    const reset = document.createElement('button');
    reset.className = 'rcc-mini rcc-set';
    reset.textContent = 'сброс';
    reset.title = 'Вернуть автоматический цвет';
    reset.addEventListener('click', () => { delete cfg.over[token]; save(); apply(); });
    const r = colorRow(label, (v) => { cfg.over[token] = v; save(); apply(); }, reset);
    r.reset = reset;
    fineInputs[token] = r;
    fine.appendChild(r.row);
  });

  root.querySelector('.rcc-reset').addEventListener('click', () => { cfg.over = {}; save(); apply(); });
  root.querySelector('.rcc-random').addEventListener('click', () => {
    const rnd = () => toHex([0, 0, 0].map(() => Math.random() * 255));
    setManual({ bg: rnd(), accent: rnd(), text: null, over: {} });
  });

  group.prepend(root);
  return true;
}

function refreshUi(tokens, base) {
  if (!root) return;
  root.classList.toggle('rcc-off', !cfg.on);
  root.classList.toggle('rcc-src-cover', cfg.source === 'cover');
  root.querySelector('.rcc-toggle').classList.toggle('active', cfg.on);
  root.querySelectorAll('[data-source]').forEach((b) => b.classList.toggle('active', b.dataset.source === cfg.source));
  root.querySelectorAll('[data-style]').forEach((b) => b.classList.toggle('active', b.dataset.style === cfg.coverStyle));
  base = base || currentBase();
  const t = tokens || derive(cfg, base).tokens;
  const [dotBg, dotAccent] = root.querySelectorAll('.rcc-status i');
  dotBg.style.background = base.bg;
  dotAccent.style.background = base.accent;
  root.querySelector('.rcc-status span').textContent = coverColors
    ? 'Цвета из обложки. Меняются при смене трека.'
    : 'Обложки нет — пока используются свои цвета.';
  baseInputs.bg.set(base.bg);
  baseInputs.accent.set(base.accent);
  baseInputs.text.set(cfg.text || t['--md-sys-color-on-surface']);
  baseInputs.textAuto.classList.toggle('rcc-set', !cfg.text);
  FINE.forEach(([token]) => {
    const r = fineInputs[token];
    r.set(t[token]);
    r.reset.hidden = !(token in cfg.over);
  });
}

if (!buildUi()) Riff.toast('Custom colors: не нашёл раздел Theme в настройках, панель не добавлена', 'error');
apply();
updateCover();

return {
  stop() {
    bodyObserver.disconnect();
    artObserver.disconnect();
    offTrack();
    if (removeColors) removeColors();
    if (ourClasses) { ourClasses = null; setBodyClasses(riffClasses); }
    removeUiCss();
    if (root) root.remove();
  }
};
