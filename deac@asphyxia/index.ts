// Dance Evolution Arcade (KDM) for Asphyxia CORE: the record-keeping core. MIT.
// A record is kept byte for byte: the game sends `mask,NAME,ver,col,...,` (base64) plus `bin1` (base64, 512 bytes) and
// reads back `ver,col,...,` for the same name, so only the first two tokens are dropped on the way out.
import * as http from "http";
import * as https from "https";
import { SONGS, SONG_COUNT_ALL, EVENT_SONGS } from "./data/songs";

type Rec = { collection: "record"; dataid: string; name: string; tail: string; bin?: string; build: string; pcbid?: string; sensor?: string; songlist?: string; songtotal?: number; songs?: any[]; shop?: string; history?: any[] };

const ok = () => ({ result: K.ITEM("s32", 0) });
const log = (...a: any[]) => { if (U.GetConfig("log_calls")) console.log("[deac]", ...a); }; // the operator's option, for a test run
const buildOf = (info: EamuseInfo) => (info.model || "").split(":").pop(); // KDM:J:A:A:2016080100 -> 2016080100
const GRADES = ["-", "E", "D", "C", "B", "A", "AA", "AAA"];
// DATA01-05 are difficulty 0-4 of song rows 0-62, DATA11-15 the same of rows 63-125; 8 bytes per row at bin + 8 * (row % 63)
const SONG_RECORDS: { [name: string]: [number, number] } = {
  DATA01: [0, 0], DATA02: [1, 0], DATA03: [2, 0], DATA04: [3, 0], DATA05: [4, 0],
  DATA11: [0, 63], DATA12: [1, 63], DATA13: [2, 63], DATA14: [3, 63], DATA15: [4, 63],
};

// the played songs of a song record, named by the table of the build that sent it (a row means another song in another build)
// `sensor` tags the entries whose score is new (or beaten) in this save; an unchanged entry keeps the tag of the save that made it
function songsOf(name: string, sent: Buffer, build: string, sensor: string, prev: any[] = []) {
  const [diff, base] = SONG_RECORDS[name] || [0, 0];
  const bin = Buffer.alloc(512); // the game drops the trailing zero bytes of bin1 (seen in game): the rest is zero
  sent.copy(bin, 0, 0, 512);
  const out = [];
  for (let i = 0; i < 63; i++) {
    const score = bin.readUInt32LE(i * 8);
    const w = bin.readUInt32LE(i * 8 + 4);
    if (!score && !w) continue;
    const row = base + i;
    const [code, title, , rom = ""] = (SONGS[build] || [])[row] || ["", `row ${row}`];
    const was = prev.find((e) => e.row === row && e.diff === diff);
    out.push({ row, code, title, rom, diff, score, sensor: was && was.score === score ? was.sensor || "other" : sensor, combo: w & 0x3ff, plays: (w >>> 10) & 0x3ff, grade: GRADES[(w >>> 25) & 7], clear: (w >>> 28) & 3 });
  }
  return out;
}

// RDAT01's 16 plays, newest first (0x20 bytes each: score; row / difficulty / combo / flags / grade / clear bits; time ms), named by the
// build's table. `sensor` and `shop` are the machine's at the save that first showed the play (a play already stored keeps its own): the game's
// RDAT01 shop strings are cut at their first NUL on the wire (area only), so the shop is DATA01's, the one the player played in
function historyOf(sent: Buffer, build: string, sensor: string, shop: string, prev: any[] = []) {
  const bin = Buffer.alloc(512);
  sent.copy(bin, 0, 0, 512);
  const out = [];
  for (let i = 0; i < 16; i++) {
    const score = bin.readUInt32LE(i * 32), p = bin.readUInt32LE(i * 32 + 4), time = Number(bin.readBigUInt64LE(i * 32 + 8));
    if (!time) continue;
    const row = p & 0xff, [code, title, , rom = ""] = (SONGS[build] || [])[row] || ["", `row ${row}`];
    const was = prev.find((e) => e.time === time && e.score === score && e.row === row);
    out.push({ row, code, title, rom, diff: (p >>> 8) & 0xf, score, combo: (p >>> 12) & 0x3ff, grade: GRADES[(p >>> 27) & 7], clear: (p >>> 30) & 3, time,
      sensor: was ? was.sensor || "other" : sensor, shop: was ? was.shop || "" : shop });
  }
  return out;
}

// what the WebUI reads from a record, derived from its bin: DATA01's song total and shop, the played songs, the history; `prev` is the stored record this one replaces
function derive(doc: Partial<Rec>, name: string, bin: string, build: string, sensor: string, shop: string, prev?: Rec | null) {
  if (name === "DATA01") { doc.songtotal = SONG_COUNT_ALL[build || ""]; doc.shop = shop; }   // the total is always the build's with the mod's songs, whatever Song list the machine shows
  if (name === "RDAT01" && bin) doc.history = historyOf(Buffer.from(bin, "base64"), build, sensor, shop, prev?.history);
  if (name in SONG_RECORDS && bin) doc.songs = songsOf(name, Buffer.from(bin, "base64"), build, sensor, prev?.songs);
}

