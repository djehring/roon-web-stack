import * as dotenv from "dotenv";
import { writeFileSync } from "fs";
import { scrapeUKChartData } from "../service/uk-chart-scraper";
import { DiscoveryIntent, interpretDiscovery } from "./discovery-ai";

// Golden queries for the routing step, run against the real model:
//   DISCOVERY_LIVE=1 yarn workspace @djehring/roon-web-api jest discovery-routing.live --coverage=false
// Run them after any change to the discovery instructions, so tuning one route
// cannot silently move requests that belong to another. The key comes from
// the bridge's saved key or its .env, exactly as it does for the running bridge.
dotenv.config();
jest.mock("./chatgpt", () => ({
  resolveOpenAIApiKey: () => {
    const { openaiKeyStore } =
      jest.requireActual<typeof import("../service/openai-key-store")>("../service/openai-key-store");
    return openaiKeyStore.read() || process.env.OPENAI_API_KEY || "";
  },
}));
jest.mock("@infrastructure", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../service/catalogue-release-dates", () => ({ catalogueReleaseDates: jest.fn() }));

const today = new Date(2026, 10, 24, 9);
const golden: [string, Partial<DiscoveryIntent>][] = [
  ["Find me the uk top ten from this week in 1985", { kind: "chart", chart: { date: "1985-11-24", count: 10 } }],
  ["UK top 40 early March 1973", { kind: "chart", limit: 40 }],
  ["what was number one in the UK on 14 July 1979", { kind: "chart", chart: { date: "1979-07-14", count: 1 } }],
  ["best UK hits of the eighties", { kind: "tracks" }],
  ["Latest recordings of Elgar enigma variations", { kind: "classical", mode: "albums", recent: true }],
  ["Elgaza enigma variations", { kind: "classical", mode: "albums", workScope: "single", movementCount: 15 }],
  ["Nimrod", { kind: "classical", mode: "tracks", workScope: "single" }],
  ["Brandenburg concerto", { kind: "classical", mode: "albums", workScope: "collection", movementCount: 0 }],
  ["Brandenburg Concerto No. 3", { kind: "classical", mode: "albums", workScope: "single" }],
  ["Beethoven symphonies conducted by Karajan", { kind: "classical", workScope: "collection" }],
  ["Peace Piece by Bill Evans", { kind: "tracks", limit: 1 }],
  ["Virginia Plain by Roxy Music", { kind: "tracks", limit: 1 }],
  ["upbeat sixties soul for a dinner party", { kind: "tracks" }],
  ["Molly Tuttle songs", { kind: "tracks" }],
  ["Milos Karadaglic albums", { kind: "albums", mode: "albums" }],
  ["the latest Radiohead album", { kind: "albums", recent: true }],
  ["Rumours by Fleetwood Mac", { kind: "albums" }],
];

(process.env.DISCOVERY_LIVE === "1" ? describe : describe.skip)("live discovery routing", () => {
  jest.setTimeout(120_000);
  test.concurrent.each(golden)("%s", async (query, expected) => {
    expect(await interpretDiscovery(query, "auto", today)).toMatchObject(expected);
  });
  // Only the UK singles chart has a published source here. Another chart may be
  // answered from the model's knowledge or declined, but never from the UK chart.
  test.concurrent("Billboard top ten this week in 1985", async () => {
    const kind = await interpretDiscovery("Billboard top ten this week in 1985", "auto", today).then(
      (intent) => intent.kind,
      () => "declined"
    );
    expect(["tracks", "declined"]).toContain(kind);
  });
  // An artist's songs must come back as titled suggestions, not the artist alone.
  test.concurrent.each(["songs by Duffy", "Molly Tuttle songs", "Nick Drake songs"])("%s", async (query) => {
    const intent = await interpretDiscovery(query, "auto", today);
    expect(intent.kind).toBe("tracks");
    expect(intent.tracks.length).toBeGreaterThan(2);
  });
  // The chart page is scraped, so its markup is the part most likely to change.
  test("the chart source still publishes the week of 24 November 1985", async () => {
    const chart = await scrapeUKChartData("19851124");
    expect(chart.length).toBeGreaterThanOrEqual(40);
    expect(chart[0]).toMatchObject({
      artist: expect.stringMatching(/^wham!?$/i) as string,
      track: expect.stringMatching(/^i'm your man$/i) as string,
    });
  });
});

// Compare models and reasoning efforts on the golden queries:
//   DISCOVERY_COMPARE="gpt-5-mini:low,gpt-4.1-mini:" DISCOVERY_ROUNDS=3 DISCOVERY_COMPARE_OUT=/path/results.json \
//     yarn workspace @djehring/roon-web-api jest discovery-routing.live --coverage=false
// Each entry is model:effort; an empty effort sends no reasoning setting.
const compare = (process.env.DISCOVERY_COMPARE ?? "").split(",").filter(Boolean);
(compare.length ? describe : describe.skip)("discovery model comparison", () => {
  jest.setTimeout(3_600_000);
  test("golden queries per model and effort", async () => {
    const rounds = Number(process.env.DISCOVERY_ROUNDS ?? 3);
    const results: { config: string; query: string; ms: number; ok: boolean; got: string }[] = [];
    for (const config of compare) {
      const [model, effort = ""] = config.split(":");
      process.env.DISCOVERY_MODEL = model;
      process.env.DISCOVERY_EFFORT = effort;
      for (let round = 0; round < rounds; round++) {
        for (let start = 0; start < golden.length; start += 6) {
          await Promise.all(
            golden.slice(start, start + 6).map(async ([query, expected]) => {
              const began = Date.now();
              let ok = false;
              let got = "";
              try {
                const intent = await interpretDiscovery(query, "auto", today);
                got = JSON.stringify({ ...intent, tracks: intent.tracks.length });
                expect(intent).toMatchObject(expected);
                ok = true;
              } catch (error) {
                got ||= String(error).slice(0, 200);
              }
              results.push({ config, query, ms: Date.now() - began, ok, got });
            })
          );
        }
      }
      writeFileSync(process.env.DISCOVERY_COMPARE_OUT ?? "discovery-compare.json", JSON.stringify(results, null, 1));
    }
  });
});
