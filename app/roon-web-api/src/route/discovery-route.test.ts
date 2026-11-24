import Fastify from "fastify";
import { clientManager } from "@service";
import { discoverMusic, playDiscovery, rememberDiscovery } from "../service/music-discovery";
import { registerDiscoveryRoutes } from "./discovery-route";

jest.mock("@service", () => ({ clientManager: { get: jest.fn() } }));
jest.mock("../ai-service/chatgpt", () => ({ isMissingOpenAIKeyError: () => false }));
jest.mock("../service/music-discovery", () => ({
  discoverMusic: jest.fn(),
  playDiscovery: jest.fn(),
  rememberDiscovery: jest.fn((_client, value: unknown) => value),
}));

test("discovery validates clients and input and plays only an explicit saved selection", async () => {
  const app = Fastify();
  jest.mocked(clientManager.get).mockImplementation((id) => {
    if (id !== "paired") throw new Error("Unpaired");
    return {} as never;
  });
  registerDiscoveryRoutes(app);
  const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url, payload });
  try {
    expect((await post("/unknown/music-discovery", { query: "Enigma" })).statusCode).toBe(403);
    expect((await post("/paired/music-discovery", { query: "" })).statusCode).toBe(400);
    expect((await post("/paired/music-discovery", { query: "Enigma", mode: "bad" })).statusCode).toBe(400);
    expect(discoverMusic).not.toHaveBeenCalled();
    jest.mocked(discoverMusic).mockResolvedValue({ mode: "albums", query: "Enigma", message: "Verified", results: [] });
    expect((await post("/paired/music-discovery", { query: "Enigma", mode: "auto" })).statusCode).toBe(200);
    expect(rememberDiscovery).toHaveBeenCalledWith("paired", expect.objectContaining({ mode: "albums" }));
    expect(playDiscovery).not.toHaveBeenCalled();
    expect(
      (await post("/paired/music-discovery/play", { ids: ["album"], zoneId: "office", workOnly: "yes" })).statusCode
    ).toBe(400);
    jest.mocked(playDiscovery).mockResolvedValue([]);
    expect(
      (await post("/paired/music-discovery/play", { ids: ["album"], zoneId: "office", workOnly: true })).statusCode
    ).toBe(200);
    expect(playDiscovery).toHaveBeenCalledWith("paired", "office", { ids: ["album"], workOnly: true });
    jest.mocked(playDiscovery).mockRejectedValue(new Error("These results have expired. Please search again."));
    const expired = await post("/paired/music-discovery/play", { ids: ["album"], zoneId: "office" });
    expect(expired.statusCode).toBe(409);
    expect(expired.json<{ error: string }>().error).toContain("expired");
  } finally {
    await app.close();
  }
});
