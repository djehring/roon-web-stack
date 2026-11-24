import { randomUUID } from "node:crypto";
import { logger, roon } from "@infrastructure";
import {
  DiscoveryIntent,
  DiscoveryMode,
  interpretDiscovery,
  ReleaseEvidence,
  researchReleases,
} from "../ai-service/discovery-ai";
import { Track } from "../ai-service/types/track";
import { catalogueReleaseDates } from "./catalogue-release-dates";
import {
  browseCinemaMusic,
  CinemaMusicItem,
  importCinemaMusic,
  performMusicAction,
  playLocatedCinemaTrack,
} from "./cinema-music";
import { CinemaMusicPath } from "./cinema-music-model";
import {
  completeWork,
  creditsMatch,
  hasWork,
  movementMatches,
  musicWords,
  plainCredit,
  releaseFor,
  workTracks,
} from "./discovery-matching";
import { matchesArtist, matchesTrackTitle } from "./matching-utils";
import { scrapeUKChartData } from "./uk-chart-scraper";

export interface DiscoveryResult {
  id: string;
  kind: "track" | "album";
  title: string;
  artist: string;
  album: string;
  imageKey?: string;
  available: boolean;
  reason?: string;
  path?: CinemaMusicPath;
  tracks: Track[];
  workTracks: Track[];
  workTitle?: string;
  release?: ReleaseEvidence;
}
export interface DiscoveryResponse {
  mode: "tracks" | "albums";
  query: string;
  message: string;
  results: DiscoveryResult[];
}
interface SearchDependencies {
  interpret: typeof interpretDiscovery;
  research: typeof researchReleases;
  browse: typeof browseCinemaMusic;
  contents: typeof importCinemaMusic;
  /** The published chart for the week containing a YYYY-MM-DD date, in chart order. */
  chart: (date: string) => Promise<Track[]>;
  /** Release dates from the music catalogue alone, which answers in about a second. */
  dates: typeof catalogueReleaseDates;
}
const dependencies: SearchDependencies = {
  interpret: interpretDiscovery,
  research: researchReleases,
  browse: browseCinemaMusic,
  contents: importCinemaMusic,
  chart: (date) => scrapeUKChartData(date.replace(/-/g, "")),
  dates: catalogueReleaseDates,
};
const cache = new Map<string, { client: string; expires: number; result: DiscoveryResult }>();
const busyRooms = new Set<string>();

async function catalog(query: string, kind: "Albums" | "Tracks", deps: SearchDependencies): Promise<CinemaMusicItem[]> {
  const page = await deps.browse({ hierarchy: "search", query, steps: [] });
  const group = page.items.find((item) => item.title === kind && item.kind === "list");
  if (group) return (await deps.browse(group.path)).items;
  return page.items.filter((item) => (kind === "Tracks" ? item.kind === "track" : item.kind === "list"));
}
function unavailable(track: Track, reason: string): DiscoveryResult {
  return {
    id: randomUUID(),
    kind: "track",
    title: track.track,
    artist: track.artist,
    album: track.album,
    available: false,
    reason,
    tracks: [],
    workTracks: [],
  };
}
function cleanTrack(track: Track): Track {
  return {
    ...track,
    artist: plainCredit(track.artist),
    track: plainCredit(track.track),
    album: plainCredit(track.album),
  };
}
function trackResult(track: Track): DiscoveryResult {
  return {
    id: randomUUID(),
    kind: "track",
    title: track.track,
    artist: track.artist,
    album: track.album,
    imageKey: track.imageKey,
    available: true,
    path: track.roonPath,
    tracks: [track],
    workTracks: [],
  };
}

const DECORATED = /\b(?:live|karaoke|demo|remix|instrumental)\b/i;
const JOINT_BILLING = /\s+(?:and|&|feat\.?|featuring|ft\.?|with|vs\.?)\s+|\s*\/\s*/i;

/**
 * Prefer the plain recording over an unrequested live or karaoke version, and the
 * full requested billing over its lead artist alone. Ties keep Roon's own order.
 */
