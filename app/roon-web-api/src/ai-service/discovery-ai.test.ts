import { catalogueReleaseDates } from "../service/catalogue-release-dates";
import { DiscoveryIntent, interpretDiscovery, ReleaseEvidence, researchReleases } from "./discovery-ai";

jest.mock("./chatgpt", () => ({ resolveOpenAIApiKey: () => "test-only" }));
jest.mock("@infrastructure", () => ({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() } }));
jest.mock("../service/catalogue-release-dates", () => ({ catalogueReleaseDates: jest.fn() }));

const candidate = { title: "The Moon & The Forest", artist: "Miloš Karadaglić" };
const source = "https://label.example/the-moon-and-the-forest";
const release: ReleaseEvidence = {
  ...candidate,
  releaseDate: "2021-04-30",
  recordingDate: "",
  reissue: false,
  source,
};

function researchResponse(
  releases: (ReleaseEvidence & { sourceTitle?: string })[],
  sources = [source],
  status = "completed"
) {
  return new Response(
    JSON.stringify({
      status,
      output: [
        { type: "web_search_call", action: { sources: sources.map((url) => ({ url })) } },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                releases: releases.map((release) => ({ sourceTitle: release.title, ...release })),
              }),
            },
          ],
        },
      ],
    })
  );
}

afterEach(() => jest.restoreAllMocks());
beforeEach(() => jest.mocked(catalogueReleaseDates).mockReset().mockResolvedValue([]));

function interpretation(request: Record<string, unknown>) {
  return jest.spyOn(global, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ request }) }] }],
      })
    )
  );
}
const today = new Date(2026, 10, 24, 9);

test.each(["auto", "albums"] as const)("%s keeps collections separate from movement counts", async (mode) => {
  interpretation({
    kind: "classical",
    mode: "albums",
    terms: ["Brandenburg Concertos"],
    composer: "Johann Sebastian Bach",
    work: "Brandenburg Concertos",
    workScope: "collection",
    workAliases: [],
    movement: "",
    movementCount: 6,
    performers: [],
    recent: false,
    limit: 10,
  });
  await expect(interpretDiscovery("Brandenburg concerto", mode)).resolves.toMatchObject({
    kind: "classical",
    mode: "albums",
    work: "Brandenburg Concertos",
    workScope: "collection",
    movementCount: 0,
    tracks: [],
  });
});

test("a chart request carries only its week and size, resolved against today's date", async () => {
  const fetch = interpretation({ kind: "chart", date: "1985-11-24", count: 10 });
  const intent: DiscoveryIntent = await interpretDiscovery("uk top ten from this week in 1985", "auto", today);
  expect(intent).toMatchObject({
    kind: "chart",
    chart: { date: "1985-11-24", count: 10 },
    mode: "tracks",
    limit: 10,
    work: "",
    workScope: "none",
    terms: [],
  });
  const body = JSON.parse(fetch.mock.calls[0][1]?.body as string) as { input: string };
  expect(JSON.parse(body.input)).toEqual({
    query: "uk top ten from this week in 1985",
    mode: "auto",
    today: "2026-11-24",
  });
});

test("a top 40 is not truncated to the ordinary result limit", async () => {
  interpretation({ kind: "chart", date: "1973-03-15", count: 75 });
  await expect(interpretDiscovery("uk top 75 march 1973", "auto", today)).resolves.toMatchObject({
    chart: { date: "1973-03-15", count: 40 },
    limit: 40,
  });
});

test.each(["2026-11-25", "1950-01-01", "1985-02-30", "this week"])(
  "a chart week of %s is refused rather than guessed",
  async (date) => {
    interpretation({ kind: "chart", date, count: 10 });
    await expect(interpretDiscovery("uk top ten", "auto", today)).rejects.toThrow("Name a chart week");
  }
);

test("songs carry no classical work fields and need no catalogue terms", async () => {
  const tracks = [{ artist: "Bill Evans", track: "Peace Piece", album: "Everybody Digs Bill Evans" }];
  interpretation({ kind: "tracks", tracks, recent: false, limit: 1 });
  await expect(interpretDiscovery("Peace Piece by Bill Evans", "auto")).resolves.toMatchObject({
    kind: "tracks",
    mode: "tracks",
    work: "",
    workScope: "none",
    movementCount: 0,
    tracks,
  });
});