// ---- the profile file: one card's records out of a server and into another card or server ----
// {format: "deac-profile", version: 1, refid, records: [{name, dataid, tail, bin, build, sensor?, songlist?, songs?, history?}]}; tail and bin are the stored
// base64 as is, so a load after an import returns what the game saved byte for byte. `songs` ([row, diff, score, sensor]) and `history` ([time, score,
// row, sensor, shop]) only carry the sensor and shop tags the WebUI shows; everything else the WebUI reads is derived again from the bin
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const str = (v: any, max: number) => (typeof v === "string" && v.length <= max ? v : "");
const tagOf = (v: any) => (v === "kinect" || v === "camera" ? v : "other");
function readProfile(file: any, refid: string): { error: string } | { docs: Partial<Rec>[] } {
  const bad = (error: string) => ({ error });
  if (!file || typeof file !== "object" || file.format !== "deac-profile" || file.version !== 1) return bad("not a DEAC profile file");
  if (!/^[A-Za-z0-9]{1,64}$/.test(file.refid || "")) return bad("the file names no source card");
  if (!Array.isArray(file.records) || !file.records.length || file.records.length > 64) return bad("the file holds no records, or too many");
  const seen = new Set<string>(), docs: Partial<Rec>[] = [];
  const shopOf = (file.records.find((r: any) => r && r.name === "DATA01") || {}).tail;
  const shop = typeof shopOf === "string" && B64.test(shopOf) ? Buffer.from(shopOf, "base64").toString("latin1").split(",")[1 + 26] || "" : "";
  for (const r of file.records) {
    if (!r || typeof r !== "object") return bad("a record is not an object");
    const { name, dataid, tail, bin = "", build = "" } = r;
    if (typeof name !== "string" || !/^[A-Z0-9]{1,9}$/.test(name)) return bad(`a record has the name ${JSON.stringify(name)}`);
    if (typeof tail !== "string" || tail.length > 24000 || !B64.test(tail) || !/^[0-9a-f]+,/i.test(Buffer.from(tail, "base64").toString("latin1")))
      return bad(`${name}: the columns are not the game's (version, then values)`);
    if (typeof bin !== "string" || !B64.test(bin) || Buffer.from(bin, "base64").length > 512) return bad(`${name}: the binary part is not base64 of at most 512 bytes`);
    if (typeof build !== "string" || !/^(\d{10})?$/.test(build)) return bad(`${name}: the build is not a game build`);
    if (typeof dataid !== "string" || !/^[A-Za-z0-9]{1,64}$/.test(dataid)) return bad(`${name}: the data id is not valid`);
    // the player's own data id is the card's refid; PAIR01's is the refid plus the other player's: the first part follows the card
    const id = dataid.startsWith(file.refid) ? refid + dataid.slice(file.refid.length) : dataid;
    if (seen.has(name + id)) return bad(`${name} is in the file twice`);
    seen.add(name + id);
    const doc: Partial<Rec> = { tail, bin, build, dataid: id, name, pcbid: "", sensor: tagOf(r.sensor), songlist: r.songlist === "konami" || r.songlist === "all" ? r.songlist : "other" };
    const arr = (v: any) => (Array.isArray(v) ? v.filter(Array.isArray) : []);
    derive(doc, name, bin, build, "other", shop, {
      songs: arr(r.songs).map((a: any[]) => ({ row: a[0], diff: a[1], score: a[2], sensor: tagOf(a[3]) })),
      history: arr(r.history).map((a: any[]) => ({ time: a[0], score: a[1], row: a[2], sensor: tagOf(a[3]), shop: str(a[4], 128) })),
    } as Rec);
    docs.push(doc);
  }
  return { docs };
}

// ---- the Discord notice: the operator's `discord_webhook`, empty = off; never awaited by the save, so a slow Discord delays no credit ----
const DIFF_NAMES = ["Light", "Standard", "Extreme", "Stealth", "Master"];
const sjis = (s: string) => { try { return U.DecodeString(Buffer.from(s || "", "latin1"), "shift_jis"); } catch { return s || ""; } };
const hexCol = (t: string[], i: number) => parseInt(t[i] || "0", 16) || 0;
const colsOf = (tail: string) => Buffer.from(tail || "", "base64").toString("latin1").split(","); // a stored tail: `ver,col0,col1,...`, column i is token 1 + i
function post(url: string, body: any) {
  return new Promise<void>((resolve) => {
    try {
      const u = new URL(url), data = Buffer.from(JSON.stringify(body));
      const req = (u.protocol === "http:" ? http : https).request(u, { method: "POST", timeout: 5000, headers: { "Content-Type": "application/json", "Content-Length": data.length } }, (res: any) => { res.resume(); res.on("end", resolve); });
      req.on("error", (e: Error) => { console.error("[deac] Discord webhook:", e.message); resolve(); });
      req.on("timeout", () => req.destroy());
      req.end(data);
    } catch (e: any) { console.error("[deac] Discord webhook:", e.message); resolve(); }
  });
}
// the server #1: a chart's #1 is the highest score; a tie goes to the better mark (the game's clear class, PLAY < CLEAR < FULL COMBO < ... every
// note hit < ... all PERFECT), then to whoever got there first. A new #1 is a play that beats the stored #1 on score or, on an equal score, on mark: an equal one never does.
const MARKS = ["PLAY", "CLEAR", "FULL COMBO", "FULL COMBO, every note hit", "FULL COMBO, all PERFECT"];
const markRank = (e: any) => (e.grade && e.grade !== "-" ? 1 + (e.clear || 0) : 0); // as the WebUI's `marksOf`: a grade letter is a clear, the class is the full combo's
const beats = (a: any, b: any) => a.score > b.score || (a.score === b.score && markRank(a) > markRank(b));
// the best entry of one song and difficulty over every card's stored record `name` (this build's rows), and whose it is; shortcut: a tie keeps the first card the database lists, there is no per-entry clock
function chartTop(rows: Rec[], build: string, row: number, diff: number) {
  let top: { e: any; refid: string } | null = null;
  for (const r of rows) if (r.build === build) for (const p of r.songs || []) if (p.row === row && p.diff === diff && p.score > 0 && (!top || beats(p, top.e))) top = { e: p, refid: (r as any).__refid };
  return top;
}
const cardName = async (refid: string) => { const r = await DB.FindOne<Rec>(refid, { collection: "record", name: "DATA01" }); return r ? sjis(colsOf(r.tail)[1 + 24]) || "A player" : "A player"; };
const comma = (n: number) => n.toLocaleString("en-US");

