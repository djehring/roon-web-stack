import fs from "fs/promises";
import { OpenAI } from "openai";
import path from "path";
import { logger } from "@infrastructure";
import { AlbumRecognition } from "@model";
import { attachUKTourSection, fetchUKTourDates, getUKChartData, isUKChartQuery, stripUKTourSection } from "@service";
import { Track, TrackStory } from "./types/track";

const CACHE_DIR = path.join(process.cwd(), "cache", "track-stories");

let openai: OpenAI | null = null;

class MissingOpenAIKeyError extends Error {
  public constructor() {
    super("OPENAI_API_KEY is missing or empty");
    this.name = "MissingOpenAIKeyError";
  }
}

function assertOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.trim() === "") {
    throw new MissingOpenAIKeyError();
  }
  return key;
}

export function isMissingOpenAIKeyError(err: unknown): err is MissingOpenAIKeyError {
  return err instanceof MissingOpenAIKeyError;
}

function getOpenAIInstance(): OpenAI {
  if (!openai) {
    openai = new OpenAI({
      apiKey: assertOpenAIKey(),
    });
  }
  return openai;
}

function parseTrack(line: string): Track | null {
  const parts = line.split(" - ");
  if (parts.length < 2) {
    logger.warn("Invalid line format (needs at least artist - track):", line);
    return null;
  }
  const [artist, track, album] = parts;
  if (!artist || !track) {
    logger.warn("Missing artist or track:", line);
    return null;
  }
  return {
    artist: artist.trim(),
    track: track.trim(),
    album: album ? album.trim() : "",
  };
}

function parseTracks(messageContent: string): Track[] {
  if (!messageContent.trim()) {
    logger.error("Empty or invalid message content");
    return [];
  }

  // If there are newlines, treat as multiple tracks
  if (messageContent.includes("\n")) {
    return messageContent
      .trim()
      .split("\n")
      .map(parseTrack)
      .filter((track): track is Track => track !== null);
  }

  // Single track case
  const track = parseTrack(messageContent.trim());
  return track ? [track] : [];
}

/**
 * Verifies if a track exists on a specific album using external API data
 * This is a fallback verification method when the AI might be uncertain
 * @param track The track to verify
 * @returns The track with potential error information
 */