test("an explicit Albums choice turns song suggestions into catalogue album searches", async () => {
  interpretation({
    kind: "tracks",
    tracks: [
      { artist: "Bill Evans", track: "Peace Piece", album: "Everybody Digs Bill Evans" },
      { artist: "Bill Evans", track: "Waltz for Debby", album: "" },
    ],
    recent: false,
    limit: 10,
  });
  await expect(interpretDiscovery("Bill Evans", "albums")).resolves.toMatchObject({
    kind: "albums",
    mode: "albums",
    terms: ["Everybody Digs Bill Evans", "Bill Evans"],
    tracks: [],
  });
});

test("a request that names no music is refused", async () => {
  interpretation({ kind: "albums", terms: [" "], performers: [], recent: false, limit: 10 });
  await expect(interpretDiscovery("play something", "auto")).rejects.toThrow("Please name some music");
  interpretation({ kind: "tracks", tracks: [], recent: false, limit: 10 });
  await expect(interpretDiscovery("play something", "auto")).rejects.toThrow("Please name some music");
});

test("uses exact catalogue dates without web research when coverage is complete", async () => {
  jest.mocked(catalogueReleaseDates).mockResolvedValue([release]);
  const fetch = jest.spyOn(global, "fetch");
  await expect(researchReleases("Milos", [candidate])).resolves.toEqual([release]);
  expect(fetch).not.toHaveBeenCalled();
});

test("keeps catalogue dates when web research of the remaining albums fails", async () => {
  jest.mocked(catalogueReleaseDates).mockResolvedValue([release]);
  jest.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
  await expect(researchReleases("Milos", [candidate, { ...candidate, title: "Another album" }])).resolves.toEqual([
    release,
  ]);
});

test("latest searches use enough catalogue dates without waiting for web research", async () => {
  jest.mocked(catalogueReleaseDates).mockResolvedValue([release]);
  const fetch = jest.spyOn(global, "fetch");
  await expect(
    researchReleases("latest Milos", [candidate], { recent: true, limit: 1, terms: ["Milos"] })
  ).resolves.toEqual([release]);
  expect(catalogueReleaseDates).toHaveBeenCalledWith([candidate], ["Milos"]);
  expect(fetch).not.toHaveBeenCalled();
});

test("latest searches preserve catalogue dates when optional web research fails", async () => {
  jest.mocked(catalogueReleaseDates).mockResolvedValue([release]);
  jest.spyOn(global, "fetch").mockRejectedValue(new Error("deadline"));
  await expect(
    researchReleases("latest Milos", [candidate, { ...candidate, title: "Unknown" }], { recent: true })
  ).resolves.toEqual([release]);
});

test("large latest pools preserve all catalogue dates and bound optional web research", async () => {
  const candidates = Array.from({ length: 80 }, (_, index) => ({ ...candidate, title: `Album ${index}` }));
  const dates = candidates.slice(0, 30).map((candidate) => ({ ...release, ...candidate }));
  jest.mocked(catalogueReleaseDates).mockResolvedValue(dates);
  const fetch = jest.spyOn(global, "fetch");
  await expect(researchReleases("latest", candidates, { recent: true })).resolves.toEqual(dates);
  expect(fetch).not.toHaveBeenCalled();
  jest.mocked(catalogueReleaseDates).mockResolvedValue([]);
  fetch.mockResolvedValue(researchResponse([]));
  await expect(researchReleases("latest", candidates, { recent: true })).resolves.toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(4);
});

test("keeps sourced release dates directly from research without another interpretation step", async () => {
  const fetch = jest.spyOn(global, "fetch").mockResolvedValue(researchResponse([release]));
  await expect(researchReleases("Milos Karadaglic", [candidate])).resolves.toEqual([release]);
  expect(fetch).toHaveBeenCalledTimes(1);
  const request = JSON.parse(fetch.mock.calls[0][1]?.body as string) as {
    text: { format: { type: string; strict: boolean } };
    include: string[];
  };
  expect(request.text.format).toMatchObject({ type: "json_schema", strict: true });
  expect(request.include).toContain("web_search_call.action.sources");
});

test("rejects uncited, mismatched, incomplete, invalid and future release dates", async () => {
  jest
    .spyOn(global, "fetch")
    .mockResolvedValue(
      researchResponse([
        release,
        { ...release, source: "https://unverified.example/album" },
        { ...release, title: "Another album" },
        { ...release, artist: "Another guitarist" },
        { ...release, releaseDate: "2021-04" },
        { ...release, releaseDate: "2021-02-30" },
        { ...release, releaseDate: "2999-01-01" },
      ])
    );
  await expect(researchReleases("Milos Karadaglic", [candidate])).resolves.toEqual([release]);
});

