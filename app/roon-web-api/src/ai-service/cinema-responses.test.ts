import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cinemaResponse, withCinemaResponses } from "./cinema-responses";

jest.mock("node:timers/promises", () => ({
  setTimeout: jest.fn().mockResolvedValue(undefined),
}));

const completed = () =>
  new Response(JSON.stringify({ status: "completed", output: [] }));
const timeout = () =>
  new DOMException("The operation was aborted due to timeout", "TimeoutError");
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

  test("web research has a longer initial budget, retries once and reports its stage", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(timeout())
      .mockResolvedValueOnce(completed());
    const budgets = jest.spyOn(AbortSignal, "timeout");
    const progress = jest
      .fn<Promise<void>, [string]>()
      .mockResolvedValue(undefined);
    const result = await withCinemaResponses({ directory, progress }, () =>
      cinemaResponse(
        body("portraits"),
        "test-key",
        "Researching artist pictures"
      )
    );
    expect(result.status).toBe("completed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(budgets.mock.calls.map(([budget]) => budget)).toEqual([
      300_000, 300_000,
    ]);
    expect(progress.mock.calls.map(([message]) => message)).toEqual([
      "Researching artist pictures…",
      "Researching artist pictures — retrying a slow connection…",
    ]);
  });

  test("retrying Bowie resumes saved research instead of paying for every earlier topic again", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(completed())
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(timeout());
    const context = { directory, progress: () => Promise.resolve() };
    const research = () =>
      withCinemaResponses(context, async () => {
        await cinemaResponse(body("career"), "test-key", "Researching career");
        return cinemaResponse(
          body("portraits"),
          "test-key",
          "Researching artist pictures"
        );
      });
    await expect(research()).rejects.toThrow(
      "Researching artist pictures timed out after a retry"
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await fs.readdir(directory)).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(completed());
    await expect(research()).resolves.toMatchObject({ status: "completed" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(
      (
        JSON.parse(fetchMock.mock.calls[3][1]?.body as string) as {
          input: string;
        }
      ).input
    ).toContain("portraits");
    expect(
      await fs.readFile(
        path.join(directory, (await fs.readdir(directory))[0]),
        "utf8"
      )
    ).not.toContain("test-key");
  });

  test("transient HTTP errors retry, but credentials and incomplete responses fail immediately", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(completed());
    await expect(
      cinemaResponse(body("career"), "test-key", "Researching career")
    ).resolves.toMatchObject({ status: "completed" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Invalid key" } }), {
        status: 401,
      })
    );
    await expect(
      cinemaResponse(body("career"), "test-key", "Researching career")
    ).rejects.toThrow("HTTP 401");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "incomplete" }))
    );
    await expect(
      cinemaResponse(body("career"), "test-key", "Researching career")
    ).rejects.toThrow("Research did not complete");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("structured output stays uncached until its caller validates the draft", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(completed()));
    const compile = () =>
      withCinemaResponses(
        { directory, progress: () => Promise.resolve() },
        () =>
          cinemaResponse(
            { input: "compile", text: { format: { type: "json_object" } } },
            "test-key",
            "Preparing stories"
          )
      );
    await compile();
    await compile();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await fs.readdir(directory)).toHaveLength(0);
  });
});
