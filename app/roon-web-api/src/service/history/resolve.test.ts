import { browseCinemaMusic, CinemaMusicItem, CinemaMusicPage, performMusicAction } from "../cinema-music";
import { CinemaMusicPath } from "../cinema-music-model";
import { HistoryEvent } from "./model";
import { browseHistoryMusic, resolveHistory } from "./resolve";

jest.mock("../cinema-music", () => ({ browseCinemaMusic: jest.fn(), performMusicAction: jest.fn() }));

const title = "David Jehring - AI Compilation";
const path: CinemaMusicPath = {
  hierarchy: "search",
  query: "David Jehring - AI Compilation",
  steps: [{ title: "David Jehring - AI Compilation", index: 0 }],
};
const nested: CinemaMusicPath = { ...path, steps: [...path.steps, { title: title, index: 0 }] };
const wrapper = (): CinemaMusicPage => ({
  title: title,
  kind: "list",
  path,
  items: [{ title: title, subtitle: "djehring", kind: "list", path: nested }],
});

test("opens the sole same-title album wrapper and returns its playable path without playback", async () => {
  const album: CinemaMusicPage = { title: title, kind: "album", path: nested, items: [] };
  jest.mocked(browseCinemaMusic).mockResolvedValueOnce(wrapper()).mockResolvedValueOnce(album);
  expect(await browseHistoryMusic(path, "office")).toEqual(album);
  expect(browseCinemaMusic).toHaveBeenNthCalledWith(2, nested, "office");
  expect(performMusicAction).not.toHaveBeenCalled();
});

test("also opens the sole same-title track wrapper", async () => {
  const page = wrapper();
  page.items[0].kind = "track";
  const track: CinemaMusicPage = { title: title, kind: "track", path: nested, items: [] };
  jest.mocked(browseCinemaMusic).mockResolvedValueOnce(page).mockResolvedValueOnce(track);
  expect(await browseHistoryMusic(path)).toEqual(track);
  expect(performMusicAction).not.toHaveBeenCalled();
});

test.each(["multiple", "different-title", "search", "playable", "empty"])(
  "preserves %s pages instead of guessing a selection",
  async (scenario) => {
    const page = wrapper();
    if (scenario === "multiple") page.items.push({ ...page.items[0], subtitle: "Alternate edition" });
    if (scenario === "different-title") page.items[0].title = "Another album";
    if (scenario === "search") page.items[0].kind = "search";
    if (scenario === "playable") page.kind = "album";
    if (scenario === "empty") page.items = [];
    jest.mocked(browseCinemaMusic).mockResolvedValueOnce(page);
    expect(await browseHistoryMusic(path)).toEqual(page);
    expect(browseCinemaMusic).toHaveBeenCalledTimes(1);
    expect(performMusicAction).not.toHaveBeenCalled();
  }
);

test("bounds repeated wrappers and never returns a path beyond the accepted depth", async () => {
  jest.mocked(browseCinemaMusic).mockImplementation((current) =>
    Promise.resolve({
      ...wrapper(),
      path: current,
      items: [{ ...wrapper().items[0], path: { ...current, steps: [...current.steps, path.steps[0]] } }],
    })
  );
  expect((await browseHistoryMusic(path)).path.steps).toHaveLength(5);
  expect(browseCinemaMusic).toHaveBeenCalledTimes(5);
  jest.mocked(browseCinemaMusic).mockClear();
  const deep = { ...path, steps: Array.from({ length: 11 }, () => path.steps[0]) };
  expect((await browseHistoryMusic(deep)).path.steps).toHaveLength(12);
  expect(browseCinemaMusic).toHaveBeenCalledTimes(2);
});

test("propagates a failed nested browse for the screen's retry state", async () => {
  jest.mocked(browseCinemaMusic).mockResolvedValueOnce(wrapper()).mockRejectedValueOnce(new Error("Disconnected"));
  await expect(browseHistoryMusic(path)).rejects.toThrow("Disconnected");
  expect(performMusicAction).not.toHaveBeenCalled();
});

