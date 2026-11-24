import type { DiscoveryIntent, ReleaseEvidence } from "../ai-service/discovery-ai";
import type { Track } from "../ai-service/types/track";
import { matchesArtist } from "./matching-utils";

export const plainCredit = (value: string) => value.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, "$1");
export const musicWords = (value: string) =>
  plainCredit(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const words = (value: string) =>
  musicWords(value)
    .split(" ")
    .filter((word) => word && !["and", "the"].includes(word));

/** Formatting differences are harmless; every meaningful album-title word must remain. */
export function sameAlbumTitle(left: string, right: string): boolean {
  const a = [...new Set(words(left))].sort().join(" ");
  return !!a && a === [...new Set(words(right))].sort().join(" ");
}
export function hasWork(value: string, intent: DiscoveryIntent): boolean {
  // Collection titles use plurals; individual track headings use the singular.
  const normalize = (text: string) => musicWords(text).replace(/\b(?:concertos|concerti)\b/g, "concerto");
  const normalized = ` ${normalize(value)} `;
  return [intent.work, ...intent.workAliases]
    .filter(Boolean)
    .some((alias) => normalized.includes(` ${normalize(alias)} `));
}
export function workTracks(tracks: Track[], intent: DiscoveryIntent): Track[] {
  if (!intent.work) return tracks;
  return tracks.filter((track) =>
    hasWork(
      [
        track.track,
        ...(
          track.roonPath?.steps
            .slice(0, -1)
            .filter((step) => !sameAlbumTitle(step.title, track.album))
            .map((step) => step.title) ?? []
        ).slice(1),
      ].join(" "),
      intent
    )
  );
}
export function completeWork(tracks: Track[], intent: DiscoveryIntent): boolean {
  if (!intent.work || intent.workScope === "collection") return false;
  if (tracks.length < 2) return false;
  // An explicit count prevents excerpts and multiple performances in box sets
  // from being offered as a single complete recording.
  return intent.movementCount > 0 && tracks.length === intent.movementCount;
}
export function creditsMatch(requested: string[], listed: string): boolean {
  return requested.every((artist) => matchesArtist(artist, listed));
}
export function releaseFor(title: string, artist: string, releases: ReleaseEvidence[]): ReleaseEvidence | undefined {
  const matches = releases.filter(
    (release) => sameAlbumTitle(title, release.title) && matchesArtist(release.artist, artist)
  );
  // Conflicting dates/editions must not silently assign a new date to an old recording.
  if (new Set(matches.map((item) => `${item.releaseDate}:${item.reissue}`)).size !== 1) return;
  return matches[0];
}
export function movementMatches(title: string, movement: string): boolean {
  if (!movement) return true;
  const target = musicWords(movement);
  const actual = musicWords(title);
  if (target === "theme") return /\b(theme|enigma)\b.*\bandante\b/.test(actual) && !/\b(var|variation)\b/.test(actual);
  return words(movement).every((word) => actual.split(" ").includes(word));
}
