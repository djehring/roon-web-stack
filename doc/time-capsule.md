# Time Capsule API

## Editable music snapshots

`GET /capabilities` also advertises `musicVersion:1` and `maxTracks:1000`.
Paired clients can import music without executing playback actions:

- `POST /music/browse` with `{path, zoneId?}` returns collection metadata and child paths.
- `POST /music/import` with the same body returns `{tracks}` in source order, including repeats.
- `POST /music/queue` with `{zoneId}` returns `{title, sourceLabel, tracks, includesCurrent}`.
- `PUT /:id/content` with `{request, baseRevision, mutationId}` saves name, music and
  presentation immediately when picture content is unchanged; topic/context changes
  return a generation job. Stale revisions return 409. Mutation retries are idempotent.

Soundtracks contain 1–1,000 tracks. Imports paginate beyond the ordinary browse/queue
windows, reject partial captures and use isolated sessions. Track occurrence IDs
preserve repeated songs independently. `roonPath` stores a verified browse route rather
than expiring item keys; `imageKey`, `durationSeconds` and `matchPolicy:"exact"` are optional.
Exact playback uses the selected recording or reports it unavailable; it never silently
substitutes an AI-corrected recording. `POST /play-tracks` accepts `cinema:true` to disable
shuffle and keep the saved order. Import endpoints do not call it.

Requests may include `title`, `sourceLabel` and `clientRequestId`. Shared items use
`revision`/`lastMutationId`; picture completion preserves music edits made during its
build. Background cover refresh does not invalidate a content revision. Original query
and requested-at context remain anchored. Research receives at most 40 sample tracks,
independently of the full saved soundtrack.

The new `artwork` mode requires only the `albumCovers` topic and no OpenAI key. An
explicitly chosen visual subject (`subjectIsExplicit:true`) stays independent of changes
to soundtrack artists. Personal-photo items use the same music editor but remain local.

## Adaptive Cinema options

`options.showTrackTitle` is an optional boolean, defaulting to false for older items.
It controls the persistent current-track title and artist independently of picture
captions. `options.motion` accepts `still`, `gentle` and `kenBurns`. Both are presentation
choices: content saves reuse pictures, and in-flight picture generation preserves
later presentation edits.

The native setup can now choose a period, artist or musical-work companion. Authenticated
`GET /capabilities` returns `{optionsVersion:2, managementVersion:1, musicVersion:1, maxTracks:1000}`; clients check options support before creation and management support before editing or deleting.
The original query and timestamp remain anchored; soundtrack changes use the content endpoint. An optional `options` object carries:

- `mode`: `period`, `artist`, `work` or `artwork`.
- `topics`: validated topic IDs; at least one is required. Modes suggest defaults but allow extra topics.
- `subject`, `region` and optional inclusive ISO `periodStart` / `periodEnd`.
- `workContext`: `composition` or `recording`.
- `captions`: `none`, `brief`, `detailed`; `motion`: `still`, `gentle`, `kenBurns`.
- `pace`: `relaxed`, `standard`, `lively`; `order`: `curated`, `chronological`, `shuffled`.

Topics include period headlines/sport/culture/everyday life; artist photographs/career/collaborators/places;
and composer/programme notes/artwork/manuscripts/performers. Album covers are an optional topic in every
research mode. The bridge resolves one selected track per distinct album and retrieves the same artwork
from the paired Roon library; archive search is not used for covers. Covers are downloaded as fitted JPEGs and cached beside the web images, then attached after web-image review in every mode. Lookup uses isolated browse sessions with an eight-second per-operation timeout and a thirty-second total cover budget. Wider history is optional for artist/work modes.

A covers-only montage accepts one album and requires neither an OpenAI key nor web research. Other montages retain their three-picture minimum. For a clearly identified artist without a date window, artist photographs and career photo captions continue through the direct gallery even when places or other context topics are selected. Only those extra topics need sourced research; that mixed path compiles the retrieved evidence without a second full web audit. Dated and other researched programmes retain their audit. Artist galleries use Commons first and try Wikipedia/Openverse when fewer than six matching candidates survive filtering. All web pictures retain source, licence and quality checks.
See `capsule-options.ts` for the exact IDs. Topic order is canonicalized before cache hashing.

