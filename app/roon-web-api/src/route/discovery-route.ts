import type { FastifyInstance } from "fastify";
import { clientManager } from "@service";
import { isMissingOpenAIKeyError } from "../ai-service/chatgpt";
import type { DiscoveryMode } from "../ai-service/discovery-ai";
import { discoverMusic, playDiscovery, rememberDiscovery } from "../service/music-discovery";

export function registerDiscoveryRoutes(server: FastifyInstance): void {
  server.post<{ Params: { client_id: string }; Body: { query?: unknown; mode?: unknown } | null }>(
    "/:client_id/music-discovery",
    async (request, reply) => {
      try {
        clientManager.get(request.params.client_id);
      } catch {
        return reply.status(403).send({ error: "Reconnect to your Roon bridge." });
      }
      const { query, mode = "auto" } = request.body ?? {};
      if (
        typeof query !== "string" ||
        !query.trim() ||
        query.length > 2000 ||
        !["auto", "tracks", "albums"].includes(String(mode))
      )
        return reply.status(400).send({ error: "Enter a music search and choose Auto, Tracks or Albums." });
      try {
        return rememberDiscovery(request.params.client_id, await discoverMusic(query.trim(), mode as DiscoveryMode));
      } catch (error) {
        return reply
          .status(isMissingOpenAIKeyError(error) ? 503 : 502)
          .send({ error: error instanceof Error ? error.message : "Music search failed." });
      }
    }
  );
  server.post<{ Params: { client_id: string }; Body: { zoneId?: unknown; ids?: unknown; workOnly?: unknown } | null }>(
    "/:client_id/music-discovery/play",
    async (request, reply) => {
      try {
        clientManager.get(request.params.client_id);
      } catch {
        return reply.status(403).send({ error: "Reconnect to your Roon bridge." });
      }
      const { zoneId, ids, workOnly = false } = request.body ?? {};
      if (
        typeof zoneId !== "string" ||
        !zoneId ||
        !Array.isArray(ids) ||
        !ids.length ||
        ids.length > 20 ||
        ids.some((id: unknown) => typeof id !== "string") ||
        typeof workOnly !== "boolean"
      )
        return reply.status(400).send({ error: "Choose a recording and a room." });
      try {
        const tracks = await playDiscovery(request.params.client_id, zoneId, { ids: ids as string[], workOnly });
        return { tracks };
      } catch (error) {
        return reply.status(409).send({ error: error instanceof Error ? error.message : "Playback failed." });
      }
    }
  );
}