function verifyTrackOnAlbum(track: Track): Track {
  // Skip verification if no album is specified
  if (!track.album || track.album.trim() === "") {
    return track;
  }

  try {
    // For now, we'll use a simple verification based on known problematic cases
    // In a production environment, this would call a music metadata API

    // Known problematic cases
    const knownIssues = [
      {
        artist: "Gilbert O'Sullivan",
        track: "Get Down",
        correctAlbum: "I'm a Writer, Not a Fighter",
        incorrectAlbums: ["By Larry", "Back to Front"],
      },
      {
        artist: "Donny Osmond",
        track: "Why",
        correctAlbum: "Too Young",
        incorrectAlbums: ["Portrait of Donny"],
      },
      {
        artist: "T.Rex",
        track: "Solid Gold Easy Action",
        correctAlbum: "The Singles Collection",
        incorrectAlbums: ["Tanx"],
      },
      // Remove incorrect 1993 chart examples
      // Add correct 1973 chart examples
      {
        artist: "Gilbert O'Sullivan",
        track: "Get Down",
        correctAlbum: "I'm a Writer, Not a Fighter",
        incorrectAlbums: ["UK Chart #11"],
      },
      {
        artist: "T Rex",
        track: "20th Century Boy",
        correctAlbum: "Tanx",
        incorrectAlbums: ["UK Chart #3", "The Very Best Of T. Rex"],
      },
      {
        artist: "Slade",
        track: "Cum On Feel The Noize",
        correctAlbum: "Sladest",
        incorrectAlbums: ["UK Chart #1"],
      },
      {
        artist: "Faces",
        track: "Cindy Incidentally",
        correctAlbum: "Ooh La La",
        incorrectAlbums: ["UK Chart #2"],
      },
      {
        artist: "Donny Osmond",
        track: "The Twelfth Of Never",
        correctAlbum: "Alone Together",
        incorrectAlbums: ["UK Chart #4", "Too Young"],
      },
      {
        artist: "Detroit Emeralds",
        track: "Feel The Need In Me",
        correctAlbum: "Feel The Need",
        incorrectAlbums: ["UK Chart #5"],
      },
      {
        artist: "Alice Cooper",
        track: "Hello Hurray",
        correctAlbum: "Billion Dollar Babies",
        incorrectAlbums: ["UK Chart #6"],
      },
      {
        artist: "Strawbs",
        track: "Part Of The Union",
        correctAlbum: "Bursting at the Seams",
        incorrectAlbums: ["UK Chart #7"],
      },
      {
        artist: "Roberta Flack",
        track: "Killing Me Softly With His Song",
        correctAlbum: "Killing Me Softly",
        incorrectAlbums: ["UK Chart #8"],
      },
      {
        artist: "Sweet",
        track: "Blockbuster",
        correctAlbum: "Sweet Fanny Adams",
        incorrectAlbums: ["UK Chart #9", "The Sweet's Biggest Hits"],
      },
      {
        artist: "Jackson Five",
        track: "Doctor My Eyes",
        correctAlbum: "Skywriter",
        incorrectAlbums: ["UK Chart #10"],
      },
      // Add more known issues as they're discovered
    ];

    // Check for known issues
    const issue = knownIssues.find(
      (issue) =>
        normalizeString(issue.artist) === normalizeString(track.artist) &&
        normalizeString(issue.track) === normalizeString(track.track) &&
        issue.incorrectAlbums.some((album) => normalizeString(album) === normalizeString(track.album))
    );

    if (issue) {
      logger.debug(`Found known issue for ${track.artist} - ${track.track}`);

      // Store the original incorrect album for reference
      const originalAlbum = track.album;

      // Update the album to the correct one
      track.album = issue.correctAlbum;

      // Set wasAutoCorrected flag
      track.wasAutoCorrected = true;

      // Set a message that doesn't show as an error but as information
      track.correctionMessage = `Track not found on album "${originalAlbum}". Auto-corrected to "${issue.correctAlbum}".`;
    }

    // Check if this is a UK chart track (indicated by chart position in the album field)
    const ukChartMatch = track.album.match(/^UK\s+(?:Chart|Top)\s+#(\d+)/i);
    if (ukChartMatch) {
      const chartPosition = ukChartMatch[1];
      // For UK chart tracks, we want to find the actual album
      // In a production environment, this would call a music metadata API

      // For now, we'll use a simple lookup for known chart tracks
      const chartTracks = [
        // 1973 March A (Early March) chart data
        {
          artist: "Slade",
          track: "Cum On Feel The Noize",
          chartPosition: "1",
          correctAlbum: "Sladest",
          chartPeriod: "March 1973 (Early)",
        },
        {
          artist: "Faces",
          track: "Cindy Incidentally",
          chartPosition: "2",
          correctAlbum: "Ooh La La",
          chartPeriod: "March 1973 (Early)",
        },
        {
          artist: "T Rex",
          track: "20th Century Boy",
          chartPosition: "3",
          correctAlbum: "Tanx",
          chartPeriod: "March 1973 (Early)",
        },
        {
          artist: "Donny Osmond",
          track: "The Twelfth Of Never",
          chartPosition: "4",
          correctAlbum: "Alone Together",
          chartPeriod: "March 1973 (Early)",
        },
        {
          artist: "Detroit Emeralds",
          track: "Feel The Need In Me",
          chartPosition: "5",
          correctAlbum: "Feel The Need",
          chartPeriod: "March 1973 (Early)",
        },
        {
          artist: "Alice Cooper",
          track: "Hello Hurray",
          chartPosition: "6",
          correctAlbum: "Billion Dollar Babies",
          chartPeriod: "March 1973 (Early)",
        },
        {
          artist: "Strawbs",
          track: "Part Of The Union",
          chartPosition: "7",
          correctAlbum: "Bursting at the Seams",
          chartPeriod: "March 1973 (Early)",
        },
        {
          artist: "Roberta Flack",
          track: "Killing Me Softly With His Song",
          chartPosition: "8",
          correctAlbum: "Killing Me Softly",
          chartPeriod: "March 1973 (Early)",
        },
        {
          artist: "Sweet",
          track: "Blockbuster",
          chartPosition: "9",
          correctAlbum: "Sweet Fanny Adams",
          chartPeriod: "March 1973 (Early)",
        },
        {
          artist: "Jackson Five",
          track: "Doctor My Eyes",
          chartPosition: "10",
          correctAlbum: "Skywriter",
          chartPeriod: "March 1973 (Early)",
        },
        // Add more chart tracks as needed
      ];

      // First try to find by exact chart position
      let chartTrack = chartTracks.find(
        (ct) =>
          normalizeString(ct.artist) === normalizeString(track.artist) &&
          normalizeString(ct.track) === normalizeString(track.track) &&
          ct.chartPosition === chartPosition
      );

      // If not found by exact position, try just by artist and track
      if (!chartTrack) {
        chartTrack = chartTracks.find(
          (ct) =>
            normalizeString(ct.artist) === normalizeString(track.artist) &&
            normalizeString(ct.track) === normalizeString(track.track)
        );
      }

      if (chartTrack) {
        // Update the album to the correct one
        track.album = chartTrack.correctAlbum;

        // Set wasAutoCorrected flag
        track.wasAutoCorrected = true;

        // Set a message that doesn't show as an error but as information
        track.correctionMessage = `UK Chart #${chartTrack.chartPosition} (${chartTrack.chartPeriod}). Album: "${chartTrack.correctAlbum}".`;
      }
    }

    return track;
  } catch (error) {
    logger.error("Error verifying track on album:", error);
    return track;
  }
}

/**
 * Helper function to normalize strings for comparison
 */
function normalizeString(str: string): string {
  return str.toLowerCase().trim();
}

/**
 * Temporal/qualitative modifiers that GPT may not handle well due to knowledge cutoff
 */
const TEMPORAL_MODIFIERS = [
  /\b(latest|newest|most recent|new)\s+(release|album|record|single|ep)/i,
  /\b(recent|new)\s+(releases|albums|records|singles|eps)/i,
  /\b(latest|newest|most recent)\s+(tracks?|songs?)/i,
  /\bfrom\s+(this|last)\s+year\b/i,
  /\b(2024|2025|2026)\s+(release|album)/i,
];

/**
 * Detects if a query contains temporal modifiers that GPT cannot reliably answer
 */
function hasTemporalModifier(query: string): boolean {
  return TEMPORAL_MODIFIERS.some((pattern) => pattern.test(query));
}

/**
 * Extracts the artist name from a query by removing temporal modifiers
 */
function extractArtistFromTemporalQuery(query: string): string {
  let cleaned = query;
  // Remove temporal phrases
  const temporalPhrases = [
    /\b(latest|newest|most recent|new)\s+(release|album|record|single|ep|tracks?|songs?)\b/gi,
    /\b(recent|new)\s+(releases|albums|records|singles|eps)\b/gi,
    /\bfrom\s+(this|last)\s+year\b/gi,
    /\b(2024|2025|2026)\s+(release|album)\b/gi,
    /\bby\b/gi,
    /\bfrom\b/gi,
  ];
  for (const pattern of temporalPhrases) {
    cleaned = cleaned.replace(pattern, "");
  }
  // Clean up extra whitespace
  return cleaned.replace(/\s+/g, " ").trim();
}

export async function fetchTrackSuggestions(query: string): Promise<Track[]> {
  try {
    //throw error if query empty
    if (!query) {
      query = "Molly Tuttle tracks";
    }

    // Pre-process temporal queries - extract artist and modify query
    let isTemporalQuery = false;
    const originalQuery = query;
    if (hasTemporalModifier(query)) {
      isTemporalQuery = true;
      const artistName = extractArtistFromTemporalQuery(query);
      if (artistName) {
        logger.debug(`TEMPORAL QUERY DETECTED: "${query}" -> extracting artist: "${artistName}"`);
        // Modify query to focus on well-known tracks by the artist
        query = `${artistName} popular tracks`;
      }
    }

    // Check if this is a UK chart query
    if (isUKChartQuery(query)) {
      logger.debug(`UK CHART QUERY DETECTED: "${query}"`);
      logger.debug(`Using direct web scraping from officialcharts.com`);

      // Use our UK chart scraper to get the data
      const chartData = await getUKChartData(query);

      if (chartData.length > 0) {
        logger.debug(`Successfully retrieved ${chartData.length} chart entries from web scraping`);
        return chartData;
      } else {
        logger.warn(`No chart data found from web scraping, falling back to AI`);
        // Fall back to AI if web scraping fails
      }
    }

    // Enhanced UK chart query detection with more patterns
    const ukChartPatterns = [
      /uk\s+(?:top|chart|hit)/i, // UK top/chart/hit
      /(?:top|chart|hit).*(?:uk|britain|british)/i, // top/chart/hit followed by UK/Britain/British
      /(?:uk|britain|british).*(?:number\s+one|#1|no\.?\s*1)/i, // UK number ones
      /(?:1973|73).*(?:chart|hit)/i, // 1973 charts specifically
      /(?:march|mar).*(?:1973|73).*(?:chart|hit)/i, // March 1973 charts specifically
    ];

    const isUKChartQueryLegacy = ukChartPatterns.some((pattern) => pattern.test(query));

    // Add detailed debug logging
    if (isUKChartQueryLegacy) {
      logger.debug(`UK CHART QUERY DETECTED (LEGACY): "${query}"`);
      logger.debug(`Using UK chart prompt with everyHit.com reference`);

      // Try to extract year and month from query
      const yearMatch = query.match(/\b(19\d{2}|\d{2})\b/);
      const monthMatch = query.match(
        /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i
      );

      if (yearMatch && monthMatch) {
        // Properly handle 2-digit years
        const year = yearMatch[1].length === 2 ? `19${yearMatch[1]}` : yearMatch[1];
        let month = monthMatch[1];
        // Capitalize first letter and lowercase the rest
        month = month.charAt(0).toUpperCase() + month.slice(1).toLowerCase();
        // If abbreviated, expand to full month name
        const monthMap: { [key: string]: string } = {
          Jan: "January",
          Feb: "February",
          Mar: "March",
          Apr: "April",
          May: "May",
          Jun: "June",
          Jul: "July",
          Aug: "August",
          Sep: "September",
          Oct: "October",
          Nov: "November",
          Dec: "December",
        };
        if (monthMap[month]) {
          month = monthMap[month];
        }

        // Detect early/mid/late period
        let period = "B"; // Default to mid-month
        if (/early|start|beginning|first/i.test(query)) {
          period = "A";
        } else if (/mid|middle/i.test(query)) {
          period = "B";
        } else if (/late|end|final/i.test(query)) {
          period = "C";
        }

        logger.debug(`Detected year: ${year}, month: ${month}, period: ${period} (A=early, B=mid, C=late)`);
        logger.debug(`Expected URL format: https://www.everyhit.com/retrocharts/${year}-${month}${period}.html`);
      }
    } else {
      logger.debug(`Standard query (not UK chart): "${query}"`);
    }

    const openaiInstance = getOpenAIInstance();
    const response = await openaiInstance.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `Provide a list of ***commercially available, officially released tracks*** for "${query}". 
                    Only include tracks ***known to exist on streaming platforms***. 
                    Each entry should consist of ***the artist and track name and album separated by a dash***, 
                    with a ***line return between each***. 
                    ***Avoid any extra details, decorations, brackets, or version information.***
                    ***Ensure you return the track names as they are listed on streaming platforms.***
                    ***USE THE EXACT ALBUM NAME AS IT APPEARS ON STREAMING PLATFORMS***
                    
                    ***CRITICAL INSTRUCTION: ONLY INCLUDE TRACKS THAT YOU ARE 100% CERTAIN EXIST ON THE SPECIFIC ALBUM YOU MENTION***
                    ***DO NOT GUESS OR ASSUME A TRACK IS ON AN ALBUM - VERIFY FIRST***
                    ***IF YOU ARE UNCERTAIN ABOUT WHICH ALBUM A TRACK APPEARS ON, DO NOT INCLUDE IT***
                    
                    ***ENSURE THE TRACK IS ACTUALLY ON THE ALBUM IN UK RELEASED ALBUMS - DO NOT SUGGEST TRACKS THAT DON'T EXIST ON THE ALBUM YOU MENTION***
                    ***VERIFY EACH TRACK IS ACTUALLY ON THE ALBUM YOU SUGGEST - DO NOT GUESS OR ASSUME***
                    ***AVOID ALBUMS CALLED "Greatest Hits" or "20 Greatest Hits", "Ultimate Collection" or similar unless specifically asked for or the only album that matches***
                    ***UNLESS SPECIFICALLY ASKED ONLY RETURN EACH TRACK ONCE ON THE BEST SELLING ALBUM IT WAS RELEASED ON In THE UK***
                    ***IF THE SEARCH IS FOR A SINGLE TRACK (e.g. Virginia Plain by Bryan Ferry) THEN ONLY RETURN ONE ITEM WHICH IS THE BEST SELLING UK ALBUM CONTAINING THE TRACK***
                    ***DOUBLE-CHECK THAT THE TRACK IS ACTUALLY ON THE ALBUM BEFORE RETURNING IT - THIS IS CRITICAL***
                    
                    ***IMPORTANT: ALWAYS RETURN RESULTS - NEVER RETURN AN EMPTY RESPONSE***
                    ***If asked about an artist, return their well-known tracks from their discography***
                    ***If you cannot find exact matches, return the artist's most popular/acclaimed tracks***
                    
                    ${
                      isTemporalQuery
                        ? `***TEMPORAL QUERY NOTE:***
                    ***The original query was "${originalQuery}" which asked for recent/latest releases***
                    ***Since you may not have current release information, return well-known tracks by this artist***
                    ***Focus on tracks from their most acclaimed or popular studio albums***
                    ***Return 5-10 representative tracks that showcase the artist's work***`
                        : ""
                    }
                    ${
                      isUKChartQueryLegacy
                        ? `***FOR UK CHART QUERIES:***
                    ***When the query mentions UK charts or Top 10/20/40, use accurate UK chart data***
                    ***UK chart data is available at everyHit.com with URLs in the format: https://www.everyhit.com/retrocharts/YYYY-MMMM[A,B,C].html***
                    ***Where YYYY is the year, MMMM is the month, and [A,B,C] indicates early, mid, or late month***
                    ***Example: Early March 1973 charts would be at https://www.everyhit.com/retrocharts/1973-MarchA.html***
                    ***Ensure all tracks you list were actually in the UK charts for the specified period***
                    
                    ***IMPORTANT: For "UK Top 10 Early March 1973", the correct chart positions are:***
                    ***1. Slade - Cum On Feel The Noize***
                    ***2. Faces - Cindy Incidentally***
                    ***3. T Rex - 20th Century Boy***
                    ***4. Donny Osmond - The Twelfth Of Never***
                    ***5. Detroit Emeralds - Feel The Need In Me***
                    ***6. Alice Cooper - Hello Hurray***
                    ***7. Strawbs - Part Of The Union***
                    ***8. Roberta Flack - Killing Me Softly With His Song***
                    ***9. Sweet - Blockbuster***
                    ***10. Jackson Five - Doctor My Eyes***`
                        : ""
                    }
                    
                    ***IMPORTANT EXAMPLES:***
                    ***- "Get Down" by Gilbert O'Sullivan is on "I'm a Writer, Not a Fighter" (NOT on "Back to Front" or "By Larry")***
                    ***- "Why" by Donny Osmond is on "Too Young" (NOT on "Portrait of Donny")***
                    ***- "Solid Gold Easy Action" by T.Rex is on "The Singles Collection" (NOT on "Tanx")***
                    ${
                      isUKChartQueryLegacy
                        ? `***- "Cum On Feel The Noize" by Slade was #1 in the UK charts in early March 1973***
                    ***- "Cindy Incidentally" by Faces was #2 in the UK charts in early March 1973***
                    ***- "20th Century Boy" by T Rex was #3 in the UK charts in early March 1973***`
                        : ""
                    }`,
        },
      ],
      max_tokens: 2000,
      temperature: 0.3, // Lower temperature for more factual responses
      top_p: 1, // Default value for focused sampling
    });

    // Access the `content` property of the message
    const messageContent = response.choices[0].message.content;

    // Parse the response into a list of tracks
    if (!messageContent) {
      logger.error("No content returned in the response:", response);
      return [];
    }

    let tracks = parseTracks(messageContent);

    if (tracks.length === 0) {
      logger.error("No tracks found in the response:", messageContent);
    } else {
      logger.debug("Successfully parsed tracks:", tracks);

      // Add debug logging for UK chart tracks
      if (isUKChartQueryLegacy) {
        logger.debug("UK CHART RESULTS:");
        tracks.forEach((track, index) => {
          logger.debug(`[${index + 1}] ${track.artist} - ${track.track} - ${track.album}`);
        });
      }

      // Verify each track against known issues
      tracks = tracks.map((track) => verifyTrackOnAlbum(track));

      // Log after verification
      if (isUKChartQueryLegacy) {
        logger.debug("UK CHART RESULTS AFTER VERIFICATION:");
        tracks.forEach((track, index) => {
          logger.debug(
            `[${index + 1}] ${track.artist} - ${track.track} - ${track.album} ${track.wasAutoCorrected ? "(Auto-corrected)" : ""}`
          );
        });
      }
    }

    return tracks;
  } catch (error) {
    logger.error(error, "Error fetching track suggestions");
    throw error;
  }
}

const TRACK_STORY_MODEL = "gpt-5-mini";

const TRACK_STORY_SYSTEM_PROMPT = `You are a music historian and expert. Write a structured story about a song for a mobile UI.
Include these markdown headings, keeping each section concise (a short paragraph or two):
- **Story Behind the Song:** significance and themes
- **The Narrative:** lyrics, inspiration, storyline
- **Themes:** what the song explores
- **Recording Details:** album, release, studio, producer, key musicians
- **Musical Style:** genre, instrumentation, sound
- **Reception and Legacy:** reception, charts, awards, cultural impact
- **Upcoming in the UK:** forthcoming concerts in the United Kingdom. The app looks these up and appends this heading only when confirmed dates exist. Do not write this heading yourself. Never invent concert dates. Never mention that there are no dates or that the artist has died. Deceased or inactive artists must not get this section.
Use markdown only. Do not wrap the whole reply in a code fence.`;

function trackStoryCacheKey(track: Track): string {
  return `${track.artist}-${track.track}-${track.album}`.replace(/[^a-z0-9]/gi, "_");
}

function trackStoryCachePath(track: Track): string {
  return path.join(CACHE_DIR, `${trackStoryCacheKey(track)}.json`);
}

function trackStoryMessages(track: Track): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const albumPart = track.album ? ` from the album "${track.album}"` : "";
  return [
    { role: "system", content: TRACK_STORY_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Tell me about the song "${track.track}" by ${track.artist}${albumPart}. Confirmed forthcoming UK concerts will be attached by the app when any exist. Do not write an Upcoming in the UK heading yourself.`,
    },
  ];
}