// ---- the Progress events: IRDATA, one event at a time, a new id for each ----
// The operator's list `ir_rotation` = `name|code[:letters],code[:letters]/name|...` (one or two songs, letters of L S E M $): event n of the
// list runs `ir_rotation_days` (7) from `ir_rotation_start` (a Monday), then the next, and the list starts again; the id is the count of
// periods since the start (+1), so every period has a new id even when the list repeats. Every song is open all the time: nothing is locked.
const LETTERS = "LSEM$";
// with no `ir_rotation` the week's two songs come from a fixed shuffle of the build's EVENT_SONGS (every song a machine with all songs unlocked can play),
// walked two per period: the same pair on every server the same week. An odd pool gets one song of its middle again at the end, so a cycle is whole pairs
// and the repeated song is not next to its first use (week 25 and 50 of 101 songs); no song comes twice before all have been used.
const SEED = 0x44454b31;
function weekPair(codes: string[], n: number) {
  let s = SEED; // mulberry32
  const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const a = codes.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  if (a.length % 2) a.push(a[a.length >> 1]);
  const w = (n % (a.length / 2)) * 2;
  return [a[w], a[w + 1]];
}
// the songs of an answer that a machine can play: a code the machine lacks voids the whole IRDATA in the game, so it is dropped from its answer.
// A machine whose mark says every song is unlocked gets all; Konami's Song list, or no mark, gets the songs of Konami's list
function playable(songs: string, build: string, songlist: string) {
  if (songlist === "all") return songs;
  const konami = new Set((EVENT_SONGS[build] || []).filter((r) => r[1]).map((r) => r[0]));
  return songs.split(",").filter((e) => konami.has(e.split(":")[0])).join(",");
}
// the rotation's clock: where `now` falls in the periods from `ir_rotation_start`; period n is event id n + 1 (negative before the start)
function rotClock(now: number) {
  const start = Date.parse(String(U.GetConfig("ir_rotation_start") || "")) || Date.UTC(2026, 0, 5), span = (Number(U.GetConfig("ir_rotation_days")) || 7) * 86400000;
  return { start, span, n: Math.floor((now - start) / span) };
}
function irRotation(build: string, now: number) {
  const pool = (EVENT_SONGS[build] || []).map((r) => r[0]);
  const known = new Set(pool);
  const list = String(U.GetConfig("ir_rotation") || "").split("/").map((e) => {
    const [name, ...rest] = e.split("|"), songs = rest.join("|").split(",").map((s) => s.trim()).filter(Boolean);
    // the game voids a whole event with an unknown song or letter: such an event is dropped here
    const ok = songs.length >= 1 && songs.length <= 2 && songs.every((s) => { const [c, l = ""] = s.split(":"); return known.has(c) && l.split("").every((x) => LETTERS.includes(x)); });
    if (!ok && e.trim()) log("ir_rotation: dropped", JSON.stringify(e));
    return { name: name.trim().replace(/,/g, " "), songs: songs.join(","), ok };
  }).filter((e) => e.ok);
  const { start, span, n } = rotClock(now);
  if (now < start || (!list.length && !pool.length)) return null;
  if (!list.length) return { id: n + 1, name: "Week of " + new Date(start + n * span).toISOString().slice(0, 10), songs: weekPair(pool, n).join(",") };
  return { id: n + 1, name: list[n % list.length].name, songs: list[n % list.length].songs };
}
// ---- the Progress event's plays per difficulty ----
// The game keeps one score per event song (the best on any difficulty, `ir_slot`), so a LIGHT 100% would outrank a MASTER 95%. The plugin keeps every play of an event
// song itself, from the plays RDAT01 shows for the first time (a credit holds at most 4 stages, RDAT01 keeps 16: none is missed), as an `eplay` document under the card,
// tagged with the event of the play's own time (the week it was danced in, not the week it arrived). The WebUI ranks each song and difficulty apart.
const BY_DIFF = "LSE$M"; // the letters of an IRDATA entry, by difficulty index
function eventAt(build: string, t: number) {
  const fixed = String(U.GetConfig("ir_data_id") || "").trim(); // the operator's one fixed event wins over the rotation, as in getmaster
  if (fixed) { const id = parseInt(fixed, 10); return id > 0 ? { id, songs: String(U.GetConfig("ir_data_songs") || "") } : null; }
  return irRotation(build, t);
}
// a play counts when its song is one of its event's and the entry's letters (none: all five) allow its difficulty
const countsFor = (ev: { songs: string } | null, code: string, diff: number) =>
  !!ev && ev.songs.split(",").some((s) => { const [c, l = ""] = s.trim().split(":"); return c === code && (!l || l.includes(BY_DIFF[diff])); });
