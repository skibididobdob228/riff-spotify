<p align="center">
  <img src="banner.png" alt="Riff" width="100%">
</p>

<h1 align="center">Riff Spotify</h1>

<p align="center"><b>A fork of <a href="https://github.com/rootscripts/riff">Riff</a> with a Spotify search engine: Spotify's catalog, YouTube Music's audio. No Spotify account needed.</b></p>

<p align="center">
  <a href="https://github.com/skibididobdob228/riff-spotify/releases/latest"><b>Download</b></a> ·
  <a href="#whats-different">What's different</a> ·
  <a href="#license">License</a>
</p>

## What's different

Everything from Riff 42.3.0, plus:

- **Spotify engine.** A fourth search engine next to YouTube, YouTube Music and SoundCloud (top bar or Settings → Search engine).
  Search results, titles, artists, covers and durations come from Spotify. Audio is the matching song on YouTube Music, picked by
  artist, title and length; covers, karaoke, instrumental, live and remix uploads are skipped. A found match is remembered, so the
  next play starts at once.
- **Artist pages from Spotify:** photo, header, biography, monthly listeners, top 10 tracks, and the full discography in
  *Albums* and *Singles and EPs* rows.
- **Albums from Spotify** in search and on album pages; album tracks play through the Spotify engine directly.
- **Custom colors plugin, bundled.** Any interface color instead of only light and dark, or colors taken from the playing
  track's cover (Settings → Theme). Installed and turned on at first start; delete it in Settings → Plugins and it stays deleted.
- **Portable Windows build.** A file named `portable` next to `Riff.exe` keeps all data in a `data` folder beside it.
- **Fix:** plugin styles no longer disappear when Riff re-applies themes or custom CSS (for example on every start).

Updates are offered from this fork's releases, so updating keeps the Spotify engine.

## Download

From [Releases](https://github.com/skibididobdob228/riff-spotify/releases/latest):

| File | For |
| --- | --- |
| `Riff-Spotify-…-win-x64.exe` | Windows installer |
| `Riff-Spotify-…-win-x64-portable.zip` | Windows, no install: unzip and run `Riff.exe` |
| `Riff-Spotify-…-linux-x86_64.AppImage` | Linux: `chmod +x` and run |

The installer uses its own app id and Start menu name ("Riff Spotify"), so it doesn't replace an installed official Riff.
Both read the same library folder.

## Good to know

- Spotify data comes from the endpoints Spotify's own web player uses, with an anonymous token. This project is not affiliated
  with or endorsed by Spotify, and it may need an update if Spotify changes those endpoints. Query hashes refresh themselves
  from the web player when Spotify rotates them.
- Some labels block their official uploads on YouTube in some regions. For those tracks the engine plays the best available
  upload (often a lyric video with the original audio), or an alternative version when nothing else exists.

## Building

Same as Riff: `npm ci`, then `npx electron-builder --win` or `--linux`. Pushing a `v*` tag builds the installer and the
AppImage on GitHub Actions and attaches them to the release. The portable zip is the unpacked Windows build (`dist/win-unpacked`)
with an empty `portable` file and [.github/portable-readme.txt](.github/portable-readme.txt) as `README.txt`.

## License

This fork is licensed under the [GNU General Public License v3.0](LICENSE).

It is based on [Riff](https://github.com/rootscripts/riff) by rootscripts, released under the MIT License. The original
copyright and permission notice is kept in [LICENSE-MIT](LICENSE-MIT) and applies to the code taken from Riff.