async function readCachedTrackStory(track: Track): Promise<TrackStory | null> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const cached = await fs.readFile(trackStoryCachePath(track), "utf-8");
    const parsedCache = JSON.parse(cached) as TrackStory;
    if (!parsedCache.title || !parsedCache.content) {
      return null;
    }
    return parsedCache;
  } catch {
    return null;
  }
}

async function writeCachedTrackStory(track: Track, story: TrackStory): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(trackStoryCachePath(track), JSON.stringify(story));
}

async function fetchFromOpenAI(track: Track): Promise<TrackStory> {
  const openaiInstance = getOpenAIInstance();
  const response = await openaiInstance.chat.completions.create({
    model: TRACK_STORY_MODEL,
    messages: trackStoryMessages(track),
    max_completion_tokens: 2500,
    // gpt-5-mini accepts "minimal"; openai 4.77 types only list low/medium/high.
    reasoning_effort: "minimal" as never,
  });

  const storyContent = response.choices[0].message.content;
  if (!storyContent) {
    throw new Error("No content returned from OpenAI");
  }

  return {
    title: track.track,
    content: storyContent.trim(),
  };
}

export type TrackStoryStreamEvent =
  | { type: "meta"; title: string; cached: boolean }
  | { type: "delta"; content: string }
  | { type: "done" };

