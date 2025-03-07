import { FastifyInstance, FastifyPluginAsync, FastifyPluginCallback, FastifyReply, FastifyRequest } from "fastify";
import { fastifyPlugin } from "fastify-plugin";
import { FastifySSEPlugin } from "fastify-sse-v2";
import { fastifyMultipart } from "@fastify/multipart";
import { extension_version, logger, roon } from "@infrastructure";
import {
  Client,
  ClientRoonApiBrowseLoadOptions,
  ClientRoonApiBrowseOptions,
  Command,
  RoonImageFormat,
  RoonImageScale,
} from "@model";
import { clientManager } from "@service";
import { fetchTrackStory, fetchTrackSuggestions, transcribeAudio } from "../ai-service/chatgpt";
import { Track, TrackStory } from "../ai-service/types/track";
import {
  analyzeUnmatchedTracks,
  cleanupOldUnmatchedTracksData,
  getLatestUnmatchedTracks,
} from "../service/unmatched-tracks-analyzer";

interface ClientIdParam {
  client_id: string;
}

interface AISearchParam {
  client_id: string;
  query: string;
}

interface PlayTracksParam {
  zoneId: string;
  tracks: Track[];
}

interface ImageQuery {
  height: string;
  width: string;
  scale: string;
  format: string;
  image_key: string;
}

interface TranscriptionRequest {
  audio: Buffer;
}

