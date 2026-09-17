import { FastifyInstance } from "fastify";
import { clientManager } from "@service";
import {
  capsuleImage,
  capsuleJob,
  getZoneCapsule,
  listCapsules,
  readCapsule,
  setZoneCapsule,
  startCapsule,
  validateCapsuleRequest,
} from "../ai-service/time-capsule";

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
      routes.get<{ Params: { id: string } }>("/jobs/:id", async (request, reply) => {
        const job = await capsuleJob(request.params.id);
        return job ? reply.send(job) : reply.status(404).send({ error: "Preparation not found. Please retry." });
      });
      routes.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
        const capsule = await readCapsule(request.params.id);
        return capsule ? reply.send(capsule) : reply.status(404).send();
      });
      routes.get<{ Params: { file: string } }>("/images/:file", async (request, reply) => {
        const image = await capsuleImage(request.params.file);
        if (!image) return reply.status(404).send();
        const mime = image[0] === 0xff ? "image/jpeg" : image[0] === 0x89 ? "image/png" : "image/webp";
        return reply.type(mime).header("Cache-Control", "private, max-age=604800, immutable").send(image);
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
