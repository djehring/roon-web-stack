import { citedURLs, DiscoveryIntent, ReleaseEvidence, validReleaseDate } from "../ai-service/discovery-ai";
import { Track } from "../ai-service/types/track";
import { browseCinemaMusic, importCinemaMusic, performMusicAction, playLocatedCinemaTrack } from "./cinema-music";
import { completeWork, hasWork, releaseFor, workTracks } from "./discovery-matching";
import { matchAlbumInList, matchesArtist } from "./matching-utils";
import { discoverMusic, playDiscovery, rememberDiscovery } from "./music-discovery";

jest.mock("../ai-service/chatgpt", () => ({ resolveOpenAIApiKey: () => "test-only" }));
jest.mock("./cinema-music", () => ({
  browseCinemaMusic: jest.fn(),
  importCinemaMusic: jest.fn(),
  performMusicAction: jest.fn(),
  playLocatedCinemaTrack: jest.fn(),
}));
jest.mock("./uk-chart-scraper", () => ({ scrapeUKChartData: jest.fn() }));
jest.mock("@infrastructure", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
  roon: {
    server: jest.fn().mockResolvedValue({
      services: {
        RoonApiTransport: {
          zone_by_zone_id: jest.fn().mockReturnValue({ zone_id: "office" }),
          change_settings: jest.fn(),
        },
      },
    }),
  },
}));
const intent: DiscoveryIntent = {
  kind: "classical",
  mode: "albums",
  terms: ["Enigma Variations"],
  composer: "Edward Elgar",
  work: "Enigma Variations",
  workScope: "single",
  workAliases: ["Variations on an Original Theme"],
  movement: "",
  movementCount: 15,
  performers: [],
  recent: false,
  limit: 10,
  tracks: [],
};
const title = "Elgar: Enigma Variations, In the South, Serenade for Strings";
const artist = "[[1|Royal Liverpool Philharmonic Orchestra]], [[2|Vasily Petrenko]]";
const path = {
  hierarchy: "search" as const,
  query: "Enigma Variations",
  steps: [
    { title: "Albums", index: 0 },
    { title, subtitle: artist, index: 0 },
    { title, subtitle: artist, index: 0 },
  ],
};
const tracks: Track[] = Array.from({ length: 19 }, (_, index) => ({
  track:
    index < 15 ? `Enigma Variations, Op. 36: ${index ? `Variation ${index}` : "Theme"}` : `Serenade: Movement ${index}`,
  album: title,
  artist: "Edward Elgar, Vasily Petrenko, Royal Liverpool Philharmonic Orchestra",
  roonPath: { ...path, steps: [...path.steps, { title: `track ${index}`, index }] },
}));
const release: ReleaseEvidence = {
  title,
  artist: "Vasily Petrenko, Royal Liverpool Philharmonic Orchestra",
  releaseDate: "2019-08-30",
  recordingDate: "",
  reissue: false,
  source: "https://label.example/album",
};

function setup(changes: Partial<DiscoveryIntent> = {}) {
  const browse = jest
    .fn<ReturnType<typeof browseCinemaMusic>, Parameters<typeof browseCinemaMusic>>()
    .mockResolvedValue({
      title: "Albums",
      kind: "list",
      path: { hierarchy: "search", steps: [] },
      items: [{ title, subtitle: artist, kind: "list", path }],
    });
  const contents = jest
    .fn<ReturnType<typeof importCinemaMusic>, Parameters<typeof importCinemaMusic>>()
    .mockResolvedValue(tracks);
  return {
    interpret: jest.fn().mockResolvedValue({ ...intent, ...changes }),
    research: jest.fn().mockResolvedValue([release]),
    browse,
    contents,
    chart: jest.fn<Promise<Track[]>, [string]>().mockResolvedValue([]),
    dates: jest.fn().mockResolvedValue([release]),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(importCinemaMusic).mockResolvedValue(tracks);
});

