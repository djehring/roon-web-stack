import { FastifyInstance } from "fastify";
import { clientManager } from "@service";
import { validateCapsuleOptions } from "../ai-service/capsule-options";
import {
  deletePersonalCinema,
  isPersonalCinema,
  listPersonalCinemas,
  readPersonalCinema,
  savePersonalCinema,
  uploadPersonalImage,
} from "../ai-service/personal-cinema";
import {
  CapsuleConflict,
  capsuleImage,
  capsuleImageContentType,
  capsuleJob,
  deleteCapsule,
  getZoneCapsule,
  listCapsules,
  readCapsule,
  setZoneCapsule,
  startCapsule,
  updateCapsule,
  updateCinemaContent,
  validateCapsuleRequest,
} from "../ai-service/time-capsule";
import { cinemaArtwork } from "../service/cinema-artwork";
import { browseCinemaMusic, captureCinemaQueue, importCinemaMusic } from "../service/cinema-music";
import { cinemaTrackLimit, validateMusicPath } from "../service/cinema-music-model";

export async function registerTimeCapsuleRoutes(server: FastifyInstance) {
  await server.register(
    (routes, _options, done) => {
      routes.addHook("preHandler", (request, reply, done) => {
        const { client_id } = request.params as { client_id: string };
        try {
          clientManager.get(client_id);
          done();
        } catch {
          return reply.status(403).send();
        }
      });
      routes.addContentTypeParser(
        "image/jpeg",
        { parseAs: "buffer", bodyLimit: 12 * 1024 * 1024 },
        (_request, body, done) => {
          done(null, body);
        }
      );
      routes.get("/", async () => {
        const [generated, personal] = await Promise.all([listCapsules(), listPersonalCinemas()]);
        return [...generated, ...personal].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
      routes.put<{ Params: { file: string }; Body: Buffer }>(
        "/personal/images/:file",
        { bodyLimit: 12 * 1024 * 1024 },
        async (request, reply) => {
          try {
            if (!Buffer.isBuffer(request.body)) throw new Error("Upload a Cinema JPEG.");
            await uploadPersonalImage(request.params.file, request.body);
            return await reply.status(204).send();
          } catch (error) {
            return reply.status(400).send({ error: (error as Error).message });
          }
        }
      );
      routes.put<{ Params: { id: string } }>(
        "/personal/:id",
        { bodyLimit: 2 * 1024 * 1024 },
        async (request, reply) => {
          try {
            return await savePersonalCinema(request.params.id, request.body);
          } catch (error) {
            return reply.status(error instanceof CapsuleConflict ? 409 : 400).send({ error: (error as Error).message });
          }
        }
      );
      routes.get("/capabilities", () => ({
        optionsVersion: 2,
        managementVersion: 1,
        syncVersion: 1,
        musicVersion: 1,
        maxTracks: cinemaTrackLimit,
      }));
      for (const action of ["browse", "import"] as const) {
        routes.post<{ Body: { path?: unknown; zoneId?: string } }>(`/music/${action}`, async (request, reply) => {
          try {
            const path = validateMusicPath(request.body.path);
            const zoneId = typeof request.body.zoneId === "string" ? request.body.zoneId : undefined;
            return action === "browse"
              ? await browseCinemaMusic(path, zoneId)
              : { tracks: await importCinemaMusic(path, zoneId) };
          } catch (error) {
            return reply.status(400).send({ error: (error as Error).message });
          }
        });
      }
      routes.post<{ Body: { zoneId?: string } }>("/music/queue", async (request, reply) => {
        try {
          if (typeof request.body.zoneId !== "string" || !request.body.zoneId.trim())
            throw new Error("Choose a Roon room.");
          return await captureCinemaQueue(request.body.zoneId);
        } catch (error) {
          return reply.status(400).send({ error: (error as Error).message });
        }
      });
      routes.put<{
        Params: { id: string };
        Body: { request?: unknown; baseRevision?: unknown; mutationId?: unknown } | null;
      }>("/:id/content", async (request, reply) => {
        try {
          const body = request.body;
          if (
            !body ||
            !Number.isInteger(body.baseRevision) ||
            (body.baseRevision as number) < 0 ||
            typeof body.mutationId !== "string" ||
            !/^[a-zA-Z0-9-]{16,100}$/.test(body.mutationId)
          ) {
            throw new Error("Refresh Cinema before saving this item.");
          }
          const input = validateCapsuleRequest(body.request);
          const job = await updateCinemaContent(request.params.id, input, body.baseRevision as number, body.mutationId);
          return await (job ? reply.status(job.status === "ready" ? 200 : 202).send(job) : reply.status(404).send());
        } catch (error) {
          return reply.status(error instanceof CapsuleConflict ? 409 : 400).send({ error: (error as Error).message });
        }
      });
      routes.post<{ Body: { zoneId?: unknown; tracks?: unknown } | null }>("/artwork", async (request, reply) => {
        const { zoneId, tracks } = request.body ?? {};
        if (typeof zoneId !== "string" || !zoneId.trim() || zoneId.length > 300 || !Array.isArray(tracks)) {
          return reply.status(400).send({ error: "Provide a room and playlist tracks." });
        }
        try {
          const input = validateCapsuleRequest({
            query: "Artwork",
            requestedAt: new Date().toISOString(),
            tracks,
          });
          return { imageKey: await cinemaArtwork(zoneId, input.tracks) };
        } catch (error) {
          return reply.status(400).send({ error: (error as Error).message });
        }
      });
      routes.put<{ Params: { id: string }; Body: { options?: unknown } | null }>("/:id", async (request, reply) => {
        let options;
        try {
          options = validateCapsuleOptions(request.body?.options);
        } catch (error) {
          return reply.status(400).send({ error: (error as Error).message });
        }
        try {
          const job = await updateCapsule(request.params.id, options);
          return job ? await reply.status(202).send(job) : await reply.status(404).send();
        } catch (error) {
          return reply.status(error instanceof CapsuleConflict ? 409 : 503).send({ error: (error as Error).message });
        }
      });
      routes.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
        try {
          if (isPersonalCinema(request.params.id)) await deletePersonalCinema(request.params.id);
          else await deleteCapsule(request.params.id);
          return await reply.status(204).send();
        } catch (error) {
          return reply.status(error instanceof CapsuleConflict ? 409 : 503).send({ error: (error as Error).message });
        }
      });
      routes.post("/", async (request, reply) => {
        let input;
        try {
          input = validateCapsuleRequest(request.body);
        } catch (error) {
          return reply.status(400).send({ error: (error as Error).message });
        }
        try {
          const job = await startCapsule(input);
          return await reply.status(job.status === "ready" ? 200 : 202).send(job);
        } catch (error) {
          return reply.status(503).send({ error: (error as Error).message });
        }
      });
      routes.post<{ Params: { id: string } }>("/:id/rebuild", async (request, reply) => {
        const capsule = await readCapsule(request.params.id);
        if (!capsule) return reply.status(404).send();
        try {
          const job = await startCapsule(capsule.request, capsule.id, {
            periodStart: capsule.periodStart,
            periodEnd: capsule.periodEnd,
          });
          return await reply.status(202).send(job);
        } catch (error) {
          return reply.status(503).send({ error: (error as Error).message });
        }
      });
      routes.get<{ Params: { id: string }; Querystring: { generation?: string } }>(
        "/jobs/:id",
        async (request, reply) => {
          const job = await capsuleJob(request.params.id, request.query.generation);
          return job ? reply.send(job) : reply.status(404).send({ error: "Preparation not found. Please retry." });
        }
      );
      routes.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
        const capsule = isPersonalCinema(request.params.id)
          ? await readPersonalCinema(request.params.id)
          : await readCapsule(request.params.id);
        return capsule ? reply.send(capsule) : reply.status(404).send();
      });
      routes.get<{ Params: { file: string } }>("/images/:file", async (request, reply) => {
        const image = await capsuleImage(request.params.file);
        if (!image) return reply.status(404).send();
        return reply
          .type(capsuleImageContentType(image))
          .header("Cache-Control", "private, max-age=604800, immutable")
          .send(image);
      });
      routes.get<{ Params: { zoneId: string } }>("/zone/:zoneId", async (request, reply) => {
        const capsule = await getZoneCapsule(request.params.zoneId);
        return capsule ? reply.send(capsule) : reply.status(204).send();
      });
      routes.put<{ Params: { zoneId: string }; Body: { capsuleId?: string } | null }>(
        "/zone/:zoneId",
        async (request, reply) => {
          if (!request.params.zoneId || typeof request.body?.capsuleId !== "string") return reply.status(400).send();
          if (!(await readCapsule(request.body.capsuleId))) return reply.status(404).send();
          await setZoneCapsule(request.params.zoneId, request.body.capsuleId);
          return reply.status(204).send();
        }
      );
      done();
    },
    { prefix: "/:client_id/time-capsules" }
  );
}
