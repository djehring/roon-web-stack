import { randomUUID } from "node:crypto";
import { roon } from "@infrastructure";
import type { Item, List, QueueItem, RoonApiBrowseOptions } from "@model";
import type { CapsuleTrack } from "../ai-service/time-capsule";
import { CinemaMusicPath, CinemaMusicStep, cinemaTrackLimit } from "./cinema-music-model";

const pageSize = 100;
const catalogLimit = 20000;
const normalize = (text: string) => text.normalize("NFKC").trim().toLocaleLowerCase();
const controlRow = (item: Item) =>
  item.hint === "action" ||
  item.hint === "header" ||
  /^(play (album|playlist|work|disc|all)|shuffle( all)?|add (album|playlist|work|disc))$/i.test(item.title);
const resultCount = (value: string) => /^\d+[\d,]*\s+(results?|items?|tracks?|albums?)$/i.test(value.trim());
const trackTitle = (title: string) => title.replace(/^\d+[.-]\s+/, "");

async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Roon is taking too long. Please retry your music selection."));
        }, 15000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface CinemaMusicItem {
  title: string;
  subtitle?: string;
  imageKey?: string;
  kind: "track" | "list" | "search";
  path: CinemaMusicPath;
}
export interface CinemaMusicPage {
  title: string;
  subtitle?: string;
  kind: "album" | "playlist" | "list" | "track";
  path: CinemaMusicPath;
  items: CinemaMusicItem[];
}

/** Each operation has its own browse session. No action rows are executed here. */
class MusicBrowser {
  readonly options: RoonApiBrowseOptions;
  constructor(
    readonly path: CinemaMusicPath,
    zoneId?: string
  ) {
    this.options = {
      hierarchy: path.hierarchy,
      multi_session_key: `cinema-music-${randomUUID()}`,
      ...(zoneId ? { zone_or_output_id: zoneId } : {}),
    };
  }

  async load(list: List): Promise<Item[]> {
    if (list.count > catalogLimit)
      throw new Error("This collection is too large. Use Search to choose a smaller selection.");
    const items: Item[] = [];
    while (items.length < list.count) {
      const page = await bounded(
        roon.load({
          hierarchy: this.path.hierarchy,
          multi_session_key: this.options.multi_session_key,
          level: list.level,
          offset: items.length,
          count: Math.min(pageSize, list.count - items.length),
        })
      );
      if (!page.items.length || page.offset !== items.length || page.list.count !== list.count) {
        throw new Error("The collection changed while loading. Please retry to include every track.");
      }
      items.push(...page.items);
    }
    return items;
  }

  async browse(item?: Item, input?: string): Promise<List> {
    if (item && (controlRow(item) || !item.item_key)) throw new Error("Choose an album, playlist or track.");
    const result = await bounded(
      roon.browse({
        ...this.options,
        ...(item
          ? { item_key: item.item_key, ...(input === undefined ? {} : { input }) }
          : { pop_all: true, ...(this.path.query ? { input: this.path.query } : {}) }),
      })
    );
    if (result.is_error || !result.list)
      throw new Error(result.message || "This music is no longer available in Roon.");
    return result.list;
  }

  async open(): Promise<{ list: List; items: Item[]; album?: List }> {
    let list = await this.browse();
    let items = await this.load(list);
    let album: List | undefined;
    for (const step of this.path.steps) {
      const matches = (item: Item) =>
        normalize(item.title) === normalize(step.title) &&
        (step.subtitle === undefined ||
          resultCount(step.subtitle) ||
          normalize(item.subtitle ?? "") === normalize(step.subtitle)) &&
        (step.imageKey === undefined || item.image_key === step.imageKey);
      const atIndex = items.at(step.index);
      const candidates = items.filter(matches);
      const item = atIndex && matches(atIndex) ? atIndex : candidates.length === 1 ? candidates[0] : undefined;
      if (!item) throw new Error(`“${step.title}” has changed or is unavailable. Choose it again in Add music.`);
      if (items.some((row) => row.title === "Play Album")) album = list;
      list = await this.browse(item, step.input);
      items = await this.load(list);
    }
    return { list, items, album };
  }
}

function childPath(path: CinemaMusicPath, item: Item, index: number): CinemaMusicPath {
  const step: CinemaMusicStep = {
    title: item.title,
    index,
    ...(item.subtitle && !resultCount(item.subtitle) ? { subtitle: item.subtitle } : {}),
    ...(item.image_key ? { imageKey: item.image_key } : {}),
  };
  return { ...path, steps: [...path.steps, step] };
}