test("reproduces and repairs the saved Petrenko album and reversed combined credits", () => {
  expect(
    matchesArtist("- Sir Simon Rattle, Berliner Philharmoniker", "[[1|Berliner Philharmoniker]], [[2|Simon Rattle]]")
  ).toBe(true);
  expect(
    matchesArtist(
      "Sir Simon Rattle, Berliner Philharmoniker",
      "[[1|Berliner Philharmoniker]], [[2|Herbert von Karajan]]"
    )
  ).toBe(false);
  expect(
    matchAlbumInList(
      { items: [{ title, subtitle: artist, item_key: "album" }] },
      {
        artist: "- Vasily Petrenko",
        track: "Theme",
        album: "Elgar: Enigma Variations, In The South & Serenade for Strings",
      }
    )
  ).not.toBeNull();
});

test("album wrappers do not include other works in the complete-work selection", () => {
  const selected = workTracks(tracks, intent);
  expect(selected).toHaveLength(15);
  expect(completeWork(selected, intent)).toBe(true);
  expect(completeWork(selected.slice(0, 14), intent)).toBe(false);
  expect(completeWork([tracks[9]], intent)).toBe(false);
});

function brandenburgSetup(workScope: "single" | "collection" = "collection", mode: "albums" | "tracks" = "albums") {
  const album = "J.S. Bach: Brandenburg Concertos / Orchestral Suites";
  const albumPath = {
    hierarchy: "search" as const,
    query: "Brandenburg concerto",
    steps: [{ title: album, index: 0 }],
  };
  const deps = setup({
    mode,
    composer: "Johann Sebastian Bach",
    work: workScope === "collection" ? "Brandenburg Concertos" : "Brandenburg Concerto No. 3",
    workScope,
    workAliases: [],
    movementCount: workScope === "collection" ? 6 : 3,
    terms: ["Brandenburg Concertos"],
  });
  deps.browse.mockResolvedValue({
    title: "Albums",
    kind: "list",
    path: albumPath,
    items: [{ title: album, subtitle: "Akademie für Alte Musik Berlin", kind: "list", path: albumPath }],
  });
  const movements = [4, 3, 3, 3, 3, 3].flatMap((count, concerto) =>
    Array.from({ length: count }, (_, index) => `Brandenburg Concerto No. ${concerto + 1}: Movement ${index + 1}`)
  );
  deps.contents.mockResolvedValue(
    [...movements, "Orchestral Suite No. 2: Ouverture"].map((track, index) => ({
      track,
      album,
      artist: "Johann Sebastian Bach, Akademie für Alte Musik Berlin",
      roonPath: { ...albumPath, steps: [...albumPath.steps, { title: track, index }] },
    }))
  );
  return deps;
}

test.each(["auto", "albums"] as const)(
  "%s returns Brandenburg collections instead of requiring six tracks",
  async (mode) => {
    const deps = brandenburgSetup();
    const response = await discoverMusic("Brandenburg concerto", mode, deps);
    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({ available: true, workTracks: [] });
    expect(response.results[0].tracks).toHaveLength(20);
    expect(response.results[0].workTitle).toBeUndefined();
    expect(response.message).toContain("Albums featuring Brandenburg Concertos");
    expect(response.message).not.toContain("complete");
    expect(performMusicAction).not.toHaveBeenCalled();
    expect(playLocatedCinemaTrack).not.toHaveBeenCalled();
  }
);

test("finds a numbered concerto inside an album of all six concertos", async () => {
  const response = await discoverMusic("Brandenburg Concerto No. 3", "albums", brandenburgSetup("single"));
  expect(response.results).toHaveLength(1);
  expect(response.results[0].workTracks).toHaveLength(3);
  expect(response.results[0].workTracks.every((track) => track.track.includes("No. 3:"))).toBe(true);
  expect(response.results[0].workTitle).toBe("Brandenburg Concerto No. 3");
  expect(response.message).toContain("complete Brandenburg Concerto No. 3");
});

test("Tracks mode resolves collection movements from the playable albums", async () => {
  const deps = brandenburgSetup("collection", "tracks");
  const response = await discoverMusic("Brandenburg concerto", "tracks", deps);
  expect(response.results).toHaveLength(10);
  expect(
    response.results.every((result) => result.kind === "track" && result.title.includes("Brandenburg Concerto"))
  ).toBe(true);
  expect(deps.research).not.toHaveBeenCalled();
});

