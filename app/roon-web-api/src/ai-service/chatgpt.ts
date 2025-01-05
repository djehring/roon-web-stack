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

export async function fetchTrackSuggestions(query: string): Promise<Track[]> {
  try {
    //throw error if query empty
    if (!query) {
      query = "Molly Tuttle tracks";
    }
    const openaiInstance = getOpenAIInstance();
    const response = await openaiInstance.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        {
          role: "system",
          content: `Provide a list of ***commercially available, officially released tracks*** for "${query}". Only include tracks ***known to exist on streaming platforms***. Each entry should consist of ***the artist and track name and album separated by a dash***, with a ***line return between each***. ***Avoid any extra details, decorations, brackets, or version information.***`,
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

    let tracks: Track[] = [];

    // Check if the response contains newline characters
    if (messageContent.includes("\n")) {
      tracks = messageContent
        .trim()
        .split("\n")
        .map((line) => {
          const [artist, track, album] = line.split(" - ");
          if (!artist || !track) {
            logger.warn("Invalid line format:", line);
            return null;
          }
          return { artist: artist.trim(), track: track.trim(), album: album.trim() };
        })
        .filter((track) => track !== null) as Track[]; // Remove null entries
    } else {
      logger.error("No newline characters found in the response. Response:", messageContent);
    }

    if (tracks.length === 0) {
      logger.error("No tracks found in the response:", messageContent);
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
    model: "gpt-4-turbo",
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
