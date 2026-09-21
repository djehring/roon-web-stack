# Deploy outline

Ship one multi-arch Docker image and document three ways to run it next to a normal Roon Server. Do not build a custom Raspberry Pi OS.

The stack is a sidecar. It talks to an existing Core over the LAN, serves the web UI, and advertises `_roon-web-stack._tcp` so the native apps can pair. It does not hold the library and it does not replace Nucleus, ROCK, or `ghcr.io/roonlabs/roon`.

## Current state

Already in the repo:

- Multi-stage Dockerfile (`app/roon-web-api/Dockerfile`) that produces one Node process serving HTTP, HTTPS, and the Angular SPA.
- CD builds `linux/amd64` and `linux/arm64` (32-bit ARM is disabled on purpose).
- `docker-compose.yml` for Docker Desktop: published ports, `ROON_CORE_HOST`, optional mkcert, OpenAI key.
- NAS helper scripts that load a local `djehring/roon-web-stack` tarball with `--network host`.
- Bonjour advertiser on the HTTP port, pairing PIN, and iOS clients that expect HTTP not 3443.
- Persistent config volume at `/usr/src/app/config`. Losing it forces a new extension enable in Roon.

Gaps:

- CD still pushes `nihiluxorg/roon-web-stack`. Local scripts already tag `djehring/roon-web-stack`.
- Compose is Desktop-shaped. No production file with host networking and `restart: unless-stopped`.
- README still tells people to pull the upstream image and mixes Desktop, DietPi, and NAS notes in one page.
- Extension Manager docs point at the nihilux listing, not this fork.
- No written check that phones can see `_roon-web-stack._tcp` after a Linux or Pi deploy.

## Non-goals

- A flashed Pi appliance image (RoPieee-style). That is kernel, ALSA, and SD-card maintenance for an HTTP process.
- Running inside the official Roon Server container.
- Running on Nucleus or ROCK. Those boxes do not host extra containers.
- 32-bit ARM.
- Putting Core on a Pi. Roon Server is still x86_64 only.

## 1. Decide the public image

Pick one name and make every path use it.

- Registry: Docker Hub `djehring/roon-web-stack`, or GHCR `ghcr.io/djehring/roon-web-stack` if Hub credentials are a hassle. One registry is enough.
- Tags: `latest` on main releases, plus the git version (`v1.2.3`). Optional `edge` from main if you want nightlies later. Do not add that in the first pass.
- Point CD `REGISTRY_IMAGE` at that name. Stop publishing to `nihiluxorg/...` from this fork.
- Confirm Hub/GHCR secrets exist for this repo before the first release.
- Drop or rewrite `scripts/build-nas-image.sh` and `scripts/deploy-nas.sh`. Those are a personal amd64 tarball pipeline. After a public multi-arch image they become "pull and run."

Done when `docker pull <image>:latest` on both an amd64 NAS and a Pi 5 yields a working container.

## 2. Production compose

Keep the existing `docker-compose.yml` for Docker Desktop. Add a Linux file next to it, for example `docker-compose.host.yml`.

That file should set:

- `image: djehring/roon-web-stack` (or GHCR), not a local `build:` as the default. Keep `build:` commented or in an override for people hacking on the box.
- `network_mode: host`
- `restart: unless-stopped`
- A named volume on `/usr/src/app/config`
- `PORT` / `HTTP_PORT` default `3000` (or `8282` if you want to stay off common Node defaults). Native apps pair on this port.
- `HTTPS_PORT` default `3443` for browser microphone use only
- Optional `OPENAI_API_KEY`, `CERT_HOSTS`, `SSL_CERT`, `SSL_KEY`
- No `ROON_CORE_HOST` unless discovery fails. Host network should find Core on the LAN.

Do not publish `3000:3000` in this file. Host network owns the ports.

Add a short `.env.example` with the optional keys only.

## 3. Desktop compose stay as the exception

Leave the current file for macOS/Windows Docker Desktop.

- Document that host networking and multicast do not work there.
- `ROON_CORE_HOST` (and `ROON_CORE_PORT`, default `9330`, try `9330-9339` if pairing fails) stays required.
- Phones on that LAN will often need a typed `host:port`. Bonjour from a Desktop container is unreliable.
- Add `restart: unless-stopped` so a reboot comes back if Docker Desktop is set to start at login.

This is a development topology, not the household one.

## 4. Docs: three topologies

Replace the README "How to use it" Docker section with a short pointer, then add `doc/deploy.md` (or split under `doc/deploy/`) covering only these cases.

**A. Sibling of Roon Docker.** Core is already `ghcr.io/roonlabs/roon` on Unraid, TrueNAS, Synology, QNAP, or a Linux NUC. Second container, same host, both `--network host`. Persist config. One power cable. This is the default recommendation when the user already runs Core in Docker.