test("work matching handles concerto plurals without confusing numbered works", () => {
  const collection = { ...intent, work: "Brandenburg Concertos", workAliases: [], workScope: "collection" as const };
  expect(hasWork("Brandenburg Concerto No. 3: Allegro", collection)).toBe(true);
  expect(hasWork("Bach: Brandenburg Concerti", collection)).toBe(true);
  expect(hasWork("Violin Concerto No. 3", collection)).toBe(false);
  expect(hasWork("Brandenburg Concerto No. 10", { ...collection, work: "Brandenburg Concerto No. 1" })).toBe(false);
});

test("ordinary albums do not advertise a separate complete-work selection", async () => {
  const response = await discoverMusic(
    "Bach albums",
    "albums",
    setup({ kind: "albums", work: "", workScope: "none", composer: "" })
  );
  expect(response.results).toHaveLength(1);
  expect(response.results[0].workTracks).toEqual([]);
  expect(response.results[0].workTitle).toBeUndefined();
});

test("returns one verified album, its full track list and its ordered work subset without playback", async () => {
  const deps = setup();
  const response = await discoverMusic("latest recordings of Elgaza enigma variations", "auto", deps);
  expect(response.mode).toBe("albums");
  expect(response.results).toHaveLength(1);
  expect(response.results[0].tracks).toHaveLength(19);
  expect(response.results[0].workTracks.map((track) => track.track)).toEqual(
    tracks.slice(0, 15).map((track) => track.track)
  );
  expect(performMusicAction).not.toHaveBeenCalled();
  expect(playLocatedCinemaTrack).not.toHaveBeenCalled();
});

test("a standalone composition in Tracks mode stays on the track resolver", async () => {
  const wanted = { track: "Peace Piece", artist: "Bill Evans", album: "Everybody Digs Bill Evans" };
  const deps = setup({
    kind: "tracks",
    mode: "tracks",
    work: "Peace Piece",
    movementCount: 1,
    composer: "Bill Evans",
    terms: ["Peace Piece"],
    tracks: [wanted],
  });
  deps.browse.mockResolvedValue({
    title: "Tracks",
    kind: "list",
    path,
    items: [{ title: "Peace Piece", subtitle: "Bill Evans", kind: "track", path }],
  });
  deps.contents.mockResolvedValue([{ ...wanted, roonPath: path }]);
  const response = await discoverMusic("Peace Piece by Bill Evans", "tracks", deps);
  expect(response.results).toHaveLength(1);
  expect(response.results[0]).toMatchObject({ kind: "track", title: "Peace Piece", available: true });
  expect(deps.browse).toHaveBeenCalledWith({ hierarchy: "search", query: "Peace Piece Bill Evans", steps: [] });
  expect(deps.research).not.toHaveBeenCalled();
});

test("a track with the wrong performer is displayed as unavailable and never playable", async () => {
  const wanted = { track: "Peace Piece", artist: "Bill Evans", album: "" };
  const deps = setup({ kind: "tracks", mode: "tracks", work: "", movementCount: 0, tracks: [wanted] });
  deps.browse.mockResolvedValue({
    title: "Tracks",
    kind: "list",
    path,
    items: [{ title: "Peace Piece", subtitle: "Another Pianist", kind: "track", path }],
  });
  const response = await discoverMusic("Peace Piece by Bill Evans", "tracks", deps);
  expect(response.results[0].available).toBe(false);
  expect(deps.contents).not.toHaveBeenCalled();
});

function chartSetup(count = 3) {
  const chart = [
    { artist: "WHAM!", track: "I'M YOUR MAN", album: "" },
    { artist: "FEARGAL SHARKEY", track: "A GOOD HEART", album: "" },
    { artist: "JENNIFER RUSH", track: "THE POWER OF LOVE", album: "" },
    { artist: "UB40", track: "DON'T BREAK MY HEART", album: "" },
  ];
  const deps = setup({
    kind: "chart",
    chart: { date: "1985-11-24", count },
    mode: "tracks",
    terms: [],
    composer: "",
    work: "",
    workScope: "none",
    workAliases: [],
    movementCount: 0,
    limit: count,
  });
  deps.chart.mockResolvedValue(chart);
  const listed = [
    { title: "I'm Your Man", subtitle: "Wham!" },
    { title: "A Good Heart", subtitle: "Feargal Sharkey" },
    { title: "The Power of Love", subtitle: "Huey Lewis & the News" },
  ];
  deps.browse.mockImplementation((request) =>
    Promise.resolve({
      title: "Tracks",
      kind: "list",
      path,
      items: listed.map((item, index) => ({
        ...item,
        kind: "track" as const,
        path: { hierarchy: "search" as const, query: request.query, steps: [{ title: item.title, index }] },
      })),
    })
  );
  deps.contents.mockImplementation((trackPath) =>
    Promise.resolve(
      listed
        .filter((item) => item.title === trackPath.steps[0].title)
        .map((item) => ({ track: item.title, artist: item.subtitle, album: "Singles", roonPath: trackPath }))
    )
  );
  return deps;
}

