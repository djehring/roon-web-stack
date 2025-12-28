# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a web-based control interface for the Roon music system. It's a Yarn monorepo containing a Node.js/Fastify backend API, an Angular frontend, and shared TypeScript packages. The backend acts as a CQRS HTTP proxy to the Roon API, serving both the REST API and the Angular SPA from a single Docker container.

## Common Commands

```bash
# Install dependencies
yarn install

# Build all workspaces (in dependency order)
yarn build

# Run linting across all workspaces
yarn lint
yarn lint:fix

# Run tests across all workspaces
yarn test

# Development servers (run in separate terminals)
yarn backend   # API server with watch mode (port 3000/3443)
yarn frontend  # Angular dev server (port 4200)

# Run tests for a specific workspace
yarn workspace @djehring/roon-web-api test
yarn workspace @djehring/roon-web-ng-client test

# Docker build for NAS deployment
yarn build:nas
yarn deploy:nas
```

## Architecture

### Monorepo Structure

```
app/
├── roon-web-api/           # Backend: Fastify HTTP API proxy to Roon
└── roon-web-ng-client/     # Frontend: Angular 19 SPA

packages/
├── roon-web-model/         # Shared TypeScript type definitions
└── roon-web-client/        # TypeScript client library for API consumption
```

### Backend API (`app/roon-web-api`)

- **CQRS architecture**: Separates commands (actions) from queries (data retrieval)
- **Single Roon connection**: One connection point shared by multiple web clients
- **Server-Sent Events (SSE)**: Real-time event broadcasting for zones, outputs, queues
- **Two Fastify servers**: HTTP on port 3000, HTTPS on port 3443

Key service directories:
- `src/service/` - Core services (client-manager, command-dispatcher, ai-service)
- `src/service/command-executor/` - 30+ command executors for Roon operations
- `src/route/` - API routes (api-route.ts for /api/*, app-route.ts for static files)
- `src/roon-kit/` - Inlined sources from Stevenic/roon-kit

Path aliases in tsconfig:
- `@model` → roon-web-model
- `@service` → service/
- `@data` → data/
- `@infrastructure` → infrastructure/

### Frontend (`app/roon-web-ng-client`)

- Angular 19 with Angular Material
- Components organized by feature in `src/app/components/`
- Real-time updates via SSE event subscriptions
- Key features: AI search, zone management, browse/search, voice input

### Docker Deployment

Single container serves both frontend (static files) and backend (API):
- Multi-stage build defined in `app/roon-web-api/Dockerfile`
- Angular dist copied to `/usr/src/app/web` and served by fastify-static
- Environment variables: `ROON_CORE_HOST`, `OPENAI_API_KEY`, `LOG_LEVEL`, `PORT`

## Code Style Requirements

From `.cursorrules`:
- Functions: max 4 parameters, max 50 lines
- Line length: max 80 characters
- Nesting: max 2 levels deep
- Keep JSDoc comments intact when refactoring
- Follow ESLint/Prettier rules defined in each workspace

The project uses:
- ESLint 9.x with flat config format
- Prettier (double quotes, trailing commas, semicolons)
- TypeScript 5.6

## Testing

- Jest 29 for all workspaces
- Test files: `*.test.ts`, mocks: `*.mock.ts`
- Coverage thresholds configured per package

## Contributing

- Conventional commits required (feat:, fix:, docs:, chore:)
- Squash and merge on PRs
- CI must pass before PR review
- Target 100% coverage for client and API packages
