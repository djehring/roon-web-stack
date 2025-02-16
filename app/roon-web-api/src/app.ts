import * as dotenv from "dotenv";
import { fastify, type FastifyPluginCallback } from "fastify";
import * as fs from "fs";
import * as process from "process";
import { buildLoggerOptions, hostInfo, logger } from "@infrastructure";
import { clientManager, gracefulShutdownHook } from "@service";
import apiRoute from "./route/api-route";
import appRoute from "./route/app-route";

// Load environment variables and handle errors
const result = dotenv.config();
if (result.error) {
  process.exit(1);
}

const init = async (): Promise<void> => {
  const httpServer = fastify({
    logger: buildLoggerOptions("debug"),
  });

  const httpsServer = fastify({
    logger: buildLoggerOptions("debug"),
    https: {
      key: fs.readFileSync(process.env.SSL_KEY as string),
      cert: fs.readFileSync(process.env.SSL_CERT as string),
    },
  });

  // Add logging for server URIs
  const httpPort = process.env.HTTP_PORT || "3000";
  const httpsPort = process.env.HTTPS_PORT || "3443";

  logger.info("Server URIs:");
  logger.info(`HTTP: http://${hostInfo.host}:${httpPort}`);
  logger.info(`HTTPS: https://${hostInfo.host}:${httpsPort}`);

  const gracefulShutDownHttp = gracefulShutdownHook(httpServer);
  const gracefulShutDownHttps = gracefulShutdownHook(httpsServer);

  await httpServer.register(apiRoute as FastifyPluginCallback);
  await httpServer.register(appRoute as FastifyPluginCallback);

  await httpsServer.register(apiRoute as FastifyPluginCallback);
  await httpsServer.register(appRoute as FastifyPluginCallback);

  try {
    await httpServer.listen({ host: hostInfo.host, port: parseInt(process.env.HTTP_PORT || "3000", 10) });
    //await httpsServer.listen({ host: hostInfo.host, port: parseInt(process.env.HTTPS_PORT || "3443", 10) });

    gracefulShutDownHttp.setReady();
    gracefulShutDownHttps.setReady();

    await clientManager.start();
  } catch (err: unknown) {
    if (err instanceof Error) {
      httpServer.log.error(err.message);
      httpsServer.log.error(err.message);
    } else {
      httpServer.log.error("An unknown error occurred");
      httpsServer.log.error("An unknown error occurred");
    }

    await httpServer.close();
    //await httpsServer.close();

    process.exit(1);
  }
};

void init();
