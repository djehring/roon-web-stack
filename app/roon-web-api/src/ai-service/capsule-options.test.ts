import { validateCapsuleOptions } from "./capsule-options";
import { capsuleKey, capsuleResearchMode, configuredSubject, validateCapsuleRequest } from "./time-capsule";

export const cinemaOptions = () => ({
  mode: "period",
  topics: ["headlines", "sports"],
  subject: "UK top ten in 1984",
  region: "GB",
  workContext: "composition",
  captions: "brief",
  motion: "gentle",
  pace: "standard",
  order: "curated",
});
const request = (options = cinemaOptions()) =>
  validateCapsuleRequest({
    query: "Top ten in 1984",
    requestedAt: "2026-09-18T12:00:00Z",
    locale: "en_GB",
    timeZone: "Europe/London",
    tracks: [{ artist: "An artist", track: "A track", album: "An album" }],
    options,
  });

describe("Cinema options", () => {
  test("topic order is canonical but different selections and presentation have different cache keys", () => {
    const original = request();
    expect(capsuleKey(original)).toBe(
      capsuleKey(request({ ...cinemaOptions(), topics: ["sports", "headlines", "sports"] }))
    );
    expect(capsuleKey(original)).not.toBe(capsuleKey(request({ ...cinemaOptions(), topics: ["headlines"] })));
    expect(capsuleKey(original)).not.toBe(capsuleKey(request({ ...cinemaOptions(), pace: "relaxed" })));
    expect(original.query).toBe("Top ten in 1984");
    expect(original.options?.subject).toBe("UK top ten in 1984");
  });
  test.each([
    { topics: [] },
    { topics: ["madeUp"] },
    { mode: "photos" },
    { captions: "madeUp" },
    { showTrackTitle: "true" },
    { showTrackTitle: null },
    { motion: "madeUp" },
    { pace: "madeUp" },
    { order: "madeUp" },
    { region: "Britain" },
    { subject: " " },
    { periodStart: "2024-02-30", periodEnd: "2024-03-01" },
    { periodStart: "1984-01-01" },
    { periodStart: "1984-12-31", periodEnd: "1984-01-01" },
  ])("rejects invalid options: %j", (invalid) => {
    expect(() => validateCapsuleOptions({ ...cinemaOptions(), ...invalid })).toThrow();
  });
  test("preserves the track title choice while accepting older options", () => {
    expect(validateCapsuleOptions(cinemaOptions()).showTrackTitle).toBeUndefined();
    for (const showTrackTitle of [true, false]) {
      expect(validateCapsuleOptions({ ...cinemaOptions(), showTrackTitle }).showTrackTitle).toBe(showTrackTitle);
    }
  });
  test("presets allow additional topics without changing mode", () => {
    const options = validateCapsuleOptions({
      ...cinemaOptions(),
      topics: ["headlines", "artistImages", "albumCovers"],
    });
    expect(options.mode).toBe("period");
    expect(options.topics).toEqual(["albumCovers", "artistImages", "headlines"]);
  });
  test("uses selected tracks as the canonical artist or musical work", () => {
    const artist = validateCapsuleOptions({
      ...cinemaOptions(),
      mode: "artist",
      topics: ["artistImages"],
      subject: "Bowie greatest hits",
    });
    expect(
      configuredSubject(artist, [
        { artist: "David Bowie", track: "Changes", album: "Hunky Dory" },
        { artist: "David Bowie", track: "Heroes", album: "Heroes" },
      ])
    ).toBe("David Bowie");
    const work = validateCapsuleOptions({
      ...cinemaOptions(),
      mode: "work",
      topics: ["composer"],
      subject: "Emperor concerto",
    });
    expect(
      configuredSubject(work, [
        { artist: "Beethoven", track: "Piano Concerto No. 5: I. Allegro", album: "" },
        { artist: "Beethoven", track: "Piano Concerto No. 5: II. Adagio", album: "" },
      ])
    ).toBe("Beethoven — Piano Concerto No. 5");
  });
  test("an explicit artist or work mode wins over calendar vocabulary", () => {
    const input = request({
      ...cinemaOptions(),
      mode: "artist",
      topics: ["artistImages"],
      subject: "Django, 1939–1945",
    });
    expect(capsuleResearchMode(input)).toBe("subject");
  });
  test("valid exact dates survive validation", () => {
    expect(
      validateCapsuleOptions({ ...cinemaOptions(), periodStart: "1984-02-01", periodEnd: "1984-02-29" })
    ).toMatchObject({ periodStart: "1984-02-01", periodEnd: "1984-02-29" });
  });
});
