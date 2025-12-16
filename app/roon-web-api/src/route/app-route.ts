import { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import { fastifyPlugin } from "fastify-plugin";
import * as fs from "fs/promises";
import * as path from "path";
import { fastifyCompress } from "@fastify/compress";
import { fastifyStatic } from "@fastify/static";

const appRoute: FastifyPluginAsync = async (server: FastifyInstance): Promise<void> => {
  await server.register(fastifyCompress);

  const sendWebAsset = async (assetPath: string, contentType: string, reply: FastifyReply): Promise<unknown> => {
    const fullPath = path.join(__dirname, "web", assetPath);
    const content = await fs.readFile(fullPath);
    return reply.header("cache-control", "no-store").type(contentType).send(content);
  };

  await server.register(fastifyStatic, {
    root: path.join(__dirname, "web"),
    immutable: true,
    maxAge: "1 days",
    wildcard: true,
    setHeaders: (res, requestedPath) => {
      if (requestedPath.endsWith("index.html")) {
        void res.setHeader("cache-control", "public, max-age=0");
      }
    },
  });

  // iOS/Safari expects these well-known paths at the site root.
  server.get("/favicon.ico", async (_req, reply) => {
    return sendWebAsset("assets/favicons/favicon.ico", "image/x-icon", reply);
  });
  server.get("/manifest.webmanifest", async (_req, reply) => {
    return sendWebAsset("assets/favicons/manifest.webmanifest", "application/manifest+json", reply);
  });
  server.get("/apple-touch-icon.png", async (_req, reply) => {
    return sendWebAsset("assets/favicons/favicon-180-precomposed.png", "image/png", reply);
  });
  server.get("/apple-touch-icon-precomposed.png", async (_req, reply) => {
    return sendWebAsset("assets/favicons/favicon-180-precomposed.png", "image/png", reply);
  });

  // Some clients (notably iOS home screen shortcuts) may probe the favicons
  // directory itself. Redirect to a concrete file to avoid 404 noise.
  server.get("/assets/favicons", async (_req, reply) => {
    return reply.redirect("/assets/favicons/favicon.ico");
  });
  server.get("/assets/favicons/", async (_req, reply) => {
    return reply.redirect("/assets/favicons/favicon.ico");
  });
  server.get("/assets/fivicons", async (_req, reply) => {
    return reply.redirect("/assets/favicons/favicon.ico");
  });
  server.get("/assets/fivicons/", async (_req, reply) => {
    return reply.redirect("/assets/favicons/favicon.ico");
  });
};

export default fastifyPlugin(appRoute);
