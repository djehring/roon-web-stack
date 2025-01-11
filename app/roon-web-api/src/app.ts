import * as dotenv from "dotenv";
import { fastify, type FastifyPluginCallback } from "fastify";
import * as process from "process";
import { buildLoggerOptions, hostInfo } from "@infrastructure";
import { clientManager, gracefulShutdownHook } from "@service";
import apiRoute from "./route/api-route";
import appRoute from "./route/app-route";

// Load environment variables and handle errors
const result = dotenv.config();
if (result.error) {
  process.exit(1);
}

const init = async (): Promise<void> => {
  const server = fastify({
    logger: buildLoggerOptions("debug"),
  });
  const gracefulShutDown = gracefulShutdownHook(server);
  await server.register(apiRoute as FastifyPluginCallback);
  await server.register(appRoute as FastifyPluginCallback);
  try {
    await server.listen({ host: hostInfo.host, port: hostInfo.port });
    gracefulShutDown.setReady();
    await clientManager.start();
  } catch (err: unknown) {
    server.log.error(err);
    await server.close();
    process.exit(1);
  }
};

void init();