function recordingRank(item: CinemaMusicItem, track: Track): number[] {
  return [
    DECORATED.test(item.title) && !DECORATED.test(track.track) ? 1 : 0,
    matchesArtist(track.artist, item.subtitle) ? 0 : 1,
  ];
}

async function resolveTrack(track: Track, deps: SearchDependencies, leadArtist = ""): Promise<DiscoveryResult> {
  const artists = [track.artist, leadArtist].filter(Boolean);
  // Roon credits songwriters beside performers, so a title search can rank a
  // cover that credits the original artist first. Naming the artist in the
  // query makes Roon rank that artist's own recording first.
  const queries = [...artists.map((artist) => `${track.track} ${artist}`), track.track];
  for (const query of new Set(queries)) {
    const items = await catalog(query, "Tracks", deps);
    const matches = items
      .filter(
        (item) =>
          item.kind === "track" &&
          matchesTrackTitle(track.track, item.title) &&
          artists.some((artist) => matchesArtist(artist, item.subtitle))
      )
      .map((item) => ({ item, rank: recordingRank(item, track) }))
      .sort((left, right) => left.rank.map((value, index) => value - right.rank[index]).find(Boolean) ?? 0)
      .map((match) => match.item);
    for (const match of matches.slice(0, 3)) {
      try {
        const tracks = await deps.contents(match.path);
        if (tracks.length === 1 && tracks[0].roonPath) return trackResult(cleanTrack(tracks[0]));
      } catch {
        /* Another catalogue entry may still be available. */
      }
    }
  }
  return unavailable(track, "This recording could not be verified in Roon.");
}

/** Independent browse sessions allow a few lookups at once; results keep their requested order. */
async function resolveTracks(
  tracks: Track[],
  deps: SearchDependencies,
  leadArtist: (track: Track) => string = () => ""
): Promise<DiscoveryResult[]> {
  const results: DiscoveryResult[] = [];
  for (let index = 0; index < tracks.length; index += 3)
    results.push(
      ...(await Promise.all(
        tracks.slice(index, index + 3).map((track) => resolveTrack(track, deps, leadArtist(track)))
      ))
    );
  return results;
}

/** Charts bill collaborations jointly; Roon often credits only the lead artist. */
function chartLeadArtist(track: Track): string {
  const lead = track.artist.split(JOINT_BILLING)[0].trim();
  return lead === track.artist ? "" : lead;
}

/** The chart supplies the artists and titles; only Roon can make them playable. */
async function chartTracks(chart: { date: string; count: number }, deps: SearchDependencies): Promise<Track[]> {
  const entries = await deps.chart(chart.date);
  if (!entries.length) throw new Error("The UK singles chart for that week could not be loaded. Please try again.");
  return entries.slice(0, chart.count).map((entry) => ({ artist: entry.artist, track: entry.track, album: "" }));
}

async function albumCandidates(intent: DiscoveryIntent, deps: SearchDependencies) {
  const found = new Map<string, CinemaMusicItem>();
  for (const term of new Set([intent.work, ...intent.terms].filter(Boolean))) {
    const items = await catalog(term, "Albums", deps);
    for (const item of items) {
      if (!creditsMatch(intent.performers, item.subtitle ?? "")) continue;
      const key = [musicWords(item.title), musicWords(item.subtitle ?? ""), item.imageKey ?? ""].join("|");
      if (!found.has(key)) found.set(key, item);
    }
  }
  return [...found.values()].slice(0, 80);
}
async function resolveAlbum(
  item: CinemaMusicItem,
  intent: DiscoveryIntent,
  deps: SearchDependencies
): Promise<DiscoveryResult | undefined> {
  const tracks = (await deps.contents(item.path)).map(cleanTrack);
  if (!tracks.length || tracks.some((track) => !track.roonPath)) return;
  const selected = workTracks(tracks, intent);
  if (intent.work && !hasWork(item.title, intent) && !selected.length) return;
  const composer = musicWords(intent.composer).split(" ").at(-1);
  if (
    composer &&
    !musicWords(item.title + " " + tracks.map((track) => track.artist).join(" "))
      .split(" ")
      .includes(composer)
  )
    return;
  // Do not substitute piano arrangements or excerpts for an orchestral work.
  if (intent.work && selected.some((track) => /\b(?:arr\.|(?:arranged|version for|re:scored)\b)/i.test(track.track)))
    return;
  const complete = completeWork(selected, intent);
  if (intent.mode === "albums" && intent.work && intent.workScope !== "collection" && !complete) return;
  return {
    id: randomUUID(),
    kind: "album",
    title: item.title,
    artist: plainCredit(item.subtitle ?? tracks[0].artist),
    album: item.title,
    imageKey: item.imageKey,
    available: true,
    path: item.path,
    tracks,
    workTracks: complete ? selected : [],
    workTitle: complete ? intent.work : undefined,
  };
}

