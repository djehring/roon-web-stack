import fs from "fs/promises";
import { OpenAI } from "openai";
import path from "path";
import { logger } from "@infrastructure";
import { Track, TrackStory } from "./types/track";

const CACHE_DIR = path.join(process.cwd(), "cache", "track-stories");

let openai: OpenAI | null = null;

function getOpenAIInstance(): OpenAI {
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY, // Ensure this is set in your environment
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

export async function fetchTrackSuggestions(query: string): Promise<Track[]> {
  try {
    //throw error if query empty
    if (!query) {
      query = "Molly Tuttle tracks";
    }
    const openaiInstance = getOpenAIInstance();
    const response = await openaiInstance.chat.completions.create({
      model: "gpt-4",
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
                    ***ENSURE THE TRACK IS ON THE ALBUM IN UK RELEASED ALBUMS***
                    ***AVOID ALBUMS CALLED "Greatest Hits" or "20 Greatest Hits", "Ultimate Collection" or similar unless specifically asked for or the on;y album that matches***
                    *** UNLESS SPECIFICALLY ASKED ONLY RETURN EACH TRACK ONCE ON THE BEST SELLING ALBUM IT WAS TELEASED ON In THE UK***
                    ***IF THE SEARCH IS FOR A SINGLE TRACK (e.g. Virginia Plain by Bryan Ferry) THEN ONLY RETURN ONE ITEM WHICH IS THE BEST SELLING UK ALBUM CONTAINING THE TRACK***`,
        },
      ],
      max_tokens: 300, // Adjust as needed for response length
      temperature: 0.7, // Consistent balance between creativity and accuracy
      top_p: 1, // Default value for focused sampling
    });

    // Access the `content` property of the message
    const messageContent = response.choices[0].message.content;

    // Parse the response into a list of tracks
    if (!messageContent) {
      logger.error("No content returned in the response:", response);
      return [];
    }

    const tracks = parseTracks(messageContent);

    if (tracks.length === 0) {
      logger.error("No tracks found in the response:", messageContent);
    } else {
      logger.debug("Successfully parsed tracks:", tracks);
    }

    return tracks;
  } catch (error) {
    logger.error("Error fetching track suggestions:", error);
    return [];
  }
}

async function fetchFromOpenAI(track: Track): Promise<TrackStory> {
  const openaiInstance = getOpenAIInstance();
  const response = await openaiInstance.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Provide a detailed and structured story for the song "${track.track}" by ${track.artist}.
                  Include the following sections with headings:
                  - **Story Behind "${track.track}" by ${track.artist} on ${track.album}:** A brief introduction summarizing the significance and themes of the song.
                  - **The Narrative:** Describe the key elements of the song's lyrics, including inspiration and storyline. Break it into subsections, if applicable.
                  - **Themes:** Explain the universal or specific themes the song explores.
                  - **Recording Details:** Include album name, release date, studio location, producer, and key contributing musicians. Highlight their contributions.
                  - **Musical Style:** Provide details about the song's musical characteristics, genre influences, and instrumentation.
                  - **Reception and Legacy:** Summarize the song's critical reception, chart performance, awards, and cultural impact.

                  Ensure the response is rich in detail, well-structured, and formatted for direct use in a UI.
                  `,
      },
    ],
    max_tokens: 1000,
    temperature: 0.7,
    top_p: 1,
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

export async function fetchTrackStory(track: Track): Promise<TrackStory> {
  const cacheKey = `${track.artist}-${track.track}-${track.album}`.replace(/[^a-z0-9]/gi, "_");
  const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`);

  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const cached = await fs.readFile(cacheFile, "utf-8");
    const parsedCache = JSON.parse(cached) as TrackStory;
    if (!parsedCache.title || !parsedCache.content) {
      throw new Error("Invalid cache data");
    }
    return parsedCache;
  } catch {
    const story = await fetchFromOpenAI(track);
    await fs.writeFile(cacheFile, JSON.stringify(story));
    return story;
  }
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
      model: "whisper-1",
      language: "en",
    });

    return response.text;
  } catch (error) {
    logger.error("Error transcribing audio:", error);
    throw error;
  }
}