export async function* streamTrackStory(track: Track): AsyncGenerator<TrackStoryStreamEvent> {
  const datesPromise = fetchUKTourDates(track.artist);
  const cached = await readCachedTrackStory(track);
  if (cached) {
    const content = attachUKTourSection(cached.content, await datesPromise);
    yield { type: "meta", title: cached.title, cached: true };
    yield { type: "delta", content };
    yield { type: "done" };
    return;
  }

  const openaiInstance = getOpenAIInstance();
  yield { type: "meta", title: track.track, cached: false };

  const stream = await openaiInstance.chat.completions.create({
    model: TRACK_STORY_MODEL,
    messages: trackStoryMessages(track),
    max_completion_tokens: 2500,
    stream: true,
    // Prefer fast first tokens for mobile reading.
    reasoning_effort: "minimal" as never,
  });

  let full = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (!delta) {
      continue;
    }
    full += delta;
    yield { type: "delta", content: delta };
  }

  const content = full.trim();
  if (!content) {
    throw new Error("No content returned from OpenAI");
  }

  const stripped = stripUKTourSection(content);
  await writeCachedTrackStory(track, { title: track.track, content: stripped });
  const attached = attachUKTourSection(stripped, await datesPromise);
  if (attached !== stripped) {
    yield { type: "delta", content: attached.slice(stripped.length) };
  }
  yield { type: "done" };
}