test("a chart request plays the published chart in order and never substitutes another artist", async () => {
  const deps = chartSetup();
  const response = await discoverMusic("Find me the uk top ten from this week in 1985", "auto", deps);
  expect(deps.chart).toHaveBeenCalledWith("1985-11-24");
  expect(response.mode).toBe("tracks");
  expect(response.results.map((result) => [result.title, result.artist, result.available])).toEqual([
    ["I'm Your Man", "Wham!", true],
    ["A Good Heart", "Feargal Sharkey", true],
    ["THE POWER OF LOVE", "JENNIFER RUSH", false],
  ]);
  expect(response.message).toBe(
    "UK singles chart for the week of 24 November 1985, in chart order. 1 of 3 could not be verified in Roon."
  );
  expect(deps.research).not.toHaveBeenCalled();
  expect(playLocatedCinemaTrack).not.toHaveBeenCalled();
});

test("chart entries prefer the original recording and accept the lead artist of a joint billing", async () => {
  const deps = chartSetup(2);
  deps.chart.mockResolvedValue([
    { artist: "JENNIFER RUSH", track: "THE POWER OF LOVE", album: "" },
    { artist: "PHIL COLLINS AND MARILYN MARTIN", track: "SEPARATE LIVES", album: "" },
  ]);
  const listed = [
    { title: "The Power of Love (Live)", subtitle: "Jennifer Rush" },
    { title: "The Power of Love", subtitle: "Huey Lewis and the News" },
    { title: "The Power of Love", subtitle: "Jennifer Rush, Gunther Mende" },
    { title: "The Power of Love", subtitle: "Vanny Vabiola, Jennifer Rush" },
    { title: "Separate Lives (Live from the Serious Tour 1990)", subtitle: "Stephen Bishop, Phil Collins" },
    { title: "Separate Lives (Karaoke Version)", subtitle: "Phil Collins, Marilyn Martin" },
    { title: "Separate Lives (2016 Remaster)", subtitle: "Phil Collins, Stephen Bishop" },
    { title: "Separate Lives", subtitle: "Stephen Bishop" },
  ];
  deps.browse.mockResolvedValue({
    title: "Tracks",
    kind: "list",
    path,
    items: listed.map((item, index) => ({
      ...item,
      kind: "track" as const,
      path: { hierarchy: "search" as const, steps: [{ ...item, index }] },
    })),
  });
  deps.contents.mockImplementation((trackPath) =>
    Promise.resolve([
      {
        track: trackPath.steps[0].title,
        artist: trackPath.steps[0].subtitle ?? "",
        album: "",
        roonPath: trackPath,
      },
    ])
  );
  const response = await discoverMusic("uk top two this week in 1985", "auto", deps);
  // The request itself is tried in Roon first; the chart lookups follow.
  const lookups = deps.browse.mock.calls.map(([request]) => request.query).filter((query) => !query?.startsWith("uk"));
  expect(lookups[0]).toBe("THE POWER OF LOVE JENNIFER RUSH");
  expect(response.results.map((result) => [result.title, result.artist])).toEqual([
    ["The Power of Love", "Jennifer Rush, Gunther Mende"],
    ["Separate Lives (2016 Remaster)", "Phil Collins, Stephen Bishop"],
  ]);
});

test("a chart that cannot be loaded fails explicitly instead of guessing the hits", async () => {
  const deps = chartSetup();
  deps.chart.mockResolvedValue([]);
  await expect(discoverMusic("uk top ten this week in 1985", "auto", deps)).rejects.toThrow("could not be loaded");
  expect(deps.browse.mock.calls.every(([request]) => request.query === "uk top ten this week in 1985")).toBe(true);
});

