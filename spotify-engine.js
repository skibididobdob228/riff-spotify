// Spotify search engine: catalog data (search, covers, artists, monthly listeners) comes from
// Spotify's web player API with an anonymous token, audio comes from the matching YouTube Music song.
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PATHFINDER_URL = 'https://api-partner.spotify.com/pathfinder/v2/query';
// Any public track works for minting an anonymous token
const TOKEN_EMBED_URL = 'https://open.spotify.com/embed/track/4iRg9tHDgmRPvv56IC46Pl';
// Persisted query hashes from the web player; refreshed from its bundles when Spotify rotates them
const DEFAULT_HASHES = {
  searchTracks: 'b02683192a98dde7966b5e6655a79eeb62713eab703eda9902c932818dd52751',
  searchArtists: '7bf95d754fdbe32c8b161fbbe54d1ae50974900df4dce4c8f1afcbcad153224d',
  searchAlbums: '202cb3305e31e5a0767ba7925f28bd728cf8f8b0217e6da43909056071cd70e9',
  queryArtistOverview: '9f8134ef565e78621f1e1793555bd6633c5ac144ae0f89604ed3ae3f80b3c8e6',
  queryArtistDiscographyAll: '5e07d323febb57b4a56a42abbf781490e58764aa45feb6e3dc0591564fc56599',
  getAlbum: '0b6ce3511e1b02e4a40fa95440f992acbe85080eb308af9194322d708fc1914f'
};
const SEARCH_VARS = { offset: 0, numberOfTopResults: 5, includeAudiobooks: false, includePreReleases: false, includeAuthors: false };

// Words that mark a different recording than the studio version, with how much they cost
const VERSION_PENALTIES = [
  [100, ['instrumental', 'karaoke', 'минус', 'караоке', 'backing track']],
  [60, ['cover', 'кавер']],
  [30, ['live', 'remix', 'acoustic', 'sped up', 'slowed', 'nightcore', '8d', 'reverb', 'demo', 'concert', 'концерт', 'ремикс']]
];
const MATCH_OK = 45;

const idOf = (uri) => String(uri || '').split(':').pop();

function idFromUrl(url) {
  const m = String(url || '').match(/open\.spotify\.com\/(?:intl-[\w-]+\/)?track\/([A-Za-z0-9]{22})/);
  return m ? m[1] : null;
}

function pickImage(sources) {
  if (!Array.isArray(sources) || !sources.length) return '';
  const size = (s) => s.width || s.maxWidth || (/ab67616d0000b273/.test(s.url) ? 640 : 0);
  return [...sources].sort((a, b) => size(b) - size(a))[0].url || '';
}

function mapTrack(t) {
  if (!t || !String(t.uri || '').startsWith('spotify:track:')) return null;
  const id = idOf(t.uri);
  const artists = ((t.artists && t.artists.items) || [])
    .map((a) => ({ id: idOf(a.uri), name: a.profile && a.profile.name }))
    .filter((a) => a.name);
  return {
    id: `sp_${id}`,
    title: t.name || 'untitled',
    artist: artists.map((a) => a.name).join(', ') || 'Unknown Artist',
    duration: Math.round(((t.duration && t.duration.totalMilliseconds) || 0) / 1000),
    thumbnail: pickImage(t.albumOfTrack && t.albumOfTrack.coverArt && t.albumOfTrack.coverArt.sources),
    url: `https://open.spotify.com/track/${id}`,
    platform: 'spotify',
    album: (t.albumOfTrack && t.albumOfTrack.name) || '',
    spotifyArtists: artists,
    explicit: !!(t.contentRating && t.contentRating.label === 'EXPLICIT'),
    plays: t.playcount ? Number(t.playcount) : 0
  };
}

// Album/single/EP card in the shape Riff's album views use; ids are "sp_<spotify album id>"
function mapRelease(r, fallbackArtist = '') {
  if (!r || !String(r.uri || '').startsWith('spotify:album:')) return null;
  const artists = ((r.artists && r.artists.items) || []).map((a) => a.profile && a.profile.name).filter(Boolean);
  const year = (r.date && (r.date.year || String(r.date.isoString || '').slice(0, 4))) || '';
  return {
    id: `sp_${idOf(r.uri)}`,
    title: r.name || '',
    artist: artists.join(', ') || fallbackArtist,
    year: year ? String(year) : '',
    cover: pickImage(r.coverArt && r.coverArt.sources),
    trackCount: (r.tracks && r.tracks.totalCount) || 0,
    type: r.type || 'ALBUM'
  };
}

