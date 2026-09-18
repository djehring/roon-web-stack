import {
  captionArtistPortraits,
  photographMatchesScene,
  prepareArtistPortraits,
  TimeCapsule,
  validateCapsuleRequest,
} from "./time-capsule";

test("Bowie portraits use actual archive metadata rather than claiming a different licensed studio session", () => {
  const input = validateCapsuleRequest({
    query: "Bowie greatest hits",
    requestedAt: "2026-09-18T12:00:00Z",
    locale: "en_GB",
    timeZone: "Europe/London",
    tracks: [
      { artist: "David Bowie", track: "Changes", album: "Best of Bowie" },
    ],
    options: {
      mode: "artist",
      topics: ["artistImages"],
      subject: "Bowie greatest hits",
      region: "GB",
      workContext: "composition",
      captions: "brief",
      motion: "gentle",
      pace: "standard",
      order: "curated",
    },
  });
  const capsule: TimeCapsule = {
    id: "portraits",
    title: "Bowie",
    contextLabel: "Bowie",
    request: input,
    createdAt: "2026-09-18T12:00:00Z",
    scenes: [
      {
        id: "portrait",
        title: "David Bowie photographed by Mick Rock, 1972",
        body: "A licensed studio portrait.",
        dateLabel: "1972",
        eventStart: "1972-01-01",
        scope: "Music",
        topic: "artistImages",
        sources: [
          { title: "Studio catalogue", url: "https://example.org/studio" },
        ],
        trackIndices: [],
        imageSubjects: ["David Bowie", "Mick Rock"],
      },
    ],
  };
  prepareArtistPortraits(capsule);
  expect(capsule.scenes[0]).toMatchObject({
    title: "David Bowie",
    body: "",
    dateLabel: "",
    imageSubjects: ["David Bowie"],
  });
  expect(capsule.scenes[0].eventStart).toBeUndefined();
  expect(
    photographMatchesScene(capsule.scenes[0], {
      sourceUrl: "https://example.org/mick-rock",
      description: "Mick Rock portrait",
    })
  ).toBe(false);
  const images = ["1983-06-01", "1990-03-01", "2008 (upload date)"].map(
    (date, index) => ({
      file: `photo-${index}`,
      date,
      sourceUrl: `https://commons.wikimedia.org/wiki/File:David_Bowie_${index}.jpg`,
      description: "David Bowie performing",
      credit: "Concert photographer",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    })
  );
  capsule.scenes[0].images = images;
  captionArtistPortraits(capsule);
  expect(capsule.scenes.map((scene) => scene.dateLabel)).toEqual([
    "1983-06-01",
    "1990-03-01",
    "2008 (upload date)",
  ]);
  expect(capsule.scenes.map((scene) => scene.eventStart)).toEqual([
    "1983-06-01",
    "1990-03-01",
    undefined,
  ]);
  expect(capsule.scenes.map((scene) => scene.sources[0].url)).toEqual(
    images.map((image) => image.sourceUrl)
  );
  expect(
    capsule.scenes.every(
      (scene) => scene.body === "" && scene.topic === "artistImages"
    )
  ).toBe(true);
  expect(capsule.scenes.map((scene) => scene.images?.length)).toEqual([
    1, 1, 1,
  ]);
});