type Listed = { title: string; subtitle: string };
/** Roon's search page: its best match first, then the groups that list everything. */
function namedSetup(albums: Listed[], songs: Listed[] = [], top: Listed | undefined = albums.at(0) ?? songs.at(0)) {
  const deps = setup({ kind: "albums", terms: ["Eric Clapton"], composer: "", work: "", workScope: "none" });
  const listed = (items: Listed[], kind: "list" | "track") =>
    items.map((item, index) => ({
      ...item,
      kind,
      path: { hierarchy: "search" as const, query: "q", steps: [{ title: item.title, index }] },
    }));
  deps.browse.mockImplementation((request) => {
    const group = request.steps[0]?.title;
    const items =
      group === "Albums"
        ? listed(albums, "list")
        : group === "Tracks"
          ? listed(songs, "track")
          : [
              ...(top ? listed([top], songs.includes(top) ? "track" : "list") : []),
              ...(albums.length ? listed([{ title: "Albums", subtitle: `${albums.length} Results` }], "list") : []),
              ...(songs.length ? listed([{ title: "Tracks", subtitle: `${songs.length} Results` }], "list") : []),
            ];
    return Promise.resolve({ title: "Search", kind: "list", path, items });
  });
  deps.contents.mockImplementation((itemPath) =>
    Promise.resolve(
      songs.some((song) => song.title === itemPath.steps[0].title)
        ? [{ track: itemPath.steps[0].title, artist: "Bill Evans", album: "Everybody Digs", roonPath: itemPath }]
        : [1, 2].map((index) => ({
            track: `Song ${index}`,
            artist: "Eric Clapton",
            album: itemPath.steps[0].title,
            roonPath: { ...itemPath, steps: [...itemPath.steps, { title: `Song ${index}`, index }] },
          }))
    )
  );
  deps.interpret.mockReturnValue(new Promise(() => undefined));
  return deps;
}
const oldSock = [
  { title: "Old Sock (MFiT Version)", subtitle: "Eric Clapton" },
  { title: "Old Socks, New Shoes...", subtitle: "[[1|The Jazz Crusaders]]" },
  { title: "Old Sock", subtitle: "[[2|Bishopskin]]" },
];

test.each(["Old Sock by Eric Clapton", "Old Sock", "old sock eric clapton"])(
  "%s is returned from Roon without interpretation or web research",
  async (query) => {
    const deps = namedSetup(oldSock);
    deps.dates.mockResolvedValue([{ ...release, title: "Old Sock (MFiT Version)", artist: "Eric Clapton" }]);
    const response = await discoverMusic(query, "auto", deps);
    expect(response).toMatchObject({ mode: "albums", message: "Found in Roon by name." });
    // Another artist's album of the same name is not an edition of this one.
    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({
      kind: "album",
      title: "Old Sock (MFiT Version)",
      artist: "Eric Clapton",
      available: true,
      release: { releaseDate: "2019-08-30" },
    });
    expect(response.results[0].tracks).toHaveLength(2);
    expect(deps.research).not.toHaveBeenCalled();
    // Roon matches every word, so the connecting "by" is left out of its search.
    expect(deps.browse.mock.calls[0][0].query).not.toMatch(/\bby\b/i);
  }
);

test("editions of the named album by the same artist are returned together", async () => {
  const deps = namedSetup([
    { title: "Kind of Blue", subtitle: "Miles Davis" },
    { title: "Kind of Blue (The Mono Recordings)", subtitle: "[[1|Miles Davis]]" },
    { title: "Kind of Blue", subtitle: "[[2|Piano Miles]]" },
    { title: "Kind of Blue (Live)", subtitle: "[[1|Miles Davis]]" },
  ]);
  const response = await discoverMusic("Kind of Blue", "auto", deps);
  expect(response.results.map((result) => result.title)).toEqual([
    "Kind of Blue",
    "Kind of Blue (The Mono Recordings)",
  ]);
});

