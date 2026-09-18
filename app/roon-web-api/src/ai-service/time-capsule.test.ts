import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openaiKeyStore } from "../service/openai-key-store";
import {
  archiveDescriptionDate,
  attachVerifiedImageSubjects,
  capsuleCoverageError,
  capsuleImage,
  capsuleImageContentType,
  capsuleKey,
  capsuleRegion,
  capsuleResearchBrief,
  capsuleResearchMode,
  commonsCandidate,
  eligiblePhotograph,
  getZoneCapsule,
  openverseCandidate,
  photographBefore,
  photographMatchesScene,
  photographWithinEra,
  plannedImageSearches,
  readCapsule,
  researchedURLs,
  reviewPhotographs,
  setZoneCapsule,
  startCapsule,
  TimeCapsule,
  validateCapsuleRequest,
  validatedCapsulePeriod,
  validateProgramme,
} from "./time-capsule";

const request = () =>
  validateCapsuleRequest({
    query: "French jazz in the 1960s",
    requestedAt: "2026-09-17T12:00:00Z",
    locale: "en_GB",
    timeZone: "Europe/London",
    tracks: [{ artist: "Test artist", track: "Test track", album: "Test album" }],
  });
const source = "https://example.org/archive";
const scene = {
  title: "A sourced story",
  body: "A brief summary",
  scope: "Context",
  dateLabel: "1962",
  sources: [{ title: "Archive", url: source }],
  trackIndices: [0],
  imageQuery: "",
};

