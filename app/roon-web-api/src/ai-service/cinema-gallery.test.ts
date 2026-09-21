import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cinemaAlbumCover } from "../service/cinema-artwork";
import { openaiKeyStore } from "../service/openai-key-store";
import { attachRoonAlbumCovers, illustrateArtistGallery, isArtistGallery } from "./cinema-gallery";
import { photographMatchesScene, readCapsule, startCapsule, TimeCapsule, validateCapsuleRequest } from "./time-capsule";

jest.mock("../service/cinema-artwork", () => ({ cinemaAlbumCover: jest.fn() }));

const request = () =>
  validateCapsuleRequest({
    query: "Bowie greatest hits",
    requestedAt: "2026-09-18T12:00:00Z",
    locale: "en_GB",
    timeZone: "Europe/London",
    tracks: [{ artist: "David Bowie", track: "Changes", album: "Hunky Dory" }],
    options: {
      mode: "artist",
      topics: ["artistImages", "career", "albumCovers"],
      subject: "David Bowie",
      region: "GB",
      workContext: "composition",
      captions: "brief",
      motion: "gentle",
      pace: "standard",
      order: "curated",
    },
  });
const reply = (value: unknown) => Promise.resolve(new Response(JSON.stringify(value)));

test("rebuilding prefers different archive pictures when alternatives exist", async () => {
  const input = request();
  if (input.options) input.options.topics = ["artistImages"];
  const candidates = Array.from({ length: 40 }, (_, index) => ({
    sourceUrl: `https://commons.wikimedia.org/wiki/File:David_Bowie_${index}.jpg`,
    downloadUrl: `https://upload.wikimedia.org/artist-${index}.jpg`,
    date: String(1970 + index),
    description: "David Bowie performing",
    credit: "Photographer",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  }));
  const previousSources = new Set(candidates.slice(0, 18).map((candidate) => candidate.sourceUrl));
  const capsule: TimeCapsule = {
    id: "gallery",
    request: input,
    title: "Bowie",
    contextLabel: "Bowie",
    createdAt: "2026-09-18T12:00:00Z",
    scenes: [],
  };
  await illustrateArtistGallery(capsule, {
    previousSources,
    search: () => Promise.resolve(candidates),
    eligible: (candidate) => candidate,
    matches: () => true,
    save: (candidate) => Promise.resolve({ ...candidate, file: candidate.downloadUrl }),
    review: () => Promise.resolve(),
  });
  expect(capsule.scenes).toHaveLength(18);
  expect(capsule.scenes.every((scene) => !previousSources.has(scene.sources[0].url))).toBe(true);
});

test("Commodores galleries keep band photographs and drop namesakes", async () => {
  const input = request();
  if (!input.options) throw new Error("Missing test options");
  input.options.subject = "Commodores";
  input.tracks = [{ artist: "Commodores", track: "Easy", album: "Commodores" }];
  const candidates = [
    {
      sourceUrl: "https://commons.wikimedia.org/wiki/File:The_Commodores_1970s_(Motown_publicity_photo).jpg",
      downloadUrl: "https://upload.wikimedia.org/commodores-publicity.jpg",
      date: "1975",
      description: "1970s publicity photo of The Commodores.",
      credit: "Motown Records",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    },
    {
      sourceUrl: "https://commons.wikimedia.org/wiki/File:1904Vandy.jpg",
      downloadUrl: "https://upload.wikimedia.org/vandy-football.jpg",
      date: "1904",
      description: "1904 Vanderbilt Commodores football team, the first one coached by Dan McGugin.",
      credit: "Unknown",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    },
    {
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Commodores_at_U.S._Capitol_(9301976684).jpg",
      downloadUrl: "https://upload.wikimedia.org/navy-commodores.jpg",
      date: "2013",
      description: "U.S. Navy photo by Musician 1st Class Jeremy Buckler/Released",
      credit: "United States Navy Band",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    },
    {
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Commodores_Tour_(22657483656).jpg",
      downloadUrl: "https://upload.wikimedia.org/navy-tour.jpg",
      date: "2015",
      description:
        "151029-N-HA868-047 EVANSTON, Ill. Musician 1st Class Kevin McDonald. The Commodores are currently on an 18-day concert tour.",
      credit: "United States Navy Band from Washington, D.C., USA",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    },
    {
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Holden_Commodore_Berlina_(3).jpg",
      downloadUrl: "https://upload.wikimedia.org/holden-commodore.jpg",
      date: "2011",
      description:
        "Another VK Commodore. Berlina is a mid level specification. Like many Commodores this one has received a few visual modifications.",
      credit: "FotoSleuth",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    },
    {
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Motown_7%22_Single_(Side_1).jpg",
      downloadUrl: "https://upload.wikimedia.org/motown-single.jpg",
      date: "2023",
      description: 'Side 1 (A-side) of a Motown 7" Single, containing "Nightshift" by the Commodores.',
      credit: "DiscoA340",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    },
  ];
  const capsule: TimeCapsule = {
    id: "commodores",
    request: input,
    title: "Commodores",
    contextLabel: "Commodores",
    createdAt: "2026-09-20T15:00:00Z",
    scenes: [],
  };
  await illustrateArtistGallery(capsule, {
    search: () => Promise.resolve(candidates),
    eligible: (candidate) => candidate,
    matches: photographMatchesScene,
    save: (candidate) => Promise.resolve({ ...candidate, file: candidate.downloadUrl }),
    review: () => Promise.resolve(),
  });
  expect(capsule.scenes.map((scene) => scene.sources[0].url)).toEqual([candidates[0].sourceUrl]);
});