async function keepEventPlays(refid: string, build: string, plays: any[]) {
  for (const e of plays) {
    const ev = eventAt(build, e.time);
    if (ev && e.code && countsFor(ev, e.code, e.diff)) // the same play twice (time + score + row) is one document
      await DB.Upsert(refid, { collection: "eplay", time: e.time, score: e.score, row: e.row }, { $set: { event: ev.id, build, code: e.code, title: e.title, rom: e.rom || "", diff: e.diff, combo: e.combo, grade: e.grade, clear: e.clear, sensor: e.sensor } } as any);
  }
}
const samePlay = (a: any, b: any) => a.time === b.time && a.score === b.score && a.row === b.row;

// ---- the weekly event's trophies ----
// When a rotation period has ended (plus `ir_close_grace_minutes`, for a credit still being saved), the plugin closes its event once: a `hall` document with the podium
// (places 1-3, a tie shares its place) of every song and difficulty in each sensor view, from the `eplay` documents, and of the game's own ranking from the cards that still hold
// the event. A closed event is never worked out again, so a play that arrives later changes the page's tables and not the trophies.
const VIEWS: [string, string | null][] = [["all", null], ["kinect", "kinect"], ["camera", "camera"]];
const PODIUM = 3;
// rows best first; a place is the position of the first row with the same key (1, 1, 3); only the podium is kept
function podium<T extends { score: number }>(rows: T[], tie: (r: T) => number = () => 0) {
  rows.sort((a, b) => b.score - a.score || tie(b) - tie(a));
  let place = 0;
  return rows.map((r, i) => { if (!i || r.score !== rows[i - 1].score || tie(r) !== tie(rows[i - 1])) place = i + 1; return { ...r, place }; }).filter((r) => r.place <= PODIUM);
}
async function closeEvent(id: number, now: number) {
  const plays = await DB.Find<any>(null, { collection: "eplay", event: id } as any);
  const cards = await DB.Find<Rec>(null, { collection: "record", name: "DATA01" } as any);
  const named = new Map(cards.map((r) => [(r as any).__refid, sjis(colsOf(r.tail)[1 + 24])] as [string, string]));
  const nameOf = (refid: string) => named.get(refid) || refid.slice(0, 8);
  const info = await DB.FindOne<any>({ collection: "ir_event", id } as any);
  const songs: { code: string; title: string; rom?: string }[] = (info?.songs || []).slice();
  for (const p of plays) if (!songs.some((s) => s.code === p.code)) songs.push({ code: p.code, title: p.title, rom: p.rom || "" });
  const views: any = {};
  for (const [view, only] of VIEWS) {
    views[view] = [];
    for (const s of songs) for (let diff = 0; diff < 5; diff++) {
      const best = new Map<string, any>(); // each player's best play of that song and difficulty, in this sensor view
      for (const p of plays) if (p.code === s.code && p.diff === diff && p.score > 0 && (!only || (p.sensor || "other") === only)) { const c = best.get(p.__refid); if (!c || p.score > c.score) best.set(p.__refid, p); }
      const top = podium(Array.from(best.values()).map((p) => ({ refid: p.__refid as string, name: nameOf(p.__refid), score: p.score as number, grade: p.grade as string, sensor: (p.sensor || "other") as string })));
      if (top.length) views[view].push({ code: s.code, title: s.title, rom: s.rom || "", diff, top });
    }
  }
  const held = cards.filter((r) => hexCol(colsOf(r.tail), 1 + 7) === id).map((r) => { // the game's own ranking: the sum of the two event slots, ties by ir_total
    const t = colsOf(r.tail), c = (i: number) => hexCol(t, 1 + i);
    return { refid: (r as any).__refid as string, name: nameOf((r as any).__refid), score: Math.floor(c(8) / 100000) + Math.floor(c(9) / 100000), total: c(15) };
  }).filter((r) => r.score > 0);
  const overall = podium(held, (r) => r.total);
  const build = plays[0]?.build || cards[0]?.build || "", { start, span } = rotClock(now); // the name: what getmaster announced, else the rotation's own for that period
  const hall = { id, name: info?.name || irRotation(build, start + (id - 1) * span)?.name || "", closed: now, build, songs, views, overall };
  await DB.Upsert<any>({ collection: "hall", id } as any, { $set: hall } as any);
  return hall;
}
// a Discord message for a closed week: its champions per song and difficulty (all scores), the game's own winner, and this week's two songs
async function announceClose(hall: any, now: number) {
  const hook = String(U.GetConfig("discord_webhook") || "").trim();
  if (!hook || !U.GetConfig("discord_close_post")) return; // its own option, off by default
  const names =(top: any[]) => top.filter((e) => e.place === 1).map((e) => e.name).join(", ");
  const lines = hall.views.all.map((b: any) => `**${b.title}** (${DIFF_NAMES[b.diff]}): ${names(b.top)}, ${b.top[0].score.toLocaleString("en-US")}`);
  if (hall.overall.length) lines.push(`The game's ranking: ${names(hall.overall)}, ${hall.overall[0].score.toLocaleString("en-US")}`);
  if (!lines.length) return;
  const embeds: any[] = [{ title: `Week closed: ${hall.name || "event " + hall.id}`, color: 0x2ecc71, timestamp: new Date().toISOString(), description: lines.join("\n").slice(0, 4000) }];
  const next = irRotation(hall.build, now);
  if (next) embeds.push({ title: "This week's songs", color: 0x3498db, description: `${next.name || "Event " + next.id}: ` + next.songs.split(",").map((e) => {
    const code = e.split(":")[0];
    return ((SONGS[hall.build] || []).find((r) => r[0] === code) || ["", code === "yest" ? "YESTERDAY" : code])[1];
  }).join(", ") });
  void post(hook, { username: "DEAC", allowed_mentions: { parse: [] }, embeds });
}
// every event that has ended (and its grace) and that some card holds a score or play of, and that has no hall document yet, closed oldest first. An event nobody played is never closed
let closing: Promise<void> | null = null;
function closeDue(now: number) {
  if (closing) return closing; // one pass at a time: two calls must not close the same week twice
  closing = (async () => {
    if (String(U.GetConfig("ir_data_id") || "").trim()) return; // the operator's one fixed event never ends
    const { start, span, n } = rotClock(now), grace = Number(U.GetConfig("ir_close_grace_minutes") ?? 30) * 60000;
    if (n < 1) return;
    const seen = new Set<number>();
    for (const p of await DB.Find<any>(null, { collection: "eplay" } as any)) seen.add(p.event);
    for (const r of await DB.Find<Rec>(null, { collection: "record", name: "DATA01" } as any)) seen.add(hexCol(colsOf(r.tail), 1 + 7));
    const done = new Set((await DB.Find<any>({ collection: "hall" } as any)).map((h: any) => h.id));
    for (const id of Array.from(seen).filter((i) => i >= 1 && now >= start + i * span + grace && !done.has(i)).sort((a, b) => a - b)) {
      const hall = await closeEvent(id, now);
      log("closed event", id);
      await announceClose(hall, now);
    }
  })().catch((e: any) => console.error("[deac] closing the weekly event:", e && e.message)).finally(() => { closing = null; });
  return closing;
}

