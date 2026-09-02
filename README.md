# roon-web-stack

This is a fork of [@nihilux/roon-web-stack](https://github.com/nihilux-org/roon-web-stack).
Original work by [@nihilux](https://github.com/nihilux-org).

[![CI](https://github.com/djehring/roon-web-stack/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/djehring/roon-web-stack/actions/workflows/ci.yml)
[![CD](https://github.com/djehring/roon-web-stack/actions/workflows/cd.yml/badge.svg)](https://github.com/djehring/roon-web-stack/actions/workflows/cd.yml)

An ensemble of tools to drive `roon`, from a web browser.

<img style="max-width: 800px;" alt="Application first launch, without extension being enabled in roon settings" src="./doc/images/main-screen.png">

The artifact is a [`docker` image](https://hub.docker.com/r/djehring/roon-web-stack) that serves an `Angular` app and a `node` [CQRS](https://martinfowler.com/bliki/CQRS.html) HTTP proxy in front of the [node roon api](https://github.com/RoonLabs/node-roon-api). It is a sidecar next to an existing Roon Core, not a replacement for Nucleus, ROCK, or `ghcr.io/roonlabs/roon`.

## How to use it

How to run the image, pick a topology, and pair phones is in
[doc/deploy.md](./doc/deploy.md):

- **A.** Sibling of Roon Docker on the same NAS or Linux host
- **B.** Sidecar Pi (or any always-on Linux box) next to Nucleus / ROCK
- **C.** Extension Manager for stock upstream nihilux. This fork is the
  Docker image until it is packaged for Extension Manager.

Household installs use [`docker-compose.host.yml`](./docker-compose.host.yml)
(`djehring/roon-web-stack:latest`, host network, HTTP on port `3000`).
Docker Desktop is the exception: see [deploy.md](./doc/deploy.md#docker-desktop-exception-not-household)
and [`docker-compose.yml`](./docker-compose.yml). `ROON_CORE_HOST` is
required there. Host networking and multicast do not work. Try Core ports
`9330-9339` if pairing fails. Phones often need a typed `host:port`.

32-bit ARM is not supported.

### In the browser

Once the container has started, just go to `http://{host}:{port}` with any **modern** browser.  
You should be welcome by the application.  
On first launch, you'll be asked to choose a `zone` to display.  
Choose one, and voilà:

#### HTTPS (required for microphone access)

Browsers only allow microphone access from a **secure context** (HTTPS or
`localhost`). This stack exposes HTTPS on port `3443`.

- **LAN access**: set `CERT_HOSTS` to the IP/host you use to reach the web app
  (for example `192.168.0.13`) so the generated self-signed certificate matches
  the hostname.
- **Open the app**: `https://{host}:3443`
- **Trust the certificate**: because it's self-signed, your browser/OS must
  accept it (once trusted, microphone permissions work normally).

If you want a fully trusted certificate (no warnings), provide your own
certificate/key and set `SSL_CERT` and `SSL_KEY` to their paths inside the
container.

##### Using mkcert (recommended for LAN)

If you access the UI via a LAN DNS name (for example
`roon-web-stack.bartlam.net`), the TLS certificate must include that hostname in
its **SANs**.

- Generate a cert (example):

```bash
mkcert -install
mkcert \
  -cert-file certs/roon-web-stack.pem \
  -key-file certs/roon-web-stack-key.pem \
  roon-web-stack.bartlam.net localhost 127.0.0.1 ::1
```

- Configure compose env (paths are **inside the container**):
  - `SSL_CERT=/usr/src/app/config/certs/roon-web-stack.pem`
  - `SSL_KEY=/usr/src/app/config/certs/roon-web-stack-key.pem`

The `docker-compose.yml` mounts `./certs` into `/usr/src/app/config/certs`.

#### Native iPhone app (HTTP, not HTTPS)

The native Roon Remote app pairs over **HTTP** on the LAN, not HTTPS. Browsers
need HTTPS for the microphone; the iPhone app does not.

- Discover the bridge with Bonjour (`_roon-web-stack._tcp`) on `HTTP_PORT`
  (or `PORT`, default `3000`).
- Enter the 6-digit PIN from **Settings** in the web app.
- `POST /api/pair` with `{ "pin": "123456" }` mints a `client_id`. Wrong PIN
  returns `403`. The existing `POST /api/register` path is unchanged for the
  web client.

#### OpenAI (AI Music Search)

Paste your OpenAI API key once in **Settings**. It is stored on the sidecar
(the same config volume as pairing) and used for Search, Story, voice, and
cover recognition from every web and native client. The published image
does not include a key.

If neither the Settings key nor an optional `OPENAI_API_KEY` env is set,
those routes return `503` and the UI says so.

<img style="max-width: 800px;" alt="Selecting a zone at first app launch" src="./doc/images/selecting-zone-at-first-launch.gif">

After this first boot, the app will display the last displayed `zone`.

You can change the displayed `zone` with the `zone` selector on the app main screen and via the `settings`:

<img style="max-width: 800px;" alt="Selecting a zone at first app launch" src="./doc/images/zone-selection-and-settings.gif">

`Settings` are kind of minimal for now:
- you can choose the theme used
- you can choose between two display modes
- you can select the displayed zone
- you can show and rotate the native pairing PIN
- you can paste an OpenAI API key used by all clients on this stack

As features will be added, settings will be added, if needed, to support them.  
These settings are saved in `localstorage`, so they're both linked to the `host` serving the app and to the browser instance they've been set. Changing one of these parameters will reset all settings to their default value.

Using the app should be pretty straight-forward for anyone using `roon`, still, there's a [user guide (with a FAQ) available](./doc/user-guide.md).

### Enabling the extension in roon settings

Don't forget to enable the extension in `roon` settings (might be needed every time you recreate or restart the container if you don't mount the `config` volume).  
If you don't, you'll see this message in the browser:

<img style="max-width: 800px;" alt="Application first launch, without extension being enabled in roon settings" src="./doc/images/first-launch-without-extension-enabled.png">

As a reminder, this is how to enable an extension in `roon` settings:

<img style="max-width: 800px;" alt="Application first launch, without extension being enabled in roon settings" src="./doc/images/enable-in-roon-extension-settings.png">

## How to build it from source

First, you'll need the last `lts` version of `node` (newer might work, not tested though). Currently, the [CI](./.github/workflows/ci.yml) and the [CD](./.github/workflows/cd.yml) are using what's defined in the main `package.json`: `node >= 22.6.0`. This will follow availability of node `lts` in `github` actions.
How you install `node` is your story, after all you want to build from sources.

Checkout the code and `cd` in the directory.

This `monorepo` uses `yarn 4.4.0` as it's package manager as defined in the root `package.json`.

To enable `corepack` for this project, you'll be good for a pair of:
```bash
corepack install
corepack enable yarn
```

Then install, build (just to check everything works fine), have fun:
```bash
yarn install
yarn build
```
To launch the `backend` in watch mode:
```bash
yarn backend
```
To launch the `frontend` in watch mode:
```bash
yarn frontend
```
Most commands are available at `root` of the `monorepo`:
```bash
yarn lint       #lint every workspace in their dependency order
yarn lint:fix   #lint and auto-fix every workspace in their dependency order
yarn build      #build every workspace in their dependency order, run lint during build process
yarn test       #test every workspace in their dependency order
```

The Angular dev server proxies API calls to the Node default port.

To build the Docker image locally:

```bash
docker build -t djehring/roon-web-stack:latest \
  -f app/roon-web-api/Dockerfile .
```

The image rebuilds the monorepo inside the builder stage. For Docker Desktop
on macOS or Windows, see [deploy.md](./doc/deploy.md#docker-desktop-exception-not-household):
host networking and multicast do not work, so `ROON_CORE_HOST` is required.
Try Core ports `9330-9339` if pairing fails.

## Docker architecture (this repo)

This repository builds **one container** that serves:
- **Frontend**: an Angular SPA (static files)
- **Backend**: a Node/Fastify API that connects to Roon Core via `node-roon-api`

### What runs inside the container

- **Single Node process**: `node app.js`
  - `app.js` is produced by webpack from [`app/roon-web-api/src/app.ts`](./app/roon-web-api/src/app.ts).
  - The Node app starts **two Fastify servers**:
    - **HTTP** on `HTTP_PORT` (default `3000`)
    - **HTTPS** on `HTTPS_PORT` (default `3443`)
  - Both servers register:
    - [`api-route.ts`](./app/roon-web-api/src/route/api-route.ts) at `/api/*`
    - [`app-route.ts`](./app/roon-web-api/src/route/app-route.ts) at `/*` (static SPA)

### How the frontend is served

- The Angular build output is copied into the image at `/usr/src/app/web`.
- `fastify-static` serves that directory from `/` (and any non-`/api` paths).
- The web manifest is under `/assets/favicons/manifest.webmanifest` and is
  configured to launch the app at `/` (`start_url: "/"`, `scope: "/"`).

### How the backend API is served

- The API is served from the **same origin** under `/api`.
  - Example: `GET /api/version` returns `204` and sets
    `x-roon-web-stack-version`.
- The API exposes endpoints for registering a client, SSE events, browsing,
  images, commands, etc. (see [`api-route.ts`](./app/roon-web-api/src/route/api-route.ts)).

### Roon Core discovery vs direct connect

On Linux with host network, UDP discovery typically works. Leave
`ROON_CORE_HOST` unset unless it fails. Details are in
[doc/deploy.md](./doc/deploy.md#networking).

On Docker Desktop, set `ROON_CORE_HOST` and optionally `ROON_CORE_PORT`
(default `9330`, try `9330-9339` if pairing fails).

### Docker image build flow (multi-stage)

The Docker build is defined in [`app/roon-web-api/Dockerfile`](./app/roon-web-api/Dockerfile):

- **Builder stage** (Node image)
  - installs dependencies with Yarn
  - runs `yarn build` for the monorepo
    - builds the backend bundle (`app/roon-web-api/bin/app.js`)
    - builds the Angular dist (`app/roon-web-ng-client/dist/.../browser`)
- **Runtime stage** (Alpine)
  - copies `app.js`, `node_modules`, and the Angular dist into the runtime image
  - generates a local self-signed TLS cert inside the image (dev convenience)

### Docker ports (including iPhone shortcut)

Current compose mappings in [`docker-compose.yml`](./docker-compose.yml):
- **`3000 -> 3000`**: HTTP
- **`3443 -> 3443`**: HTTPS
- **`4200 -> 3000`**: HTTP alias (useful for iPhone shortcut that used to be `:4200`)
- **`4443 -> 3443`**: HTTPS alias

Practical URLs:
- Desktop: `http://localhost:3000/` or `https://localhost:3443/`
- iPhone: `http://<your-mac-lan-ip>:4200/`
  - iOS web clips often fetch icons better over HTTP than HTTPS with a
    self-signed cert.

### Start on boot

Docker Desktop: enable **Start Docker Desktop when you log in**.
[`docker-compose.yml`](./docker-compose.yml) already has
`restart: unless-stopped`.

Linux / NAS / Pi: use [`docker-compose.host.yml`](./docker-compose.host.yml)
(`restart: unless-stopped` is already set). See [doc/deploy.md](./doc/deploy.md).

### Troubleshooting: “frontend loads but backend isn’t running”

Usually the backend *is* running (it’s the same process), but the UI may appear
empty if it can’t pair to Roon Core.

Checks:
- **API reachable**: `GET http://<host>:3000/api/version` should return `204`.
- **Roon pairing**: check container logs for “paired roon server”.
- **Direct connect** (macOS): ensure `ROON_CORE_HOST` is set and `ROON_CORE_PORT`
  matches your Core port range (commonly `9330-9339` on newer builds).

## Some context

This project is young and at its very early stage. It's just enough functionalities to be usable and I value the feedback from the community. The idea is to feed further development by these feedbacks.

Also, despite building software for a living, I'm not a `frontend` developer.
My core experiences and expertises are in designing and building distributed and scalable `apis` (`µ-services`, `cloud stuff`, `k8s`, `dbs` and all the usual suspects).   
Recently I've only used `typescript`, at work, to build `serverless` and `@edge` stuffs.

This project was for me an occasion to go back to `web` development (I'd not done that for at least 7 years), helping to deal with some personal stuff in the process.

So, development will be agile, on my personal time. I'm not planning spending more than 3 to 5 hours a week on this project in the future. Otherwise, it should become my job.  
See [what's coming for this project](./doc/what's-coming.md) to learn how to submit feature request and how to participate in the priorisation process.

Any contribution is welcome, see [CONTRIBUTING](./CONTRIBUTING.md) for info.  

**Constructive** remarks on the [stack choices](./doc/stack-choices.md) or better way to code a modern `Angular` app are also welcome (last project I've worked on as a `fullstack` dev was almost a decade ago, during the early days of `Angular 2`).

## Thanks [Stevenic](https://github.com/Stevenic) for [roon-kit](https://github.com/Stevenic/roon-kit)!

**This `monorepo` includes inlined sources coming from [Stevenic/roon-kit](https://github.com/Stevenic/roon-kit).**

It's stated everywhere it makes sens, and this is one of these places.

See the [README.md](app/roon-web-api/src/roon-kit/README.md) in the corresponding source folder for more details (and here for the [model part](packages/roon-web-model/src/roon-kit/README.md)).

This `monorepo` also includes code copied and adapted from [@bbc/lrud-spatial](https://github.com/bbc/lrud-spatial) in the `lib` `ngx-spatial-navigable`. More precisely, the code in [ngx-spatial-navigable.utils.ts](./app/roon-web-ng-client/projects/nihilux/ngx-spatial-navigable/src/lib/services/ngx-spatial-navigable.utils.ts) is mostly a copy and a `Typescript` conversion of the code in [lrud.js](https://github.com/bbc/lrud-spatial/blob/master/lib/lrud.js) in the [@bbc/lrud-spatial](https://github.com/bbc/lrud-spatial) project. Therefore, the file  [ngx-spatial-navigable.utils.ts](./app/roon-web-ng-client/projects/nihilux/ngx-spatial-navigable/src/lib/services/ngx-spatial-navigable.utils.ts) is published under the original license of the file [lrud.js](https://github.com/bbc/lrud-spatial/blob/master/lib/lrud.js) and should be considered as copyrighted by its original author.
See the header and the `disclaimer` in the header of this file for more details.

## Credits

This app would not have been possible without the vitality of open source projects, so thanks to all of them.

Sorry if I forgot anyone, please don't argue on the order.

- [Stevenic](https://github.com/Stevenic) for [roon-kit](https://github.com/Stevenic/roon-kit)
- [roon](https://roon.app) for [node roon api](https://github.com/RoonLabs/node-roon-api)
- [Angular](https://github.com/angular)
- [Angular Material](https://github.com/angular/components)
- [@bbc/lrud-spatial](https://github.com/bbc/lrud-spatial)
- [Fastify](https://github.com/fastify/fastify)
- [Fastify SSE v2](https://github.com/mpetrunic/fastify-sse-v2)
- [Fastify static](https://github.com/fastify/fastify-static)
- [graceful server](https://github.com/gquittet/graceful-server)
- [nanoid](https://github.com/ai/nanoid)
- [ts-retry-promise](https://github.com/normartin/ts-retry-promise)
- [fast-equals](https://github.com/planttheidea/fast-equals)
- [rxjs](https://github.com/ReactiveX/rxjs)
- [jest](https://github.com/jestjs/jest)
- [node](https://github.com/nodejs/node)
- [typescript](https://github.com/microsoft/TypeScript)
- [yarn](https://github.com/yarnpkg/berry)
- [Sass](https://github.com/sass/sass)
- [webpack](https://github.com/webpack/webpack) (can't list every plugin used, but thanks to everyone!)
- [eslint](https://github.com/eslint/eslint) (can't list everything's used, but thanks to everyone!)
- [prettier](https://github.com/prettier/prettier)
- [editorconfig](https://github.com/editorconfig/editorconfig)
- [docker](https://github.com/docker)
- [GitHub](https://github.com), with a special thanks to everyone involved in the `actions` in used in this repo
- [alpine](https://gitlab.alpinelinux.org/alpine/aports)
- [linux and git](https://git.kernel.org)
