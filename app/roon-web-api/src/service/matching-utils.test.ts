import { Item } from "@model";
import { Track } from "../ai-service/types/track";
import { matchAlbumInList, matchesArtist, matchTrackInList } from "./matching-utils";

describe("matching-utils", () => {
  describe("recording identity", () => {
    test.each([
      ["Olivia Newton-John", "[[1|Olivia Newton-John]]", true],
      ["Olivia Newton-John", "Juliana Hatfield", false],
      ["Olivia Newton-John", "[[2|Juliana Hatfield]]", false],
      ["Olivia Newton-John", "Juliana Hatfield Sings Olivia Newton-John", false],
      ["Olivia Newton-John", "[[2|Juliana Hatfield Sings Olivia Newton-John]]", false],
      ["John Lennon", "John Legend", false],
      ["Queen", "Queens of the Stone Age", false],
      ["Olivia Newton-John", undefined, false],
      ["Olivia Newton-John", "", false],
      ["", "", false],
      ["The Beatles", "Beatles", true],
      ["Sinéad O’Connor", "Sinead O'Connor", true],
      ["Olivia Newton-John", "[[1|John Travolta]], [[2|Olivia Newton-John]]", true],
      ["Olivia Newton-John", "John Travolta & Olivia Newton-John", true],
    ])("artist %s against %s matches=%s", (artist, credit, expected) => {
      expect(matchesArtist(artist, credit)).toBe(expected);
    });

    test("a confirmed album artist may supply a missing track credit, never override another performer", () => {
      const track = { artist: "Olivia Newton-John", album: "Grease", track: "Hopelessly Devoted to You" };
      const item = { title: track.track, item_key: "track" };
      expect(matchTrackInList([item], track, "Olivia Newton-John")).toBe(item);
      expect(matchTrackInList([item], track, "Various Artists")).toBeUndefined();
      expect(matchTrackInList([item], track)).toBeUndefined();
      expect(
        matchTrackInList([{ ...item, subtitle: "Juliana Hatfield" }], track, "Olivia Newton-John")
      ).toBeUndefined();
    });

    test("a lone same-title album must still have the requested artist", () => {
      const track = { artist: "Olivia Newton-John", album: "Grease", track: "Hopelessly Devoted to You" };
      expect(
        matchAlbumInList({ items: [{ title: "Grease", item_key: "album", subtitle: "[[1|Juliana Hatfield]]" }] }, track)
      ).toBeNull();
    });

    test("track matching keeps remasters but rejects partial titles and missing playback keys", () => {
      const track = { artist: "The Muppets", album: "", track: "Mah Na Mah Na" };
      const item = { title: "1-6 Mahna Mahna (2009 Remaster)", subtitle: "The Muppets", item_key: "track" };
      expect(matchTrackInList([item], track)).toBe(item);
      expect(matchTrackInList([{ ...item, title: "Mahna Mahna Medley" }], track)).toBeUndefined();
      expect(matchTrackInList([{ ...item, item_key: undefined }], track)).toBeUndefined();
    });
  });
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

    it("should match a plain artist subtitle without Roon's encoded form", () => {
      const albums = createAlbumsList([
        {
          title: "The Green Album",
          subtitle: "The Muppets",
          item_key: "key1",
        },
      ]);
      const track = createTrack("The Muppets: The Green Album", "The Muppets");

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

    it("should handle apostrophes in artist names", () => {
      const albums = createAlbumsList([
        {
          title: "Back to Front",
          subtitle: "[[123|Gilbert O'Sullivan]]",
          item_key: "key1",
        },
      ]);

      // Test with apostrophe
      let track = createTrack("Back to Front", "Gilbert O'Sullivan");
      let result = matchAlbumInList(albums, track);
      expect(result).toEqual(albums.items[0]);

      // Test without apostrophe
      track = createTrack("Back to Front", "Gilbert OSullivan");
      result = matchAlbumInList(albums, track);
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
