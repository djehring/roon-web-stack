import { cinemaProgress } from "./cinema-responses";
import { mapCinemaWork } from "./cinema-work";
import type {
  CapsuleImage,
  CapsuleRequest,
  CapsuleScene,
  TimeCapsule,
} from "./time-capsule";

interface GalleryCandidate extends Omit<CapsuleImage, "file"> {
  downloadUrl: string;
  originalUrl?: string;
}
interface GallerySearch {
  query: string;
  topic: string;
  album?: string;
}
interface GallerySources {
  previousSources?: Set<string>;
  search: (query: string) => Promise<GalleryCandidate[]>;
  eligible: (candidate: GalleryCandidate) => GalleryCandidate | undefined;
  matches: (scene: CapsuleScene, candidate: GalleryCandidate) => boolean;
  save: (candidate: GalleryCandidate) => Promise<CapsuleImage | undefined>;
  review: (capsule: TimeCapsule) => Promise<void>;
}

/** Artist galleries use archive captions; only contextual stories need research. */
export function isArtistGallery(request: CapsuleRequest): boolean {
  const options = request.options;
  const artist = normalized(request.tracks[0]?.artist ?? "").split(" ");
  const subject = normalized(options?.subject ?? "")
    .split(" ")
    .filter(
      (word) =>
        ![
          "the",
          "of",
          "best",
          "greatest",
          "hits",
          "playlist",
          "music",
          "songs",
          "tracks",
        ].includes(word)
    );
  return (
    options?.mode === "artist" &&
    // Short ambiguous names such as Queen still need the research resolver.
    artist.length > 1 &&
    subject.length > 0 &&
    subject.every((word) => artist.includes(word)) &&
    !options.periodStart &&
    !options.periodEnd &&
    options.topics.every((topic) =>
      ["artistImages", "career", "albumCovers"].includes(topic)
    ) &&
    new Set(request.tracks.map((track) => track.artist.trim().toLowerCase()))
      .size === 1
  );
}

function gallerySearches(request: CapsuleRequest): GallerySearch[] {
  const artist = `"${request.tracks[0].artist.replace(/["\\]/g, " ")}"`;
  const topics = request.options?.topics ?? [];
  const searches: GallerySearch[] = [];
  if (topics.includes("artistImages"))
    searches.push({ topic: "artistImages", query: artist });
  if (topics.includes("career"))
    searches.push({ topic: "career", query: `${artist} concert` });
  if (topics.includes("albumCovers")) {
    const albums = [
      ...new Set(request.tracks.map((track) => track.album).filter(Boolean)),
    ].slice(0, 10);
    searches.push(
      ...albums.map((album) => ({
        topic: "albumCovers",
        album,
        query: `${artist} ${album} album cover`,
      }))
    );
  }
  return searches;
}

const normalized = (value: string) =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function galleryScene(
  artist: string,
  search: GallerySearch,
  image: GalleryCandidate
): CapsuleScene {
  const caption = image.description
    .replace(/^English:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    id: "",
    title: search.album ? `${artist} — ${search.album}` : artist,
    body: search.topic === "career" ? caption.slice(0, 360) : "",
    dateLabel: image.date,
    scope: "Music",
    topic: search.topic,
    imageSubjects: [artist],
    trackIndices: [],
    sources: [{ title: image.credit, url: image.sourceUrl }],
    eventStart: /upload/i.test(image.date)
      ? undefined
      : image.date.match(/\b(?:18|19|20)\d{2}\b/)?.[0],
  };
}

function matchesGallery(
  search: GallerySearch,
  image: GalleryCandidate
): boolean {
  const description = `${image.sourceUrl} ${image.description}`;
  if (search.album)
    return (
      /\b(?:cover|sleeve|artwork)\b/i.test(description) &&
      normalized(description).includes(normalized(search.album))
    );
  return !/\b(?:statue|sculpture|mural|waxwork|tribute|impersonator|lookalike|memorial|cropped|painting|drawing|caricature|watercolou?r|engraving|illustration|sketch|poster|logo)\b/i.test(
    description
  );
}

/** Prefer a spread of photographic dates over twelve shots from one concert. */
function variedDates<T extends { candidate: GalleryCandidate }>(
  items: T[]
): T[] {
  const dates = new Set<string>();
  const first: T[] = [];
  const remaining: T[] = [];
  for (const item of items) {
    const date =
      item.candidate.date.match(/\b(?:18|19|20)\d{2}\b/)?.[0] ??
      item.candidate.date;
    (dates.has(date) ? remaining : first).push(item);
    dates.add(date);
  }
  return [...first, ...remaining];
}

function galleryChoices<T extends { candidate: GalleryCandidate }>(
  groups: T[][]
): T[] {
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

export async function illustrateArtistGallery(
  capsule: TimeCapsule,
  sources: GallerySources
): Promise<void> {
  const artist = capsule.request.tracks[0].artist;
  await cinemaProgress(`Finding photographs of ${artist}…`);
  const groups = await mapCinemaWork(
    gallerySearches(capsule.request),
    3,
    async (search) => {
      const candidates = await sources.search(search.query).catch(() => []);
      return variedDates(
        candidates.flatMap((item) => {
          const candidate = sources.eligible(item);
          if (!candidate || !matchesGallery(search, candidate)) return [];
          const scene = galleryScene(artist, search, candidate);
          return sources.matches(scene, candidate)
            ? [{ candidate, scene }]
            : [];
        })
      ).sort(
        (a, b) =>
          Number(sources.previousSources?.has(a.candidate.sourceUrl) ?? false) -
          Number(sources.previousSources?.has(b.candidate.sourceUrl) ?? false)
      );
    }
  );
  const choices = galleryChoices(groups);
  await cinemaProgress(`Downloading ${choices.length} artist pictures…`);
  const scenes = await mapCinemaWork(
    choices,
    3,
    async ({ candidate, scene }, index) => {
      const image = await sources.save(candidate).catch(() => undefined);
      return image
        ? { ...scene, id: `gallery-${index}`, image, images: [image] }
        : undefined;
    }
  );
  capsule.scenes = scenes.filter(
    (scene): scene is NonNullable<typeof scene> => !!scene
  );
  delete capsule.contextImage;
  await sources.review(capsule);
}
