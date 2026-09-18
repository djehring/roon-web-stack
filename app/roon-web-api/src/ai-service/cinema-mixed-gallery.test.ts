import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cinemaAlbumCover } from "../service/cinema-artwork";
import { openaiKeyStore } from "../service/openai-key-store";
import { artistGalleryRequest } from "./cinema-gallery";
import { startCapsule, validateCapsuleRequest } from "./time-capsule";

jest.mock("../service/cinema-artwork", () => ({ cinemaAlbumCover: jest.fn() }));
const source = "https://example.org/archive/karekare";
const request = () =>
  validateCapsuleRequest({
    query: "Crowded House greatest hits",
    requestedAt: "2026-09-18T16:00:00Z",
    locale: "en_GB",
    timeZone: "Europe/London",
    tracks: [{ artist: "Crowded House", track: "Weather With You", album: "Recurring Dream" }],
    options: {
      mode: "artist",
      topics: ["artistImages", "career", "places", "albumCovers"],
      subject: "Crowded House",
      region: "GB",
      workContext: "composition",
      captions: "brief",
      motion: "gentle",
      pace: "standard",
      order: "curated",
    },
  });
const response = (value: unknown) => new Response(JSON.stringify(value));
const output = (value: unknown) =>
  response({
    status: "completed",
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: typeof value === "string" ? value : JSON.stringify(value),
            annotations: [{ type: "url_citation", url: source }],
          },
        ],
      },
    ],
  });

test("extra topics keep direct artist pictures, but dates and a narrower subject retain research", () => {
  const input = request();
  expect(artistGalleryRequest(input)?.options?.topics).toEqual(["artistImages", "career"]);
  expect(
    artistGalleryRequest(
      validateCapsuleRequest({
        ...input,
        options: { ...input.options, periodStart: "1986-01-01", periodEnd: "1990-12-31" },
      })
    )
  ).toBeUndefined();
  expect(
    artistGalleryRequest(
      validateCapsuleRequest({ ...input, options: { ...input.options, subject: "Crowded House in Melbourne" } })
    )
  ).toBeUndefined();
});

test("a mixed artist montage researches only places once, and saves web photos plus its Roon cover", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cinema-mixed-"));
  const previous = process.env.TIME_CAPSULE_CACHE_DIR;
  process.env.TIME_CAPSULE_CACHE_DIR = directory;
  jest.spyOn(openaiKeyStore, "read").mockReturnValue("test-key");
  jest
    .mocked(cinemaAlbumCover)
    .mockResolvedValue({ imageKey: "recurring-dream", image: Buffer.from([0xff, 0xd8, ...Array<number>(30).fill(0)]) });
  const researchTopics: string[] = [];
  const stages: string[] = [];
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    await Promise.resolve();
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "api.openai.com") {
      const body = JSON.parse(init?.body as string) as {
        instructions: string;
        tools?: unknown;
        input: string | { content: { type: string; text?: string }[] }[];
      };
      stages.push(body.instructions);
      if (typeof body.input !== "string") {
        expect(body.instructions).toContain("A missing or approximate photo date is acceptable");
        const ids = body.input[0].content
          .filter((part) => part.type === "input_text")
          .map((part) => (JSON.parse(part.text ?? "{}") as { photoId?: string }).photoId)
          .filter(Boolean);
        return output({ acceptedPhotoIds: ids });
      }
      const data = JSON.parse(body.input.replace(/^Return JSON for this data:\n/, "")) as {
        topic?: string;
        headlines?: { id: string }[];
        candidates?: { photoId: string }[];
      };
      if (body.tools) {
        expect(data.topic).toBe("places");
        researchTopics.push(data.topic ?? "");
        return output("The band recorded at Karekare Beach. Source: " + source);
      }
      if (body.instructions.startsWith("Return JSON {searches:"))
        return output({ searches: [{ sceneId: data.headlines?.[0].id, queries: ["Karekare Beach"] }] });
      if (body.instructions.startsWith("Select photographs"))
        return output({
          matches: [
            {
              sceneId: data.headlines?.[0].id,
              photoIds: data.candidates?.map((candidate) => candidate.photoId).slice(0, 3),
            },
          ],
        });
      return output({
        title: "Crowded House",
        contextLabel: "Crowded House",
        scenes: [
          {
            title: "Karekare Beach",
            body: "The band recorded here.",
            dateLabel: "",
            scope: "Music",
            topic: "places",
            imageSubjects: ["Karekare Beach"],
            sources: [{ title: "Archive", url: source }],
            trackIndices: [],
          },
        ],
      });
    }
    if (url.hostname === "commons.wikimedia.org") {
      const query = url.searchParams.get("gsrsearch") ?? "";
      const place = query.includes("Karekare");
      const subject = place ? "Karekare Beach" : "Crowded House";
      const type = place ? "place" : query.includes("concert") ? "concert" : "portrait";
      return response({
        query: {
          pages: Object.fromEntries(
            Array.from({ length: 6 }, (_, index) => [
              String(index),
              {
                imageinfo: [
                  {
                    url: `https://upload.wikimedia.org/${type}-${index}.jpg`,
                    descriptionurl: `https://commons.wikimedia.org/wiki/File:${subject}_${type}_${index}.jpg`,
                    mime: "image/jpeg",
                    width: 1920,
                    extmetadata: {
                      LicenseShortName: { value: "CC BY 4.0" },
                      LicenseUrl: { value: "https://creativecommons.org/licenses/by/4.0/" },
                      Artist: { value: "Archive photographer" },
                      ImageDescription: { value: subject },
                      DateTimeOriginal: { value: "Date not recorded" },
                    },
                  },
                ],
              },
            ])
          ),
        },
      });
    }
    if (url.hostname === "upload.wikimedia.org")
      return new Response(Buffer.from([0xff, 0xd8, ...Array<number>(30).fill(0)]), {
        headers: { "Content-Type": "image/jpeg" },
      });
    throw new Error(`Unexpected host: ${url.hostname}`);
  });
  try {
    const job = await startCapsule(request());
    for (let i = 0; i < 200 && !["ready", "failed"].includes(job.status); i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(job.error).toBeUndefined();
    expect(job.status).toBe("ready");
    expect(researchTopics).toEqual(["places"]);
    expect(stages.some((instructions) => instructions.startsWith("Independently verify"))).toBe(false);
    expect(new Set(job.capsule?.scenes.map((scene) => scene.topic))).toEqual(
      new Set(["artistImages", "career", "places", "albumCovers"])
    );
    expect(new Set(job.capsule?.scenes.flatMap((scene) => scene.images?.map((image) => image.file) ?? [])).size).toBe(
      16
    );
    const covers = job.capsule?.scenes.filter((scene) => scene.topic === "albumCovers");
    expect(covers?.[0].image?.license).toBe("Artwork supplied by Roon");
  } finally {
    jest.restoreAllMocks();
    if (previous === undefined) delete process.env.TIME_CAPSULE_CACHE_DIR;
    else process.env.TIME_CAPSULE_CACHE_DIR = previous;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
