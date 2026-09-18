import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cinemaAlbumCover } from "../service/cinema-artwork";
import { openaiKeyStore } from "../service/openai-key-store";
import { attachRoonAlbumCovers, illustrateArtistGallery, isArtistGallery } from "./cinema-gallery";
import { readCapsule, startCapsule, TimeCapsule, validateCapsuleRequest } from "./time-capsule";

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
      expect(body.reasoning).toBeUndefined();
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
