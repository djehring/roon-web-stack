import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Zone } from "@model";
import { HistoryEvent, historyLimits, HistorySnapshot, retentionMs } from "./model";
import { HistoryRecorder } from "./recorder";
import { HistoryService } from "./service";
import { HistoryStore } from "./store";

jest.mock("@infrastructure", () => ({ roon: {} }));
let directory: string;
let now: number;
let mono: number;
let store: HistoryStore;
let recorder: HistoryRecorder;
const zone = (position = 0, title = "Song", state = "playing", room = "room") =>
  ({
    zone_id: room,
    display_name: room,
    state,
    outputs: [{ output_id: room }],
    now_playing: {
      length: 120,
      seek_position: position,
      image_key: "cover",
      one_line: { line1: title },
      two_line: { line1: title, line2: "Artist" },
      three_line: { line1: title, line2: "Artist", line3: "Album" },
    },
  }) as Zone;
function observe(z: Zone, seconds = 0) {
  now += seconds * 1000;
  mono += seconds * 1000;
  recorder.receive("core", "Changed", { zones_changed: [z] });
}
function listen(room = "room", start = 0) {
  observe(zone(start, "Song", "playing", room));
  for (let i = 1; i <= 30; i++) observe(zone(start + i, "Song", "playing", room), 1);
}
function event(id: string, offset = 0): HistoryEvent {
  return {
    id,
    coreId: "core",
    observedAt: new Date(now + offset).toISOString(),
    qualifiedAt: new Date(now + offset).toISOString(),
    zoneId: "room",
    room: "Room",
    outputIds: ["output"],
    title: "Song",
    artist: "Artist",
    album: "Album",
    duration: 120,
  };
}
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "roon-history-"));
  now = Date.now() - 100000;
  mono = 0;
  store = new HistoryStore(path.join(directory, "history.json"), () => now);
  await store.open();
  recorder = new HistoryRecorder(
    store,
    () => now,
    () => mono
  );
});
afterEach(async () => {
  await store.save();
  await fs.rm(directory, { recursive: true, force: true });
});