describe("Time Capsule", () => {
  test("all stories retain targeted archive searches before generic subjects fill the search budget", () => {
    const headlines = Array.from({ length: 25 }, (_, n) => ({
      id: `scene-${n}`,
      title: `Paris story ${n}`,
      dateLabel: "14 June 1940",
      imageSubjects: ["Paris", "Champs-Elysees", "Hotel de Ville"],
    }));
    const plan = {
      searches: headlines.map((h) => ({ sceneId: h.id, queries: [`event ${h.id} 1940`, `archive ${h.id}`] })),
    };
    const searches = plannedImageSearches(plan, headlines, "1945");
    expect(searches).toHaveLength(72);
    for (const h of headlines) {
      expect(searches).toContainEqual({ sceneId: h.id, query: `event ${h.id} 1940` });
      expect(searches).toContainEqual({ sceneId: h.id, query: `archive ${h.id}` });
    }
    expect(searches.some((s) => s.query === "Paris 1945")).toBe(false);
    expect(searches.some((s) => s.query === "Paris 1940")).toBe(true);
  });
  test("allows dated nearby-era illustrations without backdating modern photographs", () => {
    const photo = {
      downloadUrl: "https://upload.wikimedia.org/portrait.jpg",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Portrait.jpg",
      credit: "Archive",
      license: "Public domain",
      licenseUrl: "",
      date: "1984-05-01",
      description: "A portrait of the presenter, whose programme began in 1978.",
    };
    expect(eligiblePhotograph(photo, "1978-10-07")?.date).toBe("1984-05-01 (later illustrative photo)");
    expect(eligiblePhotograph({ ...photo, date: "1975" }, "1978-10-07")?.date).toBe("1975");
    expect(eligiblePhotograph({ ...photo, date: "2017" }, "1978-10-07")).toBeUndefined();
    expect(eligiblePhotograph({ ...photo, date: "1957" }, "1978-10-07")).toBeUndefined();
    expect(eligiblePhotograph({ ...photo, date: "1988" }, "1978-10-07")).toBeDefined();
    expect(eligiblePhotograph({ ...photo, date: "1989" }, "1978-10-07")).toBeUndefined();
    expect(eligiblePhotograph(photo)?.date).toBe(photo.date);
  });
  test("named image subjects cannot match disconnected words from an unrelated photograph", () => {
    expect(
      photographMatchesScene(
        { title: "Blue Peter airs on BBC One", imageSubjects: ["Blue Peter"] },
        {
          sourceUrl: "https://commons.wikimedia.org/wiki/File:White_House.jpg",
          description: "John F. Kennedy in the Blue Room with Representative Peter Frelinghuysen.",
        }
      )
    ).toBe(false);
    expect(
      photographMatchesScene(
        { title: "Blue Peter airs on BBC One", imageSubjects: ["Lesley Judd", "Blue Peter"] },
        {
          sourceUrl: "https://commons.wikimedia.org/wiki/File:Lesley_Judd.jpg",
          description: "Lesley Judd in 1975",
        }
      )
    ).toBe(true);
    expect(photographWithinEra("3 October 1926", "1978-10-07")).toBe(false);
    expect(photographWithinEra("1975-10-07", "1978-10-07")).toBe(true);
    expect(
      photographMatchesScene(
        { title: "Football", imageSubjects: ["John Greig"] },
        {
          sourceUrl: "https://commons.wikimedia.org/wiki/File:Team.jpg",
          description: "Persoonsnaam: Greig, John",
        }
      )
    ).toBe(true);
    expect(
      archiveDescriptionDate(
        {
          sourceUrl: "https://commons.wikimedia.org/wiki/File:Paisley_statue.jpg",
          description: "A statue of Bob Paisley carrying an injured Emlyn Hughes in 1968.",
        },
        "1978-10-07"
      )
    ).toBeUndefined();
  });

  test("does not date modern portraits or statues from biography or the incident depicted", () => {
    expect(
      archiveDescriptionDate(
        {
          sourceUrl: "https://commons.wikimedia.org/wiki/File:Bob_Paisley_statue,_Anfield_3.jpg",
          description: "Bob Paisley carrying an injured Emlyn Hughes, 1968.",
        },
        "1978-10-07"
      )
    ).toBeUndefined();
    expect(
      archiveDescriptionDate(
        {
          sourceUrl: "https://commons.wikimedia.org/wiki/File:John_Robertson.jpg",
          description: "John Cameron Robertson MP (born 16 November 1962), an Australian politician, elected in 2011.",
        },
        "1978-10-07"
      )
    ).toBeUndefined();
    expect(
      archiveDescriptionDate(
        {
          sourceUrl: "https://commons.wikimedia.org/wiki/File:Portrait.jpg",
          description: "John Robertson (born 1962).",
        },
        "1978-10-07"
      )
    ).toBeUndefined();
  });

  test("enriches subjects only with retrieved evidence and retains the event", () => {
    const capsule: TimeCapsule = {
      id: "test",
      title: "test",
      contextLabel: "test",
      request: request(),
      createdAt: "",
      scenes: [{ ...scene, id: "scene-0", imageSubjects: ["Blue Peter"] }],
    };
    attachVerifiedImageSubjects(
      capsule,
      {
        scenes: [
          {
            sceneId: "scene-0",
            subjects: [
              { name: "Lesley Judd", url: source },
              { name: "Unverified Person", url: "https://example.org/invented" },
            ],
          },
          { sceneId: "missing", subjects: [{ name: "Another Person", url: source }] },
        ],
      },
      new Set([source])
    );
    expect(capsule.scenes[0].imageSubjects).toEqual(["Lesley Judd", "Blue Peter"]);
    expect(capsule.scenes[0].title).toBe(scene.title);
  });

  test("retries images from a verified draft without repeating research", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capsule-draft-test-"));
    const oldDirectory = process.env.TIME_CAPSULE_CACHE_DIR;
    process.env.TIME_CAPSULE_CACHE_DIR = directory;
    const input = request();
    const id = capsuleKey(input);
    const draft = {
      researchVersion: 4,
      id,
      title: "Verified bulletin",
      contextLabel: "Subject",
      request: input,
      createdAt: "",
      scenes: [{ ...scene, id: "scene-0" }],
    };
    await fs.writeFile(path.join(directory, `draft-${id}.json`), JSON.stringify(draft));
    const keyMock = jest.spyOn(openaiKeyStore, "read").mockReturnValue("test-key");
    const fetchMock = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Image service unavailable"));
    try {
      const job = await startCapsule(input);
      for (let n = 0; n < 100 && job.status !== "failed"; n++) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(job.status).toBe("failed");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).instructions).toContain("archive search phrases");
      expect(JSON.parse(await fs.readFile(path.join(directory, `draft-${id}.json`), "utf8"))).toEqual(draft);
      expect(await readCapsule(id)).toBeUndefined();
    } finally {
      fetchMock.mockRestore();
      keyMock.mockRestore();
      if (oldDirectory === undefined) delete process.env.TIME_CAPSULE_CACHE_DIR;
      else process.env.TIME_CAPSULE_CACHE_DIR = oldDirectory;
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  test.each([true, false])(
    "dated research isolates chart wording, audits sources and rejects music-only output (rebuild=%s)",
    async (rebuild) => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capsule-dated-test-"));
      const oldDirectory = process.env.TIME_CAPSULE_CACHE_DIR;
      process.env.TIME_CAPSULE_CACHE_DIR = directory;
      const keyMock = jest.spyOn(openaiKeyStore, "read").mockReturnValue("saved-test-key");
      const requests: { input: string; instructions: string }[] = [];
      const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation((_input, options) => {
        const body = JSON.parse(options?.body as string) as { input: string; instructions: string; tools?: unknown[] };
        requests.push(body);
        const result = body.tools
          ? "Verified domestic events"
          : body.instructions.startsWith("Return JSON {periodStart,periodEnd}")
            ? JSON.stringify({ periodStart: "1982-09-27", periodEnd: "1982-10-03" })
            : JSON.stringify({
                title: "Inadequate montage",
                periodStart: "1982-09-27",
                periodEnd: "1982-10-03",
                scenes: [{ ...scene, scope: "Music", eventStart: "1982-10-02", eventEnd: "1982-10-02" }],
              });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [
                    { type: "output_text", text: result, annotations: [{ type: "url_citation", url: source }] },
                  ],
                },
              ],
            }),
            { headers: { "content-type": "application/json" } }
          )
        );
      });
      try {
        const job = await startCapsule(
          { ...request(), query: "Top 10 hits first week of October 1982" },
          "d".repeat(64),
          rebuild ? { periodStart: "1982-09-27", periodEnd: "1982-10-03" } : undefined
        );
        for (let n = 0; n < 100 && !["ready", "failed"].includes(job.status); n++) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(job.status).toBe("failed");
        expect(job.error).toContain("non-music");
        expect(requests).toHaveLength(rebuild ? 5 : 7);
        const newsRequests = requests.slice(rebuild ? 0 : 2);
        expect(newsRequests[3].instructions).toContain("Independently fact-check");
        expect(newsRequests[3].instructions).toContain("NOT a singles chart");
        expect(newsRequests.slice(0, 3).map((r) => JSON.parse(r.input).topic)).toEqual([
          "national news, politics and the economy",
          "sport fixtures and results",
          "television, radio, cinema and everyday life",
        ]);
        expect(requests.every((r) => !r.input.includes("Test artist"))).toBe(true);
        expect(newsRequests.every((r) => !r.input.includes("Top 10"))).toBe(true);
        for (const research of newsRequests.slice(0, 4)) {
          expect(JSON.parse(research.input).period).toEqual({ periodStart: "1982-09-27", periodEnd: "1982-10-03" });
        }
        expect(await readCapsule(job.id)).toBeUndefined();
      } finally {
        fetchMock.mockRestore();
        keyMock.mockRestore();
        if (oldDirectory === undefined) delete process.env.TIME_CAPSULE_CACHE_DIR;
        else process.env.TIME_CAPSULE_CACHE_DIR = oldDirectory;
        await fs.rm(directory, { recursive: true, force: true });
      }
    }
  );
  test("dated handoffs preserve the week but cannot redirect the audit into answering the chart search", () => {
    const input = { ...request(), query: "Top 10 hits October 1, 1978" };
    const period = validatedCapsulePeriod({ periodStart: "1978-10-01", periodEnd: "1978-10-07" });
    const brief = capsuleResearchBrief(input, period);
    expect(brief).toMatchObject({ period, audienceCountry: "GB" });
    expect(brief).not.toHaveProperty("query");
    expect(brief).not.toHaveProperty("subject");
    expect(brief).not.toHaveProperty("tracks");
    expect(JSON.stringify(brief)).not.toContain(input.query);
    expect(capsuleResearchBrief(request())).toHaveProperty("subject", request().query);
  });

  test.each([
    ["Top django Reinhardt hits 1939 to 1945", "subject"],
    ["World War 2 in Paris", "subject"],
    ["Paris 1939-1945", "subject"],
    ["French jazz in the 1960s", "subject"],
    ["David Bowie hits 1982", "subject"],
    ["Motown hits 1965", "subject"],
    ["Top 10 hits October 1, 1978", "period"],
    ["UK top 20 hits first week of October 1982", "period"],
    ["Billboard hits in October 1982", "period"],
    ["Popular music from 1939 to 1945", "period"],
  ])("preserves subject intent for %s", (query, expected) => {
    expect(capsuleResearchMode({ ...request(), query })).toBe(expected);
  });

  test("dated subject research retains the theme and has no home-country or topic quota", () => {
    const input = { ...request(), query: "Top django Reinhardt hits 1939 to 1945" };
    const period = { periodStart: "1939-01-01", periodEnd: "1945-12-31" };
    expect(capsuleResearchBrief(input, period)).toMatchObject({ subject: input.query, period });
    const capsule: TimeCapsule = {
      id: "subject",
      title: "Paris",
      contextLabel: "Paris",
      createdAt: "",
      request: input,
      scenes: Array.from({ length: 6 }, (_, i) => ({
        ...scene,
        id: String(i),
        scope: "Culture",
        countryCodes: ["FR"],
      })),
    };
    expect(capsuleCoverageError(capsule)).toBeUndefined();
    expect(capsuleCoverageError(capsule, true)).toBeUndefined();
  });

  test("discards a legacy off-topic draft and preserves subject through research, audit and compilation", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capsule-subject-test-"));
    const oldDirectory = process.env.TIME_CAPSULE_CACHE_DIR;
    process.env.TIME_CAPSULE_CACHE_DIR = directory;
    const input = { ...request(), query: "Top django Reinhardt hits 1939 to 1945" };
    const id = capsuleKey(input);
    await fs.writeFile(
      path.join(directory, `draft-${id}.json`),
      JSON.stringify({
        id,
        request: input,
        title: "Wrong British bulletin",
        scenes: [scene],
      })
    );
    const keyMock = jest.spyOn(openaiKeyStore, "read").mockReturnValue("test-key");
    const requests: { input: string; instructions: string; tools?: unknown[] }[] = [];
    const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation((_input, options) => {
      const body = JSON.parse(options?.body as string);
      requests.push(body);
      if (requests.length > 3) return Promise.reject(new Error("Stop before images"));
      const result = body.tools
        ? "Sourced Paris history"
        : JSON.stringify({
            title: "Paris",
            periodStart: "1939-01-01",
            periodEnd: "1945-12-31",
            scenes: [
              {
                ...scene,
                title: "Paris",
                scope: "Culture",
                countryCodes: ["FR"],
                eventStart: "1944-08-25",
                eventEnd: "1944-08-25",
              },
            ],
          });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: result, annotations: [{ type: "url_citation", url: source }] }],
              },
            ],
          })
        )
      );
    });
    try {
      const job = await startCapsule(input, id, { periodStart: "1939-01-01", periodEnd: "1945-12-31" });
      for (let n = 0; n < 100 && job.status !== "failed"; n++) await new Promise((r) => setTimeout(r, 10));
      expect(job.error).toBe("Stop before images");
      expect(requests[0].instructions).toContain("photographic history");
      expect(requests[1].instructions).toContain("Independently fact-check");
      for (const body of requests.slice(0, 3)) {
        expect(body.input).toContain(`"subject":${JSON.stringify(input.query)}`);
        expect(body.input).not.toContain("Test artist");
        expect(body.instructions).not.toContain("At least two thirds");
      }
      const saved = JSON.parse(await fs.readFile(path.join(directory, `draft-${id}.json`), "utf8"));
      expect(saved.title).toBe("Paris");
      expect(saved.researchVersion).toBe(4);
    } finally {
      fetchMock.mockRestore();
      keyMock.mockRestore();
      if (oldDirectory === undefined) delete process.env.TIME_CAPSULE_CACHE_DIR;
      else process.env.TIME_CAPSULE_CACHE_DIR = oldDirectory;
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test("refuses missing, impossible and reversed resolved periods", () => {
    for (const period of [
      null,
      {},
      { periodStart: "1978-02-30", periodEnd: "1978-03-07" },
      { periodStart: "1978-10-07", periodEnd: "1978-10-01" },
    ]) {
      expect(() => validatedCapsulePeriod(period)).toThrow("historical period");
    }
  });
  test("uses the viewer's country for an unspecified chart search and respects explicit geography", () => {
    expect(capsuleRegion({ ...request(), query: "Top 10 hits first week of October 1982" })).toBe("GB");
    expect(capsuleRegion({ ...request(), query: "US Billboard hits in October 1982" })).toBe("US");
    expect(capsuleRegion(request())).toBe("FR");
  });

  test("rejects music-only and foreign-only dated montages, including after illustration", () => {
    const capsule: TimeCapsule = {
      id: "test",
      title: "test",
      contextLabel: "UK",
      createdAt: "",
      request: { ...request(), query: "Top 10 hits first week of October 1982" },
      scenes: Array.from({ length: 6 }, (_, i) => ({ ...scene, id: String(i), scope: "Music", countryCodes: ["US"] })),
    };
    expect(capsuleCoverageError(capsule)).toContain("non-music");
    capsule.scenes = capsule.scenes.map((s, i) => ({ ...s, scope: ["News", "Sport", "Culture"][i % 3] }));
    expect(capsuleCoverageError(capsule)).toBeDefined();
    capsule.scenes.forEach((s) => {
      s.countryCodes = ["GB"];
    });
    expect(capsuleCoverageError(capsule)).toBeUndefined();
    expect(capsuleCoverageError(capsule, true)).toBeDefined();
  });

  test("rejects a later commemoration and a namesake for the band Survivor", () => {
    const image = {
      sourceUrl: "https://commons.wikimedia.org/wiki/File:US_Navy_031207_Commemoration_of_1941.jpg",
      description:
        "Pearl Harbor, Hawaii (Dec. 7, 2003). Fleet Band at the commemoration of the Dec. 7, 1941 attack. Pearl Harbor Survivors Association.",
    };
    expect(archiveDescriptionDate(image, "1982-10-03")).toBeUndefined();
    expect(photographMatchesScene({ title: "Survivor's Eye of the Tiger Continues Chart Success" }, image)).toBe(false);
  });
  test("keeps arbitrary request context and separates relative dates and selected tracks", () => {
    const original = request();
    expect(original.query).toBe("French jazz in the 1960s");
    expect(capsuleKey(original)).not.toBe(capsuleKey({ ...original, requestedAt: "2026-09-24T12:00:00Z" }));
    expect(capsuleKey(original)).not.toBe(
      capsuleKey({ ...original, tracks: [{ ...original.tracks[0], track: "Another track" }] })
    );
  });
  test("rejects malformed inputs and empty selections", () => {
    expect(() => validateCapsuleRequest(null)).toThrow();
    expect(() => validateCapsuleRequest({ ...request(), requestedAt: "yesterday" })).toThrow();
    expect(() => validateCapsuleRequest({ ...request(), tracks: [null] })).toThrow();
    expect(() => validateCapsuleRequest({ ...request(), tracks: [] })).toThrow();
  });
  test("accepts only actual research URLs, drops unsupported scenes and invalid track mappings", () => {
    const urls = researchedURLs({
      output: [
        { type: "message", content: [{ type: "output_text", annotations: [{ type: "url_citation", url: source }] }] },
      ],
    });
    const result = validateProgramme(
      {
        title: "Jazz",
        contextLabel: "France · 1960s",
        scenes: [
          { ...scene, trackIndices: [0, -1, 9, 0.5] },
          { ...scene, sources: [{ url: "https://invented.example/fake" }] },
        ],
      },
      urls,
      1
    );
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0].trackIndices).toEqual([0]);
    expect(() => validateProgramme({ scenes: [scene] }, new Set(), 1)).toThrow();
  });
  test("does not accept arbitrary image hosts, missing credits or unsupported licences", () => {
    const info = {
      url: "https://upload.wikimedia.org/a.jpg",
      descriptionurl: "https://commons.wikimedia.org/wiki/File:A.jpg",
      mime: "image/jpeg",
      width: 1920,
      extmetadata: {
        LicenseShortName: { value: "CC BY-SA 4.0" },
        LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
        Artist: { value: "<b>Photographer</b>" },
        ImageDescription: { value: "A photograph" },
      },
    };
    expect(commonsCandidate(info)?.credit).toBe("Photographer");
    expect(commonsCandidate(info)?.date).toBe("Date not recorded");
    const verbose = commonsCandidate({
      ...info,
      extmetadata: {
        ...info.extmetadata,
        ImageDescription: { value: `${"Archive catalogue metadata. ".repeat(40)} Persoonsnaam: Lesley Judd.` },
      },
    });
    expect(verbose?.description).toContain("Lesley Judd");
    expect(commonsCandidate({ ...info, thumburl: "https://thumb.wikimedia.org/a.jpg" })).toBeDefined();
    expect(commonsCandidate({ ...info, width: 640 })).toBeDefined();
    expect(commonsCandidate({ ...info, mime: "image/gif", width: 500 })).toBeDefined();
    expect(
      commonsCandidate({
        ...info,
        extmetadata: {
          ...info.extmetadata,
          LicenseShortName: { value: "OGL 3" },
          LicenseUrl: { value: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" },
        },
      })
    ).toBeDefined();
    expect(commonsCandidate({ ...info, url: "http://127.0.0.1/private" })).toBeUndefined();
    expect(commonsCandidate({ ...info, extmetadata: {} })).toBeUndefined();
    expect(commonsCandidate({ ...info, width: 399 })).toBeUndefined();
    expect(capsuleImageContentType(Buffer.from("GIF89a archive image"))).toBe("image/gif");
  });

  test("accepts Openverse Flickr photographs with the same licence class and rejects the rest", () => {
    const photo = {
      title: "Lionel Richie in Black and White",
      url: "https://live.staticflickr.com/65535/abc_b.jpg",
      foreign_landing_url: "https://www.flickr.com/photos/someone/123",
      creator: "A photographer",
      license: "by-sa",
      license_version: "2.0",
      license_url: "https://creativecommons.org/licenses/by-sa/2.0/",
      width: 1024,
      filetype: "jpg",
      tags: [{ name: "lionel richie" }],
    };
    expect(openverseCandidate(photo)?.credit).toBe("A photographer");
    expect(openverseCandidate(photo)?.license).toBe("CC BY-SA 2.0");
    expect(openverseCandidate(photo)?.description).toContain("lionel richie");
    expect(openverseCandidate({ ...photo, license: "cc0", license_version: "1.0", license_url: "" })?.license).toBe(
      "CC0 1.0"
    );
    expect(openverseCandidate({ ...photo, license: "pdm", license_version: "1.0", license_url: "" })?.license).toBe(
      "Public domain"
    );
    expect(openverseCandidate({ ...photo, license: "by-nc" })).toBeUndefined();
    expect(openverseCandidate({ ...photo, creator: "" })).toBeUndefined();
    expect(openverseCandidate({ ...photo, width: 400 })).toBeUndefined();
    expect(openverseCandidate({ ...photo, url: "https://evil.example/x.jpg" })).toBeUndefined();
    expect(openverseCandidate({ ...photo, foreign_landing_url: "https://evil.example/x" })).toBeUndefined();
  });

  test("rejects definitely later photos without treating partial archive dates as year end", () => {
    for (const date of ["2007-07-01", "Taken on 19 March 2010", "Date not recorded", "circa 2007"]) {
      expect(photographBefore(date, "2007-06-29")).toBe(false);
    }
    for (const date of [
      "2007-06-29",
      "2007-06-01 13:00:00",
      "2006",
      "2007",
      "2007-05",
      "2007-06",
      "Taken on 19 March 2007",
    ]) {
      expect(photographBefore(date, "2007-06-29")).toBe(true);
    }
    expect(photographBefore("Date not recorded")).toBe(true);
  });

  test("requires archive metadata to name the headline subject", () => {
    const football = { title: "Ipswich end Liverpool's unbeaten run", imageSubjects: ["Ipswich Town", "Liverpool FC"] };
    expect(
      photographMatchesScene(football, {
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Team_1981.jpg",
        description: "Ipswich Town players training in 1981",
      })
    ).toBe(true);
    expect(
      photographMatchesScene(football, {
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Town.jpg",
        description: "A town in France",
      })
    ).toBe(false);
    const jam = { title: "UK Singles Chart: The Jam Top with 'Town Called Malice'" };
    expect(
      photographMatchesScene(jam, {
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Thejam.gif",
        description: "The Jam in concert in Newcastle, 1982",
      })
    ).toBe(true);
    expect(
      photographMatchesScene(jam, {
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Dexys_Midnight_Runners_(1982).png",
        description: "Dexys Midnight Runners in concert in 1982",
      })
    ).toBe(false);
    expect(
      photographMatchesScene(
        { title: "Corsican FLNC Launches Bomb Attacks Across France" },
        {
          sourceUrl: "https://commons.wikimedia.org/wiki/File:TransallC-160R.jpg",
          description: "Hostages taken by the Congolese National Liberation Front (FLNC) in Zaire",
        }
      )
    ).toBe(false);
    expect(
      photographMatchesScene(
        { title: "Polish Authorities Arrest Thousands Amid Martial Law" },
        {
          sourceUrl: "https://commons.wikimedia.org/wiki/File:T-55A_Martial_law_Poland.jpg",
          description: "Tank on the streets during martial law in Poland",
        }
      )
    ).toBe(true);
  });

  test("rejects archive descriptions whose exact depicted date is later in the requested year", () => {
    const image = {
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Boeing_757.jpg",
      description: "First flight: November 29, 1982",
    };
    expect(archiveDescriptionDate(image, "1982-02-20")).toBeUndefined();
    expect(archiveDescriptionDate(image, "1982-12-31")).toBe("1982-11-29");
    expect(
      archiveDescriptionDate(
        {
          sourceUrl: "https://commons.wikimedia.org/wiki/File:JGeilsBand1982.jpg",
          description: "The J. Geils Band performing in June 1982",
        },
        "1982-02-20"
      )
    ).toBeUndefined();
    expect(
      archiveDescriptionDate(
        {
          sourceUrl: "https://commons.wikimedia.org/wiki/File:British_Airways_Boeing_757_November_1982.jpg",
          description: "British Airways Boeing 757",
        },
        "1982-02-20"
      )
    ).toBeUndefined();
    expect(
      archiveDescriptionDate(
        {
          sourceUrl: "https://commons.wikimedia.org/wiki/File:1983_DeLorean_DMC-12.jpg",
          description: "The Belfast factory entered receivership in 1982",
        },
        "1982-02-20"
      )
    ).toBeUndefined();
  });

  test("keeps montage headlines inside the exact requested window", () => {
    const programme = validateProgramme(
      {
        periodStart: "1984-05-06",
        periodEnd: "1984-05-12",
        scenes: [
          { ...scene, eventStart: "1984-05-08", eventEnd: "1984-05-08" },
          { ...scene, eventStart: "1983-02-01", eventEnd: "1983-02-01" },
          { ...scene, eventStart: "1984-05-13", eventEnd: "1984-05-13" },
          { ...scene, eventStart: "1984-05-01", eventEnd: "1984-06-01" },
        ],
      },
      new Set([source]),
      1
    );
    expect(programme.periodStart).toBe("1984-05-06");
    expect(programme.periodEnd).toBe("1984-05-12");
    expect(programme.scenes).toHaveLength(1);
    expect(() =>
      validateProgramme({ periodStart: "1985-01-01", periodEnd: "1984-01-01", scenes: [scene] }, new Set([source]), 1)
    ).toThrow();
    expect(
      validateProgramme({ periodStart: "1984-02-31", scenes: [scene] }, new Set([source]), 1).periodStart
    ).toBeUndefined();
  });

  test("pixel review removes rejected photos and their legacy fallback", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capsule-review-"));
    const oldDirectory = process.env.TIME_CAPSULE_CACHE_DIR;
    process.env.TIME_CAPSULE_CACHE_DIR = directory;
    const keyMock = jest.spyOn(openaiKeyStore, "read").mockReturnValue("test-key");
    const photos = ["a", "b"].map((letter) => ({
      file: letter.repeat(64),
      sourceUrl: source,
      credit: "Archive",
      license: "Public domain",
      licenseUrl: "",
      date: "1962",
      description: "Archive photograph",
    }));
    const capsule: TimeCapsule = {
      id: "c".repeat(64),
      title: "Test",
      contextLabel: "Test",
      createdAt: "",
      request: request(),
      scenes: photos.map((image, index) => ({ ...scene, id: `scene-${index}`, images: [image], image })),
    };
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    acceptedPhotoIds: [photos[0].file, "invented"],
                  }),
                },
              ],
            },
          ],
        })
      )
    );
    try {
      for (const photo of photos)
        await fs.writeFile(path.join(directory, `${photo.file}.image`), Buffer.from([0x89, 1, 2]));
      await reviewPhotographs(capsule);
      expect(capsule.scenes[0].images).toEqual([photos[0]]);
      expect(capsule.scenes[1].images).toEqual([]);
      expect(capsule.scenes[1].image).toBeUndefined();
      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as {
        input: { content: { type: string }[] }[];
      };
      expect(body.input[0].content.filter((part) => part.type === "input_image")).toHaveLength(2);
    } finally {
      fetchMock.mockRestore();
      keyMock.mockRestore();
      if (oldDirectory === undefined) delete process.env.TIME_CAPSULE_CACHE_DIR;
      else process.env.TIME_CAPSULE_CACHE_DIR = oldDirectory;
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test("generates from retrieved evidence, persists replay and shares a zone without another AI call", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capsule-test-"));
    const oldDirectory = process.env.TIME_CAPSULE_CACHE_DIR;
    const oldKey = process.env.OPENAI_API_KEY;
    process.env.TIME_CAPSULE_CACHE_DIR = directory;
    delete process.env.OPENAI_API_KEY;
    const keyMock = jest.spyOn(openaiKeyStore, "read").mockReturnValue("saved-test-key");
    const response = (value: unknown) => ({ ok: true, json: () => Promise.resolve(value) }) as Response;
    const output = (value: unknown) =>
      response({
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }],
      });
    let modelCalls = 0;
    let noPictures = false;
    const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation((input, options) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("api.openai.com")) {
        modelCalls++;
        const stage = modelCalls % 5;
        if (stage === 1)
          return Promise.resolve(
            response({
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [
                    {
                      type: "output_text",
                      text: "Retrieved research",
                      annotations: [{ type: "url_citation", url: source }],
                    },
                  ],
                },
              ],
            })
          );
        if (stage === 2)
          return Promise.resolve(
            output({
              title: "French jazz",
              contextLabel: "France · 1960s",
              periodEnd: "1962-12-31",
              scenes: [scene, scene, scene].map((item) => ({
                ...item,
                title: "Archive concert",
                eventStart: "1962-01-01",
                eventEnd: "1962-12-31",
              })),
            })
          );
        if (stage === 3) return Promise.resolve(output({ queries: noPictures ? [] : ["French jazz"] }));
        if (stage === 0) {
          const body = JSON.parse(options?.body as string) as {
            input: { content: { type: string; text?: string }[] }[];
          };
          const ids = body.input[0].content
            .filter((part) => part.type === "input_text")
            .map((part) => (JSON.parse(part.text ?? "{}") as { photoId: string }).photoId);
          return Promise.resolve(output({ acceptedPhotoIds: ids }));
        }
        const body = JSON.parse(options?.body as string) as { input: string };
        const payload = JSON.parse(body.input.split("\n").slice(1).join("\n")) as { candidates: { photoId: string }[] };
        const ids = payload.candidates.map((candidate) => candidate.photoId);
        // Return out of order with duplicate and invalid references: association must use IDs.
        return Promise.resolve(
          output({
            matches: [
              { sceneId: "scene-2", photoIds: [ids[2]] },
              { sceneId: "invented-scene", photoIds: [ids[0]] },
              { sceneId: "scene-0", photoIds: [ids[0], ids[0], "invented-photo"] },
              { sceneId: "scene-1", photoIds: [ids[1], ids[0]] },
            ],
          })
        );
      }
      if (url.includes("commons.wikimedia.org/w/api.php")) {
        expect(new URL(url).searchParams.get("gsrlimit")).toBe("50");
        return Promise.resolve(
          response({
            query: {
              pages: noPictures
                ? {}
                : Object.fromEntries(
                    [0, 1, 2].map((index) => [
                      String(index),
                      {
                        imageinfo: [
                          {
                            url: `https://upload.wikimedia.org/${index}.png`,
                            thumburl: `https://thumb.wikimedia.org/${index}.png`,
                            descriptionurl: `https://commons.wikimedia.org/wiki/File:${index}.png`,
                            mime: "image/png",
                            width: 1920,
                            extmetadata: {
                              Artist: { value: "Archive" },
                              LicenseShortName: { value: "Public domain" },
                              DateTimeOriginal: { value: "Date not recorded" },
                              ImageDescription: { value: "An archive concert photograph from 1962" },
                            },
                          },
                        ],
                      },
                    ])
                  ),
            },
          })
        );
      }
      if (url === "https://thumb.wikimedia.org/0.png")
        return Promise.resolve(new Response("Rate limited", { status: 429 }));
      return Promise.resolve(
        new Response(
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK2kAAAAASUVORK5CYII=",
            "base64"
          ),
          { headers: { "content-type": "image/png" } }
        )
      );
    });
    try {
      const job = await startCapsule(request());
      for (let n = 0; n < 100 && !["ready", "failed"].includes(job.status); n++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(job.status).toBe("ready");
      expect((await readCapsule(job.id))?.request).toEqual(request());
      await setZoneCapsule("living/room", job.id);
      expect((await getZoneCapsule("living/room"))?.id).toBe(job.id);
      expect((await startCapsule(request())).status).toBe("ready");
      expect(modelCalls).toBe(5);
      expect(job.capsule?.scenes.map((scene) => scene.image?.sourceUrl)).toEqual(
        [0, 1, 2].map((index) => `https://commons.wikimedia.org/wiki/File:${index}.png`)
      );
      expect(job.capsule?.scenes.flatMap((scene) => scene.images ?? [])).toHaveLength(3);
      expect(job.capsule?.scenes[0].image?.date).toBe("1962 (archive description)");
      expect(fetchMock).toHaveBeenCalledWith("https://upload.wikimedia.org/0.png", expect.anything());
      const original = await readCapsule(job.id);
      noPictures = true;
      const rebuild = await startCapsule(request(), job.id);
      for (let n = 0; n < 100 && !["ready", "failed"].includes(rebuild.status); n++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(rebuild.status).toBe("failed");
      expect(rebuild.error).toContain("Not enough distinct archive photographs");
      expect(await readCapsule(job.id)).toEqual(original);
      expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer saved-test-key" });
      expect(await capsuleImage("../../secret")).toBeUndefined();
      expect(await readCapsule("../../secret")).toBeUndefined();
    } finally {
      fetchMock.mockRestore();
      keyMock.mockRestore();
      if (oldDirectory === undefined) delete process.env.TIME_CAPSULE_CACHE_DIR;
      else process.env.TIME_CAPSULE_CACHE_DIR = oldDirectory;
      if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = oldKey;
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