describe("finding a recorded play", () => {
  const event: HistoryEvent = {
    id: "bowie-play",
    coreId: "core",
    observedAt: "2026-10-04T08:03:07.160Z",
    qualifiedAt: "2026-10-04T08:03:41.348Z",
    zoneId: "kitchen",
    room: "Kitchen",
    outputIds: [],
    title: "Fascination (2016 Remaster)",
    artist: "David Bowie",
    album: "Young Americans (2016 Remaster)",
    duration: 348,
    imageKey: "bowie-cover",
  };
  const item = (title: string, subtitle: string, imageKey?: string): CinemaMusicItem => ({
    title,
    subtitle,
    imageKey,
    kind: "list",
    path: { hierarchy: "search", steps: [] },
  });

  function results(kind: "Albums" | "Tracks", queries: Record<string, CinemaMusicItem[]>) {
    jest.mocked(browseCinemaMusic).mockImplementation((path) => {
      const categoryPath: CinemaMusicPath = { ...path, steps: [{ title: kind, index: 1 }] };
      return Promise.resolve({
        title: path.steps.length ? kind : "Search",
        kind: "list",
        path,
        items: path.steps.length
          ? (queries[path.query ?? ""] ?? []).map((entry, index) => ({
              ...entry,
              path: { ...path, steps: [...path.steps, { title: entry.title, index }] },
            }))
          : [
              { ...item(event.album, event.artist, event.imageKey), kind: "track" },
              { title: kind, subtitle: "2 Results", kind: "list", path: categoryPath },
            ],
      });
    });
  }

  beforeEach(() => jest.resetAllMocks());
  afterEach(() => {
    expect(performMusicAction).not.toHaveBeenCalled();
  });

  test("finds Young Americans with a shorter query while preserving the exact remaster and browse path", async () => {
    results("Albums", {
      [event.album]: [item("American Wayfarer (2016 Remaster)", "Burl Ives")],
      "Young Americans": [
        item(event.album, "[[314746|David Bowie]]", event.imageKey),
        item("Young Americans", "Durand Jones & The Indications", "other-cover"),
        item("Young Americans (1999 Remaster)", "David Bowie", event.imageKey),
      ],
    });
    const resolution = await resolveHistory(event, "albums", "kitchen");
    expect(resolution.choices).toHaveLength(1);
    expect(resolution.choices[0]).toMatchObject({
      title: event.album,
      subtitle: "[[314746|David Bowie]]",
      path: {
        query: "Young Americans",
        steps: [
          { title: "Albums", index: 1 },
          { title: event.album, index: 0 },
        ],
      },
    });
    expect(browseCinemaMusic).toHaveBeenCalledTimes(4);
    expect(jest.mocked(browseCinemaMusic).mock.calls.every((call) => call[1] === "kitchen")).toBe(true);
  });

  test("does not broaden a successful search and excludes other artists' same-title tracks", async () => {
    results("Tracks", {
      [event.title]: [
        item(event.title, "David Bowie, Luther Vandross", event.imageKey),
        item(event.title, "Another Artist", "another-cover"),
        item(event.title, "Another Artist", event.imageKey),
      ],
    });
    const resolution = await resolveHistory(event, "tracks");
    expect(resolution.choices.map((choice) => choice.subtitle)).toEqual(["David Bowie, Luther Vandross"]);
    expect(browseCinemaMusic).toHaveBeenCalledTimes(2);
  });

  test("keeps ambiguous same-artist editions when artwork is unavailable", async () => {
    results("Tracks", {
      [event.title]: [
        item(event.title, "David Bowie", "edition-one"),
        item(event.title, "David Bowie", "edition-two"),
        item(event.title, "Other David Bowie Band", "unrelated"),
      ],
    });
    expect((await resolveHistory({ ...event, imageKey: undefined }, "tracks")).choices).toHaveLength(2);
  });

  test("matches all transport credits against linked browse credits with different separators", async () => {
    results("Tracks", {
      [event.title]: [
        item(event.title, "[[1|David Bowie]], [[2|Luther Vandross]]"),
        item(event.title, "[[2|Luther Vandross]]"),
      ],
    });
    const resolution = await resolveHistory({ ...event, artist: "David Bowie / Luther Vandross" }, "tracks");
    expect(resolution.choices).toHaveLength(1);
    expect(resolution.choices[0].subtitle).toContain("David Bowie");
  });

  test("album artwork supports compilations whose album artist differs from the recorded performer", async () => {
    results("Albums", { [event.album]: [item(event.album, "Various Artists", event.imageKey)] });
    expect((await resolveHistory(event, "albums")).choices).toHaveLength(1);
  });

  test("does not substitute another remaster or another artist when the original cannot be found", async () => {
    results("Albums", {
      "Young Americans": [
        item("Young Americans (1999 Remaster)", event.artist, event.imageKey),
        item(event.album, "Another Artist", "another-cover"),
      ],
    });
    expect((await resolveHistory(event, "albums")).choices).toEqual([]);
  });

  test("a same-title top track is not an album result when the Albums category is absent", async () => {
    jest.mocked(browseCinemaMusic).mockResolvedValue({
      title: "Search",
      kind: "list",
      path: { hierarchy: "search", steps: [] },
      items: [{ ...item(event.album, event.artist, event.imageKey), kind: "track" }],
    });
    expect((await resolveHistory(event, "albums")).choices).toEqual([]);
  });

  test.each(["Fascination (Remastered 2017)", "Fascination [2016 Remaster]"])(
    "also retries a remastered track query: %s",
    async (title) => {
      results("Tracks", { Fascination: [item(title, event.artist, event.imageKey)] });
      const resolution = await resolveHistory({ ...event, title }, "tracks");
      expect(resolution.choices).toHaveLength(1);
      expect(resolution.choices[0].path.query).toBe("Fascination");
    }
  );

  test("does not remove meaningful parenthesized title text or retry an unchanged query", async () => {
    results("Tracks", {});
    expect((await resolveHistory({ ...event, title: "Heroes (Live)" }, "tracks")).choices).toEqual([]);
    expect(browseCinemaMusic).toHaveBeenCalledTimes(2);
    expect(jest.mocked(browseCinemaMusic).mock.calls.every(([path]) => path.query === "Heroes (Live)")).toBe(true);
  });

  test("reports browse errors instead of hiding them as no matches", async () => {
    jest.mocked(browseCinemaMusic).mockRejectedValue(new Error("Roon is taking too long"));
    await expect(resolveHistory(event, "albums")).rejects.toThrow("Roon is taking too long");
    expect(browseCinemaMusic).toHaveBeenCalledTimes(1);
  });
});