test("a title shared by an album and a song follows Roon's own top result", async () => {
  const albums = [{ title: "Peace Piece", subtitle: "[[1|Bill Evans]]" }];
  const songs = [{ title: "Peace Piece", subtitle: "Bill Evans, Bill Evans Trio" }];
  const song = await discoverMusic("Peace Piece by Bill Evans", "auto", namedSetup(albums, songs, songs[0]));
  expect(song).toMatchObject({ mode: "tracks", message: "Found in Roon by name." });
  expect(song.results).toMatchObject([{ kind: "track", title: "Peace Piece", available: true }]);
  const album = await discoverMusic("Peace Piece", "auto", namedSetup(albums, songs, albums[0]));
  expect(album).toMatchObject({ mode: "albums", message: "Found in Roon by name." });
  // An explicit mode overrides the top result when the title is named with its artist.
  const asked = await discoverMusic("Peace Piece by Bill Evans", "albums", namedSetup(albums, songs, songs[0]));
  expect(asked).toMatchObject({ mode: "albums", message: "Found in Roon by name." });
});

test.each([
  ["an artist, even with a self-titled album", "Eric Clapton", { title: "Eric Clapton", subtitle: "7 Albums" }],
  ["a request with further words", "latest Old Sock by Eric Clapton", undefined],
  ["a bare title that is not Roon's top result", "Old Sock", { title: "Socks", subtitle: "[[3|Someone]]" }],
  ["a work whose top result is a longer title", "Enigma Variations", undefined],
])("%s is left to interpretation", async (_, query, top) => {
  const deps = namedSetup(
    [
      { title: "Old Sock", subtitle: "Eric Clapton" },
      { title: "Eric Clapton", subtitle: "Eric Clapton" },
      { title: "Elgar: Enigma Variations", subtitle: "Leonard Bernstein" },
    ],
    [],
    top ?? { title: "Elgar: Enigma Variations", subtitle: "Leonard Bernstein" }
  );
  deps.interpret.mockResolvedValue({ ...intent, kind: "albums", terms: ["x"], work: "", workScope: "none" });
  const response = await discoverMusic(query, "auto", deps);
  expect(response.message).not.toBe("Found in Roon by name.");
});

test("a karaoke version is never taken for the named album", async () => {
  const deps = namedSetup([{ title: "Rockferry (Karaoke Version Originally Performed by Duffy)", subtitle: "Duffy" }]);
  deps.interpret.mockResolvedValue({ ...intent, kind: "albums", terms: ["x"], work: "", workScope: "none" });
  const response = await discoverMusic("Rockferry by Duffy", "auto", deps);
  expect(response.message).not.toBe("Found in Roon by name.");
});

test("rejects excerpts and the wrong named performer", async () => {
  const deps = setup();
  deps.contents.mockResolvedValue(tracks.slice(0, 1));
  expect((await discoverMusic("complete Enigma", "auto", deps)).results).toEqual([]);
  expect(deps.research).not.toHaveBeenCalled();
  expect((await discoverMusic("Rattle Enigma", "auto", setup({ performers: ["Simon Rattle"] }))).results).toEqual([]);
});

test.each(["auto", "albums"] as const)("%s album searches take dates from the catalogue alone", async (mode) => {
  const deps = setup({ recent: false });
  const response = await discoverMusic("Enigma Variations", mode, deps);
  expect(deps.dates).toHaveBeenCalledWith([
    { title, artist: "Royal Liverpool Philharmonic Orchestra, Vasily Petrenko", trackCount: 19 },
  ]);
  // Web research can take a minute or more; only a latest search waits for it.
  expect(deps.research).not.toHaveBeenCalled();
  expect(response.results[0].release).toEqual(release);
  expect(response.message).toBe("Albums containing the complete Enigma Variations.");
  expect(performMusicAction).not.toHaveBeenCalled();
});