const machineOf = (info: EamuseInfo) => info.pcbid || "-";
// The launcher's mark (an honour label, not anti-cheat), by two channels, the first that is there wins:
// 1. the model's revision letter (`KDM:J:B:<rev>:2016080100`, which every core hands a plugin): D Kinect + Konami's Song list, E Kinect + every
//    song unlocked, F camera + Konami's, G camera + every song; Konami's own letter is A.
// 2. a PCBID of 20 hex characters that ends in "DE" + the sensor (0 Kinect, 1 camera) + the Song list (0 Konami's, 1 every song) (only on cores that hand the plugin the PCBID).
// No mark at all is "other": a save from a launcher that is not KDMSENSOR (a player's own), never guessed.
const REV_MARKS = "DEFG";
function markOf(info: EamuseInfo) {
  const rev = (info.model || "").split(":")[3] || "", i = rev.length === 1 ? REV_MARKS.indexOf(rev) : -1;
  const m = /DE([01])([01])$/i.exec(machineOf(info));
  const [s, l] = i >= 0 ? [i >> 1, i & 1] : m ? [+m[1], +m[2]] : [-1, -1];
  return { sensor: s < 0 ? "other" : s ? "camera" : "kinect", songlist: l < 0 ? "other" : l ? "all" : "konami" };
}

const refidOf = (data: any) => $(data).str("data.refid", "");
const dataidOf = (data: any) => $(data).str("data.dataid", refidOf(data));
const find = (data: any, name: string) => DB.FindOne<Rec>(refidOf(data), { collection: "record", dataid: dataidOf(data), name });