const FILLER = new Set(["by", "the", "and", "a", "an"]);
const namedWords = (value: string) =>
  musicWords(value)
    .split(" ")
    .filter((word) => word && !FILLER.has(word))
    .sort()
    .join(" ");
/** Edition notes such as (MFiT Version) are not part of the name someone asks for. */
const baseTitle = (title: string) => title.replace(/\s*[([][^)\]]*[)\]]/g, "").trim() || title;
const itemCredits = (item: CinemaMusicItem) =>
  plainCredit(item.subtitle ?? "")
    .split(/\s*(?:,|\/|&|;)\s*/)
    .filter(Boolean);

/**
 * A request that is exactly a title plus one of its credited artists, such as
 * Old Sock by Eric Clapton, names that item outright. Returns that artist.
 */
function namedWithArtist(query: string, item: CinemaMusicItem): string | undefined {
  if (DECORATED.test(item.title) && !DECORATED.test(query)) return;
  const title = namedWords(baseTitle(item.title));
  if (!title) return;
  return itemCredits(item).find((credit) => {
    const artist = namedWords(credit);
    return !!artist && namedWords(`${title} ${artist}`) === namedWords(query);
  });
}
/** A request that is exactly a title, such as Rockferry. Only Roon's own top result may claim it. */
function namedByTitle(query: string, item: CinemaMusicItem): string | undefined {
  if (DECORATED.test(item.title) && !DECORATED.test(query)) return;
  return namedWords(baseTitle(item.title)) === namedWords(query) ? itemCredits(item)[0] : undefined;
}

function applyReleases(results: DiscoveryResult[], releases: ReleaseEvidence[]) {
  for (const result of results) {
    const release = releaseFor(result.album, result.artist, releases);
    // Metadata can shortlist an album before its contents are loaded. Preserve
    // only the year if the eventual track count differs from the dated edition.
    result.release =
      release && result.kind === "album" && release.trackCount && release.trackCount !== result.tracks.length
        ? { ...release, releaseDate: release.releaseDate.slice(0, 4) }
        : release;
  }
}

const NAMED_ALBUM: DiscoveryIntent = {
  kind: "albums",
  mode: "albums",
  terms: [],
  composer: "",
  work: "",
  workScope: "none",
  workAliases: [],
  movement: "",
  movementCount: 0,
  performers: [],
  recent: false,
  limit: 3,
  tracks: [],
};

/**
 * Roon's own search answers in a second or two, so music named outright is
 * returned from it without waiting for interpretation or web research.
 */
