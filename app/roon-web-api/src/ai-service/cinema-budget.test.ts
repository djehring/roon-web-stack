import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cinemaLimits, cinemaResponse, withCinemaResponses } from "./cinema-responses";

const completed = (text = "{}") =>
  new Response(
    JSON.stringify({
      id: "response-id",
      model: "test-model",
      status: "completed",
      usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 10 } },
      output: [
        { type: "message", content: [{ type: "output_text", text }] },
        { type: "web_search_call", action: { type: "search" } },
        { type: "web_search_call", action: { type: "open_page" } },
      ],
    })
  );
const timeout = () => new DOMException("Timed out", "TimeoutError");
const body = (topic: string) => ({ input: `Django Reinhardt: ${topic}`, tools: [{ type: "web_search" }] });
let directory: string;
const context = () => ({ directory, progress: () => Promise.resolve() });
const usage = async () =>
  JSON.parse(await fs.readFile(path.join(directory, "usage.json"), "utf8")) as Record<string, unknown>[];
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "cinema-budget-"));
});
afterEach(async () => {
  jest.restoreAllMocks();
  await fs.rm(directory, { force: true, recursive: true });
});

test("a timeout is submitted once and unknown charges remain reserved", async () => {
  const fetchMock = jest.spyOn(globalThis, "fetch").mockRejectedValue(timeout());
  await expect(
    withCinemaResponses(context(), () => cinemaResponse(body("portraits"), "test-key", "Pictures"))
  ).rejects.toThrow("No automatic retry was made");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await usage()).toEqual([
    expect.objectContaining({ status: "usage-unknown", outputAllowance: 4096, toolAllowance: 4 }),
  ]);
  expect(JSON.stringify(await usage())).not.toContain("test-key");
});

test.each([401, 408, 429, 500, 503, 504])("HTTP %s never triggers another paid request", async (status) => {
  const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Error", { status }));
  await expect(
    withCinemaResponses(context(), () => cinemaResponse(body("career"), "test-key", "Career"))
  ).rejects.toThrow(`HTTP ${status}`);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("photo reviews are reused and their usage is recorded without counting opened pages as searches", async () => {
  const fetchMock = jest
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(completed('{"acceptedPhotoIds":["photo"]}')));
  const input = {
    input: [{ role: "user", content: [{ type: "input_image", image_url: "data:image/jpeg;base64,test" }] }],
    text: { format: { type: "json_object" } },
  };
  const review = () => withCinemaResponses(context(), () => cinemaResponse(input, "test-key", "Reviewing"));
  await review();
  await review();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await usage()).toHaveLength(1);
  expect((await usage())[0]).toMatchObject({
    responseId: "response-id",
    webSearchCalls: 1,
    usage: { input_tokens: 100, output_tokens: 20 },
  });
});

test("malformed structured output is counted but not cached", async () => {
  const fetchMock = jest
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(completed("invalid JSON")));
  const compile = () =>
    withCinemaResponses(context(), () => cinemaResponse({ input: "compile" }, "test-key", "Compile"));
  await compile();
  await compile();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(await fs.readdir(directory)).toEqual(["usage.json"]);
});

test("incomplete responses retain reported usage without being retried", async () => {
  const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        usage: { input_tokens: 50, output_tokens: 4096 },
      })
    )
  );
  await expect(
    withCinemaResponses(context(), () => cinemaResponse(body("career"), "test-key", "Career"))
  ).rejects.toThrow("max_output_tokens");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect((await usage())[0]).toMatchObject({ status: "incomplete", usage: { output_tokens: 4096 } });
});

test("concurrent workers cannot overrun a persisted call budget", async () => {
  const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(completed()));
  const call = (index: number) =>
    cinemaResponse({ input: `call ${index}`, max_output_tokens: 1 }, "test-key", "Review");
  await withCinemaResponses(context(), async () => {
    for (let i = 0; i < cinemaLimits.calls - 1; i++) await call(i);
  });
  const results = await withCinemaResponses(context(), () => Promise.allSettled([call(100), call(101), call(102)]));
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(cinemaLimits.calls);
  await expect(withCinemaResponses(context(), () => call(103))).rejects.toThrow("AI usage limit");
  expect(fetchMock).toHaveBeenCalledTimes(cinemaLimits.calls);
});

test.each(["output", "tools"])("the %s allowance stops further calls even after timeouts", async (limit) => {
  const fetchMock = jest.spyOn(globalThis, "fetch").mockRejectedValue(timeout());
  const input =
    limit === "tools"
      ? { ...body("career"), max_output_tokens: 1, max_tool_calls: 4 }
      : { input: "compile", max_output_tokens: 6144 };
  const allowed = limit === "tools" ? cinemaLimits.toolCalls / 4 : Math.floor(cinemaLimits.outputTokens / 6144);
  for (let i = 0; i < allowed; i++)
    await expect(withCinemaResponses(context(), () => cinemaResponse(input, "key", "Stage"))).rejects.toThrow(
      "timed out"
    );
  await expect(withCinemaResponses(context(), () => cinemaResponse(input, "key", "Stage"))).rejects.toThrow(
    "AI usage limit"
  );
  expect(fetchMock).toHaveBeenCalledTimes(allowed);
});

test("oversized prompts and expired preparations stop before a paid request", async () => {
  const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(completed()));
  await expect(
    withCinemaResponses(context(), () => cinemaResponse({ input: "x".repeat(120_001) }, "key", "Compile"))
  ).rejects.toThrow("too large");
  const clock = jest.spyOn(Date, "now").mockReturnValue(1000);
  await expect(
    withCinemaResponses(context(), async () => {
      clock.mockReturnValue(1001 + cinemaLimits.durationMs);
      return cinemaResponse(body("career"), "key", "Research");
    })
  ).rejects.toThrow("10-minute");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("a corrupt accounting file fails closed", async () => {
  await fs.writeFile(path.join(directory, "usage.json"), "bad JSON");
  const fetchMock = jest.spyOn(globalThis, "fetch");
  await expect(
    withCinemaResponses(context(), () => cinemaResponse(body("career"), "key", "Research"))
  ).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});
