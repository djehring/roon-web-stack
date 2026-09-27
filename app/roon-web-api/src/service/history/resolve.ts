import { browseCinemaMusic, CinemaMusicItem } from "../cinema-music";
import { CinemaMusicPath } from "../cinema-music-model";
import { HistoryEvent, normalize } from "./model";

/** Present exact-title candidates for explicit selection; display metadata cannot prove an edition. */
export async function resolveHistory(event: HistoryEvent, kind: "tracks" | "albums", zoneId?: string) {
  const query = kind === "albums" ? event.album : event.title;
  if (!query) throw new Error("This play has no album information.");
  const path: CinemaMusicPath = { hierarchy: "search", query, steps: [] };
  let page = await browseCinemaMusic(path, zoneId);
  const category = page.items.find((i) => normalize(i.title) === kind && i.kind === "list");
  if (category) page = await browseCinemaMusic(category.path, zoneId);
  const candidates = page.items.filter((i) => normalize(i.title) === normalize(query) && i.kind !== "search");
  // Offer choices rather than accepting a title/performer match as a unique recording ID.
  return {
    choices: candidates
      .slice(0, 100)
      .map((item: CinemaMusicItem) => ({ ...item, kind: kind === "albums" ? "album" : "track" })),
    message: candidates.length ? "Choose the recording or edition you want." : "This music could not be found in Roon.",
  };
}