test("an unknown recording date does not discard a verified release date", async () => {
  jest.spyOn(global, "fetch").mockResolvedValue(researchResponse([{ ...release, recordingDate: "2020" }]));
  await expect(researchReleases("Milos Karadaglic", [candidate])).resolves.toEqual([release]);
});

test("a source about a parent album cannot date a separately released single", async () => {
  const single = { ...release, title: "Sour Times" };
  jest.spyOn(global, "fetch").mockResolvedValue(researchResponse([{ ...single, sourceTitle: "Sound of Silence" }]));
  await expect(researchReleases("Milos", [single])).resolves.toEqual([]);
});

test("a music video source cannot date an audio release", async () => {
  const video = { ...release, source: "https://tidal.com/video/123" };
  jest.spyOn(global, "fetch").mockResolvedValue(researchResponse([video], [video.source]));
  await expect(researchReleases("Milos", [candidate])).resolves.toEqual([]);
});

test("a source may label the same release as an EP or single", async () => {
  const ep = { ...release, title: "Guitar Covers" };
  jest.spyOn(global, "fetch").mockResolvedValue(researchResponse([{ ...ep, sourceTitle: "Guitar Covers - EP" }]));
  await expect(researchReleases("Milos", [ep])).resolves.toEqual([ep]);
});

test.each([
  ["Latino", "MILOŠ KARADAGLIĆ Latino"],
  ["Mediterráneo", "MILOŠ KARADAGLIĆ Mediterráneo CD + DVD"],
  ["Blackbird: The Beatles Album", "Blackbird - The Beatles Album: CD"],
])("accepts artist and format decorations around %s on label pages", async (title, sourceTitle) => {
  const album = { ...release, title };
  jest.spyOn(global, "fetch").mockResolvedValue(researchResponse([{ ...album, sourceTitle }]));
  await expect(researchReleases("Milos", [album])).resolves.toEqual([album]);
});

test.each([
  ["Latino", "MILOŠ KARADAGLIĆ Latino Gold"],
  ["Latino Gold", "MILOŠ KARADAGLIĆ Latino CD"],
  ["Blackbird: The Beatles Album", "Blackbird - The Beatles Album Deluxe CD"],
])("rejects different editions of %s despite artist or format decorations", async (title, sourceTitle) => {
  const album = { ...release, title };
  jest.spyOn(global, "fetch").mockResolvedValue(researchResponse([{ ...album, sourceTitle }]));
  await expect(researchReleases("Milos", [album])).resolves.toEqual([]);
});

test("does not claim dates without research sources", async () => {
  jest.spyOn(global, "fetch").mockResolvedValue(researchResponse([release], []));
  await expect(researchReleases("Milos Karadaglic", [candidate])).resolves.toEqual([]);
});

test("does not call research when no playable candidates were found", async () => {
  const fetch = jest.spyOn(global, "fetch");
  await expect(researchReleases("Milos Karadaglic", [])).resolves.toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

test("incomplete research fails explicitly instead of accepting partial dates", async () => {
  jest.spyOn(global, "fetch").mockResolvedValue(researchResponse([release], [source], "incomplete"));
  await expect(researchReleases("Milos Karadaglic", [candidate])).rejects.toThrow("did not finish");
});

test("research supports twenty album results without truncating dates at twelve", async () => {
  const releases = Array.from({ length: 20 }, (_, index) => ({ ...release, title: `Album ${index}` }));
  const fetch = jest.spyOn(global, "fetch").mockImplementation(() => Promise.resolve(researchResponse(releases)));
  await expect(researchReleases("Milos albums", releases)).resolves.toEqual(releases);
  expect(fetch).toHaveBeenCalledTimes(4);
});

test("a failed research group does not discard dates from other albums", async () => {
  const releases = Array.from({ length: 6 }, (_, index) => ({ ...release, title: `Album ${index}` }));
  jest
    .spyOn(global, "fetch")
    .mockRejectedValueOnce(new Error("Connection lost"))
    .mockResolvedValueOnce(researchResponse([releases[5]]));
  await expect(researchReleases("Milos albums", releases)).resolves.toEqual([releases[5]]);
});