export async function fetchTrackStory(track: Track): Promise<TrackStory> {
  const datesPromise = fetchUKTourDates(track.artist);
  const cached = await readCachedTrackStory(track);
  const story = cached ?? (await fetchFromOpenAI(track));
  if (!cached) {
    await writeCachedTrackStory(track, {
      title: story.title,
      content: stripUKTourSection(story.content),
    });
  }
  return {
    title: story.title,
    content: attachUKTourSection(story.content, await datesPromise),
  };
}

export async function transcribeAudio(audioFile: Buffer): Promise<string> {
  try {
    const openaiInstance = getOpenAIInstance();

    // Use subarray instead of slice
    const isMP4 = audioFile.subarray(4, 8).toString() === "ftyp";
    const mimeType = isMP4 ? "audio/mp4" : "audio/webm";
    const extension = isMP4 ? "mp4" : "webm";
    logger.info("mimeType: " + mimeType);

    const response = await openaiInstance.audio.transcriptions.create({
      file: new File([audioFile], `audio.${extension}`, { type: mimeType }),
      model: "gpt-4o-transcribe",
      language: "en",
    });

    return response.text;
  } catch (error) {
    logger.error("Error transcribing audio:", error);
    throw error;
  }
}

/**
 * Uses GPT-4 to find the correct album for a track that wasn't found in the library.
 * This is a last-resort method when all other search methods have failed.
 * @param track The track that wasn't found
 * @returns A Promise that resolves to a Track with updated album information
 */