async function namedMusic(
  query: string,
  mode: DiscoveryMode,
  deps: SearchDependencies
): Promise<DiscoveryResponse | undefined> {
  // Roon matches every word, so a connecting "by" hides the album it would otherwise find.
  const search = query
    .replace(/\bby\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!search) return;
  const page = await deps.browse({ hierarchy: "search", query: search, steps: [] });
  const group = async (name: string) => {
    const list = page.items.find((item) => item.title === name && item.kind === "list");
    return list ? (await deps.browse(list.path)).items : [];
  };
  const [albumItems, trackItems] = await Promise.all([
    mode === "tracks" ? [] : group("Albums"),
    mode === "albums" ? [] : group("Tracks"),
  ]);
  const same = (left: CinemaMusicItem) => (right: CinemaMusicItem) =>
    left.title === right.title && plainCredit(left.subtitle ?? "") === plainCredit(right.subtitle ?? "");
  // Roon lists its best match first, above the groups. It is an album or a track
  // only if the matching group lists it too; an artist or composer is neither.
  const top = page.items.at(0);
  const topAlbum = top && albumItems.find(same(top));
  const topTrack = top && !topAlbum ? trackItems.find(same(top)) : undefined;
  const named = (item: CinemaMusicItem) => namedWithArtist(query, item) ?? namedByTitle(query, item);

  let album = topAlbum && named(topAlbum) ? topAlbum : undefined;
  let track = topTrack && named(topTrack) ? topTrack : undefined;
  if (!album && !track) {
    // Below the top result only a title with its artist is specific enough, and
    // a title shared by an album and its title track needs interpretation to choose.
    album = albumItems.find((item) => item.kind === "list" && namedWithArtist(query, item));
    track = trackItems.find((item) => item.kind === "track" && namedWithArtist(query, item));
    if (album && track) return;
  }
  if (track) {
    const artist = named(track) ?? namedWithArtist(query, track) ?? "";
    const result = await resolveTrack({ track: baseTitle(track.title), artist, album: "" }, deps);
    if (result.available) return { mode: "tracks", query, message: "Found in Roon by name.", results: [result] };
    return;
  }
  if (!album) return;
  const chosen = album;
  const artist = named(chosen) ?? namedWithArtist(query, chosen) ?? "";
  const editions = [
    chosen,
    ...albumItems.filter(
      (item) =>
        item !== chosen &&
        item.kind === "list" &&
        namedWords(baseTitle(item.title)) === namedWords(baseTitle(chosen.title)) &&
        matchesArtist(artist, item.subtitle) &&
        (!DECORATED.test(item.title) || DECORATED.test(query))
    ),
  ].slice(0, NAMED_ALBUM.limit);
  // Editions load in their own browse sessions, so a few can load at once.
  const loaded = await Promise.all(
    editions.map((item) => resolveAlbum(item, NAMED_ALBUM, deps).catch(() => undefined))
  );
  const results = loaded.filter((result) => result !== undefined);
  if (!results.length) return;
  const releases = await deps
    .dates(results.map((result) => ({ title: result.album, artist: result.artist, trackCount: result.tracks.length })))
    .catch(() => []);
  applyReleases(results, releases);
  return { mode: "albums", query, message: "Found in Roon by name.", results };
}

function compareReleases(a?: ReleaseEvidence, b?: ReleaseEvidence): number {
  const rank = (release?: ReleaseEvidence) => (!release ? 2 : release.reissue ? 1 : 0);
  return rank(a) - rank(b) || (b?.releaseDate ?? "").localeCompare(a?.releaseDate ?? "");
}

async function selectAlbums(items: CinemaMusicItem[], intent: DiscoveryIntent, deps: SearchDependencies) {
  const results: DiscoveryResult[] = [];
  const batchSize = 3;
  const pool = intent.recent ? items.slice(0, Math.max(20, intent.limit * 3)) : items;
  let checked = 0;
  for (let index = 0; index < pool.length && results.length < intent.limit; index += batchSize) {
    // Every import uses its own Roon browse session. Keep concurrency bounded
    // and consume results in ranked order, regardless of which request finishes first.
    const batch = await Promise.allSettled(
      pool.slice(index, index + batchSize).map((item) => resolveAlbum(item, intent, deps))
    );
    checked += batch.length;
    for (const outcome of batch) {
      if (outcome.status !== "fulfilled" || !outcome.value) continue;
      const album = outcome.value;
      if (intent.mode === "albums") results.push(album);
      else
        results.push(
          ...workTracks(album.tracks, intent)
            .filter((track) => movementMatches(track.track, intent.movement))
            .map(trackResult)
        );
    }
  }
  return { results: results.slice(0, intent.limit), checked };
}