test("qualifies once, ignores duplicate events and short skips", () => {
  observe(zone());
  observe(zone(5), 5);
  observe(zone(0, "Other"));
  expect(store.retained()).toHaveLength(0);
  listen();
  observe(zone(30));
  observe(zone(30));
  expect(store.retained()).toHaveLength(1);
});
test("does not credit seeks, pauses, buffering or disconnection", () => {
  observe(zone());
  observe(zone(80), 1);
  observe(zone(80, "Song", "paused"), 1);
  observe(zone(80, "Song", "playing"), 60);
  observe(zone(81), 1);
  recorder.disconnect();
  observe(zone(100), 20);
  expect(store.retained()).toHaveLength(0);
  for (let i = 1; i <= 28; i++) observe(zone(100 + i), 1);
  expect(store.retained()).toHaveLength(0);
});
test("half-duration rule includes short tracks", () => {
  const short = zone();
  if (!short.now_playing) throw new Error("Missing fixture metadata");
  short.now_playing.length = 10;
  observe(short);
  for (let i = 1; i <= 5; i++) {
    short.now_playing.seek_position = i;
    observe(short, 1);
  }
  expect(store.retained()).toHaveLength(1);
});
test("natural repeat qualifies again; backward seek does not", () => {
  listen();
  observe(zone(10), 1);
  listen("room", 10);
  expect(store.retained()).toHaveLength(1);
  observe(zone(119), 1);
  observe(zone(0), 1);
  for (let i = 1; i <= 30; i++) observe(zone(i), 1);
  expect(store.retained()).toHaveLength(2);
});
test("independent zones retain separate plays and grouped snapshots do not duplicate", () => {
  listen("one");
  listen("two");
  recorder.receive("core", "Subscribed", { zones: [zone(30, "Song", "playing", "two")] });
  expect(store.retained()).toHaveLength(2);
});
test("restart uses bounded committed checkpoints and ignores offline time", async () => {
  listen();
  recorder.disconnect();
  await store.save();
  const restored = new HistoryStore(store.file, () => now);
  await restored.open();
  recorder = new HistoryRecorder(
    restored,
    () => now,
    () => mono
  );
  listen("room", 31);
  expect(restored.retained()).toHaveLength(1);
  await restored.save();
});
test("radio is excluded", () => {
  const radio = zone();
  if (!radio.now_playing) throw new Error("Missing fixture metadata");
  delete radio.now_playing.length;
  observe(radio);
  observe(radio, 60);
  expect(store.retained()).toHaveLength(0);
});
test("expiry applies to reads and cleanup without new plays", async () => {
  store.add(event("one"));
  await store.save();
  now += retentionMs + 1;
  expect(store.retained()).toHaveLength(0);
  await store.cleanup();
  expect((JSON.parse(await fs.readFile(store.file, "utf8")) as HistorySnapshot).events).toEqual([]);
});
test("caps events and bytes including old cores", async () => {
  store.snapshot.events = Array.from({ length: 10020 }, (_, i) => ({
    ...event(String(i), -i),
    coreId: i % 2 ? "old" : "core",
  }));
  store.prune();
  expect(store.snapshot.events).toHaveLength(historyLimits.events);
  store.snapshot.events = store.snapshot.events.map((e) => ({
    ...e,
    title: "X".repeat(1000),
    album: "Y".repeat(1000),
  }));
  await store.save();
  expect((await fs.stat(store.file)).size).toBeLessThanOrEqual(historyLimits.bytes);
  expect((await fs.readdir(directory)).sort()).toEqual(["history.json"]);
});
test("atomic write failure keeps committed file and reports degraded recording", async () => {
  store.add(event("one"));
  await store.save();
  await fs.mkdir(`${store.file}.tmp`);
  store.add(event("two"));
  await store.save();
  expect(store.error).toContain("could not be saved");
  expect((JSON.parse(await fs.readFile(store.file, "utf8")) as HistorySnapshot).events).toHaveLength(1);
  await fs.rm(`${store.file}.tmp`, { recursive: true });
  await store.save();
  expect(store.error).toBeUndefined();
});
test("unreadable history is preserved", async () => {
  await fs.writeFile(store.file, "broken");
  const broken = new HistoryStore(store.file);
  await broken.open();
  broken.add(event("new"));
  await broken.save();
  expect(broken.error).toContain("could not be loaded");
  expect(await fs.readFile(store.file, "utf8")).toBe("broken");
});
test("stable paging, album grouping, room filters and core isolation", () => {
  const service = new HistoryService(store);
  service.recorder.coreId = "core";
  store.snapshot.events = [
    event("a", -3000),
    event("b", -2000),
    { ...event("c", -1000), imageKey: "edition2" },
    { ...event("d"), zoneId: "kitchen", room: "Kitchen" },
    { ...event("old"), coreId: "old" },
  ];
  const first = service.page("tracks", { limit: "2" });
  store.snapshot.events.push({ ...event("new"), qualifiedAt: new Date(Date.now() + 1000).toISOString() });
  const next = service.page("tracks", { limit: "2", cursor: first.nextCursor });
  expect([...first.items, ...next.items].map((e) => e.id)).toEqual(["d", "c", "b", "a"]);
  expect(service.page("albums", { roomId: "room" }).items).toHaveLength(2);
  expect(() => service.page("tracks", { roomId: "kitchen", cursor: first.nextCursor })).toThrow();
  expect(() => service.page("tracks", { limit: "10000" })).toThrow();
});

test("saved album tracks with changing composer credits regroup without rewriting plays", async () => {
  const plays = [
    { ...event("blue-drag"), title: "Blue drag", artist: "Django Reinhardt / Josef Myrow" },
    {
      ...event("lady-be-good", -180000),
      title: "Lady be good",
      artist: "Django Reinhardt / Ira Gershwin / George Gershwin",
    },
    { ...event("dinah", -360000), title: "Dinah", artist: "Django Reinhardt / Duke Ellington" },
  ].map((play) => ({ ...play, album: "The Quintessence", imageKey: "django-cover" }));
  store.snapshot.events = plays;
  await store.save();
  const saved = await fs.readFile(store.file, "utf8");
  const restored = new HistoryStore(store.file, () => now);
  await restored.open();
  const service = new HistoryService(restored);
  service.recorder.coreId = "core";

  const albums = service.page("albums", {}).items;
  expect(albums).toHaveLength(1);
  expect(albums[0]).toMatchObject({ ...plays[0], artist: "Django Reinhardt" });
  const tracks = service.page("tracks", {}).items;
  expect(tracks).toEqual(plays.map((play) => ({ ...play, albumId: albums[0].albumId })));
  expect(new Set(tracks.map((play) => play.albumId))).toEqual(new Set([albums[0].albumId]));
  expect(restored.snapshot.events).toEqual(plays);
  expect(await fs.readFile(store.file, "utf8")).toBe(saved);
  expect(service.event("blue-drag").artist).toBe("Django Reinhardt / Josef Myrow");
});