const usergamedata_send: EPR = async (info, data, send) => {
  const refid = refidOf(data);
  if (!refid) return send.deny();
  if (refid.startsWith("X")) return send.object(ok()); // a guest (ess: X + the 31-digit game session): nothing to keep
  await closeDue(Date.now()); // a week that has just ended is closed before this save can replace the event a profile holds
  const build = buildOf(info), mark = markOf(info);
  const lines = $(data).elements("data.record.d").map((d) => Buffer.from(d.str("", ""), "base64").toString("latin1"));
  // DATA01's shop name (column 26 after `mask,NAME,ver`), the shop of the plays this save adds to the history
  const d01 = lines.find((l) => l.split(",")[1] === "DATA01");
  const shop = d01 ? d01.split(",")[3 + 26] || "" : ((await find(data, "DATA01"))?.shop as string) || "";
  const hook = String(U.GetConfig("discord_webhook") || "").trim();
  const firsts: { e: any; top: { e: any; refid: string } | null }[] = []; // the plays that become a chart's server #1
  for (const d of $(data).elements("data.record.d")) {
    const line = Buffer.from(d.str("", ""), "base64").toString("latin1"); // latin1: every byte survives the round trip
    const i = line.indexOf(","), j = line.indexOf(",", i + 1);
    const name = line.slice(i + 1, j);
    if (i < 0 || j < 0 || !/^[A-Z0-9]{1,9}$/.test(name)) return send.deny();
    const bin = d.str("bin1", "");
    const doc: Partial<Rec> = { tail: Buffer.from(line.slice(j + 1), "latin1").toString("base64"), build, pcbid: machineOf(info), sensor: mark.sensor, songlist: mark.songlist };
    doc.bin = bin; // "" when the record has no binary part
    const prev = name === "RDAT01" || name in SONG_RECORDS ? await find(data, name) : undefined;
    derive(doc, name, bin, build, mark.sensor, shop, prev);
    if (hook && name in SONG_RECORDS && doc.songs?.length) { // the stored records are still the ones before this save: the #1 to beat
      const rows = await DB.Find<Rec>(null, { collection: "record", name } as any);
      for (const e of doc.songs) if (e.score > 0) { const top = chartTop(rows, build || "", e.row, e.diff); if (!top || beats(e, top.e)) firsts.push({ e, top }); }
    }
    if (name === "RDAT01") await keepEventPlays(refid, build, (doc.history || []).filter((e) => !(prev?.history || []).some((p: any) => samePlay(p, e))));
    log("send", refid, name, "bin1 bytes", bin ? Buffer.from(bin, "base64").length : 0);
    await DB.Upsert<Rec>(refid, { collection: "record", dataid: dataidOf(data), name }, { $set: doc } as any);
  }
  if (hook && firsts.length) { // only a new server #1; never a personal best
    const player = sjis(d01 ? d01.split(",")[3 + 24] : colsOf(((await find(data, "DATA01"))?.tail as string) || "")[1 + 24]) || "A player";
    const sensor = mark.sensor === "other" ? "not the KDMSENSOR launcher" : mark.sensor === "kinect" ? "Kinect" : "Camera";
    const embeds: any[] = [];
    for (const { e, top } of firsts.slice(0, 5)) {
      const was = top && top.refid !== refid ? await cardName(top.refid) : "";
      const [, , artist] = (SONGS[build || ""] || [])[e.row] || [];
      const fields: any[] = [{ name: "Player", value: player, inline: true }, { name: "Chart", value: DIFF_NAMES[e.diff] || "?", inline: true },
        { name: "Score", value: comma(e.score) + (top && e.score > top.e.score ? ` (+${comma(e.score - top.e.score)} vs prev #1)` : ""), inline: true },
        { name: "Grade", value: e.grade, inline: true }, { name: "Sensor", value: sensor, inline: true }];
      if (top) fields.push({ name: "Previous #1", value: `${comma(top.e.score)} • ${MARKS[markRank(top.e)]}`, inline: true });
      embeds.push({ title: `🏆 ${player} got #1! • ${MARKS[markRank(e)]}`, color: 0xf1c40f, timestamp: new Date().toISOString(), fields, footer: { text: `${String(U.GetConfig("server_name") || "").trim() || "DEAC"} • new #1` },
        description: `**${e.title}**${artist ? ` - ${artist}` : ""}` + (was ? `\nTook #1 from **${was}**` : top ? "\nRaised their own #1" : "") });
    }
    void post(hook, { username: "DEAC", allowed_mentions: { parse: [] }, ...(firsts.length > 5 ? { content: `+ ${firsts.length - 5} more #1s` } : {}), embeds }); // allowed_mentions: a name cannot ping the server
  }
  return send.object(ok());
};

// `recv_csv` is `NAME,mask,NAME,mask,...`: one answer per name, in order; a name never saved is `<NODATA>`
const usergamedata_recv: EPR = async (info, data, send) => {
  const names = $(data).str("data.recv_csv", "").split(",").filter((_, i) => i % 2 === 0 && _);
  const d = [];
  let found = 0;
  for (const name of names) {
    const rec = await find(data, name);
    if (rec) found++;
    d.push(rec
      ? { ...K.ITEM("str", rec.tail), ...(rec.bin && { bin1: K.ITEM("str", rec.bin) }) }
      : K.ITEM("str", "<NODATA>"));
  }
  log("recv", refidOf(data), names.length + " records:", names.join(" "), "found", found);
  return send.object({ ...ok(), player: { record: { d }, record_num: K.ITEM("u32", d.length) } });
};

// the ARK event log: every row kept as sent, in the order it arrived (the score and judge counts of a stage are in it)
const eventlog_write: EPR = async (info, data, send) => {
  const mark = markOf(info), row: any = { collection: "eventlog", build: buildOf(info), time: Date.now(), pcbid: machineOf(info), sensor: mark.sensor, songlist: mark.songlist };
  for (const k of ["eventid", "eventorder", "pcbtime", "gamesession", "strdata1", "strdata2", "numdata1", "numdata2", "locationid"])
    row[k] = String($(data).content(`data.${k}`, ""));
  await DB.Insert(row);
  // a session id the game keeps for its whole run (a guest's refid is `X` + it); the game sends it back unchanged
  const sess = BigInt($(data).bigint("data.gamesession", BigInt(0)));
  return send.object({
    gamesession: K.ITEM("s64", sess > BigInt(0) ? sess : BigInt(Date.now())),
    logsendflg: K.ITEM("s32", 0), logerrlevel: K.ITEM("s32", 0), evtidnosendflg: K.ITEM("s32", 0),
  });
};

