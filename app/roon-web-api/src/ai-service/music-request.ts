import { OpenAI } from "openai";
import { resolveOpenAIApiKey } from "./chatgpt";

export const MUSIC_REQUEST_KINDS = ["radio", "album", "artist", "playlist", "genre", "described"] as const;

export type MusicRequestKind = (typeof MUSIC_REQUEST_KINDS)[number];

export interface MusicRequest {
  kind: MusicRequestKind;
  music: string;
  room: string;
}

type ChatClient = Pick<OpenAI, "chat">;

const MUSIC_REQUEST_MODEL = "gpt-5-mini";

export function musicRequestPrompt(rooms: string[]): string {
  return [
    "You read one spoken request for a Roon home music system and say what to play and in which room.",
    `The rooms are: ${rooms.length ? rooms.join(", ") : "none"}.`,
    "kind is radio for a broadcast or internet radio station; album when the listener asks for an album;",
    "artist when they ask for an artist or band without naming a song; playlist for one of their saved playlists;",
    "genre for a single broad genre of one or two words, such as jazz or classical;",
    "described for songs, moods, eras, activities and every other description.",
    "music is the station, album, artist, playlist or genre name, or the description, in the listener's own words.",
    "Leave out the room, the app name, and filler such as play, put on, some or please.",
    "room is one of the rooms exactly as listed, only when the listener names it; otherwise an empty string.",
  ].join(" ");
}

/** Never trust a room or kind outside the request's own choices. */
export function parseMusicRequest(content: string, rooms: string[]): MusicRequest {
  const parsed = JSON.parse(content) as Partial<Record<keyof MusicRequest, unknown>>;
  const kind = MUSIC_REQUEST_KINDS.find((candidate) => candidate === parsed.kind);
  const music = typeof parsed.music === "string" ? parsed.music.trim() : "";
  if (!kind || !music) {
    throw new Error("The music request could not be understood.");
  }
  const room = rooms.find((candidate) => candidate === parsed.room) ?? "";
  return { kind, music, room };
}

export async function interpretMusicRequest(
  text: string,
  rooms: string[],
  openai: ChatClient = new OpenAI({ apiKey: resolveOpenAIApiKey() })
): Promise<MusicRequest> {
  const response = await openai.chat.completions.create({
    model: MUSIC_REQUEST_MODEL,
    messages: [
      { role: "system", content: musicRequestPrompt(rooms) },
      { role: "user", content: text },
    ],
    // gpt-5-mini accepts "minimal"; openai 4.77 types only list low/medium/high.
    reasoning_effort: "minimal" as never,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "music_request",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "music", "room"],
          properties: {
            kind: { type: "string", enum: [...MUSIC_REQUEST_KINDS] },
            music: { type: "string" },
            room: { type: "string", enum: [...rooms, ""] },
          },
        },
      },
    },
  });
  const content = response.choices[0]?.message.content;
  if (!content) {
    throw new Error("No content returned from OpenAI");
  }
  return parseMusicRequest(content, rooms);
}
