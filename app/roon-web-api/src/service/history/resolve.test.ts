import { browseCinemaMusic, CinemaMusicItem, CinemaMusicPage, performMusicAction } from "../cinema-music";
import { CinemaMusicPath } from "../cinema-music-model";
import { HistoryEvent } from "./model";
import { browseHistoryMusic, resolveHistory } from "./resolve";

jest.mock("../cinema-music", () => ({
  browseCinemaMusic: jest.fn(),
  performMusicAction: jest.fn(),
  trackTitle: (title: string) => title.replace(/^(?:\d+[.-]|\d+-\d+)\s+/, ""),
}));

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

  /** Roon's search categories, plus the track listing each album opens to. */
  interface Catalogue {
    albums?: Record<string, CinemaMusicItem[]>;
    tracks?: Record<string, CinemaMusicItem[]>;
    contents?: Record<string, CinemaMusicItem[]>;
  }

  function results(catalogue: Catalogue) {
    const listed = (entries: CinemaMusicItem[], from: CinemaMusicPath) =>
      entries.map((entry, index) => ({
        ...entry,
        path: { ...from, steps: [...from.steps, { title: entry.title, index }] },
      }));
    jest.mocked(browseCinemaMusic).mockImplementation((path) => {
      const [category, chosen] = path.steps;
      if (path.steps.length === 0) {
        // Roon leads its search page with a top result, then the category rows.
        return Promise.resolve({
          title: "Search",
          kind: "list",
          path,
          items: [
            { ...item(event.album, event.artist, event.imageKey), kind: "track" as const },
            ...(["Albums", "Tracks"] as const)
              .filter((name) => catalogue[name.toLowerCase() as "albums" | "tracks"])
              .map((name, offset) => ({
                title: name,
                subtitle: "2 Results",
                kind: "list" as const,
                path: { ...path, steps: [{ title: name, index: offset + 1 }] },
              })),
          ],
        });
      }
      if (path.steps.length === 1) {
        const queries = catalogue[category.title.toLowerCase() as "albums" | "tracks"] ?? {};
        return Promise.resolve({
          title: category.title,
          kind: "list",
          path,
          items: listed(queries[path.query ?? ""] ?? [], path),
        });
      }
      return Promise.resolve({
        title: chosen.title,
        kind: "album",
        path,
        items: listed(
          (catalogue.contents?.[chosen.title] ?? []).map((entry) => ({ ...entry, kind: "track" as const })),
          path
        ),
      });
    });
  }

  beforeEach(() => jest.resetAllMocks());
  afterEach(() => {
    expect(performMusicAction).not.toHaveBeenCalled();
  });

  test("finds Young Americans with a shorter query while preserving the exact remaster and browse path", async () => {
    results({
      albums: {
        [event.album]: [item("American Wayfarer (2016 Remaster)", "Burl Ives")],
        "Young Americans": [
          item(event.album, "[[314746|David Bowie]]", event.imageKey),
          item("Young Americans", "Durand Jones & The Indications", "other-cover"),
          item("Young Americans (1999 Remaster)", "David Bowie", event.imageKey),
        ],
      },
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

  test.each([
    ["alongside its credits", "David Bowie Young Americans (2016 Remaster)"],
    ["under its leading credit alone", "David Bowie"],
  ])("finds an album Roon only returns %s", async (_description, query) => {
    results({
      albums: {
        [query]: [
          item(event.album, "[[314746|David Bowie]]", event.imageKey),
          item("Station to Station", "David Bowie", "other-cover"),
        ],
      },
    });
    const resolution = await resolveHistory(event, "albums");
    expect(resolution.choices).toHaveLength(1);
    expect(resolution.choices[0].path.query).toBe(query);
  });

  test("opens the recorded album and offers the track it actually lists", async () => {
    results({
      albums: { [event.album]: [item(event.album, "[[314746|David Bowie]]", event.imageKey)] },
      contents: { [event.album]: [item("5. Somebody Up There Likes Me", ""), item(`6. ${event.title}`, "")] },
    });
    const resolution = await resolveHistory(event, "tracks", "kitchen");
    expect(resolution.choices).toHaveLength(1);
    expect(resolution.choices[0]).toMatchObject({ title: `6. ${event.title}`, kind: "track" });
    // Two browses to find the album, one to open it. The search index is not consulted.
    expect(browseCinemaMusic).toHaveBeenCalledTimes(3);
    expect(jest.mocked(browseCinemaMusic).mock.calls.every((call) => call[1] === "kitchen")).toBe(true);
  });

  test("offers every identically titled recording the album lists, with its position", async () => {
    results({
      albums: { [event.album]: [item(event.album, "David Bowie", event.imageKey)] },
      contents: { [event.album]: [item("2. Nursery Suite", ""), item("3. Nursery Suite", "")] },
    });
    const resolution = await resolveHistory({ ...event, title: "Nursery Suite" }, "tracks");
    expect(resolution.choices.map((choice) => choice.title)).toEqual(["2. Nursery Suite", "3. Nursery Suite"]);
  });

  test("reads a track position spanning several discs", async () => {
    results({
      albums: { [event.album]: [item(event.album, "David Bowie", event.imageKey)] },
      contents: { [event.album]: [item("1-4 1984", ""), item(`2-7 ${event.title}`, "")] },
    });
    const resolution = await resolveHistory(event, "tracks");
    expect(resolution.choices.map((choice) => choice.title)).toEqual([`2-7 ${event.title}`]);
  });

  test("does not read a leading number in the title itself as a position", async () => {
    results({
      albums: { [event.album]: [item(event.album, "David Bowie", event.imageKey)] },
      contents: { [event.album]: [item("1984", ""), item("3. 1984", "")] },
      tracks: {},
    });
    const resolution = await resolveHistory({ ...event, title: "1984" }, "tracks");
    expect(resolution.choices.map((choice) => choice.title)).toEqual(["1984", "3. 1984"]);
  });

  test("searches for the recording when the recorded album cannot be identified", async () => {
    results({
      albums: {},
      tracks: {
        [event.title]: [
          item(event.title, "David Bowie, Luther Vandross", event.imageKey),
          item(event.title, "Another Artist", "another-cover"),
          item(event.title, "Another Artist", event.imageKey),
        ],
      },
    });
    const resolution = await resolveHistory(event, "tracks");
    expect(resolution.choices.map((choice) => choice.subtitle)).toEqual(["David Bowie, Luther Vandross"]);
  });

  test("points at the album when it is found but does not list the recording", async () => {
    results({
      albums: { [event.album]: [item(event.album, "David Bowie", event.imageKey)] },
      contents: { [event.album]: [item("1. Young Americans", "")] },
      tracks: {},
    });
    const resolution = await resolveHistory(event, "tracks");
    expect(resolution.choices).toEqual([]);
    expect(resolution.message).toBe("This recording could not be found in Roon. Its album is listed under Albums.");
  });

  test("keeps ambiguous same-artist editions when artwork is unavailable", async () => {
    results({
      tracks: {
        [event.title]: [
          item(event.title, "David Bowie", "edition-one"),
          item(event.title, "David Bowie", "edition-two"),
          item(event.title, "Other David Bowie Band", "unrelated"),
        ],
      },
    });
    expect((await resolveHistory({ ...event, imageKey: undefined }, "tracks")).choices).toHaveLength(2);
  });

  test("matches all transport credits against linked browse credits with different separators", async () => {
    results({
      tracks: {
        [event.title]: [
          item(event.title, "[[1|David Bowie]], [[2|Luther Vandross]]"),
          item(event.title, "[[2|Luther Vandross]]"),
        ],
      },
    });
    const resolution = await resolveHistory({ ...event, artist: "David Bowie / Luther Vandross" }, "tracks");
    expect(resolution.choices).toHaveLength(1);
    expect(resolution.choices[0].subtitle).toContain("David Bowie");
  });

  test("album artwork supports compilations whose album artist differs from the recorded performer", async () => {
    results({ albums: { [event.album]: [item(event.album, "Various Artists", event.imageKey)] } });
    expect((await resolveHistory(event, "albums")).choices).toHaveLength(1);
  });

  test("does not substitute another remaster or another artist when the original cannot be found", async () => {
    results({
      albums: {
        "Young Americans": [
          item("Young Americans (1999 Remaster)", event.artist, event.imageKey),
          item(event.album, "Another Artist", "another-cover"),
        ],
      },
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
      results({ tracks: { Fascination: [item(title, event.artist, event.imageKey)] } });
      const resolution = await resolveHistory({ ...event, title }, "tracks");
      expect(resolution.choices).toHaveLength(1);
      expect(resolution.choices[0].path.query).toBe("Fascination");
    }
  );

  test("does not remove meaningful parenthesized title text or retry an unchanged query", async () => {
    results({ tracks: {} });
    const played = { ...event, album: "", title: "Heroes (Live)" };
    expect((await resolveHistory(played, "tracks")).choices).toEqual([]);
    expect(browseCinemaMusic).toHaveBeenCalledTimes(2);
    expect(jest.mocked(browseCinemaMusic).mock.calls.every(([path]) => path.query === "Heroes (Live)")).toBe(true);
  });

  test("reports browse errors instead of hiding them as no matches", async () => {
    jest.mocked(browseCinemaMusic).mockRejectedValue(new Error("Roon is taking too long"));
    await expect(resolveHistory(event, "albums")).rejects.toThrow("Roon is taking too long");
    expect(browseCinemaMusic).toHaveBeenCalledTimes(1);
  });
});
