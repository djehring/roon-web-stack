import axios from "axios";
import * as cheerio from "cheerio";
import { logger } from "@infrastructure";

export type UKTourDate = {
  when: string;
  venue: string;
  city: string;
  url?: string;
};

const HORIZON_MONTHS = 6;
const MAX_DATES = 40;
const LASTFM_TIMEOUT_MS = 4000;
const OFFICIAL_TIMEOUT_MS = 15000;
const CACHE_MS = 6 * 60 * 60 * 1000;

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9",
};

const UK_COUNTRIES = new Set([
  "united kingdom",
  "uk",
  "great britain",
  "england",
  "scotland",
  "wales",
  "northern ireland",
]);

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
const TICKET_HOST =
  /ticketsource|ticketmaster|seetickets|tickettailor|eventbrite|dice\.fm|axs\.com|wegotickets|gigantic|skiddle/i;
const DAY_MONTH_LABEL = new RegExp(`^(\\d{1,2})\\s+(${Object.keys(MONTHS).join("|")})$`, "i");
const TOUR_HEADING = /upcoming\s+in\s+the\s+uk/i;
const WEEKDAY_DATE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(.+)$/i;

const tourCache = new Map<string, { dates: UKTourDate[]; expires: number }>();

export function resetUKTourDateCache(): void {
  tourCache.clear();
}

export function artistForLookup(artist: string): string {
  return (
    artist
      .replace(/^[\s\-–—]+/, "")
      .split(/\s+(?:feat\.?|ft\.?|featuring|with)\s+/i)[0]
      ?.trim() ?? ""
  );
}

export function officialGigPageUrls(artist: string): string[] {
  const compact = artist.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return [`https://${compact}music.com/gigs/`, `https://${compact}music.com/tour/`];
}

export function formatUKTourSection(dates: UKTourDate[]): string {
  if (dates.length === 0) {
    return "";
  }
  const bullets = dates.map((date) => {
    const place = [date.venue, date.city].filter((part) => part.length > 0).join(", ");
    const label = `${date.when}, ${place}`;
    return date.url ? `- [${label}](${date.url})` : `- ${label}`;
  });
  return `**Upcoming in the UK:**\n\n${bullets.join("\n")}`;
}

export function stripUKTourSection(content: string): string {
  const lines = content.split("\n");
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (isTourHeading(line)) {
      skipping = true;
      continue;
    }
    if (skipping && isMarkdownHeading(line)) {
      skipping = false;
    }
    if (!skipping) {
      kept.push(line);
    }
  }
  return kept.join("\n").trim();
}

export function attachUKTourSection(content: string, dates: UKTourDate[]): string {
  const body = stripUKTourSection(content);
  const section = formatUKTourSection(dates);
  if (!section) {
    return body;
  }
  return `${body}\n\n${section}`;
}

export async function fetchUKTourDates(artist: string): Promise<UKTourDate[]> {
  const name = artistForLookup(artist);
  if (!name) {
    return [];
  }
  const cached = tourCache.get(name);
  if (cached && cached.expires > Date.now()) {
    return cached.dates;
  }
  try {
    const [lastFm, official] = await Promise.all([fetchLastFmDates(name), fetchOfficialDates(name)]);
    const dates = filterUKTourHorizon(mergeUKTourDates(official, lastFm)).slice(0, MAX_DATES);
    logger.debug(
      `UK tour dates for ${name}: ${dates.length} found in ${HORIZON_MONTHS} months (${lastFm.length} last.fm, ${official.length} official)`
    );
    tourCache.set(name, { dates, expires: Date.now() + CACHE_MS });
    return dates;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`UK tour dates lookup failed for ${name}: ${message}`);
    return [];
  }
}

export function filterUKTourHorizon(dates: UKTourDate[], now = new Date()): UKTourDate[] {
  const start = startOfDay(now);
  const end = addMonths(start, HORIZON_MONTHS);
  return dates.filter((date) => {
    const time = whenToTime(date.when);
    return time >= start.getTime() && time <= end.getTime();
  });
}

export function mergeUKTourDates(...groups: UKTourDate[][]): UKTourDate[] {
  const byKey = new Map<string, UKTourDate>();
  for (const group of groups) {
    for (const date of group) {
      const key = `${date.when}|${date.venue}`.toLowerCase();
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...date });
        continue;
      }
      const url = preferUrl(existing.url, date.url);
      if (url) {
        existing.url = url;
      }
      if (!existing.city && date.city) {
        existing.city = date.city;
      }
    }
  }
  return [...byKey.values()].sort((a, b) => whenToTime(a.when) - whenToTime(b.when));
}