test("direct galleries cover artist pictures, career photos and covers; dated or wider stories retain research", () => {
  const input = request();
  expect(isArtistGallery(input)).toBe(true);
  expect(
    isArtistGallery({
      ...input,
      tracks: [{ artist: "Queen", track: "Bohemian Rhapsody", album: "" }],
    })
  ).toBe(false);
  expect(
    isArtistGallery({
      ...input,
      tracks: [...input.tracks, { artist: "Another artist", album: "", track: "Song" }],
    })
  ).toBe(false);
  const options = input.options;
  if (!options) throw new Error("Missing test options");
  expect(
    isArtistGallery({
      ...input,
      options: { ...options, subject: "Commodores" },
      tracks: [{ artist: "Commodores", track: "Three Times a Lady", album: "Natural High" }],
    })
  ).toBe(true);
  expect(
    isArtistGallery({
      ...input,
      options: { ...options, subject: "Bowie greatest hits" },
    })
  ).toBe(true);
  expect(
    isArtistGallery({
      ...input,
      options: { ...options, subject: "David Bowie in Berlin" },
    })
  ).toBe(false);
  expect(
    isArtistGallery({
      ...input,
      options: { ...options, topics: ["historicalContext"] },
    })
  ).toBe(false);
  expect(isArtistGallery({ ...input, options: { ...options, mode: "work" } })).toBe(false);
  expect(
    isArtistGallery({
      ...input,
      options: {
        ...options,
        periodStart: "1970-01-01",
        periodEnd: "1980-12-31",
      },
    })
  ).toBe(false);
});

test("uses one Roon cover for each distinct selected album", async () => {
  const capsule: TimeCapsule = {
    id: "covers",
    request: {
      ...request(),
      tracks: [
        { artist: "David Bowie", track: "Changes", album: "Hunky Dory" },
        { artist: "David Bowie", track: "Life on Mars?", album: "Hunky Dory" },
        { artist: "David Bowie", track: "Heroes", album: "Heroes" },
      ],
    },
    title: "Bowie",
    contextLabel: "Bowie",
    createdAt: "",
    scenes: [],
  };
  await attachRoonAlbumCovers(capsule, (track) =>
    Promise.resolve({
      file: track.album,
      sourceUrl: "https://roon.app/",
      credit: track.artist,
      license: "Artwork supplied by Roon",
      licenseUrl: "https://roon.app/",
      date: "Album artwork",
      description: track.album,
    })
  );
  expect(capsule.scenes.map((scene) => scene.title)).toEqual(["David Bowie — Hunky Dory", "David Bowie — Heroes"]);
  expect(capsule.scenes.every((scene) => scene.topic === "albumCovers")).toBe(true);
});

