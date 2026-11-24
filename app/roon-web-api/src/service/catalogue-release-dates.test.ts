import { catalogueReleaseDates } from "./catalogue-release-dates";

jest.mock("@infrastructure", () => ({ logger: { debug: jest.fn() } }));

const candidate = { title: "The Moon & The Forest", artist: "Miloš Karadaglić", trackCount: 12 };
const album = {
  wrapperType: "collection",
  collectionType: "Album",
  collectionName: "The Moon & The Forest",
  artistName: "Milos Karadaglic",
  trackCount: 12,
  releaseDate: "2021-04-30T07:00:00Z",
  collectionViewUrl: "https://music.apple.com/gb/album/the-moon-the-forest/1554073927",
};
const response = (results: unknown[]) => new Response(JSON.stringify({ results }));
afterEach(() => jest.restoreAllMocks());

test("gets dates from an exact catalogue album and shares an artist search", async () => {
  const fetch = jest.spyOn(global, "fetch").mockResolvedValue(response([album]));
  const releases = await catalogueReleaseDates([candidate, { ...candidate, title: "Unknown" }]);
  expect(releases).toEqual([
    {
      title: candidate.title,
      artist: candidate.artist,
      releaseDate: "2021-04-30",
      recordingDate: "",
      reissue: false,
      source: album.collectionViewUrl,
      trackCount: album.trackCount,
    },
  ]);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("a work search finds dates beyond the first five performers", async () => {
  const fetch = jest.spyOn(global, "fetch").mockImplementation((input) => {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    const term = url.searchParams.get("term");
    return Promise.resolve(response(term === "the moon the forest" ? [album] : []));
  });
  const candidates = Array.from({ length: 8 }, (_, index) => ({ ...candidate, artist: `Other Artist ${index}` }));
  const releases = await catalogueReleaseDates([...candidates, candidate], ["The Moon & The Forest"]);
  expect(releases).toHaveLength(1);
  expect(releases[0].artist).toBe(candidate.artist);
  expect(fetch).toHaveBeenCalledTimes(5);
});

test.each([
  { artistName: "Another Guitarist" },
  { collectionName: "The Moon & The Forest (Deluxe)" },
  { releaseDate: "2021-02-30T08:00:00Z" },
  { releaseDate: "2999-04-30T08:00:00Z" },
  { releaseDate: "2021" },
  { collectionViewUrl: "https://unverified.example/album" },
])("rejects mismatched or ambiguous catalogue metadata (%j)", async (change) => {
  jest.spyOn(global, "fetch").mockResolvedValue(response([{ ...album, ...change }]));
  await expect(catalogueReleaseDates([candidate])).resolves.toEqual([]);
});

test("uses the common year when matching catalogue editions disagree on the day", async () => {
  jest.spyOn(global, "fetch").mockResolvedValue(response([album, { ...album, releaseDate: "2021-05-07T07:00:00Z" }]));
  expect((await catalogueReleaseDates([candidate]))[0]?.releaseDate).toBe("2021");
});

test.each([{ trackCount: 18 }, { releaseDate: "2021-01-01T08:00:00Z" }])(
  "preserves the year when catalogue precision is uncertain (%j)",
  async (change) => {
    jest.spyOn(global, "fetch").mockResolvedValue(response([{ ...album, ...change }]));
    expect((await catalogueReleaseDates([candidate]))[0]?.releaseDate).toBe("2021");
  }
);

test("rejects catalogue editions with conflicting release years", async () => {
  jest.spyOn(global, "fetch").mockResolvedValue(response([album, { ...album, releaseDate: "2022-05-07T07:00:00Z" }]));
  await expect(catalogueReleaseDates([candidate])).resolves.toEqual([]);
});

test("matches a single with slash-separated Roon performer credits", async () => {
  jest.spyOn(global, "fetch").mockResolvedValue(
    response([
      {
        ...album,
        collectionName: "Sicilienne - Single",
        artistName: "Cocomi & Milos Karadaglic",
        trackCount: 1,
      },
    ])
  );
  const releases = await catalogueReleaseDates([
    { title: "Sicilienne", artist: "Cocomi / Milos Karadaglic", trackCount: 1 },
  ]);
  expect(releases).toHaveLength(1);
});

test("a failed catalogue lookup permits web research to fill the gaps", async () => {
  jest.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
  await expect(catalogueReleaseDates([candidate])).resolves.toEqual([]);
});

test("does not look up an empty catalogue result", async () => {
  const fetch = jest.spyOn(global, "fetch");
  await expect(catalogueReleaseDates([])).resolves.toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});
