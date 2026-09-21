import { roon } from "@infrastructure";
import type { RoonApiBrowseOptions } from "@model";
import { browseCinemaMusic, captureCinemaQueue, importCinemaMusic, playLocatedCinemaTrack } from "./cinema-music";
import { CinemaMusicPath, validateMusicPath } from "./cinema-music-model";

jest.mock("@infrastructure", () => ({ roon: { browse: jest.fn(), load: jest.fn(), server: jest.fn() } }));

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture value");
  return value;
}

describe("Cinema music selections", () => {
  const path: CinemaMusicPath = {
    hierarchy: "albums",
    steps: [{ title: "Selected album", subtitle: "Artist", index: 0 }],
  };
  let count: number;
  let unsubscribe: jest.Mock;
  let settings: jest.Mock;
  const sessions = new Map<string, string>();
  const list = (level: string) => ({
    level: level === "root" ? 0 : level === "album" ? 1 : 2,
    title: level === "root" ? "Albums" : level === "album" ? "Selected album" : "1. Song",
    subtitle: "Artist",
    image_key: "cover",
    count: level === "root" ? 1 : level === "album" ? count + 1 : 3,
    ...(level.startsWith("track") ? { hint: "action_list" } : {}),
  });
  beforeEach(() => {
    count = 613;
    sessions.clear();
    unsubscribe = jest.fn();
    settings = jest.fn().mockResolvedValue(undefined);
    jest.mocked(roon.browse).mockImplementation((input) => {
      const options = input as RoonApiBrowseOptions;
      const level = !options.item_key ? "root" : options.item_key === "album" ? "album" : options.item_key;
      sessions.set(required(options.multi_session_key), level);
      return Promise.resolve({ action: "list", list: list(level) } as never);
    });
    jest.mocked(roon.load).mockImplementation((options) => {
      const level = required(sessions.get(required(options.multi_session_key)));
      const items =
        level === "root"
          ? [{ title: "Selected album", subtitle: "Artist", item_key: "album", hint: "list" }]
          : level === "album"
            ? [
                { title: "Play Album", item_key: "play-album", hint: "action_list" },
                ...Array.from({ length: count }, (_, index) => ({
                  title: `${index + 1}. Song`,
                  subtitle: "Artist",
                  image_key: "cover",
                  item_key: `track-${index}`,
                  hint: "action_list",
                })),
              ]
            : ["Play Now", "Queue", "Play From Here"].map((title) => ({ title, hint: "action", item_key: title }));
      return Promise.resolve({
        list: list(level),
        offset: options.offset,
        items: items.slice(options.offset, required(options.offset) + required(options.count)),
      } as never);
    });
    jest.mocked(roon.server).mockResolvedValue({
      services: {
        RoonApiTransport: {
          zone_by_zone_id: () => ({
            display_name: "Living Room",
            queue_items_remaining: 250,
            now_playing: { three_line: { line1: "Song 0", line2: "Artist" } },
          }),
          change_settings: settings,
          subscribe_queue: (_zone: unknown, _limit: number, callback: (status: string, body: unknown) => void) => {
            callback("Subscribed", {
              items: Array.from({ length: 250 }, (_, index) => ({
                three_line: {
                  line1: `Song ${index}`,
                  line2: "Artist",
                  line3: "Album",
                },
                image_key: "cover",
                length: 180,
              })),
            });
            return { unsubscribe };
          },
        },
      },
    } as never);
  });

  test("imports all pages, preserves repeated recordings and never executes playback", async () => {
    const tracks = await importCinemaMusic(path);
    expect(tracks).toHaveLength(613);
    expect(new Set(tracks.map((track) => track.entryId)).size).toBe(613);
    expect(tracks[612]).toMatchObject({
      artist: "Artist",
      track: "Song",
      album: "Selected album",
      matchPolicy: "exact",
      imageKey: "cover",
    });
    expect(tracks[612].roonPath?.steps[1].index).toBe(613);
    expect(roon.browse).toHaveBeenCalledTimes(2);
    expect(roon.load).toHaveBeenCalledTimes(8);
    expect(roon.server).not.toHaveBeenCalled();
  });

  test("browsing omits command rows and rejects a saved path to an action", async () => {
    const page = await browseCinemaMusic(path);
    expect(page.kind).toBe("album");
    expect(page.items).toHaveLength(613);
    expect(page.items[0].title).toBe("1. Song");
    const unsafe = { ...path, steps: [...path.steps, { title: "Play Album", index: 0 }] };
    await expect(importCinemaMusic(unsafe)).rejects.toThrow("Choose an album");
    expect(
      jest
        .mocked(roon.browse)
        .mock.calls.some(([options]) => (options as RoonApiBrowseOptions).item_key === "play-album")
    ).toBe(false);
  });

  test("rejects incomplete and oversized imports without returning a truncated queue", async () => {
    const original = required(jest.mocked(roon.load).getMockImplementation());
    jest
      .mocked(roon.load)
      .mockImplementation(async (options) =>
        options.offset === 100 ? ({ list: list("album"), offset: 100, items: [] } as never) : original(options)
      );
    await expect(importCinemaMusic(path)).rejects.toThrow("changed while loading");
    jest.mocked(roon.load).mockImplementation(original);
    count = 1001;
    await expect(importCinemaMusic(path)).rejects.toThrow("1000 tracks");
  });

  test("fails closed if a source changed and replays only an explicitly selected occurrence", async () => {
    await expect(importCinemaMusic({ ...path, steps: [{ title: "Replaced album", index: 0 }] })).rejects.toThrow(
      "unavailable"
    );
    const trackPath = {
      ...path,
      steps: [...path.steps, { title: "1. Song", subtitle: "Artist", imageKey: "cover", index: 1 }],
    };
    await playLocatedCinemaTrack(trackPath, "living", true);
    expect(roon.browse).toHaveBeenLastCalledWith(expect.objectContaining({ item_key: "Play Now" }));
    expect(settings).toHaveBeenCalledWith(expect.anything(), { shuffle: false });
    await playLocatedCinemaTrack(trackPath, "living", false);
    expect(roon.browse).toHaveBeenLastCalledWith(expect.objectContaining({ item_key: "Queue" }));
    expect(
      jest
        .mocked(roon.browse)
        .mock.calls.some(([options]) => (options as RoonApiBrowseOptions).item_key === "Play From Here")
    ).toBe(false);
  });

  test("captures queues beyond the normal 150-row display and releases its subscription", async () => {
    const snapshot = await captureCinemaQueue("living");
    expect(snapshot.tracks).toHaveLength(250);
    expect(snapshot.includesCurrent).toBe(true);
    expect(snapshot.tracks[0]).toMatchObject({ durationSeconds: 180, imageKey: "cover", matchPolicy: "exact" });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(settings).not.toHaveBeenCalled();
    expect(roon.browse).not.toHaveBeenCalled();
  });

  test("unwraps the extra recording page returned by Roon search without running its actions", async () => {
    const load = required(jest.mocked(roon.load).getMockImplementation());
    jest.mocked(roon.load).mockImplementation(async (options) => {
      if (sessions.get(required(options.multi_session_key)) === "track-0")
        return {
          offset: 0,
          list: { ...list("track-0"), hint: undefined, count: 1 },
          items: [{ title: "1. Song", subtitle: "Artist", item_key: "recording", hint: "action_list" }],
        } as never;
      return load(options);
    });
    const browse = required(jest.mocked(roon.browse).getMockImplementation());
    jest.mocked(roon.browse).mockImplementation(async (options) => {
      const result = await browse(options);
      if ((options as RoonApiBrowseOptions).item_key === "track-0") {
        result.list = { ...list("track-0"), hint: undefined, count: 1 } as never;
      } else if ((options as RoonApiBrowseOptions).item_key === "recording") {
        result.list = list("track-0") as never;
      }
      return result;
    });
    const tracks = await importCinemaMusic({ ...path, steps: [...path.steps, { title: "1. Song", index: 1 }] });
    expect(tracks).toHaveLength(1);
    expect(tracks[0].roonPath?.steps).toHaveLength(3);
    expect(
      jest.mocked(roon.browse).mock.calls.some(([options]) => (options as RoonApiBrowseOptions).item_key === "Play Now")
    ).toBe(false);
  });

  test("rejects an incomplete queue and still releases its temporary subscription", async () => {
    const core = await roon.server();
    jest
      .spyOn(core.services.RoonApiTransport, "zone_by_zone_id")
      .mockReturnValue({ queue_items_remaining: 400 } as never);
    await expect(captureCinemaQueue("living")).rejects.toThrow("250 of 400");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  test("validates persisted routes without accepting arbitrary hierarchies or indices", () => {
    expect(validateMusicPath(path)).toEqual(path);
    expect(() => validateMusicPath({ hierarchy: "action", steps: [] })).toThrow();
    expect(() => validateMusicPath({ ...path, steps: [{ title: "Album", index: -1 }] })).toThrow();
  });
});
