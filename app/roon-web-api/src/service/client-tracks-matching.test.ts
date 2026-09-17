import { roon } from "@infrastructure";
import { Item, RoonApiBrowseOptions } from "@model";
import { findTrackWithGPT } from "../ai-service/chatgpt";
import { Track } from "../ai-service/types/track";
import { findTracksInRoon } from "./client-tracks-manager";
import { searchForAlbumWithTitle } from "./roon-utils";

jest.mock("@infrastructure", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  roon: { browse: jest.fn(), load: jest.fn() },
}));
jest.mock("../ai-service/chatgpt", () => ({ findTrackWithGPT: jest.fn() }));
jest.mock("fs/promises", () => ({ mkdir: jest.fn(), writeFile: jest.fn() }));
jest.mock("./roon-utils", () => ({
  resetBrowseSession: jest.fn(),
  browseIntoLibrary: jest.fn().mockResolvedValue({ list: { level: 0 } }),
  getLibrarySearchItem: jest.fn().mockResolvedValue({ item_key: "search" }),
  searchForAlbumWithTitle: jest.fn(),
}));

const requested: Track = {
  track: "Hopelessly Devoted to You",
  artist: "Olivia Newton-John",
  album: "Grease (The Original Motion Picture Soundtrack)",
};
const options: RoonApiBrowseOptions = {
  hierarchy: "browse",
  multi_session_key: "client",
  zone_or_output_id: "office",
};
const row = (key: string, artist?: string, title = requested.track): Item => ({
  title,
  subtitle: artist,
  item_key: key,
  hint: "action_list",
});
const original = row("original", "[[1|Olivia Newton-John]]");
const cover = row("cover", "[[2|Juliana Hatfield]]");
const tribute = row("tribute", "Juliana Hatfield Sings Olivia Newton-John");

// Exercise the real resolver and queue actions, mocking only external services.
function catalog(search: Item[], albums: Item[] = [], albumTracks: Item[] = [], section = false) {
  let current = "search";
  let hierarchy = "search";
  const played: string[] = [];
  const opened: string[] = [];
  (searchForAlbumWithTitle as jest.Mock).mockResolvedValue({ items: albums });
  (roon.browse as jest.Mock).mockImplementation((input: RoonApiBrowseOptions) => {
    hierarchy = input.hierarchy;
    if (input.input) current = "search";
    else if (input.item_key) {
      current = input.item_key;
      opened.push(current);
      if (current.endsWith(":play") || current.endsWith(":queue")) {
        played.push(current);
        return Promise.resolve({ action: "message", message: "OK" });
      }
    }
    return Promise.resolve({ action: "list", list: { level: 1, count: 3, title: current } });
  });
  (roon.load as jest.Mock).mockImplementation(() => {
    let items: Item[];
    if (current === "search") items = section ? [{ title: "Tracks", item_key: "tracks", hint: "list" }] : search;
    else if (current === "tracks") items = search;
    else if (current === "album") items = [{ title: "Tracks", item_key: "album-tracks", hint: "list" }];
    else if (current === "album-tracks") items = albumTracks;
    else if (current.endsWith(":actions"))
      items = [
        { title: "Play Now", item_key: current + ":play", hint: "action" },
        { title: "Play Next", item_key: current + ":next", hint: "action" },
        { title: "Queue", item_key: current + ":queue", hint: "action" },
      ];
    else if (hierarchy === "browse" && albumTracks.some((item) => item.item_key === current))
      items = [
        { title: "Play Now", item_key: current + ":play", hint: "action" },
        { title: "Queue", item_key: current + ":queue", hint: "action" },
      ];
    else items = [{ title: "Play Track", item_key: current + ":actions", hint: "action_list" }];
    return Promise.resolve({ items, offset: 0, list: { level: 1, count: items.length, title: current } });
  });
  return { played, opened };
}

describe("shared bridge playback matching", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (findTrackWithGPT as jest.Mock).mockImplementation((track: Track) => Promise.resolve({ ...track }));
  });

  test.each([false, true])("plays the requested artist (Tracks section=%s)", async (section) => {
    const { played, opened } = catalog([cover, tribute, original], [], [], section);
    expect(await findTracksInRoon([{ ...requested, album: "" }], options)).toEqual([]);
    expect(played).toEqual(["original:actions:play"]);
    expect(opened).not.toContain("cover");
    expect(opened).not.toContain("tribute");
  });

  test.each([false, true])("reports unavailable when only covers exist (Tracks section=%s)", async (section) => {
    const { played } = catalog([cover, tribute], [], [], section);
    const missing = await findTracksInRoon([{ ...requested, album: "" }], options);
    expect(missing).toHaveLength(1);
    expect(missing[0].artist).toBe(requested.artist);
    expect(played).toEqual([]);
  });

  test("rejects a sole matching album by the wrong artist", async () => {
    const { played, opened } = catalog([], [row("album", "[[2|Juliana Hatfield]]", requested.album)], [cover]);
    expect(await findTracksInRoon([{ ...requested }], options)).toHaveLength(1);
    expect(opened).not.toContain("album");
    expect(played).toEqual([]);
  });

  test("checks the track artist on a Various Artists compilation", async () => {
    const { played } = catalog([], [row("album", "[[3|Various Artists]]", requested.album)], [cover, original]);
    expect(await findTracksInRoon([{ ...requested }], options)).toEqual([]);
    expect(played).toEqual(["original:play"]);
  });

  test("does not infer a performer from a compilation's title", async () => {
    const { played } = catalog([], [row("album", "Various Artists", requested.album)], [cover, row("unknown")]);
    expect(await findTracksInRoon([{ ...requested }], options)).toHaveLength(1);
    expect(played).toEqual([]);
  });

  test("a GPT album correction cannot change the requested artist", async () => {
    const { played } = catalog([], [row("album", "[[2|Juliana Hatfield]]", "Tribute")], [cover]);
    (findTrackWithGPT as jest.Mock).mockResolvedValue({
      ...requested,
      artist: "Juliana Hatfield",
      album: "Tribute",
      wasAutoCorrected: true,
    });
    const missing = await findTracksInRoon([{ ...requested }], options);
    expect(missing).toHaveLength(1);
    expect(missing[0].artist).toBe(requested.artist);
    expect(played).toEqual([]);
  });

  test("compact title spelling still requires the requested artist", async () => {
    const { played } = catalog(
      [row("cake", "Cake", "Mahna Mahna"), row("muppets", "The Muppets", "Mahna Mahna")],
      [],
      [],
      true
    );
    expect(await findTracksInRoon([{ track: "Mah Na Mah Na", artist: "The Muppets", album: "" }], options)).toEqual([]);
    expect(played).toEqual(["muppets:actions:play"]);
  });

  test("does not substitute a different song by the requested artist", async () => {
    const { played } = catalog([row("different", requested.artist, "Physical")], [], [], true);
    expect(await findTracksInRoon([{ ...requested, album: "" }], options)).toHaveLength(1);
    expect(played).toEqual([]);
  });

  test("queues only accepted tracks in request order", async () => {
    const { played } = catalog([cover, original, row("second", "Commodores", "Three Times a Lady")], [], [], true);
    const missing = await findTracksInRoon(
      [
        { track: "Missing song", artist: "Missing artist", album: "" },
        { ...requested, album: "" },
        { track: "Three Times a Lady", artist: "Commodores", album: "" },
      ],
      options
    );
    expect(missing).toHaveLength(1);
    expect(played).toEqual(["original:actions:play", "second:actions:queue"]);
  });
});