export function parseLastFmEvents(html: string): UKTourDate[] {
  const $ = cheerio.load(html);
  const dates: UKTourDate[] = [];
  $('tr[itemtype="http://schema.org/MusicEvent"]').each((_, row) => {
    const event = $(row);
    const iso = event.find("time").attr("datetime") ?? event.find("[itemprop=startDate]").attr("content") ?? undefined;
    const venue = event.find(".events-list-item-venue--title").text().replace(/\s+/g, " ").trim();
    const address = event.find(".events-list-item-venue--address").text().replace(/\s+/g, " ").trim();
    const parsed = fromVenueAddress(
      iso,
      venue,
      address,
      event.find("[itemprop=url]").attr("href"),
      "https://www.last.fm"
    );
    if (parsed) {
      dates.push(parsed);
    }
  });
  return dates;
}

export function parseOfficialGigPage(html: string): UKTourDate[] {
  return mergeUKTourDates(parseMecEvents(html), parseJsonLdEvents(html), parseMonthListEvents(html));
}

export function parseJsonLdEvents(html: string): UKTourDate[] {
  const $ = cheerio.load(html);
  const dates: UKTourDate[] = [];
  $('script[type="application/ld+json"]').each((_, script) => {
    const items = jsonLdItems($(script).text());
    for (const item of items) {
      if (!isEventType(item["@type"])) {
        continue;
      }
      const location = asRecord(item.location);
      const venue = tidyName(asString(location?.name));
      const address = locationAddress(location);
      const offers = asRecord(item.offers);
      const parsed = fromVenueAddress(
        asString(item.startDate),
        venue,
        address,
        asString(offers?.url) || asString(item.url)
      );
      if (parsed) {
        dates.push(parsed);
      }
    }
  });
  return dates;
}

async function fetchLastFmDates(name: string): Promise<UKTourDate[]> {
  const slug = encodeURIComponent(name).replace(/%20/g, "+");
  const response = await axios.get<string>(`https://www.last.fm/music/${slug}/+events`, {
    headers: REQUEST_HEADERS,
    timeout: LASTFM_TIMEOUT_MS,
    family: 4,
    validateStatus: (status) => status === 200 || status === 404,
  });
  if (response.status === 404) {
    return [];
  }
  return parseLastFmEvents(String(response.data));
}

async function fetchOfficialDates(name: string): Promise<UKTourDate[]> {
  for (const url of officialGigPageUrls(name)) {
    try {
      const response = await axios.get<string>(url, {
        headers: REQUEST_HEADERS,
        timeout: OFFICIAL_TIMEOUT_MS,
        family: 4,
        maxRedirects: 3,
        validateStatus: (status) => status === 200 || status === 404,
      });
      if (response.status !== 200) {
        continue;
      }
      const dates = parseOfficialGigPage(String(response.data));
      if (dates.length > 0) {
        logger.debug(`Official gig page for ${name}: ${url} (${dates.length} UK dates)`);
        return dates;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.debug(`Official gig page lookup failed for ${name} at ${url}: ${message}`);
    }
  }
  return [];
}

function parseMonthListEvents(html: string): UKTourDate[] {
  const $ = cheerio.load(html);
  const dates: UKTourDate[] = [];
  $("h2, h3, h4, h5").each((_, heading) => {
    const text = $(heading).text().replace(/\s+/g, " ").trim();
    const match = text.match(new RegExp(`^(${Object.keys(MONTHS).join("|")})\\s+(\\d{4})$`, "i"));
    if (!match) {
      return;
    }
    const month = MONTHS[match[1].toLowerCase()];
    const year = Number(match[2]);
    $(heading)
      .next("ul")
      .find("li")
      .each((__, item) => {
        const line = $(item).text().replace(/\s+/g, " ").trim();
        const parsed = fromOfficialLine(line, month, year, $(item).find("a").attr("href"));
        if (parsed) {
          dates.push(parsed);
        }
      });
  });
  return dates;
}

function parseMecEvents(html: string): UKTourDate[] {
  const $ = cheerio.load(html);
  const dates: UKTourDate[] = [];
  $(".mec-event-article").each((_, article) => {
    const root = $(article);
    const label = root.find(".mec-start-date-label").first().text().replace(/\s+/g, " ").trim();
    const year = mecYear(root.attr("class") ?? "");
    const iso = fromDayMonthLabel(label, year);
    const venue = tidyName(root.find("dd.author, dd.org").first().text());
    const address = root.find(".mec-address").first().text().replace(/\s+/g, " ").trim();
    const parsed = fromVenueAddress(
      iso,
      venue,
      address || venue,
      root.find("a.mec-booking-button, a.mec-more-info-button").first().attr("href")
    );
    if (parsed) {
      dates.push(parsed);
    }
  });
  return dates;
}

function fromVenueAddress(
  iso: string | undefined,
  venue: string,
  address: string,
  href?: string,
  base?: string
): UKTourDate | undefined {
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const country = parts.at(-1) ?? "";
  if (!UK_COUNTRIES.has(country.toLowerCase()) && !UK_POSTCODE.test(address)) {
    return undefined;
  }
  const when = formatWhen(iso);
  if (!when) {
    return undefined;
  }
  const url = absoluteHttpUrl(href, base);
  return {
    when,
    venue: venue || "Venue TBC",
    city: ukCity(parts, venue),
    ...(url ? { url } : {}),
  };
}

function fromOfficialLine(line: string, month: number, year: number, href?: string): UKTourDate | undefined {
  const match = line.match(WEEKDAY_DATE);
  if (!match) {
    return undefined;
  }
  const day = Number(match[1]);
  const place = match[2].trim();
  if (!UK_POSTCODE.test(place) && !hasUkCountry(place)) {
    return undefined;
  }
  const when = formatWhen(new Date(Date.UTC(year, month, day, 12)).toISOString());
  if (!when) {
    return undefined;
  }
  const parts = place
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !UK_POSTCODE.test(part));
  const url = absoluteHttpUrl(href);
  return {
    when,
    venue: parts[0] || "Venue TBC",
    city: parts[1] ?? "",
    ...(url ? { url } : {}),
  };
}