test.each([false, true])("date lookup sorts only when recency is requested (%s)", async (recent) => {
  const deps = setup({ kind: "albums", recent, composer: "", work: "", terms: ["Milos Karadaglic"] });
  const albums = ["Older album", "Newer album", "Reissue", "Unknown date"];
  deps.browse.mockResolvedValue({
    title: "Albums",
    kind: "list",
    path,
    items: albums.map((title, index) => ({
      title,
      subtitle: "Miloš Karadaglić",
      kind: "list",
      path: { ...path, steps: [{ title, index }] },
    })),
  });
  deps.contents.mockImplementation((path) =>
    Promise.resolve([
      {
        track: "First track",
        artist: "Miloš Karadaglić",
        album: path.steps[0].title,
        roonPath: path,
      },
    ])
  );
  const dated = jest.fn().mockResolvedValue(
    albums.slice(0, 3).map((title, index) => ({
      ...release,
      title,
      artist: "Miloš Karadaglić",
      releaseDate: `${2020 + index}-01-01`,
      reissue: index === 2,
    }))
  );
  deps.research = dated;
  deps.dates = dated;
  const response = await discoverMusic(recent ? "latest Milos albums" : "Milos Karadaglic", "albums", deps);
  expect(response.results.map((item) => item.title)).toEqual(
    recent ? ["Newer album", "Older album", "Reissue", "Unknown date"] : albums
  );
  expect(response.results.filter((item) => item.release)).toHaveLength(3);
  // A missing date is simply not shown; only a latest search explains its ranking.
  if (recent) expect(response.message).toContain("Newest verified releases first");
  else expect(response.message).toBe("Albums verified in Roon.");
});

test.each(["failed", "empty"])("an album date lookup that is %s preserves playable results", async (outcome) => {
  const deps = setup();
  if (outcome === "failed") deps.dates.mockRejectedValue(new Error("catalogue offline"));
  else deps.dates.mockResolvedValue([]);
  const response = await discoverMusic("Enigma Variations", "albums", deps);
  expect(response.results).toHaveLength(1);
  expect(response.results[0]).toMatchObject({ available: true, tracks });
  expect(response.results[0].release).toBeUndefined();
  expect(response.message).toBe("Albums containing the complete Enigma Variations.");
});

test("research failures preserve recency intent and explain unverified dates", async () => {
  const deps = setup({ recent: true });
  deps.research.mockRejectedValue(new Error("research offline"));
  const response = await discoverMusic("latest Enigma", "auto", deps);
  expect(deps.research).toHaveBeenCalledWith(
    "latest Enigma",
    [{ title, artist: "Royal Liverpool Philharmonic Orchestra, Vasily Petrenko" }],
    { recent: true, terms: ["Edward Elgar Enigma Variations", "Enigma Variations"], limit: 10 }
  );
  expect(response.message).toContain("not ranked as the latest");
  expect(response.results[0].release).toBeUndefined();
});

test("recency research ranks catalogue metadata before loading album contents", async () => {
  const deps = setup({ recent: true });
  const response = await discoverMusic("latest Enigma", "auto", deps);
  expect(deps.research).toHaveBeenCalledWith(
    "latest Enigma",
    [{ title, artist: "Royal Liverpool Philharmonic Orchestra, Vasily Petrenko" }],
    { recent: true, terms: ["Edward Elgar Enigma Variations", "Enigma Variations"], limit: 10 }
  );
  expect(deps.research.mock.invocationCallOrder[0]).toBeLessThan(deps.contents.mock.invocationCallOrder[0]);
  expect(response.results[0].release).toEqual(release);
  expect(response.message).toContain("Newest verified releases first");
});

test("latest searches validate the ranked shortlist instead of every album", async () => {
  const deps = setup({ recent: true, limit: 3, kind: "albums", work: "", composer: "", workScope: "none" });
  const albums = Array.from({ length: 40 }, (_, index) => ({
    title: `Album ${index}`,
    subtitle: "Artist",
    kind: "list" as const,
    path: { ...path, steps: [{ title: `Album ${index}`, index }] },
  }));
  deps.browse.mockResolvedValue({ title: "Albums", kind: "list", path, items: albums });
  deps.research.mockResolvedValue(
    albums.map((album, index) => ({
      ...release,
      title: album.title,
      artist: "Artist",
      releaseDate: `${1980 + index}-06-01`,
    }))
  );
  let active = 0;
  let peak = 0;
  deps.contents.mockImplementation(async (albumPath) => {
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    return [{ track: "Track", album: albumPath.steps[0].title, artist: "Artist", roonPath: albumPath }];
  });
  const response = await discoverMusic("latest albums", "albums", deps);
  expect(response.results.map((result) => result.title)).toEqual(["Album 39", "Album 38", "Album 37"]);
  expect(deps.contents).toHaveBeenCalledTimes(3);
  expect(peak).toBe(3);
  expect(deps.research).toHaveBeenCalledTimes(1);
});