Configured requests research only selected topics, independently audit the evidence, filter compiled scenes
by selected topic ID, and retain all options in saved manifests and rebuilds. They require three distinct
accepted images across at least three scenes without the legacy mandatory topic or domestic quotas. Missing illustrated topics are
reported in `notices`; available material can still play. Classical imagery can include genuine paintings,
engravings, manuscripts and scores. Composition context never defaults to a recording year.
An artist request that includes Artist photographs cannot publish without an accepted image of that artist;
places and collaborators are not accepted as a substitute.

Personal Photos montages are entirely on-device and never use these routes. The API rejects `photos` mode.
Requests without `options` retain their existing behavior. Research checkpoints now use version 6 so older web-cover research cannot be reused.

## Saved playlist management

The library opens first on native iPhone, iPad and Apple TV. Each Cinema item is an app-owned
track snapshot with visual options, independent of Roon playlist APIs. **Play music & pictures**
starts that snapshot in the selected room. **Watch pictures** sends no playback commands.

`PUT /:id` accepts `{options}` using the same validation as creation. It preserves the saved ID,
query, timestamp and tracks and starts a replacement generation job. Presentation/topic edits
preserve the previously resolved dates; changing the visual subject, mode or explicit dates
resolves the new context. The old manifest remains readable until the replacement is atomically
published. Failed regeneration leaves it intact. Concurrent edits and deletion during generation
return 409. A missing edit target returns 404.

Creation verifies that a cached manifest still matches the requested options. If its ID now
belongs to an edited playlist, a separate deterministic ID is used, so recreating an original
request cannot replay or overwrite the edited item. Repeated creation can reuse the separate cache.

`DELETE /:id` is idempotent (204). It removes the saved manifest, research draft, finished job
and matching room associations. Association changes are serialized with cleanup. Shared cached
image files remain because other Cinema items may refer to them. Personal-photo items are
managed on the source device, outside this API.

The native preparation player shows available album artwork or the previous picture immediately,
keeps the room's music controls usable, and switches to the finished montage automatically.
An older bridge reports an actionable update message in the client before editing/deleting.

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
| GET `/capabilities` | Supported option and management versions |
| POST `/` | Start preparation (202), or cached programme (200) |
| GET `/jobs/:id?generation=…` | Status for that generation; reject an interrupted/superseded run |
| POST `/artwork` | `{zoneId,tracks}` → `{imageKey}` or null; independent of generation and transport |
| GET `/:id` | Saved programme |
| POST `/:id/rebuild` | Rebuild original request, retaining ID and room association |
| PUT `/:id` | Update visual options and regenerate (202); preserve saved soundtrack and ID |
| DELETE `/:id` | Remove saved item and associations (204); 409 while generating |
| GET `/images/:hash` | Cached archive image |
| GET `/zone/:zoneId` | Room association, or 204 |
| PUT `/zone/:zoneId` | Set association with `{capsuleId}` |

Create body: `{query, requestedAt, locale, timeZone, tracks:[{artist,track,album}]}`. Freeze `requestedAt` when the music search starts. Hash identity includes the complete request, so replay never reinterprets relative dates. The shared library stores app-owned track snapshots, not Roon playlist IDs.

For a week/year search, preparation researches news, politics, economy, sport, culture and people in the exact requested window. Songs are the soundtrack; the research does not default to artist biographies. Each short headline describes one event with retrieved source URLs and in-period start/end dates.

Wikimedia Commons candidates require a reusable licence, attribution, approved HTTPS download host and original width of at least 1,000 pixels. If Commons and Wikipedia page images yield fewer than three eligible photographs for a search, the bridge also queries Openverse for the same licence class, excluding Wikimedia duplicates. Only Flickr originals on `*.staticflickr.com` with a flickr.com source page are downloaded; NC/ND licences are rejected. Original photographic dates must precede the requested period’s end; unknown dates and ambiguous ranges crossing that cutoff are rejected. Earlier portraits of the exact subject remain permissible, visibly dated. Selection uses explicit headline/photo IDs, omits unsuitable subjects and is instructed to reject alternate crops. The bridge also deduplicates file references. Thumbnail downloads fall back to approved original files if necessary. A further AI visual review inspects the actual downloaded pixels in batches of three, rejecting obvious blur, severe pixelation and unrelated subjects. This is a best-effort quality filter; it cannot guarantee perfect archival imagery.

Scenes contain `images` arrays and retain `image` as the first photograph for older clients. Legacy `contextImage` is not generated. At least three distinct downloaded photos are required before publishing a manifest; scenes without images never become montage frames. Rebuild failure preserves the previous saved manifest. Model output is not independently fact-checked, and archive coverage varies.

