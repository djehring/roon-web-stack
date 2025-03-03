import { Item } from "@model";
import { Track } from "../ai-service/types/track";
import { matchAlbumInList } from "./matching-utils";

describe("matching-utils", () => {
  describe("matchAlbumInList", () => {
    // Common test data
    const createAlbumsList = (items: Item[]) => ({ items });
    const createTrack = (album: string, artist: string): Track => ({
      album,
      artist,
      track: "Test Track", // track name doesn't matter for album matching
    });

    it("should return null when no albums match", () => {
      const albums = createAlbumsList([
        {
          title: "Different Album",
          subtitle: "[[123|Different Artist]]",
          item_key: "key1",
        },
      ]);
      const track = createTrack("Test Album", "Test Artist");

      const result = matchAlbumInList(albums, track);
      expect(result).toBeNull();
    });

    it("should match exact album title and artist", () => {
      const albums = createAlbumsList([
        {
          title: "Test Album",
          subtitle: "[[123|Test Artist]]",
          item_key: "key1",
        },
      ]);
      const track = createTrack("Test Album", "Test Artist");

      const result = matchAlbumInList(albums, track);
      expect(result).toEqual(albums.items[0]);
    });

    it("should normalize album titles for comparison", () => {
      const albums = createAlbumsList([
        {
          title: "Café Nights (Deluxe Edition)",
          subtitle: "[[123|Test Artist]]",
          item_key: "key1",
        },
      ]);
      const track = createTrack("cafe nights", "Test Artist");

      const result = matchAlbumInList(albums, track);
      expect(result).toEqual(albums.items[0]);
    });

    it("should normalize artist names for comparison", () => {
      const albums = createAlbumsList([
        {
          title: "Test Album",
          subtitle: "[[123|Sinéad O'Connor]]",
          item_key: "key1",
        },
      ]);
      const track = createTrack("Test Album", "Sinead OConnor");

      const result = matchAlbumInList(albums, track);
      expect(result).toEqual(albums.items[0]);
    });

    it("should match when artist is part of a collaboration", () => {
      const albums = createAlbumsList([
        {
          title: "Collaboration Album",
          subtitle: "[[123|Artist One]] & [[456|Artist Two]]",
          item_key: "key1",
        },
      ]);
      const track = createTrack("Collaboration Album", "Artist Two");

      const result = matchAlbumInList(albums, track);
      expect(result).toEqual(albums.items[0]);
    });

    it("should handle empty or malformed subtitle", () => {
      const albums = createAlbumsList([
        {
          title: "Test Album",
          subtitle: "", // Empty subtitle
          item_key: "key1",
        },
        {
          title: "Test Album",
          subtitle: "[[malformed", // Malformed subtitle
          item_key: "key2",
        },
      ]);
      const track = createTrack("Test Album", "Any Artist");

      const result = matchAlbumInList(albums, track);
      expect(result).toBeNull();
    });

    it("should match when artist name is a substring", () => {
      const albums = createAlbumsList([
        {
          title: "Test Album",
          subtitle: "[[123|The Beatles]]",
          item_key: "key1",
        },
      ]);
      const track = createTrack("Test Album", "Beatles");

      const result = matchAlbumInList(albums, track);
      expect(result).toEqual(albums.items[0]);
    });

    it("should handle multiple albums with same title but different artists", () => {
      const albums = createAlbumsList([
        {
          title: "Self Titled",
          subtitle: "[[123|Artist One]]",
          item_key: "key1",
        },
        {
          title: "Self Titled",
          subtitle: "[[456|Artist Two]]",
          item_key: "key2",
        },
      ]);
      const track = createTrack("Self Titled", "Artist Two");

      const result = matchAlbumInList(albums, track);
      expect(result).toEqual(albums.items[1]);
    });
  });
});
