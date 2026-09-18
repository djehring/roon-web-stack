import { zoneManager } from "../data/zone-manager";
import { roon } from "../infrastructure/roon-extension";
import { cinemaAlbumCover, cinemaArtwork } from "./cinema-artwork";
import { searchAlbumsInLibrary } from "./roon-utils";

jest.mock("../data/zone-manager", () => ({ zoneManager: { zones: jest.fn() } }));
jest.mock("../infrastructure/roon-extension", () => ({ roon: { getImage: jest.fn() } }));

afterEach(() => jest.useRealTimers());

jest.mock("./roon-utils", () => ({ searchAlbumsInLibrary: jest.fn() }));

test("finds a playlist cover in an isolated browse session and caches duplicate requests", async () => {
  jest.mocked(searchAlbumsInLibrary).mockResolvedValue([
    {
      title: "Arrival",
      subtitle: "Wrong artist",
      item_key: "wrong",
      image_key: "wrong-cover",
    },
    {
      title: "Arrival (Deluxe Edition)",
      subtitle: "ABBA",
      item_key: "right",
      image_key: "cover",
    },
  ]);
  const tracks = [{ album: "Arrival", artist: "ABBA", track: "Dancing Queen" }];
  expect(await Promise.all([cinemaArtwork("living", tracks), cinemaArtwork("living", tracks)])).toEqual([
    "cover",
    "cover",
  ]);
  expect(searchAlbumsInLibrary).toHaveBeenCalledTimes(1);
  expect(searchAlbumsInLibrary).toHaveBeenCalledWith(expect.stringMatching(/^cinema-artwork-/), "living", "Arrival");
});

test("skips missing covers and duplicate albums, then tries another playlist album", async () => {
  jest
    .mocked(searchAlbumsInLibrary)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        title: "Voulez-Vous",
        subtitle: "ABBA",
        item_key: "album",
        image_key: "second-cover",
      },
    ]);
  expect(
    await cinemaArtwork("kitchen", [
      { album: "Arrival", artist: "ABBA", track: "One" },
      { album: "Arrival", artist: "ABBA", track: "Two" },
      { album: "Voulez-Vous", artist: "ABBA", track: "Three" },
    ])
  ).toBe("second-cover");
  expect(searchAlbumsInLibrary).toHaveBeenCalledTimes(2);
});

test("loads the matching Roon JPEG for the montage using an available room", async () => {
  jest.mocked(zoneManager.zones).mockReturnValue([{ zone_id: "cover-room", display_name: "Room" }]);
  jest.mocked(searchAlbumsInLibrary).mockResolvedValue([
    { title: "Heroes and Villains", subtitle: "David Bowie", item_key: "wrong", image_key: "wrong" },
    { title: "Heroes", subtitle: "David Bowie", item_key: "right", image_key: "heroes-cover" },
  ]);
  const image = Buffer.from([0xff, 0xd8, ...Array<number>(30).fill(0)]);
  jest.mocked(roon.getImage).mockResolvedValue({ content_type: "image/jpeg", image });
  await expect(cinemaAlbumCover({ artist: "David Bowie", track: "Heroes", album: "Heroes" })).resolves.toEqual({
    imageKey: "heroes-cover",
    image,
  });
  expect(roon.getImage).toHaveBeenCalledWith("heroes-cover", {
    format: "image/jpeg",
    width: 1600,
    height: 1600,
    scale: "fit",
  });
});

test("a stalled lookup expires and the next request has an independent browse session", async () => {
  jest.useFakeTimers();
  jest.mocked(searchAlbumsInLibrary).mockImplementationOnce(() => new Promise(() => undefined));
  const track = { artist: "Timeout artist", track: "Track", album: "Timeout album" };
  const first = cinemaArtwork("timeout-room", [track]);
  const second = cinemaArtwork("timeout-room", [{ ...track, album: "Next album" }]);
  jest
    .mocked(searchAlbumsInLibrary)
    .mockResolvedValueOnce([
      { title: "Next album", subtitle: track.artist, item_key: "next", image_key: "next-cover" },
    ]);
  await jest.advanceTimersByTimeAsync(8000);
  await expect(first).resolves.toBeNull();
  await expect(second).resolves.toBe("next-cover");
  const sessions = jest.mocked(searchAlbumsInLibrary).mock.calls.map(([session]) => session);
  expect(new Set(sessions).size).toBe(2);
  expect(jest.getTimerCount()).toBe(0);
});

test("album identity includes artist and preserves non-Latin names", async () => {
  jest
    .mocked(searchAlbumsInLibrary)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ title: "光", subtitle: "宇多田ヒカル", item_key: "album", image_key: "japanese-cover" }]);
  await expect(
    cinemaArtwork("japanese-room", [
      { artist: "Another artist", album: "光", track: "One" },
      { artist: "宇多田ヒカル", album: "光", track: "Two" },
    ])
  ).resolves.toBe("japanese-cover");
});

test("missing rooms and invalid image responses do not create cover files", async () => {
  jest.mocked(zoneManager.zones).mockReturnValue([]);
  const track = { artist: "David Bowie", track: "Heroes", album: "Heroes" };
  await expect(cinemaAlbumCover(track)).resolves.toBeUndefined();
  expect(roon.getImage).not.toHaveBeenCalled();
  jest.mocked(zoneManager.zones).mockReturnValue([{ zone_id: "invalid-image-room", display_name: "Room" }]);
  jest
    .mocked(searchAlbumsInLibrary)
    .mockResolvedValue([{ title: "Heroes", subtitle: "David Bowie", item_key: "right", image_key: "invalid-image" }]);
  jest
    .mocked(roon.getImage)
    .mockResolvedValue({ content_type: "image/jpeg", image: Buffer.from("<html>failed image</html>") });
  await expect(cinemaAlbumCover(track)).resolves.toBeUndefined();
});
