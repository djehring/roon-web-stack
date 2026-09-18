# Time Capsule API

## Adaptive Cinema options

The native setup can now choose a period, artist or musical-work companion. Authenticated
`GET /capabilities` returns `{optionsVersion:2}`; new clients check this before creation.
The original query, timestamp and soundtrack are preserved. An optional `options` object carries:

- `mode`: `period`, `artist` or `work`.
- `topics`: validated topic IDs; at least one is required. Modes suggest defaults but allow extra topics.
- `subject`, `region` and optional inclusive ISO `periodStart` / `periodEnd`.
- `workContext`: `composition` or `recording`.
- `captions`: `none`, `brief`, `detailed`; `motion`: `still`, `gentle`, `kenBurns`.
- `pace`: `relaxed`, `standard`, `lively`; `order`: `curated`, `chronological`, `shuffled`.

Topics include period headlines/sport/culture/everyday life; artist photographs/career/collaborators/places;
and composer/programme notes/artwork/manuscripts/performers. Album covers are an optional topic in every
research mode; only covers available under the normal reusable-image licence gate are eligible. Wider
history is optional for artist/work modes.
See `capsule-options.ts` for the exact IDs. Topic order is canonicalized before cache hashing.

Configured requests research only selected topics, independently audit the evidence, filter compiled scenes
by selected topic ID, and retain all options in saved manifests and rebuilds. They require three distinct
accepted images across at least three scenes without the legacy mandatory topic or domestic quotas. Missing illustrated topics are
reported in `notices`; available material can still play. Classical imagery can include genuine paintings,
engravings, manuscripts and scores. Composition context never defaults to a recording year.
An artist request that includes Artist photographs cannot publish without an accepted image of that artist;
places and collaborators are not accepted as a substitute.

Personal Photos montages are entirely on-device and never use these routes. The API rejects `photos` mode.
Requests without `options` retain their existing behavior. Research checkpoints now use version 4.

## Existing request flow

Continually changing photographic Cinema montages for the native iPhone, iPad and Apple TV clients. The API researches the exact AI Search request and selected tracks; no historical content pack is bundled.

Configuration:

- Paste the OpenAI API key in Settings (stored on the bridge config volume). `OPENAI_API_KEY` remains an operator fallback.
- `TIME_CAPSULE_MODEL`: defaults to `gpt-5.6-sol`; requires Responses web search, image input and JSON output.
- `TIME_CAPSULE_CACHE_DIR`: defaults to `cache/time-capsules` under the API working directory. Mount this directory on persistent storage in Docker; do not rely on the container writable layer.

Every route uses the existing registered-client check. The base path is `/api/:client_id/time-capsules`:

| Route | Purpose |
| --- | --- |
| GET `/` | Saved manifests, newest 50 |
| POST `/` | Start preparation (202), or cached programme (200) |
| GET `/jobs/:id` | Preparation status / completed programme |
| GET `/:id` | Saved programme |
| POST `/:id/rebuild` | Rebuild original request, retaining ID and room association |
| GET `/images/:hash` | Cached archive image |
| GET `/zone/:zoneId` | Room association, or 204 |
| PUT `/zone/:zoneId` | Set association with `{capsuleId}` |

Create body: `{query, requestedAt, locale, timeZone, tracks:[{artist,track,album}]}`. Freeze `requestedAt` when the music search starts. Hash identity includes the complete request, so replay never reinterprets relative dates. The shared library stores app-owned track snapshots, not Roon playlist IDs.

For a week/year search, preparation researches news, politics, economy, sport, culture and people in the exact requested window. Songs are the soundtrack; the research does not default to artist biographies. Each short headline describes one event with retrieved source URLs and in-period start/end dates.

Wikimedia Commons candidates require a reusable licence, attribution, approved HTTPS download host and original width of at least 1,000 pixels. If Commons and Wikipedia page images yield fewer than three eligible photographs for a search, the bridge also queries Openverse for the same licence class, excluding Wikimedia duplicates. Only Flickr originals on `*.staticflickr.com` with a flickr.com source page are downloaded; NC/ND licences are rejected. Original photographic dates must precede the requested period’s end; unknown dates and ambiguous ranges crossing that cutoff are rejected. Earlier portraits of the exact subject remain permissible, visibly dated. Selection uses explicit headline/photo IDs, omits unsuitable subjects and is instructed to reject alternate crops. The bridge also deduplicates file references. Thumbnail downloads fall back to approved original files if necessary. A further AI visual review inspects the actual downloaded pixels in batches of three, rejecting obvious blur, severe pixelation and unrelated subjects. This is a best-effort quality filter; it cannot guarantee perfect archival imagery.

Scenes contain `images` arrays and retain `image` as the first photograph for older clients. Legacy `contextImage` is not generated. At least three distinct downloaded photos are required before publishing a manifest; scenes without images never become montage frames. Rebuild failure preserves the previous saved manifest. Model output is not independently fact-checked, and archive coverage varies.

Two jobs can run concurrently. Finished manifests and room associations are atomically saved. In-progress status is in memory and will be lost on restart. Each OpenAI call has a 150-second timeout; downloads have 20-second / 8 MB limits. Clients can refresh the library after disconnecting while preparation continues. There is no cancellation, deletion or automatic retention UI yet.

Requires the companion native Cinema app update. Native viewers change photographs every eight seconds, continue across song boundaries, and hold on Roon pause. Each screen has its own photo clock; music still plays in the Roon room. No AirPlay video export, TV wake/launch or licensed newspaper archive integration is included.

Verification covers generation/cache persistence, arbitrary requests, evidence URLs, exact event boundaries, photo chronology, explicit image matching, duplicate references, rebuild preservation and paired HTTP route behaviour. The companion native tests cover independent photo timing and pause/resume. Live archive coverage must be checked alongside tests; it cannot be inferred from mocked image metadata.