function reportStage(stage: string, started: number, details: Record<string, unknown>) {
  logger.info({ stage, durationMs: Date.now() - started, ...details }, "Music discovery progress");
}

export async function discoverMusic(
  query: string,
  mode: DiscoveryMode,
  deps = dependencies
): Promise<DiscoveryResponse> {
  const started = Date.now();
  // Interpretation starts at once, so a request Roon cannot answer by name loses no time.
  const interpreting = deps.interpret(query, mode);
  interpreting.catch(() => undefined);
  const named = await namedMusic(query, mode, deps).catch(() => undefined);
  if (named) {
    reportStage("named", started, { query, mode: named.mode, results: named.results.length });
    return named;
  }
  const intent = await interpreting;
  reportStage("interpret", started, { query, kind: intent.kind, recent: intent.recent });
  let researchFailed = false;
  let releases: ReleaseEvidence[] | undefined;
  let results: DiscoveryResult[] = [];
  if (intent.kind === "chart" && intent.chart) {
    const chartStarted = Date.now();
    const entries = await chartTracks(intent.chart, deps);
    results = await resolveTracks(entries, deps, chartLeadArtist);
    reportStage("chart", chartStarted, {
      query,
      week: intent.chart.date,
      entries: entries.length,
      playable: results.filter((result) => result.available).length,
    });
  } else if (intent.kind === "albums" || intent.kind === "classical") {
    const catalogueStarted = Date.now();
    const items = await albumCandidates(intent, deps);
    reportStage("catalogue", catalogueStarted, { query, candidates: items.length });
    if (intent.recent && items.length) {
      const datesStarted = Date.now();
      const candidates = [
        ...new Map(
          items.map((item) => {
            const candidate = { title: item.title, artist: plainCredit(item.subtitle ?? "") };
            return [JSON.stringify(candidate), candidate];
          })
        ).values(),
      ];
      try {
        releases = await deps.research(query, candidates, {
          recent: true,
          terms: [[intent.composer, intent.work || intent.terms[0]].filter(Boolean).join(" "), ...intent.terms],
          limit: intent.limit,
        });
      } catch {
        researchFailed = true;
        releases = [];
      }
      items.sort((a, b) =>
        compareReleases(
          releaseFor(a.title, plainCredit(a.subtitle ?? ""), releases ?? []),
          releaseFor(b.title, plainCredit(b.subtitle ?? ""), releases ?? [])
        )
      );
      reportStage("dates", datesStarted, { query, datedCandidates: releases.length });
    }
    const verificationStarted = Date.now();
    const selection = await selectAlbums(items, intent, deps);
    results = selection.results;
    reportStage("verify", verificationStarted, { query, checked: selection.checked, results: results.length });
  } else {
    results = await resolveTracks(intent.tracks, deps);
  }
  if (
    releases === undefined &&
    (intent.mode === "albums" || intent.recent) &&
    results.some((result) => result.available)
  ) {
    const candidates = [
      ...new Map(
        results
          .filter((result) => result.available)
          .map((result) => {
            const candidate = {
              title: result.album,
              artist: result.artist,
              trackCount: result.kind === "album" ? result.tracks.length : undefined,
            };
            return [JSON.stringify(candidate), candidate];
          })
      ).values(),
    ];
    try {
      // Only a latest search needs every date, to rank by. Web research can take
      // a minute or more, so other searches show the dates the catalogue has.
      releases = intent.recent
        ? await deps.research(query, candidates, { recent: true })
        : await deps.dates(candidates);
    } catch {
      researchFailed = true;
    }
  }
  applyReleases(results, releases ?? []);
  if (intent.recent) results.sort((a, b) => compareReleases(a.release, b.release));
  const unique = new Map(
    results.map((result) => [JSON.stringify(result.path ?? result.title + result.artist), result])
  );
  results = [...unique.values()].slice(0, intent.limit);
  let message =
    intent.mode === "albums"
      ? intent.work
        ? intent.workScope === "collection"
          ? `Albums featuring ${intent.work}.`
          : `Albums containing the complete ${intent.work}.`
        : "Albums verified in Roon."
      : "Recordings verified in Roon.";
  if (intent.recent)
    message +=
      researchFailed || !results.some((item) => item.release)
        ? " Release dates could not be verified; these results are not ranked as the latest."
        : " Newest verified releases first; known reissues and albums with unknown dates follow. Availability is limited to your Roon catalogue.";
  if (intent.chart) {
    const week = new Date(`${intent.chart.date}T00:00:00Z`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    const missing = results.filter((result) => !result.available).length;
    message = `UK singles chart for the week of ${week}, in chart order.`;
    if (missing) message += ` ${missing} of ${results.length} could not be verified in Roon.`;
  }
  if (!results.length)
    message = "No matching playable recordings were verified in Roon. Try a performer or album title.";
  reportStage("complete", started, {
    query,
    results: results.length,
    datedResults: results.filter((result) => result.release).length,
  });
  return { mode: intent.mode, query, message, results };
}

export function rememberDiscovery(client: string, response: DiscoveryResponse): DiscoveryResponse {
  for (const [id, entry] of cache) if (entry.expires < Date.now()) cache.delete(id);
  for (const result of response.results) cache.set(result.id, { client, expires: Date.now() + 30 * 60_000, result });
  while (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return response;
}

function requiredPath(path?: CinemaMusicPath): CinemaMusicPath {
  if (!path) throw new Error("This recording is no longer available. Search again.");
  return path;
}

async function refreshSelection(result: DiscoveryResult, zone: string): Promise<void> {
  const current = (await importCinemaMusic(requiredPath(result.path), zone)).map(cleanTrack);
  const identity = (tracks: Track[]) => tracks.map((track) => [track.track, track.artist, track.album]);
  if (JSON.stringify(identity(current)) !== JSON.stringify(identity(result.tracks))) {
    throw new Error("This recording has changed since the search. Please search again.");
  }
}

/** Playback accepts only a server-resolved selection belonging to this client. */
export async function playDiscovery(
  client: string,
  zone: string,
  selection: { ids: string[]; workOnly: boolean }
): Promise<Track[]> {
  if (busyRooms.has(zone)) throw new Error("A music selection is already being queued in this room.");
  const results = selection.ids.map((id) => {
    const saved = cache.get(id);
    if (!saved || saved.client !== client || saved.expires < Date.now())
      throw new Error("These results have expired. Please search again.");
    if (!saved.result.available || !saved.result.path) throw new Error("This recording is unavailable.");
    if (selection.workOnly && !saved.result.workTracks.length)
      throw new Error("The complete work was not verified on this album.");
    return saved.result;
  });
  if (!results.length) throw new Error("Select some music first.");
  busyRooms.add(zone);
  try {
    // Refresh all selections before modifying the queue. Paths validate title,
    // credits and artwork in fresh isolated browse sessions, never stale keys.
    for (const result of results) await refreshSelection(result, zone);
    const core = await roon.server();
    const room = core.services.RoonApiTransport.zone_by_zone_id(zone);
    if (!room) throw new Error("Choose an available Roon room.");
    await core.services.RoonApiTransport.change_settings(room, { shuffle: false });
    const expected: Track[] = [];
    let first = true;
    for (const result of results) {
      const tracks = selection.workOnly ? result.workTracks : result.tracks;
      if (result.kind === "album" && !selection.workOnly) {
        await performMusicAction(requiredPath(result.path), zone, first ? "Play Now" : "Queue");
        first = false;
      } else {
        for (const track of tracks) {
          await playLocatedCinemaTrack(requiredPath(track.roonPath), zone, first);
          first = false;
        }
      }
      expected.push(...tracks);
    }
    return expected;
  } finally {
    busyRooms.delete(zone);
  }
}
