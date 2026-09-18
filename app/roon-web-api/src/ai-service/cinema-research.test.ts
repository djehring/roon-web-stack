import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openaiKeyStore } from "../service/openai-key-store";
import { startCapsule, TimeCapsule, validateCapsuleRequest } from "./time-capsule";

describe("Configured Cinema research", () => {
  test.each([
    { mode: "period", topic: "headlines", subject: "UK top ten in 1984", dated: true },
    { mode: "artist", topic: "historicalContext", subject: "Django Reinhardt's greatest hits", dated: false },
    { mode: "work", topic: "manuscripts", subject: "Beethoven Symphony No. 6, recorded in 1984", dated: false },
  ])("carries $mode choices through research, audit and the saved draft", async ({ mode, topic, subject, dated }) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cinema-options-test-"));
    const oldDirectory = process.env.TIME_CAPSULE_CACHE_DIR;
    process.env.TIME_CAPSULE_CACHE_DIR = directory;
    const key = jest.spyOn(openaiKeyStore, "read").mockReturnValue("test-key");
    const calls: { instructions: string; input: string; tools?: unknown[] }[] = [];
    const source = "https://example.org/primary-source";
    const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const body = JSON.parse(init?.body as string) as (typeof calls)[number];
      calls.push(body);
      if (body.instructions.startsWith("Return JSON {searches:"))
        return Promise.reject(new Error("Stop before images"));
      const scene = {
        title: subject,
        body: "A verified subject.",
        scope: "Culture",
        topic,
        imageSubjects: [subject],
        dateLabel: dated ? "1984-02-01" : "",
        eventStart: dated ? "1984-02-01" : null,
        eventEnd: dated ? "1984-02-01" : null,
        sources: [{ title: "Primary source", url: source }],
        trackIndices: [],
      };
      const result = body.tools
        ? "Verified source notes"
        : JSON.stringify({
            title: subject,
            contextLabel: subject,
            periodStart: "1984-01-01",
            periodEnd: "1984-12-31",
            scenes: [
              scene,
              { ...scene, topic: "sports", title: "Unselected sport" },
              { ...scene, topic: "albumCovers", title: "Web cover must be ignored" },
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
      const input = validateCapsuleRequest({
        query: subject,
        requestedAt: "2026-09-18T12:00:00Z",
        locale: "en_GB",
        timeZone: "Europe/London",
        tracks: [{ artist: "Selected performer", track: "Selected track", album: "Selected recording" }],
        options: {
          mode,
          topics: [topic, "albumCovers"],
          subject,
          region: "GB",
          workContext: "composition",
          captions: "none",
          motion: "kenBurns",
          pace: "relaxed",
          order: "chronological",
          ...(dated ? { periodStart: "1984-01-01", periodEnd: "1984-12-31" } : {}),
        },
      });
      const job = await startCapsule(input);
      for (let attempt = 0; attempt < 200 && job.status !== "failed"; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(job.error).toBe("Stop before images");
      expect(calls).toHaveLength(4);
      const submitted = JSON.parse(calls[0].input) as { topic: string; selectedMusic?: unknown };
      expect(submitted.topic).toBe(topic);
      for (const call of calls.slice(0, 3)) {
        expect(call.instructions).toContain("Do not add unselected topics");
        expect(call.instructions).toContain("Album covers are supplied directly by Roon");
        expect(call.input).toContain(subject);
      }
      expect(submitted.selectedMusic !== undefined).toBe(mode !== "period");
      const draft = JSON.parse(await fs.readFile(path.join(directory, `draft-${job.id}.json`), "utf8")) as TimeCapsule;
      expect(draft.request).toEqual(input);
      expect(draft.scenes).toHaveLength(1);
      expect(draft.scenes[0].topic).toBe(topic);
      expect(draft.periodStart).toBe(dated ? "1984-01-01" : undefined);
      if (mode === "work") expect(calls[3].instructions).toContain("manuscript or score");
    } finally {
      fetchMock.mockRestore();
      key.mockRestore();
      if (oldDirectory === undefined) delete process.env.TIME_CAPSULE_CACHE_DIR;
      else process.env.TIME_CAPSULE_CACHE_DIR = oldDirectory;
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