test("a complete Bowie gallery searches archives directly and only uses AI to check the downloaded photos", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cinema-gallery-test-"));
  const previous = process.env.TIME_CAPSULE_CACHE_DIR;
  process.env.TIME_CAPSULE_CACHE_DIR = directory;
  jest.spyOn(openaiKeyStore, "read").mockReturnValue("test-key");
  const coverBytes = Buffer.from([0xff, 0xd8, ...Array<number>(30).fill(0)]);
  jest.mocked(cinemaAlbumCover).mockResolvedValue({ imageKey: "roon-hunky-dory", image: coverBytes });
  let reviews = 0;
  let searches = 0;
  jest.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "commons.wikimedia.org") {
      searches++;
      const query = url.searchParams.get("gsrsearch") ?? "";
      expect(query).not.toContain("album cover");
      expect(query).toContain("filetype:bitmap");
      const concert = query.includes("concert");
      const type = concert ? "concert" : "portrait";
      const pages = Array.from({ length: 4 }, (_, index) => ({
        imageinfo: [
          {
            url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/David_Bowie_${type}_${index}.jpg`,
            descriptionurl: `https://commons.wikimedia.org/wiki/File:David_Bowie_${type}_${index}.jpg`,
            mime: "image/jpeg",
            width: 1920,
            extmetadata: {
              LicenseShortName: { value: "CC BY 4.0" },
              LicenseUrl: {
                value: "https://creativecommons.org/licenses/by/4.0/",
              },
              Artist: { value: "Archive photographer" },
              DateTimeOriginal: { value: String(1971 + index) },
              ImageDescription: {
                value:
                  index === 3
                    ? "David Bowie tribute band"
                    : concert
                      ? "David Bowie performing in London"
                      : "David Bowie portrait",
              },
            },
          },
        ],
      }));
      return reply({
        query: {
          pages: Object.fromEntries(pages.map((page, index) => [String(index), page])),
        },
      });
    }
    if (url.hostname === "upload.wikimedia.org") {
      const bytes = new Uint8Array(64);
      bytes[0] = 0xff;
      return Promise.resolve(new Response(bytes, { headers: { "Content-Type": "image/jpeg" } }));
    }
    if (url.hostname === "api.openai.com") {
      const body = JSON.parse(init?.body as string) as {
        tools?: unknown;
        reasoning?: unknown;
        input: { content: { type: string; text?: string }[] }[];
      };
      expect(body.tools).toBeUndefined();
      expect(body.reasoning).toEqual({ effort: "low" });
      expect(Array.isArray(body.input)).toBe(true);
      const ids = body.input[0].content
        .filter((part) => part.type === "input_text")
        .map((part) => (JSON.parse(part.text ?? "{}") as { photoId?: string }).photoId)
        .filter(Boolean);
      reviews++;
      return reply({
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ acceptedPhotoIds: ids }),
              },
            ],
          },
        ],
      });
    }
    return Promise.reject(new Error(`Unexpected gallery request: ${url.hostname}`));
  });
  try {
    const job = await startCapsule(request());
    for (let attempt = 0; attempt < 200 && !["ready", "failed"].includes(job.status); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(job.error).toBeUndefined();
    expect(job.status).toBe("ready");
    expect(searches).toBe(2);
    expect(reviews).toBe(2);
    expect(job.capsule?.scenes).toHaveLength(7);
    expect(cinemaAlbumCover).toHaveBeenCalledWith(request().tracks[0]);
    const cover = job.capsule?.scenes.find((scene) => scene.topic === "albumCovers");
    expect(cover?.image?.license).toBe("Artwork supplied by Roon");
    expect(await fs.readFile(path.join(directory, `${cover?.image?.file}.image`))).toEqual(coverBytes);
    expect(new Set(job.capsule?.scenes.map((scene) => scene.topic))).toEqual(
      new Set(["artistImages", "career", "albumCovers"])
    );
    expect(job.capsule?.scenes.find((scene) => scene.topic === "career")?.body).toBe(
      "David Bowie performing in London"
    );
    expect(
      job.capsule?.scenes
        .filter((scene) => scene.topic !== "albumCovers")
        .every((scene) => scene.sources[0].url.includes("commons.wikimedia.org"))
    ).toBe(true);
    expect((await readCapsule(job.id))?.generation).toBe(job.generation);
  } finally {
    jest.restoreAllMocks();
    if (previous === undefined) delete process.env.TIME_CAPSULE_CACHE_DIR;
    else process.env.TIME_CAPSULE_CACHE_DIR = previous;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("one-word artists use Wikipedia entity photos instead of a Commons namesake dump", async () => {
  const input = request();
  if (!input.options) throw new Error("Missing test options");
  input.options.subject = "Commodores";
  input.options.topics = ["artistImages"];
  input.tracks = [{ artist: "Commodores", track: "Easy", album: "Commodores" }];
  const entity = {
    sourceUrl: "https://commons.wikimedia.org/wiki/File:The_Commodores_1970s_(Motown_publicity_photo).jpg",
    downloadUrl: "https://upload.wikimedia.org/commodores-publicity.jpg",
    date: "1975",
    description: "1970s publicity photo of The Commodores.",
    credit: "Motown Records",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  };
  const football = {
    sourceUrl: "https://commons.wikimedia.org/wiki/File:1904Vandy.jpg",
    downloadUrl: "https://upload.wikimedia.org/vandy-football.jpg",
    date: "1904",
    description: "1904 Vanderbilt Commodores football team, the first one coached by Dan McGugin.",
    credit: "Unknown",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  };
  const search = jest.fn().mockResolvedValue([football]);
  const fallback = jest.fn().mockResolvedValue([entity]);
  const capsule: TimeCapsule = {
    id: "entity",
    request: input,
    title: "Commodores",
    contextLabel: "Commodores",
    createdAt: "2026-09-20T15:00:00Z",
    scenes: [],
  };
  await illustrateArtistGallery(capsule, {
    search,
    fallbackSearch: fallback,
    eligible: (candidate) => candidate,
    matches: photographMatchesScene,
    save: (candidate) => Promise.resolve({ ...candidate, file: candidate.downloadUrl }),
    review: () => Promise.resolve(),
  });
  expect(fallback).toHaveBeenCalledWith("Commodores");
  expect(search).not.toHaveBeenCalled();
  expect(capsule.scenes.map((scene) => scene.sources[0].url)).toEqual([entity.sourceUrl]);
});

test("uses other web image providers when Commons has no matching artist photos", async () => {
  const candidate = {
    sourceUrl: "https://www.flickr.com/photos/archive/123",
    downloadUrl: "https://live.staticflickr.com/123/bowie.jpg",
    date: "1976",
    description: "David Bowie performing",
    credit: "Photographer",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  };
  const input = request();
  if (input.options) input.options.topics = ["artistImages"];
  const capsule: TimeCapsule = {
    id: "fallback",
    request: input,
    title: "Bowie",
    contextLabel: "Bowie",
    createdAt: "",
    scenes: [],
  };
  const fallback = jest.fn().mockResolvedValue([candidate]);
  const review = jest.fn().mockResolvedValue(undefined);
  await illustrateArtistGallery(capsule, {
    search: () => Promise.resolve([{ ...candidate, description: "Unrelated subject" }]),
    fallbackSearch: fallback,
    eligible: (image) => image,
    matches: (_scene, image) => image.description.includes("David Bowie"),
    save: (image) => Promise.resolve({ ...image, file: "downloaded-photo" }),
    review,
  });
  expect(fallback).toHaveBeenCalledWith('"David Bowie"');
  expect(capsule.scenes[0]?.image?.sourceUrl).toBe(candidate.sourceUrl);
  expect(review).toHaveBeenCalledWith(capsule);
});

test("cover lookup has a total budget, clears timers, and removes web covers even on failure", async () => {
  jest.useFakeTimers();
  try {
    const capsule: TimeCapsule = {
      id: "bounded",
      request: request(),
      title: "Bowie",
      contextLabel: "Bowie",
      createdAt: "",
      scenes: [
        {
          id: "web-cover",
          title: "Wrong web cover",
          body: "",
          dateLabel: "",
          scope: "Music",
          topic: "albumCovers",
          sources: [],
          trackIndices: [],
        },
      ],
    };
    const pending = attachRoonAlbumCovers(capsule, () => new Promise(() => undefined), 30);
    await jest.advanceTimersByTimeAsync(30);
    await pending;
    expect(capsule.scenes).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test.each(["artist", "period", "work"])(
  "a single-album %s cover montage needs neither AI nor web research",
  async (mode) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cinema-covers-only-"));
    const previous = process.env.TIME_CAPSULE_CACHE_DIR;
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.TIME_CAPSULE_CACHE_DIR = directory;
    delete process.env.OPENAI_API_KEY;
    jest.spyOn(openaiKeyStore, "read").mockReturnValue("");
    const fetchMock = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Must not use the web"));
    jest
      .mocked(cinemaAlbumCover)
      .mockResolvedValue({ imageKey: "single-album", image: Buffer.from([0xff, 0xd8, ...Array<number>(30).fill(0)]) });
    try {
      const input = request();
      const job = await startCapsule(
        validateCapsuleRequest({ ...input, options: { ...input.options, mode, topics: ["albumCovers"] } })
      );
      for (let attempt = 0; attempt < 200 && !["ready", "failed"].includes(job.status); attempt++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(job.error).toBeUndefined();
      expect(job.status).toBe("ready");
      expect(job.capsule?.scenes).toHaveLength(1);
      expect(job.capsule?.scenes[0].topic).toBe("albumCovers");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
      if (previous === undefined) delete process.env.TIME_CAPSULE_CACHE_DIR;
      else process.env.TIME_CAPSULE_CACHE_DIR = previous;
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
);
