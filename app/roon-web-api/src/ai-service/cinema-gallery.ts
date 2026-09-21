import { cinemaProgress } from "./cinema-responses";
import { mapCinemaWork } from "./cinema-work";
import type { CapsuleImage, CapsuleRequest, CapsuleScene, TimeCapsule } from "./time-capsule";

interface GalleryCandidate extends Omit<CapsuleImage, "file"> {
  downloadUrl: string;
  originalUrl?: string;
}
interface GallerySearch {
  query: string;
  topic: string;
  /** One-word namesakes must use Wikipedia/Openverse, not a Commons filename dump. */
  entity?: boolean;
}
interface GallerySources {
  previousSources?: Set<string>;
  search: (query: string) => Promise<GalleryCandidate[]>;
  fallbackSearch?: (query: string) => Promise<GalleryCandidate[]>;
  eligible: (candidate: GalleryCandidate) => GalleryCandidate | undefined;
  matches: (scene: CapsuleScene, candidate: GalleryCandidate) => boolean;
  save: (candidate: GalleryCandidate) => Promise<CapsuleImage | undefined>;
  review: (capsule: TimeCapsule) => Promise<void>;
}

/** One-word names that collide with places, royalty or common English. */
const ambiguousOneWordArtists = new Set([
  "alabama",
  "america",
  "asia",
  "berlin",
  "boston",
  "chicago",
  "cream",
  "eagles",
  "europe",
  "georgia",
  "heart",
  "journey",
  "kansas",
  "kiss",
  "london",
  "paris",
  "phoenix",
  "police",
  "prince",
  "queen",
  "rush",
  "texas",
  "who",
  "yes",
]);

function distinctiveArtistName(artist: string[]): boolean {
  if (artist.length > 1) return true;
  return artist.length === 1 && !ambiguousOneWordArtists.has(artist[0]);
}

/** Artist galleries use archive captions; only contextual stories need research. */
export function isArtistGallery(request: CapsuleRequest): boolean {
  const options = request.options;
  const artist = normalized(request.tracks[0]?.artist ?? "").split(" ");
  const subject = normalized(options?.subject ?? "")
    .split(" ")
    .filter(
      (word) => !["the", "of", "best", "greatest", "hits", "playlist", "music", "songs", "tracks"].includes(word)
    );
  return (
    options?.mode === "artist" &&
    // Short ambiguous names such as Queen still need the research resolver.
    distinctiveArtistName(artist) &&
    subject.length > 0 &&
    subject.every((word) => artist.includes(word)) &&
    !options.periodStart &&
    !options.periodEnd &&
    options.topics.every((topic) => ["artistImages", "career", "albumCovers"].includes(topic)) &&
    new Set(request.tracks.map((track) => track.artist.trim().toLowerCase())).size === 1
  );
}

/** Extra topics must not send simple artist pictures back through biography research. */
export function artistGalleryRequest(request: CapsuleRequest): CapsuleRequest | undefined {
  if (!request.options) return undefined;
  const topics = request.options.topics.filter((topic) => ["artistImages", "career"].includes(topic));
  if (!topics.length) return undefined;
  const gallery = { ...request, options: { ...request.options, topics } };
  return isArtistGallery(gallery) ? gallery : undefined;
}

function gallerySearches(request: CapsuleRequest): GallerySearch[] {
  const name = request.tracks[0].artist.replace(/["\\]/g, " ").trim();
  const artist = `"${name}"`;
  const oneWord = !/\s/.test(name);
  const topics = request.options?.topics ?? [];
  const searches: GallerySearch[] = [];
  if (topics.includes("artistImages")) {
    searches.push(
      oneWord ? { topic: "artistImages", query: name, entity: true } : { topic: "artistImages", query: artist }
    );
  }
  if (topics.includes("career")) {
    searches.push(
      oneWord
        ? { topic: "career", query: `${name} concert`, entity: true }
        : { topic: "career", query: `${artist} concert` }
    );
  }
  return searches;
}

function albumTracks(request: CapsuleRequest) {
  const albums = new Set<string>();
  return request.tracks.filter((track) => {
    const album = track.album.trim();
    const key = track.imageKey || JSON.stringify([normalized(track.artist), normalized(album)]);
    return (album || track.imageKey) && !albums.has(key) && albums.add(key);
  });
}

function albumCoverScene(track: CapsuleRequest["tracks"][number], image: CapsuleImage, index: number): CapsuleScene {
  return {
    id: `roon-cover-${index}`,
    title: `${track.artist} — ${track.album || track.track}`,
    body: "",
    dateLabel: "Roon library artwork",
    scope: "Music",
    topic: "albumCovers",
    imageSubjects: [track.artist, track.album],
    trackIndices: [],
    sources: [{ title: "Artwork supplied by Roon", url: image.sourceUrl }],
    image,
    images: [image],
  };
}

/** Roon browse is serialized and time-boxed: artwork must never hold up a montage. */
export async function attachRoonAlbumCovers(
  capsule: TimeCapsule,
  cover: (track: CapsuleRequest["tracks"][number]) => Promise<CapsuleImage | undefined>,
  budgetMs = 30_000
): Promise<void> {
  if (!capsule.request.options?.topics.includes("albumCovers")) return;
  // Never leave a web-researched or old cover in place when Roon has no match.
  capsule.scenes = capsule.scenes.filter((scene) => scene.topic !== "albumCovers");
  const tracks = albumTracks(capsule.request);
  await cinemaProgress(`Collecting album covers from Roon (0/${tracks.length})…`);
  const deadline = Date.now() + budgetMs;
  const covers: (CapsuleScene | undefined)[] = [];
  for (const [index, track] of tracks.entries()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const image = await Promise.race([
      cover(track).catch(() => undefined),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          resolve(undefined);
        }, remaining);
      }),
    ]).finally(() => {
      clearTimeout(timer);
    });
    covers.push(image ? albumCoverScene(track, image, index) : undefined);
    await cinemaProgress(`Collecting album covers from Roon (${index + 1}/${tracks.length})…`);
  }
  const resolved = covers.filter((scene): scene is NonNullable<typeof scene> => !!scene);
  if (!resolved.length) return;
  capsule.scenes.push(...resolved);
}