function ukCity(parts: string[], venue?: string): string {
  const venueKey = tidyName(venue ?? "").toLowerCase();
  const usable = parts
    .map((part) => tidyName(part))
    .filter((part) => {
      return (
        part.length > 0 &&
        !UK_COUNTRIES.has(part.toLowerCase()) &&
        !UK_POSTCODE.test(part) &&
        part.toLowerCase() !== venueKey
      );
    });
  const towns = usable.filter((part) => !/\d/.test(part));
  return towns.at(-1) ?? usable.at(-1) ?? "";
}

function hasUkCountry(text: string): boolean {
  return text
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .some((part) => UK_COUNTRIES.has(part));
}

function jsonLdItems(raw: string): Record<string, unknown>[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    const roots = Array.isArray(parsed) ? parsed : [parsed];
    const items: Record<string, unknown>[] = [];
    for (const root of roots) {
      const record = asRecord(root);
      if (!record) {
        continue;
      }
      const graph = record["@graph"];
      if (Array.isArray(graph)) {
        for (const node of graph) {
          const item = asRecord(node);
          if (item) {
            items.push(item);
          }
        }
      } else {
        items.push(record);
      }
    }
    return items;
  } catch {
    return [];
  }
}

function isEventType(type: unknown): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((value) => value === "Event" || value === "MusicEvent");
}

function locationAddress(location: Record<string, unknown> | undefined): string {
  if (!location) {
    return "";
  }
  if (typeof location.address === "string") {
    return location.address;
  }
  const address = asRecord(location.address);
  if (!address) {
    return "";
  }
  return [
    address.streetAddress,
    address.addressLocality,
    address.addressRegion,
    address.addressCountry,
    address.postalCode,
  ]
    .map((part) => asString(part))
    .filter((part) => part.length > 0)
    .join(", ");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function tidyName(value: string): string {
  return value.replace(/,$/, "").replace(/\s+/g, " ").trim();
}

function preferUrl(existing?: string, incoming?: string): string | undefined {
  if (isTicketUrl(incoming)) {
    return incoming;
  }
  if (isTicketUrl(existing)) {
    return existing;
  }
  return existing ?? incoming;
}

function isTicketUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  try {
    return TICKET_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function absoluteHttpUrl(href?: string, base?: string): string | undefined {
  if (!href) {
    return undefined;
  }
  try {
    const url = new URL(href, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function mecYear(className: string): number | undefined {
  const match = className.match(/mec-toggle-(\d{4})\d{2}/);
  return match ? Number(match[1]) : undefined;
}

function fromDayMonthLabel(label: string, year: number | undefined): string | undefined {
  const match = label.match(DAY_MONTH_LABEL);
  if (!match || year === undefined) {
    return undefined;
  }
  const month = MONTHS[match[2].toLowerCase()];
  return new Date(Date.UTC(year, month, Number(match[1]), 12)).toISOString();
}

function whenToTime(when: string): number {
  const time = Date.parse(when);
  return Number.isNaN(time) ? 0 : time;
}

function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

function isTourHeading(line: string): boolean {
  const plain = line.replace(/[#*]/g, "").replace(/:$/, "").trim();
  return TOUR_HEADING.test(plain) && /^upcoming in the uk$/i.test(plain);
}

function isMarkdownHeading(line: string): boolean {
  const trimmed = line.trim();
  if (/^#{1,3}\s+\S/.test(trimmed)) {
    return true;
  }
  const unwrapped = trimmed
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/:$/, "")
    .trim();
  return unwrapped.length > 0 && unwrapped !== trimmed;
}

function formatWhen(iso: string | undefined): string | undefined {
  if (!iso) {
    return undefined;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(date);
}
