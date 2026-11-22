import { browseCinemaMusic, CinemaMusicItem, trackTitle } from "../cinema-music";
import { CinemaMusicPath } from "../cinema-music-model";
import { HistoryEvent, normalize } from "./model";

type HistoryKind = "tracks" | "albums";

/** Editions opened while looking for the recorded track inside its album. */
const editionsOpened = 3;
const remasterSuffix = /\s*(?:\([^()]*\bremaster(?:ed)?\b[^()]*\)|\[[^[\]]*\bremaster(?:ed)?\b[^[\]]*\])\s*$/i;
const withoutRemaster = (title: string) => title.replace(remasterSuffix, "").trim();

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

/**
 * Roon can miss an album when the query carries its displayed remaster suffix, and can
 * miss a title that is only distinctive alongside its credits. Broader queries never
 * loosen the comparison: candidates are still matched against the full recorded title.
 */
function albumQueries(event: HistoryEvent) {
  const lead = event.artist.split(" / ")[0].trim();
  return [event.album, withoutRemaster(event.album), lead && `${lead} ${event.album}`, lead];
}

/** Try each query in turn, keeping only candidates the saved metadata supports. */
async function findCandidates(event: HistoryEvent, kind: HistoryKind, zoneId: string | undefined, queries: string[]) {
  const title = kind === "albums" ? event.album : event.title;
  for (const query of new Set(queries.filter(Boolean))) {
    const candidates = matchingHistory(await search(query, title, kind, zoneId), event, kind);
    if (candidates.length) return candidates;
  }
  return [];
}

/**
 * Roon's search index names a recording by its catalogue title, while transport reports
 * the album's own track title, so searching for the played title finds nothing for most
 * classical and compilation plays. The recorded album lists the played title itself, and
 * identifying the album first also keeps the edition that actually played.
 */
async function tracksOnRecordedAlbum(event: HistoryEvent, zoneId?: string) {
  if (!event.album) return { albums: 0, tracks: [] as CinemaMusicItem[] };
  const albums = await findCandidates(event, "albums", zoneId, albumQueries(event));
  for (const album of albums.slice(0, editionsOpened)) {
    const page = await browseHistoryMusic(album.path, zoneId);
    // Keep the listed track numbers: they are all that separates repeated titles.
    const tracks = page.items.filter(
      (item) => item.kind === "track" && normalize(trackTitle(item.title)) === normalize(event.title)
    );
    if (tracks.length) return { albums: albums.length, tracks };
  }
  return { albums: albums.length, tracks: [] as CinemaMusicItem[] };
}

function resolution(candidates: CinemaMusicItem[], kind: HistoryKind, missing?: string) {
  return {
    choices: candidates
      .slice(0, 100)
      .map((item: CinemaMusicItem) => ({ ...item, kind: kind === "albums" ? "album" : "track" })),
    message: candidates.length
      ? "Choose the recording or edition you want."
      : (missing ?? "This music could not be found in Roon."),
  };
}

/** Search more broadly when necessary, but always match the original title and saved metadata. */
export async function resolveHistory(event: HistoryEvent, kind: HistoryKind, zoneId?: string) {
  const title = kind === "albums" ? event.album : event.title;
  if (!title) throw new Error("This play has no album information.");
  if (kind === "albums") return resolution(await findCandidates(event, kind, zoneId, albumQueries(event)), kind);
  const recorded = await tracksOnRecordedAlbum(event, zoneId);
  if (recorded.tracks.length) return resolution(recorded.tracks, kind);
  const searched = await findCandidates(event, kind, zoneId, [title, withoutRemaster(title)]);
  return resolution(
    searched,
    kind,
    recorded.albums
      ? "This recording could not be found in Roon. Its album is listed under Albums."
      : "This music could not be found in Roon."
  );
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