const normalized = (value: string) =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function galleryScene(artist: string, search: GallerySearch, image: GalleryCandidate): CapsuleScene {
  const caption = image.description
    .replace(/^English:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    id: "",
    title: artist,
    body: search.topic === "career" ? caption.slice(0, 360) : "",
    dateLabel: image.date,
    scope: "Music",
    topic: search.topic,
    imageSubjects: [artist],
    trackIndices: [],
    sources: [{ title: image.credit, url: image.sourceUrl }],
    eventStart: /upload/i.test(image.date) ? undefined : image.date.match(/\b(?:18|19|20)\d{2}\b/)?.[0],
  };
}

function matchesGallery(image: GalleryCandidate): boolean {
  const description = `${image.sourceUrl} ${image.description} ${image.credit}`;
  return !/\b(?:statue|sculpture|mural|waxwork|tribute|impersonator|lookalike|memorial|cropped|painting|drawing|caricature|watercolou?r|engraving|illustration|sketch|poster|logo|football|baseball|basketball|soccer|hockey|vanderbilt|navy|vinyl|a-side|b-side|home computer|7["”″]?\s*single|petty officer|seaman|musician 1st class|musician first class|navy band|\d{6}-n-[a-z0-9]+|holden|opel|vauxhall|berlina|sedan|coupe|hatchback|automobile|saloon)\b/i.test(
    description
  );
}

/** Prefer a spread of photographic dates over twelve shots from one concert. */
function variedDates<T extends { candidate: GalleryCandidate }>(items: T[]): T[] {
  const dates = new Set<string>();
  const first: T[] = [];
  const remaining: T[] = [];
  for (const item of items) {
    const date = item.candidate.date.match(/\b(?:18|19|20)\d{2}\b/)?.[0] ?? item.candidate.date;
    (dates.has(date) ? remaining : first).push(item);
    dates.add(date);
  }
  return [...first, ...remaining];
}

function galleryChoices<T extends { candidate: GalleryCandidate }>(groups: T[][]): T[] {
  const seen = new Set<string>();
  const choices: T[] = [];
  while (choices.length < 18 && groups.some((group) => group.length)) {
    for (const group of groups) {
      let item = group.shift();
      while (item && seen.has(item.candidate.sourceUrl)) item = group.shift();
      if (!item || choices.length >= 18) continue;
      seen.add(item.candidate.sourceUrl);
      choices.push(item);
    }
  }
  return choices;
}

export async function illustrateArtistGallery(capsule: TimeCapsule, sources: GallerySources): Promise<void> {
  const artist = capsule.request.tracks[0].artist;
  await cinemaProgress(`Finding photographs of ${artist}…`);
  const groups = await mapCinemaWork(gallerySearches(capsule.request), 3, async (search) => {
    const choices = (candidates: GalleryCandidate[]) =>
      candidates.flatMap((item) => {
        const candidate = sources.eligible(item);
        if (!candidate || !matchesGallery(candidate)) return [];
        const scene = galleryScene(artist, search, candidate);
        return sources.matches(scene, candidate) ? [{ candidate, scene }] : [];
      });
    const lookup = search.entity && sources.fallbackSearch ? sources.fallbackSearch : sources.search;
    const primary = choices(await lookup(search.query).catch(() => []));
    const fallback =
      primary.length < 6 && sources.fallbackSearch && !search.entity
        ? choices(await sources.fallbackSearch(search.query).catch(() => []))
        : [];
    return variedDates([...primary, ...fallback]).sort(
      (a, b) =>
        Number(sources.previousSources?.has(a.candidate.sourceUrl) ?? false) -
        Number(sources.previousSources?.has(b.candidate.sourceUrl) ?? false)
    );
  });
  const choices = galleryChoices(groups);
  await cinemaProgress(`Downloading ${choices.length} candidate artist photos…`);
  const scenes = await mapCinemaWork(choices, 3, async ({ candidate, scene }, index) => {
    const image = await sources.save(candidate).catch(() => undefined);
    return image ? { ...scene, id: `gallery-${index}`, image, images: [image] } : undefined;
  });
  capsule.scenes = scenes.filter((scene): scene is NonNullable<typeof scene> => !!scene);
  delete capsule.contextImage;
  await sources.review(capsule);
}
