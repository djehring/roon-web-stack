# Deploy roon-web-stack

This stack is a sidecar. It talks to an existing Roon Core over the LAN,
serves the web UI, and advertises `_roon-web-stack._tcp` so native apps
can pair. It does not hold the library. It does not replace Nucleus, ROCK,
or `ghcr.io/roonlabs/roon`.

Pull one image: [`djehring/roon-web-stack`](https://hub.docker.com/r/djehring/roon-web-stack).
Tags are `latest` and the git version (`v1.2.3`). Platforms are `linux/amd64`
and `linux/arm64`. 32-bit ARM is not supported.

CD publishes those tags from a GitHub Release. Before the first release,
create the Docker Hub repository if Hub does not already have it, and set
Actions secrets `DOCKERHUB_USER` and `DOCKERHUB_PAT` on
`djehring/roon-web-stack`.

HTTP on port `3000` is what phones and the web UI use. HTTPS on `3443` is
only for browser microphone access. Do not point native apps at 3443.

Copy [`.env.example`](../.env.example) to `.env` and uncomment only the
keys you need.

## Where not to put it

- Inside the official Roon Server image
- On Nucleus or ROCK (those boxes do not host extra containers)
- On a Mac that sleeps
- On a Pi that is a dedicated USB DAC if you care about isolating the
  audio clock. A Bridge or RoPieee Pi can host the container if it has
  spare CPU. Prefer a separate always-on box when that Pi is the
  living-room endpoint.

Do not run Core on a Pi. Roon Server is still x86_64 only.

## Pairing

Same steps on every topology.

1. Open `http://<host>:3000` in a browser.
2. Enable the extension in Roon Settings (Settings, Extensions). Needed
   once per config volume. Logs then show `paired roon server`.
3. In the web app Settings, read the six-digit PIN.
4. On the phone or Apple TV, allow Local Network, pick
   `_roon-web-stack._tcp`, and type that PIN.

Wiping the config volume (`docker compose down -v`, or deleting the
named volume) forgets the Roon extension enable **and** the native PIN.
Roon will ask you to enable the extension again.

## Networking

Production uses host network so multicast works both ways: the stack
finds Core, and it publishes `_roon-web-stack._tcp` on the HTTP port.

- Leave `ROON_CORE_HOST` unset on Linux unless discovery fails. Then set
  it to the Core IP. Port defaults to `9330`; try `9330-9339` if pairing
  fails.
- If the host firewall or a VLAN blocks `5353/UDP`, phones will not see
  the Bonjour service. Fix that, or type `host:3000` on the phone.
- Bridge mode (rare NAS UI constraint): set `ROON_CORE_HOST` and type
  `host:port` on the phone. Bonjour is not promised in that mode.

Logs should include `advertising _roon-web-stack._tcp on HTTP port 3000`.

## A. Sibling of Roon Docker

Core is already `ghcr.io/roonlabs/roon` on Unraid, TrueNAS, Synology,
QNAP, or a Linux NUC. Run this image as a second container on the same
host, both with host networking. Persist config. This is the default
when you already run Core in Docker.

```bash
docker compose -f docker-compose.host.yml up -d
```

[`docker-compose.host.yml`](../docker-compose.host.yml) pulls
`djehring/roon-web-stack:latest`, uses `network_mode: host`,
`restart: unless-stopped`, and a named volume on `/usr/src/app/config`.
It does not publish `3000:3000`. Host network owns the ports.

Optional: `CERT_HOSTS`, `SSL_CERT`, `SSL_KEY`. Leave `OPENAI_API_KEY`
unset. Each user pastes their key in web or native Settings.

Then:

- Browser: `http://<host>:3000`
- Browser mic: `https://<host>:3443` (trust the self-signed cert, or set
  `CERT_HOSTS` / provide your own cert)
- Native apps: Bonjour on HTTP 3000, PIN from web Settings
- Enable the extension in Roon once

## B. Sidecar Pi (or any always-on Linux box)

Pi 4 or 5, 2 GB is enough. Raspberry Pi OS or DietPi plus Docker. Same
compose file as topology A. Same LAN as Core (Nucleus, ROCK, NAS, or a
sleeping Mac). Do not run Core on the Pi.

```bash
docker compose -f docker-compose.host.yml up -d
```

Pairing is the same as topology A. The Pi must stay awake and on the
same Wi-Fi or Ethernet as the phones.

## C. Extension Manager

Stock [upstream nihilux](https://github.com/nihilux-org/roon-web-stack)
is listed in [Roon Extension Manager](https://github.com/TheAppgineer/roon-extension-manager/wiki)
from repository version `1.0.16`. Use that for the upstream app.

This fork (PIN pairing, iOS Bonjour, OpenAI search) is the Docker image
until someone packages it for Extension Manager. Do not wait on that
listing. Use topology A or B.

## Docker Desktop (exception, not household)

macOS and Windows Docker Desktop do not do host networking or multicast
reliably. Use [`docker-compose.yml`](../docker-compose.yml): published
ports, a local `build:`, and `ROON_CORE_HOST` required.

```bash
export ROON_CORE_HOST=192.168.0.14
docker compose up -d
```

- Browser: `http://localhost:3000` or `https://localhost:3443`
- `ROON_CORE_PORT` defaults to `9330`. Try `9330-9339` if pairing fails.
- Phones on that LAN will often need a typed `host:port`
  (the Mac LAN IP and `3000`, or `4200` which maps to the same HTTP
  server). Bonjour from a Desktop container is unreliable.
- Enable **Start Docker Desktop when you log in**. The compose file
  already has `restart: unless-stopped`.

This is a development topology.

### mkcert for browser mic on Desktop

```bash
mkcert -install
mkcert \
  -cert-file certs/roon-web-stack.pem \
  -key-file certs/roon-web-stack-key.pem \
  roon-web-stack.local localhost 127.0.0.1 ::1
```

Compose already mounts `./certs` and sets `SSL_CERT` / `SSL_KEY` to
those paths inside the container.

## Build from this checkout

The host compose file comments a `build:` block. Uncomment it, or:

```bash
docker build -t djehring/roon-web-stack:latest \
  -f app/roon-web-api/Dockerfile .
```

The image is Alpine plus `node` and `dumb-init`, runs as `USER node`,
and generates a self-signed cert on first boot when `SSL_CERT` /
`SSL_KEY` are absent. `GET /api/version` returns 204 and
`x-roon-web-stack-version`.

## Hardware checklist

Do this once per architecture before telling anyone to pull `latest`.

1. **amd64 sibling.** Start Core Docker and this image on the same
   Linux host, host network, empty config volume. Enable the extension.
   Open `http://<host>:3000`. Pair iPhone via Bonjour. Pair Apple TV
   the same way.
   Expect: `GET /api/version` is 204. Logs show `paired roon server`
   and `advertising _roon-web-stack._tcp` on port 3000. Phone does not
   need a typed address.
2. **arm64 sidecar.** Same compose on a Pi 4 or 5, Core on Nucleus /
   ROCK / NAS elsewhere on the LAN. Repeat the pairing.
   Expect: `docker pull djehring/roon-web-stack:latest` succeeds.
   Same pairing result as step 1.
3. **Desktop exception.** `ROON_CORE_HOST` compose on a Mac. Browser
   works. Phone may need typed `host:port`. That is acceptable.
4. **Volume wipe.** `docker compose down -v`, start again. Roon asks
   to enable the extension again.
5. **AI optional.** With no key in Settings and no `OPENAI_API_KEY` on
   the container, Search/Story return 503 and the UI says so. After
   pasting a key in Settings, one search works.
