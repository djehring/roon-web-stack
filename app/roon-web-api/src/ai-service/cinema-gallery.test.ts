import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openaiKeyStore } from "../service/openai-key-store";
import { illustrateArtistGallery, isArtistGallery } from "./cinema-gallery";
import {
  readCapsule,
  startCapsule,
  TimeCapsule,
  validateCapsuleRequest,
} from "./time-capsule";

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
const reply = (value: unknown) =>
  Promise.resolve(new Response(JSON.stringify(value)));

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
  const previousSources = new Set(
    candidates.slice(0, 18).map((candidate) => candidate.sourceUrl)
  );
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
    save: (candidate) =>
      Promise.resolve({ ...candidate, file: candidate.downloadUrl }),
    review: () => Promise.resolve(),
  });
  expect(capsule.scenes).toHaveLength(18);
  expect(
    capsule.scenes.every((scene) => !previousSources.has(scene.sources[0].url))
  ).toBe(true);
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
      tracks: [
        ...input.tracks,
        { artist: "Another artist", album: "", track: "Song" },
      ],
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
  expect(
    isArtistGallery({ ...input, options: { ...options, mode: "work" } })
  ).toBe(false);
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

test("a complete Bowie gallery searches archives directly and only uses AI to check the downloaded photos", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "cinema-gallery-test-")
  );
  const previous = process.env.TIME_CAPSULE_CACHE_DIR;
  process.env.TIME_CAPSULE_CACHE_DIR = directory;
  jest.spyOn(openaiKeyStore, "read").mockReturnValue("test-key");
  let reviews = 0;
  let searches = 0;
  jest.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    );
    if (url.hostname === "commons.wikimedia.org") {
      searches++;
      const query = url.searchParams.get("gsrsearch") ?? "";
      const cover = query.includes("album cover");
      const concert = query.includes("concert");
      const type = cover
        ? "Hunky_Dory_album_cover"
        : concert
          ? "concert"
          : "portrait";
      const pages = Array.from({ length: cover ? 1 : 4 }, (_, index) => ({
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
                    : cover
                      ? "David Bowie Hunky Dory album cover"
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
          pages: Object.fromEntries(
            pages.map((page, index) => [String(index), page])
          ),
        },
      });
    }
    if (url.hostname === "upload.wikimedia.org") {
      const bytes = new Uint8Array(64);
      bytes[0] = 0xff;
      return Promise.resolve(
        new Response(bytes, { headers: { "Content-Type": "image/jpeg" } })
      );
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
        .map(
          (part) =>
            (JSON.parse(part.text ?? "{}") as { photoId?: string }).photoId
        )
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
    return Promise.reject(
      new Error(`Unexpected gallery request: ${url.hostname}`)
    );
  });
  try {
    const job = await startCapsule(request());
    for (
      let attempt = 0;
      attempt < 200 && !["ready", "failed"].includes(job.status);
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(job.error).toBeUndefined();
    expect(job.status).toBe("ready");
    expect(searches).toBe(3);
    expect(reviews).toBe(3);
    expect(job.capsule?.scenes).toHaveLength(7);
    expect(new Set(job.capsule?.scenes.map((scene) => scene.topic))).toEqual(
      new Set(["albumCovers", "artistImages", "career"])
    );
    expect(
      job.capsule?.scenes.find((scene) => scene.topic === "career")?.body
    ).toBe("David Bowie performing in London");
    expect(
      job.capsule?.scenes.every((scene) =>
        scene.sources[0].url.includes("commons.wikimedia.org")
      )
    ).toBe(true);
    expect((await readCapsule(job.id))?.generation).toBe(job.generation);
  } finally {
    jest.restoreAllMocks();
    if (previous === undefined) delete process.env.TIME_CAPSULE_CACHE_DIR;
    else process.env.TIME_CAPSULE_CACHE_DIR = previous;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