/** Roon sometimes puts a single recording inside a second, identically named list. */
async function openRecording(path: CinemaMusicPath, zoneId?: string) {
  let browser = new MusicBrowser(path, zoneId);
  let opened = await browser.open();
  for (let depth = 0; depth < 4 && opened.list.hint !== "action_list"; depth++) {
    const candidates = opened.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !controlRow(item) && item.item_key);
    const single = candidates.length === 1 ? candidates[0] : undefined;
    if (
      !single ||
      single.item.hint !== "action_list" ||
      normalize(single.item.title) !== normalize(path.steps.at(-1)?.title ?? "")
    )
      break;
    path = childPath(path, single.item, single.index);
    browser = new MusicBrowser(path, zoneId);
    opened = await browser.open();
  }
  return { browser, path, ...opened };
}

export async function browseCinemaMusic(path: CinemaMusicPath, zoneId?: string): Promise<CinemaMusicPage> {
  const { list, items } = await new MusicBrowser(path, zoneId).open();
  const kind =
    list.hint === "action_list"
      ? "track"
      : items.some((item) => item.title === "Play Album")
        ? "album"
        : items.some((item) => item.title === "Play Playlist")
          ? "playlist"
          : "list";
  return {
    title: list.title,
    ...(list.subtitle ? { subtitle: list.subtitle } : {}),
    kind,
    path,
    items:
      kind === "track"
        ? []
        : items.flatMap((item, index) => {
            if (controlRow(item) || !item.item_key) return [];
            return [
              {
                title: item.title,
                subtitle: item.subtitle,
                imageKey: item.image_key,
                kind: item.input_prompt
                  ? ("search" as const)
                  : item.hint === "action_list"
                    ? ("track" as const)
                    : ("list" as const),
                path: childPath(path, item, index),
              },
            ];
          }),
  };
}

export async function importCinemaMusic(path: CinemaMusicPath, zoneId?: string): Promise<CapsuleTrack[]> {
  const opened = await openRecording(path, zoneId);
  const { list, items, album } = opened;
  path = opened.path;
  if (list.hint === "action_list") {
    if (!items.some((item) => item.hint === "action" && item.title === "Play Now")) {
      throw new Error("This item cannot be saved as a music track.");
    }
    return [musicTrack(list.title, list.subtitle, album, list.image_key, path)];
  }
  const isAlbum = items.some((item) => item.title === "Play Album");
  const isPlaylist = items.some((item) => item.title === "Play Playlist");
  if (!isAlbum && !isPlaylist) throw new Error("Choose a recording from this list, or open an album or playlist.");
  const result: CapsuleTrack[] = [];
  for (const [index, item] of items.entries()) {
    if (controlRow(item) || !item.item_key) continue;
    if (item.hint !== "action_list") {
      // Work/disc grouping can contain more lists: resolve them without running any actions.
      const children = await importMusicGroup(childPath(path, item, index), zoneId, isAlbum ? list : album, 1);
      result.push(...children);
    } else {
      result.push(
        musicTrack(
          item.title,
          item.subtitle,
          isAlbum ? list : album,
          item.image_key ?? (isAlbum ? list.image_key : undefined),
          childPath(path, item, index)
        )
      );
    }
    if (result.length > cinemaTrackLimit)
      throw new Error(`Cinema supports ${cinemaTrackLimit} tracks. Select fewer tracks to continue.`);
  }
  if (!result.length) throw new Error("No playable tracks were found in this selection.");
  return result;
}

async function importMusicGroup(
  path: CinemaMusicPath,
  zoneId: string | undefined,
  album: List | undefined,
  depth: number
): Promise<CapsuleTrack[]> {
  if (depth > 6) throw new Error("This music grouping is too deep. Select its tracks individually.");
  const { list, items } = await new MusicBrowser(path, zoneId).open();
  if (list.hint === "action_list")
    return [musicTrack(list.title, list.subtitle, album, list.image_key ?? album?.image_key, path)];
  const tracks: CapsuleTrack[] = [];
  for (const [index, item] of items.entries()) {
    if (controlRow(item) || !item.item_key) continue;
    tracks.push(
      ...(item.hint === "action_list"
        ? [
            musicTrack(
              item.title,
              item.subtitle,
              album,
              item.image_key ?? album?.image_key,
              childPath(path, item, index)
            ),
          ]
        : await importMusicGroup(childPath(path, item, index), zoneId, album, depth + 1))
    );
    if (tracks.length > cinemaTrackLimit)
      throw new Error(`Cinema supports ${cinemaTrackLimit} tracks. Select fewer tracks.`);
  }
  return tracks;
}

function musicTrack(
  title: string,
  artist: string | undefined,
  album: List | undefined,
  imageKey: string | undefined,
  path: CinemaMusicPath
): CapsuleTrack {
  return {
    entryId: randomUUID(),
    artist: artist || album?.subtitle || "Unknown artist",
    track: album ? trackTitle(title) : title,
    album: album?.title ?? "",
    roonPath: path,
    matchPolicy: "exact",
    ...(imageKey ? { imageKey } : {}),
  };
}

