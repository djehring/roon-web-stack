import { browseCinemaMusic, CinemaMusicItem } from "../cinema-music";
import { CinemaMusicPath } from "../cinema-music-model";
import { HistoryEvent, normalize } from "./model";

type HistoryKind = "tracks" | "albums";

async function search(query: string, title: string, kind: HistoryKind, zoneId?: string) {
  const path: CinemaMusicPath = { hierarchy: "search", query, steps: [] };
  let page = await browseCinemaMusic(path, zoneId);
  const category = page.items.find((i) => normalize(i.title) === kind && i.kind === "list");
  if (category) page = await browseCinemaMusic(category.path, zoneId);
  // Search's top result can be a track with the same title as the missing album.
  else if (normalize(page.title) !== kind) return [];
  return page.items.filter((i) => normalize(i.title) === normalize(title) && i.kind !== "search");
}

function matchingCredits(item: CinemaMusicItem, artist: string) {
  if (!artist || !item.subtitle) return false;
  // Transport separates credits with slashes; browse may use commas and linked names.
  const credits = `, ${normalize(item.subtitle).replace(/\s+\/\s+/g, ", ")}, `;
  return artist.split(" / ").every((credit) => credits.includes(`, ${normalize(credit)}, `));
}

function matchingHistory(items: CinemaMusicItem[], event: HistoryEvent, kind: HistoryKind) {
  const artwork = event.imageKey ? items.filter((i) => i.imageKey === event.imageKey) : [];
  if (artwork.length) {
    // Album credits need not contain the performer/composer of this particular track.
    if (kind === "albums" || !event.artist) return artwork;
    return artwork.filter((i) => !i.subtitle || matchingCredits(i, event.artist));
  }
  // Artwork can change. Fall back to matching credits, preserving edition choices.
  // A title alone is not enough evidence to offer unrelated artists as this play.
  return items.filter((i) => matchingCredits(i, event.artist));
}

/** Search more broadly when necessary, but always match the original title and saved metadata. */
export async function resolveHistory(event: HistoryEvent, kind: HistoryKind, zoneId?: string) {
  const title = kind === "albums" ? event.album : event.title;
  if (!title) throw new Error("This play has no album information.");
  // Roon can miss an album when the query includes its displayed remaster suffix.
  // Remove that suffix only from the fallback query, never from candidate comparison.
  const baseTitle = title
    .replace(/\s*(?:\([^()]*\bremaster(?:ed)?\b[^()]*\)|\[[^[\]]*\bremaster(?:ed)?\b[^[\]]*\])\s*$/i, "")
    .trim();
  let candidates: CinemaMusicItem[] = [];
  for (const query of new Set([title, baseTitle].filter(Boolean))) {
    candidates = matchingHistory(await search(query, title, kind, zoneId), event, kind);
    if (candidates.length) break;
  }
  return {
    choices: candidates
      .slice(0, 100)
      .map((item: CinemaMusicItem) => ({ ...item, kind: kind === "albums" ? "album" : "track" })),
    message: candidates.length ? "Choose the recording or edition you want." : "This music could not be found in Roon.",
  };
}

/** Skip redundant single-child wrappers, without selecting among editions or executing actions. */
export async function browseHistoryMusic(path: CinemaMusicPath, zoneId?: string) {
  let page = await browseCinemaMusic(path, zoneId);
  for (let depth = 0; depth < 4 && page.kind === "list" && page.path.steps.length < 12; depth++) {
    const child = page.items.length === 1 ? page.items[0] : undefined;
    if (!child || child.kind === "search" || normalize(child.title) !== normalize(page.path.steps.at(-1)?.title ?? ""))
      break;
    page = await browseCinemaMusic(child.path, zoneId);
  }
  return page;
}
