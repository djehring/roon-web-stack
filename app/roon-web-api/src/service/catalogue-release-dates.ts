import type { ReleaseEvidence } from "../ai-service/discovery-ai";
import { musicWords, sameAlbumTitle } from "./discovery-matching";
import { matchesArtist } from "./matching-utils";

export interface ReleaseCandidate {
  title: string;
  artist: string;
  trackCount?: number;
}
interface CatalogueAlbum {
  wrapperType: string;
  collectionType: string;
  collectionName: string;
  artistName: string;
  releaseDate: string;
  collectionViewUrl: string;
  trackCount: number;
}
const title = (value: string) => value.replace(/\s+(?:[-–—]\s*)?\(?(?:single|ep)\)?$/i, "").trim();
const credits = (value: string) =>
  value
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s*\/\s*/g, ", ")
    .trim();

/** Prefer catalogue metadata; reserve full dates for matching edition details. */
export async function catalogueReleaseDates(
  candidates: ReleaseCandidate[],
  terms: string[] = []
): Promise<ReleaseEvidence[]> {
  if (!candidates.length) return [];
  // Share an artist search across their albums and bound external catalogue work.
  const artists = [...new Set(candidates.map((item) => musicWords(credits(item.artist).split(/,|&|\band\b/i)[0])))];
  const queries = [...new Set([...terms.slice(0, 2).map(musicWords), ...artists].filter(Boolean))].slice(0, 5);
  const searches = await Promise.allSettled(
    queries.map(async (term) => {
      const url = new URL("https://itunes.apple.com/search");
      url.search = new URLSearchParams({
        term,
        media: "music",
        entity: "album",
        limit: "200",
        country: "GB",
      }).toString();
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("Catalogue release dates unavailable.");
      const data = (await response.json()) as { results: CatalogueAlbum[] };
      return data.results.filter((item) => item.wrapperType === "collection" && item.collectionType === "Album");
    })
  );
  const albums = searches.flatMap((outcome) => (outcome.status === "fulfilled" ? outcome.value : []));
  return candidates.flatMap((candidate) => {
    const matches = albums.filter((album) => {
      const date = album.releaseDate.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
      const parsed = new Date(`${date}T00:00:00Z`);
      return (
        Number.isFinite(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === date &&
        parsed <= new Date() &&
        sameAlbumTitle(title(candidate.title), title(album.collectionName)) &&
        matchesArtist(credits(candidate.artist), album.artistName) &&
        /^https:\/\/music\.apple\.com\//.test(album.collectionViewUrl)
      );
    });
    // Bonus tracks/booklets can differ between stores. A consistent release
    // year is still useful, but those editions cannot establish a precise day.
    if (!matches.length || new Set(matches.map((album) => album.releaseDate.slice(0, 4))).size !== 1) return [];
    const editions = matches.filter((album) => !candidate.trackCount || candidate.trackCount === album.trackCount);
    const album = editions[0] ?? matches[0];
    const date = album.releaseDate.slice(0, 10);
    const precise = editions.length > 0 && new Set(editions.map((item) => item.releaseDate.slice(0, 10))).size === 1;
    // January 1 is also used for year-only catalogue metadata. Preserve only
    // its year unless a separate source establishes the actual calendar date.
    const releaseDate = precise && !date.endsWith("-01-01") ? date : date.slice(0, 4);
    return [
      {
        title: candidate.title,
        artist: candidate.artist,
        releaseDate,
        recordingDate: "",
        reissue: /\b(?:remaster(?:ed)?|reissue|anniversary)\b/i.test(candidate.title),
        source: album.collectionViewUrl,
        trackCount: album.trackCount,
      },
    ];
  });
}
