import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cinemaProgress, cinemaResponse, withCinemaResponses } from "./cinema-responses";

const completed = () =>
  new Response(
    JSON.stringify({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }],
    })
  );
const timeout = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");
const body = (topic: string) => ({
  input: `Bowie greatest hits: ${topic}`,
  tools: [{ type: "web_search" }],
});

describe("Cinema research timeouts", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "cinema-timeout-"));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { force: true, recursive: true });
  });

  test("concurrent stage updates persist in order", async () => {
    const writes: string[] = [];
    await withCinemaResponses(
      {
        directory,
        progress: async (message) => {
          writes.push(`start:${message}`);
          await new Promise((resolve) => setTimeout(resolve, message === "first" ? 20 : 0));
          writes.push(`end:${message}`);
        },
      },
      async () => {
        await Promise.all([cinemaProgress("first"), cinemaProgress("second")]);
      }
    );
    expect(writes).toEqual(["start:first", "end:first", "start:second", "end:second"]);
  });

  test("web research has a bounded initial allowance and never retries automatically", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(timeout())
      .mockResolvedValueOnce(completed());
    const budgets = jest.spyOn(AbortSignal, "timeout");
    const progress = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    await expect(
      withCinemaResponses({ directory, progress }, () =>
        cinemaResponse(body("portraits"), "test-key", "Researching artist pictures")
      )
    ).rejects.toThrow("No automatic retry was made");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(budgets.mock.calls.map(([budget]) => budget)).toEqual([180_000]);
    expect(progress.mock.calls.map(([message]) => message)).toEqual(["Researching artist pictures…"]);
  });

  test("retrying Bowie resumes saved research instead of paying for every earlier topic again", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(completed())
      .mockRejectedValueOnce(timeout());
    const context = { directory, progress: () => Promise.resolve() };
    const research = () =>
      withCinemaResponses(context, async () => {
        await cinemaResponse(body("career"), "test-key", "Researching career");
        return cinemaResponse(body("portraits"), "test-key", "Researching artist pictures");
      });
    await expect(research()).rejects.toThrow("Researching artist pictures timed out");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await fs.readdir(directory)).toHaveLength(2);
    fetchMock.mockResolvedValueOnce(completed());
    await expect(research()).resolves.toMatchObject({ status: "completed" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      (
        JSON.parse(fetchMock.mock.calls[2][1]?.body as string) as {
          input: string;
        }
      ).input
    ).toContain("portraits");
    expect(await fs.readFile(path.join(directory, (await fs.readdir(directory))[0]), "utf8")).not.toContain("test-key");
  });

  test("HTTP errors and incomplete responses all fail without paid retries", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    await expect(cinemaResponse(body("career"), "test-key", "Researching career")).rejects.toThrow("HTTP 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Invalid key" } }), {
        status: 401,
      })
    );
    await expect(cinemaResponse(body("career"), "test-key", "Researching career")).rejects.toThrow("HTTP 401");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: "incomplete" })));
    await expect(cinemaResponse(body("career"), "test-key", "Researching career")).rejects.toThrow(
      "Researching career did not complete"
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("valid structured output is cached so repeated compilation does not cost again", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(completed()));
    const compile = () =>
      withCinemaResponses({ directory, progress: () => Promise.resolve() }, () =>
        cinemaResponse({ input: "compile", text: { format: { type: "json_object" } } }, "test-key", "Preparing stories")
      );
    await compile();
    await compile();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(directory)).toHaveLength(2);
  });
});