const apiRoute: FastifyPluginAsync = async (server: FastifyInstance): Promise<void> => {
  await server.register(FastifySSEPlugin);
  await server.register(fastifyMultipart as FastifyPluginCallback);
  server.get("/version", (_: FastifyRequest, reply: FastifyReply) => {
    return reply.status(204).header("x-roon-web-stack-version", extension_version).send();
  });
  server.post<{ Params: { previous_client_id?: string } }>("/register/:previous_client_id?", (req, reply) => {
    const previous_client_id = req.params.previous_client_id;
    const client_id = clientManager.register(previous_client_id);
    const location = `/api/${client_id}`;
    return reply.status(201).header("location", location).send();
  });
  server.post<{ Params: ClientIdParam }>("/:client_id/unregister", (req, reply) => {
    const client_id = req.params.client_id;
    clientManager.unregister(client_id);
    return reply.status(204).send();
  });
  server.post<{ Params: AISearchParam; Body: string }>("/:client_id/aisearch", async (req, reply) => {
    const { client, badRequestReply } = getClient(req, reply);
    if (client) {
      logger.debug({ client }, "Received AI search request");
      const query = req.body;
      const tracks = await fetchTrackSuggestions(query);
      return reply.status(200).send(tracks);
    } else {
      return badRequestReply;
    }
  });
  server.post<{ Params: { client_id: string }; Body: Track }>("/:client_id/trackstory", async (req, reply) => {
    const { client, badRequestReply } = getClient(req, reply);
    if (client) {
      const track = req.body;

      if (!track.artist || !track.track) {
        return reply.status(400).send({ error: "Both artist and track must be provided." });
      }

      try {
        const story: TrackStory = await fetchTrackStory(track);
        return await reply.status(200).send(story);
      } catch (error) {
        logger.error(error, "Error fetching track story.");
        return reply.status(500).send({ error: "Error fetching track story." });
      }
    } else {
      return badRequestReply;
    }
  });
  server.post<{ Params: ClientIdParam; Body: PlayTracksParam }>("/:client_id/play-tracks", async (req, reply) => {
    const { client, badRequestReply } = getClient(req, reply);
    if (client) {
      const { zoneId, tracks } = req.body;
      const unfoundTracks = (await client.playTracks(zoneId, tracks)) as Track[];
      return reply.status(200).send(unfoundTracks);
    } else {
      return badRequestReply;
    }
  });
  server.post<{ Params: ClientIdParam; Body: Command }>("/:client_id/command", async (req, reply) => {
    const { client, badRequestReply } = getClient(req, reply);
    if (client) {
      const command_id = client.command(req.body);
      return reply.status(202).send({
        command_id,
      });
    } else {
      return badRequestReply;
    }
  });
  server.post<{ Params: ClientIdParam; Body: ClientRoonApiBrowseOptions }>("/:client_id/browse", async (req, reply) => {
    const { client, badRequestReply } = getClient(req, reply);
    if (client) {
      logger.debug("Client id: ", req.params.client_id);
      const browseResponse = await client.browse(req.body);
      return reply.status(200).send(browseResponse);
    } else {
      return badRequestReply;
    }
  });
  server.post<{ Params: ClientIdParam; Body: ClientRoonApiBrowseLoadOptions }>(
    "/:client_id/load",
    async (req, reply) => {
      const { client, badRequestReply } = getClient(req, reply);
      if (client) {
        const loadResponse = await client.load(req.body);
        return reply.status(200).send(loadResponse);
      } else {
        return badRequestReply;
      }
    }
  );
  server.get<{ Params: ClientIdParam }>("/:client_id/events", (req, reply) => {
    const { client, badRequestReply } = getClient(req, reply);
    if (client) {
      reply = reply.header("x-accel-buffering", "no");
      const events = client.events();
      const sub = events.subscribe({
        next: (message) => {
          reply.sse({
            event: message.event,
            data: JSON.stringify(message.data),
          });
        },
        complete: () => {
          reply.sseContext.source.end();
          sub.unsubscribe();
        },
      });
      req.socket.on("close", () => {
        sub.unsubscribe();
        client.close();
      });
    } else {
      return badRequestReply;
    }
  });
  server.get<{ Querystring: ImageQuery }>("/image", async (req, reply) => {
    const { image_key, width, height, scale, format } = req.query;
    if (!image_key) {
      return reply.status(400).send();
    }
    let widthOption: number | undefined = undefined;
    let heightOption: number | undefined = undefined;
    let scaleOption: RoonImageScale | undefined = undefined;
    let formatOption: RoonImageFormat | undefined = undefined;
    if (width) {
      const parsedWidth = parseInt(width, 10);
      if (isNaN(parsedWidth)) {
        return reply.status(400).send();
      } else {
        widthOption = parsedWidth;
      }
    }
    if (height) {
      const parsedHeight = parseInt(height, 10);
      if (isNaN(parsedHeight)) {
        return reply.status(400).send();
      } else {
        heightOption = parsedHeight;
      }
    }
    if (scale === "fit" || scale === "fill" || scale === "stretch") {
      scaleOption = scale;
    }
    if (scaleOption && !(heightOption && widthOption)) {
      return reply.status(400).send();
    }
    if (format === "jpeg") {
      formatOption = "image/jpeg";
    } else if (format === "png") {
      formatOption = "image/png";
    }
    try {
      const { content_type, image } = await roon.getImage(image_key, {
        format: formatOption,
        height: heightOption,
        scale: scaleOption,
        width: widthOption,
      });
      return await reply
        .status(200)
        .header("cache-control", "public, max-age=86400, immutable")
        .header("age", "0")
        .header("content-type", content_type)
        .send(image);
    } catch (err) {
      if (err === "NotFound") {
        return reply.status(404).header("cache-control", "public, max-age=86400, immutable").header("age", "0").send();
      } else {
        logger.error(err, "image can't be fetched from roon");
        return reply.status(500).send();
      }
    }
  });

  server.post<{ Params: { client_id: string }; Body: TranscriptionRequest }>(
    "/:client_id/transcribe",
    async (req, reply) => {
      const { client, badRequestReply } = getClient(req, reply);
      if (!client) {
        return badRequestReply;
      }
      try {
        // Multipart parsing
        const parts = await req.file();
        if (!parts || parts.fieldname !== "audio") {
          // eslint-disable-next-line @typescript-eslint/return-await
          return reply.status(400).send({ error: "Expected 'audio' field" });
        }
        const buffer = await parts.toBuffer();
        const text = await transcribeAudio(buffer);
        // eslint-disable-next-line @typescript-eslint/return-await
        return reply.status(200).send({ text });
      } catch (error) {
        logger.error(error, "Error processing audio file");
        return reply.status(500).send({ error: "Error processing audio file" });
      }
    }
  );

  // Endpoint to get unmatched tracks analysis
  server.get<{ Params: { client_id: string } }>("/:client_id/unmatched-tracks/analysis", async (req, reply) => {
    const { client, badRequestReply } = getClient(req, reply);
    if (!client) {
      return badRequestReply;
    }

    try {
      const analysis = await analyzeUnmatchedTracks();
      return await reply.status(200).send(analysis);
    } catch (error) {
      logger.error(`Error getting unmatched tracks analysis: ${JSON.stringify(error)}`);
      return await reply.status(500).send({ error: "Failed to analyze unmatched tracks" });
    }
  });

  // Endpoint to get the latest unmatched tracks data
  server.get<{ Params: { client_id: string } }>("/:client_id/unmatched-tracks/latest", async (req, reply) => {
    const { client, badRequestReply } = getClient(req, reply);
    if (!client) {
      return badRequestReply;
    }

    try {
      const latestData = await getLatestUnmatchedTracks();
      if (!latestData) {
        return await reply.status(404).send({ error: "No unmatched tracks data found" });
      }
      return await reply.status(200).send(latestData);
    } catch (error) {
      logger.error(`Error getting latest unmatched tracks: ${JSON.stringify(error)}`);
      return await reply.status(500).send({ error: "Failed to get latest unmatched tracks" });
    }
  });

  // Endpoint to clean up old unmatched tracks data
  server.post<{ Params: { client_id: string }; Body: { keepCount?: number } }>(
    "/:client_id/unmatched-tracks/cleanup",
    async (req, reply) => {
      const { client, badRequestReply } = getClient(req, reply);
      if (!client) {
        return badRequestReply;
      }

      try {
        const keepCount = req.body.keepCount ?? 10;
        await cleanupOldUnmatchedTracksData(keepCount);
        return await reply.status(200).send({
          success: true,
          message: `Cleaned up old unmatched tracks data, keeping ${keepCount} most recent files`,
        });
      } catch (error) {
        logger.error(`Error cleaning up unmatched tracks data: ${JSON.stringify(error)}`);
        return await reply.status(500).send({ error: "Failed to clean up unmatched tracks data" });
      }
    }
  );
};

const getClient = (
  req: FastifyRequest<{ Params: ClientIdParam }>,
  res: FastifyReply
): {
  client?: Client;
  badRequestReply?: FastifyReply;
} => {
  try {
    const client_id = req.params.client_id;
    logger.debug({ client_id }, "Received request");
    return {
      client: clientManager.get(client_id),
    };
  } catch (err) {
    if (err instanceof Error) {
      logger.warn(err.message);
    }
    return {
      badRequestReply: res.status(403).send(),
    };
  }
};

export default fastifyPlugin<{ prefix: string }>(
  async (app) => {
    return app.register(apiRoute, {
      prefix: "/api",
    });
  },
  { name: "api-route" }
);
