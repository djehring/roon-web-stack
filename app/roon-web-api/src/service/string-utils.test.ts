import { normalizeArtistName, normalizeString } from "./string-utils";

describe("string-utils", () => {
  describe("normalizeString", () => {
    it("should handle empty strings", () => {
      expect(normalizeString("")).toBe("");
      expect(normalizeString(undefined as unknown as string)).toBe("");
      expect(normalizeString(null as unknown as string)).toBe("");
    });

    it("should convert to lowercase", () => {
      expect(normalizeString("HELLO WORLD")).toBe("hello world");
      expect(normalizeString("Mixed CASE")).toBe("mixed case");
    });

    it("should remove diacritics", () => {
      expect(normalizeString("café")).toBe("cafe");
      expect(normalizeString("Beyoncé")).toBe("beyonce");
      expect(normalizeString("Mötley Crüe")).toBe("motley crue");
    });

    it("should normalize quotes", () => {
      expect(normalizeString("'single' 'quotes'")).toBe("'single' 'quotes'");
      expect(normalizeString("\u201cdouble\u201d \u201cquotes\u201d")).toBe("double quotes");
    });

    it("should replace & with 'and'", () => {
      expect(normalizeString("Rock & Roll")).toBe("rock and roll");
      expect(normalizeString("R&B")).toBe("r and b");
    });

    it("should remove disc-track numbers", () => {
      expect(normalizeString("1-6 Song Title")).toBe("song title");
      expect(normalizeString("2-11 Another Song")).toBe("another song");
      expect(normalizeString("1. First Song")).toBe("first song");
    });

    it("should remove version decorations", () => {
      expect(normalizeString("Song (2023 Remaster)")).toBe("song");
      expect(normalizeString("Track (Radio Edit)")).toBe("track");
      expect(normalizeString("Music (Remix Version)")).toBe("music");
      expect(normalizeString("Song (Stereo Mix)")).toBe("song");
      expect(normalizeString("Track (Mono Version)")).toBe("track");
      expect(normalizeString("Album (Deluxe Edition)")).toBe("album");
    });

    it("should remove content in square brackets", () => {
      expect(normalizeString("Song [Live]")).toBe("song");
      expect(normalizeString("Track [Demo Version]")).toBe("track");
    });

    it("should normalize colons and dashes", () => {
      expect(normalizeString("Artist: Song")).toBe("artist song");
      expect(normalizeString("Album - Track")).toBe("album track");
    });

    it("should normalize spaces", () => {
      expect(normalizeString("  Multiple   Spaces  ")).toBe("multiple spaces");
    });

    it("should replace 'greatest' with 'great'", () => {
      expect(normalizeString("Greatest Hits")).toBe("great hits");
      expect(normalizeString("The Greatest Show")).toBe("the great show");
    });

    it("should remove leading track numbers", () => {
      expect(normalizeString("01 Track")).toBe("track");
      expect(normalizeString("12. Song")).toBe("song");
    });

    it("should handle complex combinations", () => {
      expect(normalizeString("01. Stairway to Heaven [2007 Remaster] (Live Version)")).toBe("stairway to heaven");
      expect(normalizeString("1-3 Sweet Child O' Mine - Greatest Hits Edition [HD]")).toBe(
        "sweet child o' mine great hits edition"
      );
    });
  });

  describe("normalizeArtistName", () => {
    it("should handle empty strings", () => {
      expect(normalizeArtistName("")).toBe("");
      expect(normalizeArtistName(undefined as unknown as string)).toBe("");
      expect(normalizeArtistName(null as unknown as string)).toBe("");
    });

    it("should normalize common name variations", () => {
      expect(normalizeArtistName("Stephan")).toBe("stephane");
      expect(normalizeArtistName("Steven Wilson")).toBe("stephen wilson");
    });

    it("should handle Sinéad O'Connor variations", () => {
      expect(normalizeArtistName("Sinéad O'Connor")).toBe("sinead oconnor");
      expect(normalizeArtistName("Sinead O'Connor")).toBe("sinead oconnor");
      expect(normalizeArtistName("Sinead OConnor")).toBe("sinead oconnor");
    });

    it("should handle collaborations with commas", () => {
      expect(normalizeArtistName("Eminem, Dr. Dre")).toBe("eminem dr dre");
      expect(normalizeArtistName("Jay-Z, Kanye West, Rihanna")).toBe("jay z kanye west rihanna");
    });

    it("should handle collaborations with 'and'", () => {
      expect(normalizeArtistName("Simon and Garfunkel")).toBe("simon garfunkel");
      expect(normalizeArtistName("Hall & Oates")).toBe("hall oates");
    });

    it("should handle complex artist names", () => {
      expect(normalizeArtistName("Sinéad O'Connor & The Chieftains")).toBe("sinead oconnor the chieftains");
      expect(normalizeArtistName("Steven Tyler, Joe Perry & The Boston Pops")).toBe(
        "stephen tyler joe perry the boston pops"
      );
    });

    it("should preserve meaningful special characters", () => {
      expect(normalizeArtistName("AC/DC")).toBe("acdc");
      expect(normalizeArtistName("P!nk")).toBe("pnk");
      expect(normalizeArtistName("$uicideboy$")).toBe("uicideboy");
    });

    it("should handle international artist names", () => {
      expect(normalizeArtistName("Björk")).toBe("bjork");
      expect(normalizeArtistName("Sigur Rós")).toBe("sigur ros");
      expect(normalizeArtistName("Mônica Salmaso")).toBe("monica salmaso");
    });

    it("should handle Gilbert O'Sullivan variations", () => {
      expect(normalizeArtistName("Gilbert O'Sullivan")).toBe("gilbert osullivan");
      expect(normalizeArtistName("Gilbert OSullivan")).toBe("gilbert osullivan");
      expect(normalizeArtistName("Gilbert O Sullivan")).toBe("gilbert osullivan");
    });

    it("should remove apostrophes consistently", () => {
      expect(normalizeArtistName("D'Angelo")).toBe("dangelo");
      expect(normalizeArtistName("Guns N' Roses")).toBe("guns n roses");
      expect(normalizeArtistName("Destiny's Child")).toBe("destinys child");
    });

    it("should remove 'The ' from the beginning of artist names", () => {
      expect(normalizeArtistName("The Beatles")).toBe("beatles");
      expect(normalizeArtistName("The Rolling Stones")).toBe("rolling stones");
      expect(normalizeArtistName("The Shamen")).toBe("shamen");
      expect(normalizeArtistName("The Who")).toBe("who");
      // Should not affect "The" in the middle of a name
      expect(normalizeArtistName("Rage Against The Machine")).toBe("rage against the machine");
    });
  });
});
