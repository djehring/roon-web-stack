import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { fastifyPlugin } from "fastify-plugin";
import * as path from "path";
import { fastifyCompress } from "@fastify/compress";
import { fastifyStatic } from "@fastify/static";

const appRoute: FastifyPluginAsync = async (server: FastifyInstance): Promise<void> => {
  await server.register(fastifyCompress);

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

  return server.register(fastifyStatic, {
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
};

export default fastifyPlugin(appRoute);
