import { logger } from "@infrastructure";

export function normalizeString(str: string): string {
  if (!str) return "";

  // Log original string for debugging
  logger.debug(`Normalizing string: "${str}"`);

  const normalized = str
    .toLowerCase()
    .normalize("NFKD") // Decompose accented characters
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/\s*&\s*/g, " and ")
    // Remove disc-track numbers like "1-6" or "2-11"
    .replace(/^(?:\d+-\d+|\d+)(?:\s+|\.\s+)/, "")
    .replace(/\s*\([^)]*(?:version|mix|edit|remix|remaster|remastered|mono|stereo|deluxe|edition)\)[^)]*\)?/gi, "") // Remove version decorations
    .replace(/\s*\[.*?\]/g, "") // Remove content in square brackets
    .replace(/\s*[:-]\s*/g, " ") // Normalize both colons and dashes to spaces
    .replace(/[^\w\s'"-]/g, "") // Keep only word chars, spaces, quotes, and dashes
    .replace(/\s+/g, " ") // Normalize spaces
    .replace(/greatest/g, "great") // Normalize "greatest" to "great"
    .replace(/^\d+\s*/, "") // Remove leading track numbers
    .trim();

  logger.debug(`Normalized result: "${normalized}"`);
  return normalized;
}

export function normalizeArtistName(name: string): string {
  logger.debug(`Normalizing artist name: "${name}"`);

  // First normalize the string using our base function
  const normalized = normalizeString(name)
    // Handle common name variations
    .replace(/stephan/g, "stephane")
    .replace(/steven/g, "stephen")
    // Explicitly handle Sinéad O'Connor variations
    .replace(/sinead/g, "sinead")
    .replace(/sinéad/g, "sinead")
    .replace(/oconnor/g, "oconnor")
    .replace(/o'connor/g, "oconnor");

  // Split on commas and 'and' to handle collaborations
  const parts = normalized.split(/,|\band\b/).map((p) => p.trim());

  // For collaborations, we want to keep all parts for flexible matching
  const result = parts.length > 1 ? parts.join(" ") : normalized;

  logger.debug(`Normalized artist name result: "${name}" -> "${result}"`);
  return result;
}
