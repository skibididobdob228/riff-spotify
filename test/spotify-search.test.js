'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanTitle, dedupeTracks, pickTopArtist, parseLink, matchScore } = require('../spotify-engine');

const track = (id, artist, title, duration, extra = {}) => ({
  id: `sp_${id}`,
  title,
  artist,
  duration,
  explicit: false,
  spotifyArtists: artist.split(', ').map((name, i) => ({ id: `${id}_a${i}`, name })),
  ...extra
});

test('cleanTitle drops edition tags but keeps other recordings apart', () => {
  assert.equal(cleanTitle('Bohemian Rhapsody - Remastered 2011'), 'Bohemian Rhapsody');
  assert.equal(cleanTitle('Yesterday (Remastered 2009)'), 'Yesterday');
  assert.equal(cleanTitle('Help! - Mono Version'), 'Help!');
  assert.equal(cleanTitle('Bohemian Rhapsody - Live Aid'), 'Bohemian Rhapsody - Live Aid');
  assert.equal(cleanTitle('Song (feat. X)'), 'Song (feat. X)');
  assert.equal(cleanTitle('(Remastered)'), '(Remastered)', 'never cleans a title down to nothing');
});

test('dedupeTracks keeps one card per recording in Spotify order', () => {
  const queen = { spotifyArtists: [{ id: 'queen', name: 'Queen' }] };
  const out = dedupeTracks([
    track('1', 'Queen', 'Bohemian Rhapsody', 354, queen),
    track('2', 'Queen', 'Bohemian Rhapsody - Remastered', 355, queen),
    track('3', 'Panic! At The Disco', 'Bohemian Rhapsody', 363),
    track('4', 'Queen', 'Bohemian Rhapsody - Live Aid', 148, queen),
    track('5', 'Queen', 'Bohemian Rhapsody', 356, queen),
    track('6', 'Queen', 'Bohemian Rhapsody', 351, { ...queen, explicit: true }),
    track('7', 'Queen', 'Bohemian Rhapsody', 300, queen)
  ]);
  assert.deepEqual(out.map((t) => t.id), ['sp_1', 'sp_3', 'sp_4', 'sp_6', 'sp_7']);
});

test('dedupeTracks compares the lead artist, so "Kino" and "Kino, Viktor Tsoi" are one recording', () => {
  const out = dedupeTracks([
    track('1', 'Kino', 'Группа крови', 284),
    track('2', 'Kino, Viktor Tsoi', 'Группа крови', 286),
    track('3', 'Kino', 'Группа крови', 235)
  ]);
  assert.deepEqual(out.map((t) => t.id), ['sp_1', 'sp_3']);
});

test('pickTopArtist shows the artist the query names, only when they lead the results', () => {
  const kino = { id: 'kino', name: 'Kino' };
  const skr = { id: 'skr', name: 'Skryptonite' };
  const band = { id: 'br', name: 'Bohemian Rhapsody' };
  const by = (a, title) => ({ title, spotifyArtists: [{ id: a.id, name: a.name }] });

  assert.equal(pickTopArtist('кино группа крови', [kino], [by(kino, 'Группа крови')]), kino);
  assert.equal(pickTopArtist('скрипт', [skr], [by(skr, 'Положение')]), skr, 'transliterated prefix');
  assert.equal(pickTopArtist('Skryptonite', [skr], [by(skr, 'Положение')]), skr);
  assert.equal(pickTopArtist('bohemian rhapsody', [band], [by({ id: 'queen', name: 'Queen' }, 'Bohemian Rhapsody')]), null,
    'a namesake band absent from the results is not the artist the query is about');
  assert.equal(pickTopArtist('', [kino], [by(kino, 'x')]), null);
});

test('parseLink reads Spotify links and URIs', () => {
  const id = '4iRg9tHDgmRPvv56IC46Pl';
  assert.deepEqual(parseLink(`https://open.spotify.com/album/${id}?si=abc`), { type: 'album', id });
  assert.deepEqual(parseLink(`open.spotify.com/intl-de/artist/${id}`), { type: 'artist', id });
  assert.deepEqual(parseLink(`spotify:track:${id}`), { type: 'track', id });
  assert.equal(parseLink('кино группа крови'), null);
  assert.equal(parseLink(`https://open.spotify.com/album/${id.toLowerCase().slice(1)}`), null);
});

test('matchScore still prefers the studio version over a live one', () => {
  const sp = { title: 'Bohemian Rhapsody', artists: ['Queen'], duration: 354 };
  const studio = matchScore(sp, { title: 'Bohemian Rhapsody', artist: 'Queen', duration: 355 });
  const live = matchScore(sp, { title: 'Bohemian Rhapsody (Live Aid 1985)', artist: 'Queen', duration: 356 });
  assert.ok(studio > live);
});
