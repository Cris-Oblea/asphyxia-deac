# DEAC: Dance Evolution Arcade for Asphyxia CORE

An [Asphyxia CORE](https://github.com/asphyxia-core) plugin for **DanceEvolution ARCADE** (Konami, game code `KDM`). It keeps every player's records the way the game sends them, so a card's progress, scores, unlocks and history come back on any machine, and it gives players a WebUI to look at them.

Made for the August 2016 build (`KDM-001-2016080100`); the February 2016 song table is in it too, so each build's songs are named right.

## Features

- **Saves and loads** every record the game keeps for a card (profile, scores, marks, the last 16 plays, unlocks), byte for byte, in coin mode, free play and event mode.
- **Progress events**: the internet-ranking event the game shows, one at a time, rotating weekly. Two songs are picked from the build's list by default, or you set the rotation. A machine only gets songs it can play.
- **Hall of fame**: each closed week's winners per song and difficulty, with trophies.
- **WebUI** for players: profile, scores per song and difficulty, the game's own marks (Play, Clear, Full combo), play history, achievements, trophies, rivals, all-time rankings, the event in progress and the Hall of fame.
- **Profile transfer**: export a card's records to a file and import them into your own card, on this server or another.
- **Discord** (optional): a message when a save makes a new #1 of a song and difficulty, and optionally the week's close.
- **Backup**: a key-protected download of the whole database.
- **The sensor of each score**: when the game runs from the [KDMSENSOR](https://github.com/Cris-Oblea/KDMSENSOR) launcher, each score shows whether it was played on a Kinect or a camera, and rankings can be read per sensor. Other launchers show "Not the KDMSENSOR launcher". It is an honour label, not anti-cheat.

## Requirements

- Asphyxia CORE v1.70b or later (forks of the CORE work too).
- The game pointed at the CORE as its e-amusement server.

## Installation

1. Copy the `deac@asphyxia` folder into the CORE's `plugins` folder.
2. Restart the CORE. The plugin shows up as **Dance Evolution Arcade DEAC plugin** in the WebUI.
3. Set its options in the WebUI if you want to (all have defaults).

## Options

| option | what it does |
|---|---|
| Progress events (rotation) | The weekly events: `name\|song[:letters],song[:letters]/...` (4-letter song codes; letters of L S E M $ for the difficulties). Empty: two songs picked by the plugin each week. |
| Days per Progress event | How long each event runs (default 7). |
| Rotation start | When the first event begins (default Monday 2026-01-05 UTC, so events run Monday to Monday). |
| Minutes before a week closes | How long after a week ends the plugin waits before it records the winners (default 30). |
| IRDATA id / songs | A single fixed event instead of the rotation. |
| EVENTMSG | The game's event feed text. |
| Server name | The name in the footer of the Discord posts (default "DEAC"). |
| Discord webhook URL | Where the new #1 messages go. Empty: off. |
| Discord: post the week's close | Also post each closed week's champions and next week's songs. |
| Backup key | Opens the database download at `deac@asphyxia/backup?key=<key>`. Empty: off. |
| Log every call | One line per save or load in the CORE's log, for testing. |

## What this repository never contains

- Konami's files, in any form: no game data, no module, no audio, no art. The song tables hold only each song's code, title and artist, so the WebUI can name them.
- Anybody's saves or scores.

## Credits

- **Asphyxia CORE** and its plugin API.
- The players whose reports shaped it.

Not affiliated with or endorsed by Konami.

## License

[MIT](LICENSE).
