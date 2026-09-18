import { FastifyInstance } from "fastify";
import { clientManager } from "@service";
import { validateCapsuleOptions } from "../ai-service/capsule-options";
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
  validateCapsuleRequest,
} from "../ai-service/time-capsule";
import { cinemaArtwork } from "../service/cinema-artwork";

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
      routes.get("/", async () => listCapsules());
      routes.get("/capabilities", () => ({ optionsVersion: 2, managementVersion: 1 }));
      routes.post<{ Body: { zoneId?: unknown; tracks?: unknown } | null }>(
        "/artwork",
        async (request, reply) => {
          const { zoneId, tracks } = request.body ?? {};
          if (
            typeof zoneId !== "string" ||
            !zoneId.trim() ||
            zoneId.length > 300 ||
            !Array.isArray(tracks)
          ) {
            return reply
              .status(400)
              .send({ error: "Provide a room and playlist tracks." });
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
        }
      );
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
          await deleteCapsule(request.params.id);
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
      routes.get<{ Params: { id: string }; Querystring: { generation?: string } }>("/jobs/:id", async (request, reply) => {
        const job = await capsuleJob(request.params.id, request.query.generation);
        return job ? reply.send(job) : reply.status(404).send({ error: "Preparation not found. Please retry." });
      });
      routes.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
        const capsule = await readCapsule(request.params.id);
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