export async function captureCinemaQueue(zoneId: string) {
  const core = await bounded(roon.server());
  const transport = core.services.RoonApiTransport;
  const zone = transport.zone_by_zone_id(zoneId);
  if (!zone) throw new Error("Choose an available Roon room.");
  let subscription: { unsubscribe: () => void } | undefined;
  // node-roon-api returns a subscription handle; the legacy model declares void.
  const subscribe = transport.subscribe_queue.bind(transport) as unknown as (
    ...args: Parameters<typeof transport.subscribe_queue>
  ) => {
    unsubscribe: () => void;
  };
  const captured = await bounded(
    new Promise<QueueItem[]>((resolve, reject) => {
      subscription = subscribe(zone, cinemaTrackLimit + 1, (status, body) => {
        if (status === "Subscribed") resolve(body.items ?? []);
        else if (status === "Unsubscribed") reject(new Error("The room disconnected. Please retry."));
      });
    })
  ).finally(() => subscription?.unsubscribe());
  const expected = transport.zone_by_zone_id(zoneId)?.queue_items_remaining ?? zone.queue_items_remaining;
  if (captured.length > cinemaTrackLimit || (expected !== undefined && expected > captured.length)) {
    throw new Error(
      `The whole queue could not be captured (${captured.length} of ${expected ?? "more"} tracks). Choose an album or playlist instead. Cinema supports ${cinemaTrackLimit} tracks.`
    );
  }
  const current = zone.now_playing?.three_line;
  const tracks: CapsuleTrack[] = captured.map((item) => ({
    entryId: randomUUID(),
    track: item.three_line.line1,
    artist: item.three_line.line2 || "Unknown artist",
    album: item.three_line.line3 || "",
    imageKey: item.image_key,
    durationSeconds: item.length,
    matchPolicy: "exact",
  }));
  const includesCurrent =
    !!current && tracks[0]?.track === current.line1 && (!current.line2 || tracks[0]?.artist === current.line2);
  if (!tracks.length) throw new Error("There is no music in this queue. Choose an album or playlist.");
  return {
    title: `${zone.display_name} queue`,
    sourceLabel: `From ${zone.display_name} queue`,
    tracks,
    includesCurrent,
  };
}

/** Called only by explicit playback; importing and browsing never reach this function. */
export async function playLocatedCinemaTrack(path: CinemaMusicPath, zoneId: string, first: boolean): Promise<void> {
  const { browser, list, items } = await openRecording(path, zoneId);
  if (list.hint !== "action_list") throw new Error("The saved track has changed. Choose it again in Edit → Music.");
  const action = items.find((item) => item.hint === "action" && item.title === (first ? "Play Now" : "Queue"));
  if (!action?.item_key) throw new Error("This track is no longer playable.");
  if (first) {
    const core = await bounded(roon.server());
    const zone = core.services.RoonApiTransport.zone_by_zone_id(zoneId);
    if (!zone) throw new Error("Choose an available room.");
    await core.services.RoonApiTransport.change_settings(zone, { shuffle: false });
  }
  const result = await bounded(roon.browse({ ...browser.options, item_key: action.item_key }));
  if (result.is_error) throw new Error(result.message || "Roon could not play this track.");
}

export async function findExactCinemaTrack(track: CapsuleTrack, zoneId: string): Promise<CinemaMusicPath> {
  // Prefer the album/cover actually captured from Roon, never a fuzzy remaster or AI correction.
  if (track.album) {
    const albums = await browseCinemaMusic({ hierarchy: "albums", steps: [] }, zoneId);
    const matches = albums.items.filter(
      (item) =>
        normalize(item.title) === normalize(track.album) &&
        (track.imageKey
          ? item.imageKey === track.imageKey
          : normalize(item.subtitle ?? "").includes(normalize(track.artist)))
    );
    if (matches.length === 1) {
      const contents = await importCinemaMusic(matches[0].path, zoneId);
      const choices = contents.filter((item) => normalize(item.track) === normalize(track.track));
      if (choices.length === 1 && choices[0].roonPath) return choices[0].roonPath;
    }
  }
  const results = await browseCinemaMusic({ hierarchy: "search", query: track.track, steps: [] }, zoneId);
  const trackGroup = results.items.find((item) => item.title === "Tracks" && item.kind === "list");
  const items = trackGroup ? (await browseCinemaMusic(trackGroup.path, zoneId)).items : results.items;
  const matches = items.filter(
    (item) =>
      item.kind === "track" &&
      normalize(trackTitle(item.title)) === normalize(track.track) &&
      !!track.imageKey &&
      item.imageKey === track.imageKey
  );
  if (matches.length !== 1)
    throw new Error("The original recording could not be identified. Replace this track in Edit → Music.");
  return matches[0].path;
}