**B. Sidecar Pi (or any always-on Linux box) next to Nucleus, ROCK, or a sleeping Mac.** Pi 4/5, 2 GB is enough. Raspberry Pi OS or DietPi plus Docker. Same host-network compose. Same LAN as Core. Do not tell people to run Core on the Pi.

**C. Extension Manager.** Keep the nihilux-in-Appgineer path as the easy option for stock upstream. Say clearly that this fork (PIN pairing, iOS Bonjour, OpenAI search) is the Docker image until someone packages it for Extension Manager. Do not block the image work on that listing.

Each topology needs:

- `docker compose` snippet
- Ports: HTTP for apps, HTTPS only if they use the browser mic
- Enable the extension in Roon Settings once
- Pairing steps that match the iOS README (PIN from web Settings, `_roon-web-stack._tcp`)
- What happens if the config volume is wiped

Also say where not to put it: inside the Roon Server image, on Nucleus/ROCK, on a Mac that sleeps, on a Pi that is a dedicated USB DAC if you care about isolating the audio clock. A Bridge/RoPieee Pi can host the container if it has spare CPU. Prefer a separate always-on box when that Pi is the living-room endpoint.

## 5. Networking and discovery

Host network is the production default because multicast has to work both ways: the stack finds Core, and it publishes `_roon-web-stack._tcp` on the HTTP port.

Work items:

- Confirm the advertiser publishes the HTTP port, not 3443. It already does. Docs must not tell people to point phones at HTTPS.
- On host-network Linux, check that Avahi/mDNS from the container is visible to an iPhone on Wi-Fi. If the host firewall or a VLAN blocks 5353/UDP, document that.
- Keep `ROON_CORE_HOST` as the escape hatch. Do not make people set it on Linux unless discovery fails.
- If someone must use bridge mode (rare NAS UI constraint), document `ROON_CORE_HOST` plus typed `host:port` on the phone. Do not promise Bonjour in that mode.

## 6. Image contents, not a second image

One image for every topology. No slim "Pi edition."

Check before calling the image done:

- Runtime stays Alpine plus `node` and `dumb-init`. Keep it small enough for a Pi 4.
- `USER node` and a writable config dir still work when the volume is empty on first boot.
- Entrypoint still generates a self-signed cert when `SSL_CERT`/`SSL_KEY` are absent.
- `GET /api/version` returns 204 and `x-roon-web-stack-version` on HTTP.
- Logs show "paired roon server" after the extension is enabled, and "advertising `_roon-web-stack._tcp`" on the HTTP port.

Optional later, not in the first cut: HEALTHCHECK on `/api/version`.

## 7. Verify on real hardware

Do this once per architecture before telling anyone to pull `latest`.

1. **amd64 sibling.** Start Core Docker and this image on the same Linux host, host network, empty config volume. Enable extension. Open `http://<host>:3000`. Pair iPhone via Bonjour. Pair Apple TV the same way.
2. **arm64 sidecar.** Same compose on a Pi 4 or 5, Core on Nucleus/ROCK/NAS elsewhere on the LAN. Repeat the pairing.
3. **Desktop exception.** `ROON_CORE_HOST` compose on a Mac. Browser works. Phone may need typed address. That is acceptable.
4. **Volume wipe.** `docker compose down -v`, start again, confirm Roon asks to enable the extension again.
5. **AI optional.** With `OPENAI_API_KEY` unset, Search/Story return 503 and the UI says so. With the key set, one search works.

Write the commands and expected results into `doc/deploy.md` as a checklist, not a separate test suite.

## 8. iOS and README cross-links

`roon-ios/README.md` already assumes HTTP and Bonjour. After the image name and default port are fixed, update that pairing section so the host:port example matches the published compose.

No iOS code change is required for this deploy work unless Bonjour TXT (`ver`, `httpsPort`) needs a new field. It does not today.

## 9. Extension Manager, later

Only after the image is the supported install:

- Decide whether this fork should appear as its own Extension Manager entry.
- That is a packaging conversation with Appgineer's repo, not a Dockerfile change.
- Until then, README: use Docker for this fork, Extension Manager for upstream nihilux.

## Suggested order

1. Registry name, CD secrets, first multi-arch push of `djehring/roon-web-stack` (or GHCR).
2. `docker-compose.host.yml` + `.env.example`.
3. `doc/deploy.md` with topologies A/B/C and the hardware checklist.
4. Trim README Docker/Extension Manager sections to pointers.
5. Run the amd64 and Pi pairing checks. Fix whatever Bonjour or port docs got wrong.
6. Retire or shrink the NAS tarball scripts.
7. Point `roon-ios` pairing docs at the published image.
8. Extension Manager listing, if you still want it.

## Done when

Someone with a Nucleus and a Pi, or someone with Roon Docker on a NAS, can follow one page, pull one image, enable the extension, and pair the iPhone without typing `host:port`.