test("album hints distinguish titles, artwork and missing-artwork credits", () => {
  const service = new HistoryService(store);
  service.recorder.coreId = "core";
  store.snapshot.events = [
    { ...event("cover-one"), imageKey: "cover-one" },
    { ...event("cover-two", -1000), imageKey: "cover-two" },
    { ...event("other-title", -2000), album: "Other album", imageKey: "cover-one" },
    event("no-cover-one", -3000),
    { ...event("no-cover-two", -4000), artist: "Other artist" },
    { ...event("no-album", -5000), album: "", imageKey: "cover-one" },
    { ...event("other-core", -6000), coreId: "other-core", imageKey: "cover-one" },
  ];
  expect(service.page("albums", {}).items.map((play) => play.id)).toEqual([
    "cover-one",
    "cover-two",
    "other-title",
    "no-cover-one",
    "no-cover-two",
  ]);
  expect(service.page("tracks", {}).items).toHaveLength(6);
});

test("regrouped albums keep newest ordering, room filters and stable pagination", () => {
  const service = new HistoryService(store);
  service.recorder.coreId = "core";
  store.snapshot.events = [
    { ...event("newest"), imageKey: "cover", artist: "Artist / Composer A" },
    { ...event("other-album", -1000), album: "Other album", imageKey: "other-cover" },
    { ...event("kitchen", -2000), imageKey: "cover", artist: "Artist / Composer B", zoneId: "kitchen" },
    { ...event("oldest", -3000), imageKey: "cover", artist: "Artist" },
  ];
  const first = service.page("albums", { limit: "1" });
  expect(first.items[0]).toMatchObject({ id: "newest", artist: "Artist" });
  store.snapshot.events.push({
    ...event("later"),
    imageKey: "cover",
    artist: "Unrelated credit",
    qualifiedAt: new Date(Date.now() + 1000).toISOString(),
  });
  const second = service.page("albums", { limit: "1", cursor: first.nextCursor });
  expect(second.items.map((play) => play.id)).toEqual(["other-album"]);
  expect(second.nextCursor).toBeUndefined();
  expect(service.page("albums", { roomId: "kitchen" }).items[0]).toMatchObject({
    id: "kitchen",
    artist: "Artist / Composer B",
  });
});

test("album labels keep shared full credits and do not guess an artist for compilations", () => {
  const service = new HistoryService(store);
  service.recorder.coreId = "core";
  store.snapshot.events = [
    { ...event("one"), imageKey: "cover", artist: "AC/DC / Guest" },
    { ...event("two", -1000), imageKey: "cover", artist: "ac/dc / Another Guest" },
  ];
  expect(service.page("albums", {}).items[0].artist).toBe("AC/DC");
  store.snapshot.events.push({ ...event("three", -2000), imageKey: "cover", artist: "Different performer" });
  expect(service.page("albums", {}).items[0].artist).toBe("");
  expect(service.page("tracks", {}).items[0].artist).toBe("AC/DC / Guest");
});

test("normal seek subscription updates qualify without full zone snapshots", () => {
  recorder.receive("core", "Subscribed", { zones: [zone()] });
  for (let position = 1; position <= 30; position++) {
    now += 1000;
    mono += 1000;
    recorder.receive("core", "Changed", {
      zones_seek_changed: [{ zone_id: "room", seek_position: position, queue_time_remaining: 120 - position }],
    });
  }
  expect(store.retained()).toHaveLength(1);
});

test("changing Core never reuses another Core's continuing session", () => {
  listen();
  recorder.pair("new-core");
  recorder.receive("new-core", "Subscribed", { zones: [zone(30)] });
  for (let position = 31; position <= 60; position++) {
    now += 1000;
    mono += 1000;
    recorder.receive("new-core", "Changed", { zones_changed: [zone(position)] });
  }
  expect(new Set(store.retained().map((e) => e.coreId))).toEqual(new Set(["core", "new-core"]));
});

test("a grouped zone changing identity keeps its session when the output continues", () => {
  listen();
  const moved = zone(31, "Song", "playing", "new-room");
  moved.outputs = zone().outputs;
  recorder.receive("core", "Changed", { zones_removed: ["room"], zones_added: [moved] });
  for (let i = 32; i <= 63; i++) {
    moved.now_playing = { ...moved.now_playing, seek_position: i } as Zone["now_playing"];
    observe(moved, 1);
  }
  expect(store.retained()).toHaveLength(1);
});

test("linked Roon artist credits are stored as readable display text", () => {
  const linked = zone();
  if (!linked.now_playing) throw new Error("Missing fixture");
  linked.now_playing.three_line.line2 = "[[123|Artist]] / [[456|Performer]]";
  observe(linked);
  for (let i = 1; i <= 30; i++) {
    linked.now_playing.seek_position = i;
    observe(linked, 1);
  }
  expect(store.retained()[0].artist).toBe("Artist / Performer");
});

test("initially paused tracks use the time playback is observed to resume", () => {
  observe(zone(0, "Song", "paused"));
  now += 86400000;
  mono += 86400000;
  const resumedAt = new Date(now).toISOString();
  listen();
  expect(store.retained()[0].observedAt).toBe(resumedAt);
});
