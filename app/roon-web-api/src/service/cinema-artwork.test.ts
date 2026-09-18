import { cinemaArtwork } from "./cinema-artwork";
import { searchAlbumsInLibrary } from "./roon-utils";

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
  expect(
    await Promise.all([
      cinemaArtwork("living", tracks),
      cinemaArtwork("living", tracks),
    ])
  ).toEqual(["cover", "cover"]);
  expect(searchAlbumsInLibrary).toHaveBeenCalledTimes(1);
  expect(searchAlbumsInLibrary).toHaveBeenCalledWith(
    "cinema-artwork",
    "living",
    "Arrival"
  );
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
