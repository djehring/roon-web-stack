import { FastifyInstance } from "fastify";
import { clientManager } from "@service";
import { performMusicAction } from "../service/cinema-music";
import { validateMusicPath } from "../service/cinema-music-model";
import { historyLimits } from "../service/history/model";
import { browseHistoryMusic, resolveHistory } from "../service/history/resolve";
import { HistoryService, historyService } from "../service/history/service";

export async function registerHistoryRoutes(server: FastifyInstance, service: HistoryService = historyService()) {
  await server.register(
    (routes, _options, done) => {
      routes.addHook("preHandler", (request, reply, next) => {
        try {
          clientManager.get((request.params as { client_id: string }).client_id);
          next();
        } catch {
          return reply.status(403).send();
        }
      });
      routes.setErrorHandler((error, _request, reply) => reply.status(400).send({ error: error.message }));
      routes.get("/capabilities", () => ({
        version: 1,
        retentionDays: historyLimits.days,
        maxEvents: historyLimits.events,
        maxBytes: historyLimits.bytes,
        views: ["albums", "tracks"],
        qualification: "30 seconds or half the track, whichever is shorter",
      }));
      for (const kind of ["tracks", "albums"] as const) {
        routes.get<{ Querystring: { roomId?: string; cursor?: string; limit?: string } }>(`/${kind}`, (request) =>
          service.page(kind, request.query)
        );
      }
      routes.post<{ Body: { eventId?: unknown; kind?: unknown; zoneId?: unknown } | null }>(
        "/resolve",
        async (request) => {
          const body = request.body;
          if (!body || typeof body.eventId !== "string" || !["tracks", "albums"].includes(String(body.kind)))
            throw new Error("Choose a history entry.");
          return await resolveHistory(
            service.event(body.eventId),
            body.kind as "tracks" | "albums",
            typeof body.zoneId === "string" ? body.zoneId : undefined
          );
        }
      );
      routes.post<{ Body: { path?: unknown; zoneId?: unknown } | null }>("/browse", async (request) => {
        return await browseHistoryMusic(
          validateMusicPath(request.body?.path),
          typeof request.body?.zoneId === "string" ? request.body.zoneId : undefined
        );
      });
      routes.post<{ Body: { path?: unknown; zoneId?: unknown; action?: unknown } | null }>("/play", async (request) => {
        const body = request.body;
        if (
          !body ||
          typeof body.zoneId !== "string" ||
          !body.zoneId ||
          body.zoneId.length > 300 ||
          typeof body.action !== "string" ||
          !["Play Now", "Play Next", "Queue"].includes(body.action)
        )
          throw new Error("Choose a playback action and room.");
        // Older installed clients may send the original wrapper path rather than
        // the playable path returned by /browse. Resolve it afresh for both.
        const page = await browseHistoryMusic(validateMusicPath(body.path), body.zoneId);
        if (page.kind === "list") throw new Error("Choose a recording or album to play.");
        await performMusicAction(page.path, body.zoneId, body.action);
        return { ok: true };
      });
      done();
    },
    { prefix: "/:client_id/history" }
  );
}