// --- matching a Spotify track to a YouTube Music song ---
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
};
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ё/g, 'е')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// Latin-only key so "Кино" and "Kino" compare equal
const key = (s) => norm(s).replace(/[а-я]/g, (ch) => TRANSLIT[ch]);
// "Song (feat. X) - Remastered 2009" -> "song"
const baseTitle = (s) => key(String(s || '').replace(/\s*[([][^)\]]*[)\]]/g, ' ').replace(/\s+-\s+.*$/, ''));
// YouTube video titles are often "Artist - Song (Official Video)"
const titleVariants = (s) => [s, ...String(s || '').split(/\s+-\s+/).slice(0, 2)];
const words = (s) => new Set(s.split(' ').filter(Boolean));

// Spelling-insensitive form of a latin word: "max" ~ "maks", "skryptonite" ~ "skriptonit"
const squash = (w) => w.replace(/x/g, 'ks').replace(/ph/g, 'f').replace(/w/g, 'v').replace(/[yj]/g, 'i')
  .replace(/ck|q|c/g, 'k').replace(/(.)\1+/g, '$1');

// 1 - normalized edit distance
function similarity(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

function overlap(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.max(A.size, B.size);
}

// Above MATCH_OK only when title and artist both agree
function matchScore(sp, c) {
  const spBase = baseTitle(sp.title);
  const title = Math.max(...titleVariants(c.title).map((t) => overlap(spBase, baseTitle(t))));
  // The artist must be the uploader or named in the title itself; "Song (Queen)" is how covers credit the original
  const cWords = [...words(key(`${c.artist} ${String(c.title || '').replace(/[([][^)\]]*[)\]]/g, ' ')}`))].map(squash);
  const artistHit = sp.artists.some((a) => {
    const aw = [...words(key(a))].map(squash);
    return aw.length > 0 && aw.every((w) => cWords.some((cw) => similarity(cw, w) >= 0.75));
  });
  let dur = 5;
  if (sp.duration && c.duration) {
    const d = Math.abs(sp.duration - c.duration);
    dur = d <= 2 ? 25 : d <= 5 ? 18 : d <= 10 ? 8 : d <= 30 ? -5 : -40;
  }
  const spFull = ` ${key(sp.title)} `, cTitle = ` ${key(c.title)} `;
  let penalty = 0;
  for (const [cost, list] of VERSION_PENALTIES) {
    penalty += list.map(key).filter((w) => cTitle.includes(` ${w} `) && !spFull.includes(` ${w} `)).length * cost;
  }
  return title * 40 + (artistHit ? 35 : -40) + dur - penalty;
}

module.exports = function createSpotifyEngine({ ytmSearchRequest, parseYtmSongs, directYoutubeSearch, logger, dataDir }) {
  const log = (level, msg) => { try { logger.log(level, `spotify: ${msg}`); } catch (_) {} };

  async function getText(url, timeout = 15000) {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(timeout) });
    if (!r.ok) throw new Error(`${url} status ${r.status}`);
    return r.text();
  }

  let token = '', tokenExp = 0, tokenPending = null;
  function getToken(force) {
    if (!force && token && Date.now() < tokenExp) return Promise.resolve(token);
    if (!tokenPending) {
      tokenPending = (async () => {
        const html = await getText(TOKEN_EMBED_URL);
        const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        const props = m ? JSON.parse(m[1]).props : null;
        const session = props && props.pageProps && props.pageProps.state && props.pageProps.state.settings && props.pageProps.state.settings.session;
        if (!session || !session.accessToken) throw new Error('no anonymous token in embed page');
        token = session.accessToken;
        tokenExp = (session.accessTokenExpirationTimestampMs || Date.now() + 30 * 60000) - 60000;
        return token;
      })().finally(() => { tokenPending = null; });
    }
    return tokenPending;
  }

  const hashes = { ...DEFAULT_HASHES };
  let hashesCheckedAt = 0;
  async function refreshHashes() {
    if (Date.now() - hashesCheckedAt < 10 * 60000) return false;
    hashesCheckedAt = Date.now();
    const html = await getText('https://open.spotify.com/search');
    const urls = new Set((html.match(/https:\/\/open\.spotifycdn\.com\/cdn\/build\/web-player\/web-player\.[0-9a-f]+\.js/g) || []));
    const cdn = html.match(/<script id="__CDN_FILE_URLS__"[^>]*>([^<]+)<\/script>/);
    if (cdn) {
      try {
        const files = JSON.parse(Buffer.from(cdn[1].trim(), 'base64').toString('utf8'));
        for (const [name, url] of Object.entries(files)) {
          if (/^build\/web-player\/xpui-routes-(search|artist)\.[0-9a-f]+\.js$/.test(name)) urls.add(url);
        }
      } catch (_) {}
    }
    let found = 0;
    for (const url of urls) {
      const js = await getText(url, 30000);
      for (const m of js.matchAll(/"(\w+)","query","([0-9a-f]{64})"/g)) {
        if (m[1] in hashes) { hashes[m[1]] = m[2]; found++; }
      }
    }
    log('warn', `refreshed ${found} query hashes from the web player`);
    return found > 0;
  }

  async function query(op, variables, retry = '') {
    const tok = await getToken(retry === 'token');
    const r = await fetch(PATHFINDER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tok}`,
        'Content-Type': 'application/json;charset=UTF-8',
        'User-Agent': UA,
        'app-platform': 'WebPlayer',
        'Referer': 'https://open.spotify.com/'
      },
      body: JSON.stringify({ variables, operationName: op, extensions: { persistedQuery: { version: 1, sha256Hash: hashes[op] } } }),
      signal: AbortSignal.timeout(15000)
    });
    if (r.status === 401 && !retry) return query(op, variables, 'token');
    if (r.status === 412 && retry !== 'hash' && await refreshHashes().catch((e) => { log('error', `hash refresh failed: ${e.message}`); return false; })) {
      return query(op, variables, 'hash');
    }
    const text = await r.text();
    if (!r.ok) throw new Error(`${op} status ${r.status}: ${text.slice(0, 120)}`);
    const json = JSON.parse(text);
    if (!json || !json.data) throw new Error(`${op}: empty response`);
    return json.data;
  }

  async function search(q, limit = 20) {
    const d = await query('searchTracks', { ...SEARCH_VARS, searchTerm: q, limit: Math.min(50, limit) });
    const items = (d.searchV2 && d.searchV2.tracksV2 && d.searchV2.tracksV2.items) || [];
    return items.map((x) => mapTrack(x && x.item && x.item.data)).filter(Boolean);
  }

  async function searchAlbums(q, limit = 20) {
    const d = await query('searchAlbums', { ...SEARCH_VARS, searchTerm: q, limit: Math.min(50, limit) });
    const items = (d.searchV2 && d.searchV2.albumsV2 && d.searchV2.albumsV2.items) || [];
    return items.map((x) => mapRelease(x && x.data)).filter(Boolean);
  }

  // Albums, singles, EPs and compilations, newest first
  async function discography(artistId, artistName) {
    const items = [];
    for (let offset = 0; offset < 300; offset += 50) {
      const d = await query('queryArtistDiscographyAll', { uri: `spotify:artist:${artistId}`, offset, limit: 50, order: 'DATE_DESC' });
      const all = d.artistUnion && d.artistUnion.discography && d.artistUnion.discography.all;
      const page = (all && all.items) || [];
      items.push(...page);
      if (!page.length || items.length >= ((all && all.totalCount) || 0)) break;
    }
    return items.map((x) => mapRelease(x.releases && x.releases.items && x.releases.items[0], artistName)).filter(Boolean);
  }

  // id: "sp_<album id>"; tracks follow Riff's album format plus `track`, a ready-to-play Spotify track
  async function album(id) {
    const albumId = String(id || '').replace(/^sp_/, '');
    if (!/^[A-Za-z0-9]{22}$/.test(albumId)) return null;
    let a = null;
    const items = [];
    for (let offset = 0; offset < 500; offset += 50) {
      const d = await query('getAlbum', { uri: `spotify:album:${albumId}`, locale: '', offset, limit: 50 });
      a = a || d.albumUnion;
      const page = (d.albumUnion && d.albumUnion.tracksV2 && d.albumUnion.tracksV2.items) || [];
      items.push(...page);
      const total = (d.albumUnion && d.albumUnion.tracksV2 && d.albumUnion.tracksV2.totalCount) || 0;
      if (!page.length || items.length >= total) break;
    }
    if (!a || !a.name) return null;
    const info = mapRelease({ ...a, tracks: { totalCount: items.length } });
    const tracks = items.map((x) => {
      const t = x && x.track;
      const track = mapTrack(t);
      if (!track) return null;
      track.thumbnail = track.thumbnail || info.cover;
      track.album = track.album || info.title;
      return {
        no: t.trackNumber || 1,
        disc: t.discNumber || 1,
        title: track.title,
        artist: track.artist,
        durationMs: (t.duration && t.duration.totalMilliseconds) || 0,
        track
      };
    }).filter(Boolean);
    return { album: info, tracks };
  }

  async function artist({ id, name }) {
    if (!id && name) {
      const d = await query('searchArtists', { ...SEARCH_VARS, searchTerm: name, limit: 5 });
      const items = ((d.searchV2 && d.searchV2.artists && d.searchV2.artists.items) || []).map((x) => x.data).filter((x) => x && x.uri);
      const want = norm(name);
      const hit = items.find((x) => norm(x.profile && x.profile.name) === want) || items[0];
      if (!hit) return null;
      id = idOf(hit.uri);
    }
    if (!/^[A-Za-z0-9]{22}$/.test(String(id || ''))) return null;
    const [d, releases] = await Promise.all([
      query('queryArtistOverview', { uri: `spotify:artist:${id}`, locale: '', includePrerelease: false }),
      discography(id, name).catch((e) => { log('warn', `discography failed: ${e.message}`); return null; })
    ]);
    const a = d.artistUnion;
    if (!a || !a.profile) return null;
    // The overview carries the first albums and singles, enough when the full discography call fails
    const overviewReleases = ['albums', 'singles'].flatMap((k) => ((a.discography && a.discography[k] && a.discography[k].items) || [])
      .map((x) => mapRelease(x.releases && x.releases.items && x.releases.items[0], a.profile.name)));
    const topTracks = (a.discography && a.discography.topTracks && a.discography.topTracks.items) || [];
    return {
      id,
      name: a.profile.name,
      isVerified: !!a.profile.verified,
      bio: (a.profile.biography && a.profile.biography.text) || '',
      avatar: pickImage(a.visuals && a.visuals.avatarImage && a.visuals.avatarImage.sources),
      header: pickImage(a.headerImage && a.headerImage.data && a.headerImage.data.sources),
      monthlyListeners: (a.stats && a.stats.monthlyListeners) || 0,
      followers: (a.stats && a.stats.followers) || 0,
      tracks: topTracks.map((x) => mapTrack(x.track)).filter(Boolean),
      releases: (releases || overviewReleases).filter(Boolean).map((r) => ({ ...r, artist: r.artist || a.profile.name }))
    };
  }

  // Spotify track id -> YouTube video id, remembered across restarts
  const MATCHES_PATH = path.join(dataDir, 'spotify-matches.json');
  let matches = {};
  try { matches = JSON.parse(fs.readFileSync(MATCHES_PATH, 'utf8')) || {}; } catch (_) {}
  let saveTimer = null;
  function saveMatches() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { fs.promises.writeFile(MATCHES_PATH, JSON.stringify(matches)).catch(() => {}); }, 1000);
  }

  const resolving = new Map();
  function knownMatch(spId) {
    return matches[spId] || null;
  }

  // meta: { title, artist ("A, B"), duration in seconds }
  function resolveAudio(spId, meta = {}) {
    if (matches[spId]) return Promise.resolve(matches[spId]);
    if (resolving.has(spId)) return resolving.get(spId);
    const p = (async () => {
      const sp = {
        title: meta.title || '',
        artists: String(meta.artist || '').split(',').map((s) => s.trim()).filter(Boolean),
        duration: Number(meta.duration) || 0
      };
      if (!sp.title) return null;
      const q = `${sp.artists[0] || ''} ${sp.title}`.trim();
      let best = null;
      const consider = (c, bias) => {
        if (!c || !/^[\w-]{11}$/.test(String(c.id || ''))) return;
        const s = matchScore(sp, c) + bias;
        if (!best || s > best.score) best = { score: s, id: c.id, title: c.title, artist: c.artist };
      };
      try {
        parseYtmSongs(await ytmSearchRequest(q)).slice(0, 10).forEach((c) => consider(c, 0));
      } catch (e) { log('warn', `ytmusic lookup failed for "${q}": ${e.message}`); }
      if (!best || best.score < MATCH_OK) {
        try {
          ((await directYoutubeSearch(`${q} audio`)) || []).slice(0, 10).forEach((c) => consider(c, -5));
        } catch (e) { log('warn', `youtube lookup failed for "${q}": ${e.message}`); }
      }
      if (!best || best.score < 20) {
        log('warn', `no audio match for "${q}"`);
        return null;
      }
      if (best.score >= MATCH_OK) { matches[spId] = best.id; saveMatches(); }
      else log('warn', `weak audio match for "${q}": "${best.artist} - ${best.title}" (${Math.round(best.score)})`);
      return best.id;
    })().catch((e) => { log('error', `resolve failed: ${e.message}`); return null; })
      .finally(() => resolving.delete(spId));
    resolving.set(spId, p);
    return p;
  }

  return { idFromUrl, search, searchAlbums, album, artist, resolveAudio, knownMatch };
};

module.exports.matchScore = matchScore;
module.exports.mapTrack = mapTrack;