Two jobs can run concurrently. Finished manifests and room associations are atomically saved. Each run has a generation identifier and an atomic `job-<id>.json` marker. Finished manifests carry that identifier and a fresh completion timestamp. After restart, a pending marker cannot turn an old saved manifest into a successful rebuild: polling reports a retryable failure, including for legacy clients without a generation query. Active work does not resume automatically. Web-research calls get 300 seconds initially; structured-output calls get 150 seconds. Both allow one 300-second retry for transient errors; downloads have 20-second / 8 MB limits. Clients can refresh the library after disconnecting while preparation continues. There is no cancellation or automatic retention policy. The native library includes edit and delete actions.

Requires the companion native Cinema app update. Native viewers change photographs every eight seconds, continue across song boundaries, and hold on Roon pause. Each screen has its own photo clock; music still plays in the Roon room. No AirPlay video export, TV wake/launch or licensed newspaper archive integration is included.

Verification covers generation/cache persistence, arbitrary requests, evidence URLs, exact event boundaries, photo chronology, explicit image matching, duplicate references, rebuild preservation and paired HTTP route behaviour. The companion native tests cover independent photo timing and pause/resume. Live archive coverage must be checked alongside tests; it cannot be inferred from mocked image metadata.

Album-cover lookup uses a serialized `cinema-artwork` Roon browse session, separate from client browsing and playback. It tries up to three distinct playlist albums, verifies album and artist metadata, and caches successful keys. Clients prefetch during setup and load image bytes through the existing image route.

Completed web-research calls are checkpointed under `progress-<id>/<request-hash>/`, keyed by their full request payload. Retries reuse verified-source gathering while structured JSON remains uncached until the existing draft validation succeeds. Success and deletion remove the step cache. Jobs publish a `message` describing research, archive search, downloads or picture review; persisted failures retain the failed stage and error after restart. Native polling retries temporary network errors against the same generation.

The native watchdog measures 15 minutes without a stage change, not 15 minutes total. Stage progress keeps an active long build connected; connection recovery preserves its generation ID and does not submit another build.

For single-artist montages, artist-picture scenes search for the canonical soundtrack artist and use each accepted archive photograph's own date and attribution. Research must not require a particular studio portrait or copyrighted catalogue item. Each accepted portrait becomes a separate scene after the normal subject, licence and visual checks. Repeated archive queries share results within one build. A live isolated Bowie run verified completion with 16 distinct pictures, including seven artist portraits, after resuming its saved research draft.

Simple artist galleries bypass biography research, research verification, scene compilation and AI search planning. This applies to one artist with a full name, no date range or extra subject context, and only artist pictures, career photos and album covers selected. They look up that exact artist directly in Commons, preserve search relevance, distribute candidates across dates and caption them from archive metadata. Career captions describe the photographed performances and appearances rather than generating a biography. Up to 18 candidates are downloaded and visually reviewed; rebuilds prefer sources absent from the previous saved montage. Missing cover artwork is reported rather than substituted with an artist portrait. A fresh Bowie gallery completed in 40 seconds with nine accepted photographs.

Dated requests, ambiguous short artist names and wider contextual topics retain the research workflow. Those topics are researched concurrently, with at most three active topics per build. Their results retain the selected topic order and all finish before independent verification starts. Research notes are concise to reduce repeated material in verification and compilation. Archive searches use three rolling workers, so one slow lookup no longer stalls an entire batch. Photo review runs two independent batches of three images at a time and can approve only the photos actually present in that batch. Licence, metadata, subject and pixel checks remain in place. Progress writes are serialized, and failures drain active work before allowing a retry, preventing late progress from an earlier run.

For GPT-5/6 models, converting verified notes and archive metadata into JSON uses `reasoning.effort: low`. Web research, independent verification and pixel review retain their default reasoning. Other model overrides do not receive this setting. The default [GPT-5.6 Sol model supports low reasoning](https://developers.openai.com/api/docs/models/gpt-5.6-sol); no model change is required.


The archive-search progress counter explicitly counts searches, not downloaded pictures. Download and quality-review messages report their own photo counts. Commons queries include `filetype:bitmap`, preventing PDF/DjVu book text from exhausting the first page of image candidates. Undated galleries accept an honest unknown photo date when the subject and picture quality are clear; dated programmes retain their chronology checks.
