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

1. Download `asphyxia-deac-x.y.z.zip` from the [latest release](https://github.com/Cris-Oblea/asphyxia-deac/releases/latest) and extract it.
2. Copy the `deac@asphyxia` folder into the CORE's `plugins` folder.
3. Restart the CORE. The plugin shows up as **DEAC** in the WebUI's game list (the WebUI is the address the CORE shows when it starts; on the same PC, by default `http://localhost:8083`).
4. Set its options in the WebUI if you want to (all have defaults; see [Options](#options)).

## Using it

- **Connect the game.** In the launcher's *spice2x settings...*, Options tab, set the e-amusement URL to the CORE's address (`http://localhost:8083` on the same PC, `http://<the server's IP>:8083` from another one). Play with a card: everything saved goes to that card.
- **Players' pages.** Each player signs up in the CORE's WebUI with their card and finds their profile under **DEAC**: Details, Scores, Achievements, History, Rivals and Transfer. The plugin's own pages in the sidebar (Progress event, Hall of fame, All-time rankings) are open to everyone.
- **Progress events.** Nothing to do: each week the plugin picks two songs and the game shows them as its ranking event. To choose the songs yourself, fill *Progress events (rotation)*. When a week closes, its winners go to the Hall of fame with their trophies.
- **Discord.** In your Discord server: *Server Settings > Integrations > Webhooks > New Webhook*, pick the channel, *Copy Webhook URL*. Paste it into the *Discord webhook URL* option and set *Server name* to how the posts should sign. From then on, each new #1 of a song and difficulty is posted there; turn on *Discord: post the week's close* to post each week's champions and next week's songs too.
- **Changing the name.** On the profile's Details, type the new name and press *Change the name*: up to 10 characters the game's name entry has (letters, digits, . , ; : @, hiragana, katakana, ー, spaces), as many times as you like. The game shows it from the next card-in, and every page (rankings, Hall of fame) at once.
- **Moving a profile.** On the profile's Transfer tab, download the card's records as a file; on the other server (or another card), sign in to the new card and import that file. Importing replaces that card's records.
- **Backup.** Set a *Backup key*, then open `http://<CORE>/plugin/deac@asphyxia/backup?key=<your key>` to download the whole database. With no key it stays closed.

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
| Backup key | Opens the database download at `/plugin/deac@asphyxia/backup?key=<key>`. Empty: off. |
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
