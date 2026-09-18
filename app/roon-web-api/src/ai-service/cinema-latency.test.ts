import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openaiKeyStore } from "../service/openai-key-store";
import {
  reviewPhotographs,
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
const output = (text: string) =>
  new Response(
    JSON.stringify({
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text,
              annotations: [
                { type: "url_citation", url: "https://example.org/source" },
              ],
            },
          ],
        },
      ],
    })
  );
let directory: string;
let previousDirectory: string | undefined;
let previousModel: string | undefined;
beforeEach(async () => {
  previousDirectory = process.env.TIME_CAPSULE_CACHE_DIR;
  previousModel = process.env.TIME_CAPSULE_MODEL;
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "cinema-latency-test-"));
  process.env.TIME_CAPSULE_CACHE_DIR = directory;
  jest.spyOn(openaiKeyStore, "read").mockReturnValue("test-key");
});
afterEach(async () => {
  jest.restoreAllMocks();
  if (previousDirectory === undefined)
    delete process.env.TIME_CAPSULE_CACHE_DIR;
  else process.env.TIME_CAPSULE_CACHE_DIR = previousDirectory;
  if (previousModel === undefined) delete process.env.TIME_CAPSULE_MODEL;
  else process.env.TIME_CAPSULE_MODEL = previousModel;
  await fs.rm(directory, { recursive: true, force: true });
});

test.each(["gpt-5.6-sol", "gpt-4o"])(
  "uses fast JSON conversion only when supported by %s",
  async (model) => {
    process.env.TIME_CAPSULE_MODEL = model;
    const calls: {
      input: string;
      instructions: string;
      tools?: unknown[];
      reasoning?: { effort: string };
    }[] = [];
    jest.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const body = JSON.parse(init?.body as string) as (typeof calls)[number];
      calls.push(body);
      if (body.instructions.startsWith("Return JSON {searches:"))
        return Promise.reject(new Error("Stopped before image selection"));
      if (body.tools)
        return Promise.resolve(output("Verified David Bowie notes"));
      return Promise.resolve(
        output(
          JSON.stringify({
            title: "David Bowie",
            contextLabel: "Bowie",
            scenes: [
              {
                title: "David Bowie",
                body: "David Bowie performing",
                dateLabel: "",
                scope: "Music",
                topic: "historicalContext",
                sources: [
                  { title: "Archive", url: "https://example.org/source" },
                ],
                imageSubjects: ["David Bowie"],
                trackIndices: [],
              },
            ],
          })
        )
      );
    });
    const input = request();
    if (input.options) input.options.topics = ["historicalContext"];
    const job = await startCapsule(input);
    for (let attempt = 0; attempt < 200 && job.status !== "failed"; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(job.error).toBe("Stopped before image selection");
    expect(calls).toHaveLength(4);
    expect(
      calls.slice(0, 2).every((call) => call.reasoning === undefined)
    ).toBe(true);
    for (const call of calls.slice(2))
      expect(call.reasoning).toEqual(
        model === "gpt-5.6-sol" ? { effort: "low" } : undefined
      );
  }
);

test("Bowie topics overlap, then verification receives all completed sources", async () => {
  let active = 0;
  let peak = 0;
  let verified: string[] = [];
  jest.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(init?.body as string) as { input: string };
    const input = JSON.parse(body.input) as {
      topic?: string;
      notes?: { topic: string; evidence: string }[];
    };
    if (!input.topic) {
      expect(active).toBe(0);
      verified = (input.notes ?? []).map((note) => note.topic);
      throw new Error("Stopped after research verification");
    }
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active--;
    return output(`Sourced ${input.topic} notes`);
  });
  const input = request();
  if (input.options)
    input.options.topics = ["collaborators", "historicalContext", "places"];
  const job = await startCapsule(input);
  for (let attempt = 0; attempt < 200 && job.status !== "failed"; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(job.error).toBe("Stopped after research verification");
  expect(peak).toBe(3);
  expect(verified).toEqual(["collaborators", "historicalContext", "places"]);
});

test("photo review overlaps two batches and cannot approve photos from another batch", async () => {
  const images = Array.from({ length: 7 }, (_, index) => ({
    file: String(index + 1).padStart(64, "0"),
    date: "1983",
    description: "David Bowie performing",
    sourceUrl: `https://example.org/photo-${index}`,
    credit: "Photographer",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  }));
  const capsule: TimeCapsule = {
    id: "review",
    title: "Bowie",
    contextLabel: "Bowie",
    request: request(),
    createdAt: new Date().toISOString(),
    scenes: [
      {
        id: "portrait",
        title: "David Bowie",
        body: "",
        dateLabel: "1983",
        scope: "Music",
        sources: [],
        trackIndices: [],
        images,
      },
    ],
  };
  for (const image of images)
    await fs.writeFile(
      path.join(directory, `${image.file}.image`),
      Buffer.from([0xff, 0xd8, 0xff, 0xd9])
    );
  let active = 0;
  let peak = 0;
  let calls = 0;
  jest.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(init?.body as string) as {
      input: { content: { type: string; text?: string }[] }[];
    };
    expect(body).not.toHaveProperty("reasoning");
    const ids = body.input[0].content
      .filter((part) => part.type === "input_text")
      .map(
        (part) =>
          (JSON.parse(part.text ?? "{}") as { photoId?: string }).photoId
      )
      .filter(Boolean);
    calls++;
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active--;
    // Only approve the first actual picture in each batch. The final picture
    // must not gain approval from an earlier batch that never inspected it.
    return output(
      JSON.stringify({
        acceptedPhotoIds: ids.length > 1 ? [ids[0], images[6].file] : [],
      })
    );
  });
  await reviewPhotographs(capsule);
  expect(calls).toBe(3);
  expect(peak).toBe(2);
  expect(capsule.scenes[0].images?.map((image) => image.file)).toEqual([
    images[0].file,
    images[3].file,
  ]);
});