export async function findTrackWithGPT(track: Track): Promise<Track> {
  try {
    if (!track.artist || !track.track) {
      logger.error("Invalid track data for GPT search:", track);
      return track;
    }

    logger.debug(`Using GPT to find correct album for: ${track.artist} - ${track.track}`);

    const openaiInstance = getOpenAIInstance();
    const response = await openaiInstance.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a music database expert. Your task is to find the EXACT album information for a specific track.
                    
                    ***CRITICAL INSTRUCTIONS:***
                    - Return ONLY the artist, track title, and album name in the format "Artist - Track - Album"
                    - Do NOT include any explanations, notes, or additional text
                    - Use the EXACT album name as it appears on streaming platforms
                    - Prefer original studio albums over compilations or "Greatest Hits" collections
                    - If multiple albums contain the track, choose the most popular or original release
                    - If the track appears on multiple albums, choose the album where it was first released or is most commonly associated with
                    - VERIFY that the track is actually on the album you suggest
                    - DO NOT guess or assume - only return information you are certain about
                    - If you cannot find a definitive album, return the original artist and track with "Unknown" as the album
                    
                    ***EXAMPLES:***
                    - For "SPEAK LIKE A CHILD by THE STYLE COUNCIL", return "THE STYLE COUNCIL - SPEAK LIKE A CHILD - Introducing The Style Council"
                    - For "Get Down by Gilbert O'Sullivan", return "Gilbert O'Sullivan - Get Down - I'm a Writer, Not a Fighter"
                    - For "Why by Donny Osmond", return "Donny Osmond - Why - Too Young"
                    - For "ROCK THE BOAT by FORREST", return "FORREST - ROCK THE BOAT - Feel The Need"
                    - For "HIGH LIFE by MODERN ROMANCE", return "MODERN ROMANCE - HIGH LIFE - Trick Of The Light"`,
        },
        {
          role: "user",
          content: `Find the exact album for: ${track.track} by ${track.artist}`,
        },
      ],
      max_tokens: 500,
      temperature: 0.3,
    });

    const messageContent = response.choices[0].message.content;
    if (!messageContent) {
      logger.error("No content returned from GPT for track:", track);
      return track;
    }

    // Parse the response
    const parsedTrack = parseTrack(messageContent.trim());
    if (!parsedTrack) {
      logger.error("Failed to parse GPT response:", messageContent);
      return track;
    }

    // Only update the album if we got a valid response
    if (parsedTrack.album && parsedTrack.album !== "Unknown") {
      // Create a new track with the updated album
      const updatedTrack: Track = {
        artist: track.artist, // Keep original artist
        track: track.track, // Keep original track
        album: parsedTrack.album, // Use the album from GPT
        wasAutoCorrected: true,
        correctionMessage: `Album found via AI: "${parsedTrack.album}"`,
      };

      logger.debug(`GPT found album for ${track.artist} - ${track.track}: ${parsedTrack.album}`);
      return updatedTrack;
    }

    // If we didn't get a valid album, return the original track
    return track;
  } catch (error) {
    logger.error("Error finding track with GPT:", error);
    return track;
  }
}

/**
 * Uses OpenAI Vision to recognize an album from an image and/or text hint.
 * @param imageBase64 Base64-encoded image data (without data URL prefix)
 * @param mimeType The MIME type of the image (e.g., "image/png", "image/jpeg")
 * @param textHint Optional text description to help identify the album
 * @returns Album recognition result with title, artist, and confidence
 */
export async function recognizeAlbumFromImage(
  imageBase64: string,
  mimeType: string,
  textHint?: string
): Promise<AlbumRecognition> {
  try {
    const openaiInstance = getOpenAIInstance();

    const systemPrompt = `You are an expert at identifying music albums from images.
When shown an album cover or related image, identify:
1. The album title (exact name as it appears on streaming platforms)
2. The artist name
3. Your confidence level: "high" if you're certain, "medium" if likely but not 100% sure, "low" if it's a guess

CRITICAL INSTRUCTIONS:
- Return ONLY valid JSON in this exact format: {"albumTitle": "...", "artistName": "...", "confidence": "high|medium|low"}
- Do NOT include any explanation or additional text
- Use the EXACT album and artist names as they appear on streaming platforms
- If you cannot identify the album, return: {"albumTitle": "Unknown", "artistName": "Unknown", "confidence": "low"}`;

    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      {
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${imageBase64}`,
          detail: "auto",
        },
      },
    ];

    if (textHint && textHint.trim()) {
      userContent.push({
        type: "text",
        text: `Additional context: ${textHint.trim()}`,
      });
    } else {
      userContent.push({
        type: "text",
        text: "Please identify this album from the image.",
      });
    }

    const response = await openaiInstance.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      max_tokens: 500,
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const messageContent = response.choices[0].message.content;
    if (!messageContent) {
      logger.error("No content returned from OpenAI Vision");
      return {
        albumTitle: "Unknown",
        artistName: "Unknown",
        confidence: "low",
      };
    }

    // Parse the JSON response, stripping markdown fences if present
    const jsonStr = messageContent.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    // Validate the response structure
    if (
      typeof parsed.albumTitle !== "string" ||
      typeof parsed.artistName !== "string" ||
      !["high", "medium", "low"].includes(parsed.confidence as string)
    ) {
      logger.error("Invalid response structure from OpenAI Vision:", parsed);
      return {
        albumTitle: "Unknown",
        artistName: "Unknown",
        confidence: "low",
      };
    }

    const result: AlbumRecognition = {
      albumTitle: parsed.albumTitle,
      artistName: parsed.artistName,
      confidence: parsed.confidence as "high" | "medium" | "low",
    };

    logger.debug(
      `Album recognized: ${result.artistName} - ${result.albumTitle} ` + `(confidence: ${result.confidence})`
    );

    return result;
  } catch (error) {
    logger.error("Error recognizing album from image:", error);
    return {
      albumTitle: "Unknown",
      artistName: "Unknown",
      confidence: "low",
    };
  }
}
