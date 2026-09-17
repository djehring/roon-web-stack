# Time Capsule API

Dynamic Cinema programmes for the native iPhone, iPad and Apple TV clients. The API researches the exact AI Search request and selected tracks; no historical content pack is bundled.

Configuration:

- Paste the OpenAI API key in Settings (stored on the bridge config volume). `OPENAI_API_KEY` remains an operator fallback.
- `TIME_CAPSULE_MODEL`: defaults to `gpt-4.1`; requires Responses web search and JSON output.
- `TIME_CAPSULE_CACHE_DIR`: defaults to `cache/time-capsules` under the API working directory. Mount this directory on persistent storage in Docker; do not rely on the container writable layer.

Every route uses the existing registered-client check. The base path is `/api/:client_id/time-capsules`:

| Route | Purpose |
| --- | --- |
| GET `/` | Saved manifests, newest 50 |
| POST `/` | Start preparation (202), or cached programme (200) |
| GET `/jobs/:id` | Preparation status / completed programme |
| GET `/:id` | Saved programme |
| GET `/images/:hash` | Cached archive image |
| GET `/zone/:zoneId` | Room association, or 204 |
| PUT `/zone/:zoneId` | Set association with `{capsuleId}` |

Create body: `{query, requestedAt, locale, timeZone, tracks:[{artist,track,album}]}`. Freeze `requestedAt` when the music search starts. Hash identity includes the complete request, so replay never reinterprets relative dates. The shared library stores app-owned track snapshots, not Roon playlist IDs.

Preparation performs sourced web research, compiles concise original stories, and searches Wikimedia Commons for reusable images. Returned source URLs must be present in the research results. Extracted date boundaries reject later events and identify earlier context. Metadata restrictions, image size limits and an HTTPS Wikimedia download allowlist constrain assets; image-provider failure leaves a text programme playable. Model output is not independently fact-checked, and archive coverage varies.

Two jobs can run concurrently. Finished manifests and room associations are atomically saved. In-progress status is in memory and will be lost on restart. Each OpenAI call has a 150-second timeout; downloads have 20-second / 8 MB limits. Clients can refresh the library after disconnecting while preparation continues. There is no cancellation, deletion or automatic retention UI yet.

Requires the companion native Cinema app update. Native viewers render against existing Roon track/seek events; music still plays in the Roon room. No AirPlay video export, TV wake/launch or licensed newspaper archive integration is included.

Verification: nine focused Jest tests pass for generation/cache persistence, arbitrary requests, evidence URLs, date boundaries, image metadata and HTTP access/status behaviour. TypeScript and ESLint pass. Live generation was exercised independently of the original historical example. The live bridge has not been deployed by this implementation task.