// the core hands the plugin `card_id` as "<id>|<printed number>"; DDR (a game already proven on this core) answers the first part, so does this
const convcardnumber: EPR = async (info, data, send) =>
  send.object({ ...ok(), data: { card_number: K.ITEM("str", $(data).str("data.card_id", "").split("|")[0]) } });

// server messages: result 0 = nothing to say; EVENTMSG and IRDATA come from the operator's options
const getmaster: EPR = async (info, data, send) => {
  const key = $(data).str("data.datakey", "") || $(data).str("datakey", "");
  const evt = /^(EVENTMSG|EVTMSG\d*)$/.test(key); // the wire says EVTMSG3, not EVENTMSG
  const now = Date.now();
  if (key === "IRDATA") await closeDue(now); // every credit asks for the event first: the plugin has no clock of its own (a timer in the plugin runs once)
  const opt = (k: string) => String(U.GetConfig(k) || "");
  const ir = !!opt("ir_data_id"); // the operator's one fixed event wins over the rotation (a test aid)
  const rot = key === "IRDATA" && !ir ? irRotation(buildOf(info) || "", now) : null;
  const s1 = evt ? opt("event_message") : key === "IRDATA" ? opt("ir_data_id") || (rot ? `${rot.id}${rot.name ? "," + rot.name : ""}` : "") : "";
  const week = key === "IRDATA" ? (ir ? opt("ir_data_songs") : rot?.songs || "") : evt ? opt("event_message_2") : ""; // what the server holds for the event, for every machine
  // the rotation's songs reach a machine only if it can play them; the operator's fixed event (a test aid) goes as set
  const s2 = key === "IRDATA" && !ir ? playable(week, buildOf(info) || "", markOf(info).songlist) : week;
  log("getmaster", key, `machine ${machineOf(info)} ${markOf(info).sensor}/${markOf(info).songlist}`, s1 && s2 ? `answered ${JSON.stringify(s1)}` : "nothing to say");
  if (!s1 || (key === "IRDATA" && !s2)) { // a week where the machine has neither song: no IRDATA (the WebUI still names the week from the server's list)
    if (s1 && key === "IRDATA") await nameEvent(s1, week, buildOf(info) || "");
    return send.object({ result: K.ITEM("s32", 0) });
  }
  const b64 = (s: string) => Buffer.from(s.slice(0, 512), "latin1").toString("base64");
  if (key === "IRDATA") await nameEvent(s1, week, buildOf(info) || "");
  return send.object({
    result: K.ITEM("s32", 1), strdata1: K.ITEM("str", b64(s1)), strdata2: K.ITEM("str", b64(s2)), updatedate: K.ITEM("u64", BigInt(now)),
  });
};
// the WebUI's Progress-event page names the event and its songs from what the server holds for the week (all its songs, whichever machine asked)
function songInfo(build: string, entry: string) {
  const code = entry.split(":")[0];
  const r = (SONGS[build] || []).find((r) => r[0] === code);
  return { code, title: r ? r[1] : code === "yest" ? "YESTERDAY" : code, rom: r ? r[3] : "" };
}
async function nameEvent(s1: string, s2: string, build: string) {
  const [id, ...name] = s1.split(",");
  const songs = s2.split(",").filter(Boolean).slice(0, 2).map((e) => songInfo(build, e));
  await DB.Upsert<any>({ collection: "ir_event", id: parseInt(id, 10) }, { $set: { name: name.join(","), songs } } as any);
}
// the WebUI names the week in progress before any machine has asked for it: the rotation's next ten years, worked out at the core's start
// by the same irRotation the game is answered with (a page cannot run the plugin's code). The operator's fixed event has no weeks: none.
function schedule(now: number) {
  const build = "2016080100", { start, span, n } = rotClock(now), out: any[] = [];
  if (String(U.GetConfig("ir_data_id") || "").trim()) return out;
  for (let i = Math.max(n, 0); i < Math.max(n, 0) + 520; i++) {
    const r = irRotation(build, start + i * span);
    if (r) out.push({ id: r.id, name: r.name, from: start + i * span, to: start + (i + 1) * span, songs: r.songs.split(",").filter(Boolean).map((e) => songInfo(build, e)) });
  }
  return out;
}