test("ranked validation keeps checking candidates when the newest album is unavailable", async () => {
  const deps = setup({ recent: true, limit: 1, kind: "albums", work: "", composer: "", workScope: "none" });
  deps.browse.mockResolvedValue({
    title: "Albums",
    kind: "list",
    path,
    items: ["Unavailable", "Available"].map((title, index) => ({
      title,
      subtitle: "Artist",
      kind: "list",
      path: { ...path, steps: [{ title, index }] },
    })),
  });
  deps.research.mockResolvedValue(
    ["Unavailable", "Available"].map((title, index) => ({
      ...release,
      title,
      artist: "Artist",
      releaseDate: `202${5 - index}-06-01`,
    }))
  );
  deps.contents.mockImplementation(async (albumPath) => {
    await Promise.resolve();
    if (albumPath.steps[0].title === "Unavailable") throw new Error("Removed");
    return [{ track: "Track", album: "Available", artist: "Artist", roonPath: albumPath }];
  });
  const response = await discoverMusic("latest albums", "albums", deps);
  expect(response.results.map((result) => result.title)).toEqual(["Available"]);
  expect(response.results[0].release?.releaseDate).toBe("2024-06-01");
});

test("dates from a different catalogue track count retain their verified year", async () => {
  const deps = setup({ recent: true });
  deps.research.mockResolvedValue([{ ...release, trackCount: 99 }]);
  const response = await discoverMusic("latest Enigma", "albums", deps);
  expect(response.results[0].release?.releaseDate).toBe("2019");
});

test("release evidence requires an exact album/performer and valid, nonfuture dates", () => {
  expect(releaseFor(title, artist, [release])).toEqual(release);
  expect(releaseFor(title, "Simon Rattle", [release])).toBeUndefined();
  expect(releaseFor(title, artist, [release, { ...release, releaseDate: "2020-01-01" }])).toBeUndefined();
  expect(validReleaseDate("2025-02-30")).toBe(false);
  expect(validReleaseDate("2999-01-01")).toBe(false);
  expect(validReleaseDate("2019-08-30")).toBe(true);
  expect([
    ...citedURLs({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", annotations: [{ type: "url_citation", url: release.source }] }],
        },
      ],
    }),
  ]).toEqual([release.source]);
});

test("whole album playback uses its refreshed album action, not the first movement", async () => {
  const response = rememberDiscovery("client-a", await discoverMusic("Enigma", "auto", setup()));
  await playDiscovery("client-a", "office", { ids: [response.results[0].id], workOnly: false });
  expect(importCinemaMusic).toHaveBeenCalledWith(path, "office");
  expect(performMusicAction).toHaveBeenCalledWith(path, "office", "Play Now");
  expect(playLocatedCinemaTrack).not.toHaveBeenCalled();
});

test("work playback keeps the original movement order and does not queue coupled works", async () => {
  const response = rememberDiscovery("client-b", await discoverMusic("Enigma", "auto", setup()));
  await playDiscovery("client-b", "kitchen", { ids: [response.results[0].id], workOnly: true });
  expect(performMusicAction).not.toHaveBeenCalled();
  expect(jest.mocked(playLocatedCinemaTrack).mock.calls).toEqual(
    tracks.slice(0, 15).map((track, index) => [track.roonPath, "kitchen", index === 0])
  );
});

test("another client, an expired result or a changed recording cannot start playback", async () => {
  const response = rememberDiscovery("client-c", await discoverMusic("Enigma", "auto", setup()));
  const selection = { ids: [response.results[0].id], workOnly: false };
  await expect(playDiscovery("different-client", "office", selection)).rejects.toThrow("expired");
  await expect(playDiscovery("client-c", "office", { ids: ["unknown"], workOnly: false })).rejects.toThrow("expired");
  jest.mocked(importCinemaMusic).mockRejectedValue(new Error("Recording changed"));
  await expect(playDiscovery("client-c", "office", selection)).rejects.toThrow("Recording changed");
  expect(performMusicAction).not.toHaveBeenCalled();
  expect(playLocatedCinemaTrack).not.toHaveBeenCalled();
});