export function register() {
  R.GameCode("KDM");
  R.Contributor("Cris-Oblea", "https://github.com/Cris-Oblea/asphyxia-deac"); // the public repo, on the WebUI's About page
  R.Config("event_message", { name: "EVENTMSG", desc: "The event feed, e.g. u:hall,yest/d:hall:text:1. Empty: none.", type: "string", default: "" });
  R.Config("event_message_2", { name: "EVENTMSG strdata2", desc: "The second text of the event feed (read by two functions whose meaning is not resolved). Empty: none.", type: "string", default: "" });
  R.Config("ir_rotation", { name: "Progress events (rotation)", desc: "The Progress events (the week in progress), one at a time: name|song[:letters],song[:letters]/name|... e.g. Week one|hvro:LS,spec:LM/Week two|dind,msou:M. Songs are the 4-letter codes, letters of L S E M $ (none: all five). Empty (default): the plugin picks two songs each period itself, all five difficulties.", type: "string", default: "" });
  R.Config("ir_rotation_days", { name: "Days per Progress event", desc: "How long each event of the rotation runs (default 7).", type: "float", default: 7 });
  R.Config("ir_rotation_start", { name: "Rotation start", desc: "The moment the first event begins, e.g. 2026-12-07T00:00:00Z; empty: Monday 2026-01-05 (UTC), so events run Monday to Monday.", type: "string", default: "" });
  R.Config("log_calls", { name: "Log every call", desc: "One line per playerdata call in the core log (records, bytes): for a test run.", type: "boolean", default: false });
  R.Config("backup_key", { name: "Backup key", desc: "Opens the database download: the page deac@asphyxia/backup?key=<this key>. Empty: no download.", type: "string", default: "" });
  // a WebUI page cannot read the options (U.GetConfig answers undefined there), so the key is copied where its page can: the plugin's own space, at the core's start
  // what the pages derive when drawn (the romanised titles, the song total per build): the plugin's tables, copied where a page can read them
  // one document and one after the other: two writes at the core's start made its database fail to load
  DB.Upsert({ collection: "settings" }, { $set: { backup_key: String(U.GetConfig("backup_key") || "") } } as any).then(() =>
    DB.Upsert({ collection: "songtable" }, { $set: { builds: Object.fromEntries(Object.keys(SONGS).map((b) => [b, { total: SONG_COUNT_ALL[b], rom: Object.fromEntries(SONGS[b].filter((r) => r[3]).map((r) => [r[0], r[3]])) }])) } } as any)).then(() =>
    DB.Upsert({ collection: "schedule" }, { $set: { weeks: schedule(Date.now()) } } as any));
  R.Config("server_name", { name: "Server name", desc: "The name in the footer of the Discord posts. Empty: DEAC.", type: "string", default: "" });
  R.Config("discord_webhook", { name: "Discord webhook URL", desc: "A Discord webhook: a message only when a save makes a new server #1 of a song and difficulty (a first score counts; never a personal best), in the form of a score channel's posts. No message for a guest. Empty: off.", type: "string", default: "" });
  R.Config("discord_close_post", { name: "Discord: post the week's close", desc: "With the webhook set, also post a closed week's champions and the next week's songs. Default off.", type: "boolean", default: false });
  R.Config("ir_close_grace_minutes", { name: "Minutes before a week closes", desc: "How long after a Progress event's week ends the plugin waits before it records the winners, for a credit still being saved. Default 30.", type: "float", default: 30 });
  R.Config("ir_data_id", { name: "IRDATA id[,name]", desc: "The internet-ranking event: id (above 0) and a name. Empty: none.", type: "string", default: "" });
  R.Config("ir_data_songs", { name: "IRDATA songs", desc: "Up to two entries <song code>[:<letters of L S E $ M>], separated by a comma.", type: "string", default: "" });
  // WebUI (webui/*.pug): the player's button; every record of the card goes, so the next credit is a new player (PAIR01 included)
  R.WebUIEvent("deleteRecords", async ({ refid }) => { if (refid) { await DB.Remove(refid, { collection: "record" }); await DB.Remove(refid, { collection: "eplay" }); } });
  // the card becomes the profile of a file (readProfile checks all of it first; nothing is touched when it is refused). A WebUI event answers
  // the page no data (the core redirects), so the outcome is kept in the plugin's `import` document for the page to show after its reload
  R.WebUIEvent("importRecords", async ({ refid, file }: { refid: string; file: any }) => {
    if (!refid || typeof refid !== "string" || refid.startsWith("X")) return;
    const got = readProfile(file, refid);
    const note = { time: Date.now(), error: "", records: 0 };
    if ("error" in got) note.error = got.error;
    else {
      await DB.Remove(refid, { collection: "record" });
      await DB.Remove(refid, { collection: "eplay" }); // the card becomes the file's profile: its event plays are the file's history's
      for (const doc of got.docs) {
        await DB.Upsert<Rec>(refid, { collection: "record", dataid: doc.dataid, name: doc.name }, { $set: doc } as any);
        if (doc.name === "RDAT01") await keepEventPlays(refid, doc.build || "", doc.history || []);
      }
      note.records = got.docs.length;
    }
    await DB.Upsert(refid, { collection: "import" }, { $set: note } as any);
  });
  // rivals: a player's picks, kept in the plugin's own space (collection `rivals`, not `record`, so the delete button leaves them); never sent to the game
  R.WebUIEvent("setRivals", async ({ refid, rivals }: { refid: string; rivals: string[] }) => {
    if (!refid) return;
    const ids: string[] = [];
    for (const id of Array.isArray(rivals) ? rivals : []) // another card with a profile on this server, once each, at most 8
      if (typeof id === "string" && id !== refid && !ids.includes(id) && ids.length < 8 && (await DB.FindOne(id, { collection: "record", name: "DATA01" }))) ids.push(id);
    await DB.Upsert(refid, { collection: "rivals" }, { $set: { ids } } as any);
  });
  R.Route("playerdata.usergamedata_send", usergamedata_send);
  R.Route("playerdata.usergamedata_recv", usergamedata_recv);
  R.Route("playerdata.usergamedata_inheritance", usergamedata_recv); // the same fields; the game never makes this call
  R.Route("eventlog.write", eventlog_write);
  R.Route("system.getmaster", getmaster);
  R.Route("system.convcardnumber", convcardnumber);
}
