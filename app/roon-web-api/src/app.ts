import * as dotenv from "dotenv";
import { fastify, type FastifyPluginCallback } from "fastify";
import * as fs from "fs";
import * as net from "net";
import * as process from "process";
import { buildLoggerOptions, hostInfo, logger } from "@infrastructure";
import { clientManager, gracefulShutdownHook, startScheduledTasks, stopScheduledTasks } from "@service";
import apiRoute from "./route/api-route";
import appRoute from "./route/app-route";

// Load environment variables.
//
// In containers (and many production setups) we rely on injected environment
// variables rather than a local `.env` file, so missing `.env` must not be fatal.
const result = dotenv.config();
if (result.error && (result.error as NodeJS.ErrnoException).code !== "ENOENT") {
  // eslint-disable-next-line no-console
  console.error("Error loading environment variables:", result.error);
  process.exit(1);
}

/**
 * Checks if a port is in use
 * @param port - The port number to check
 * @param host - The host to check the port on
 * @returns Promise that resolves to true if port is in use, false otherwise
 */
const isPortInUse = async (port: number, host: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve(true);
      }
    });

    server.once("listening", () => {
      server.close();
      resolve(false);
    });

    server.listen(port, host);
  });
};

const init = async (): Promise<void> => {
  const httpServer = fastify({
    logger: buildLoggerOptions("debug"),
    bodyLimit: 20 * 1024 * 1024, // 20MB for base64 encoded images
  });

  const httpsServer = fastify({
    logger: buildLoggerOptions("debug"),
    bodyLimit: 20 * 1024 * 1024, // 20MB for base64 encoded images
    https: {
      key: fs.readFileSync(process.env.SSL_KEY as string),
      cert: fs.readFileSync(process.env.SSL_CERT as string),
    },
  });

  // Add logging for server URIs
  const httpPort = parseInt(process.env.HTTP_PORT || "3000", 10);
  const httpsPort = parseInt(process.env.HTTPS_PORT || "3443", 10);

  // Check if ports are in use
  const [httpInUse, httpsInUse] = await Promise.all([
    isPortInUse(httpPort, hostInfo.host),
    isPortInUse(httpsPort, hostInfo.host),
  ]);

  if (httpInUse || httpsInUse) {
    const inUsePortMessages = [];
    if (httpInUse) {
      inUsePortMessages.push(`HTTP port ${httpPort}`);
    }
    if (httpsInUse) {
      inUsePortMessages.push(`HTTPS port ${httpsPort}`);
    }
    logger.error(`Port(s) already in use: ${inUsePortMessages.join(" and ")}`);
    process.exit(1);
  }

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
    await httpServer.listen({ host: hostInfo.host, port: httpPort });
    await httpsServer.listen({ host: hostInfo.host, port: httpsPort });

    gracefulShutDownHttp.setReady();
    gracefulShutDownHttps.setReady();

    await clientManager.start();

    // Start scheduled tasks
    startScheduledTasks();

    // Register cleanup handler for scheduled tasks
    process.on("SIGINT", () => {
      stopScheduledTasks();
    });

    process.on("SIGTERM", () => {
      stopScheduledTasks();
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      httpServer.log.error(err.message);
      httpsServer.log.error(err.message);
    } else {
      httpServer.log.error("An unknown error occurred");
      httpsServer.log.error("An unknown error occurred");
    }

    await httpServer.close();
    await httpsServer.close();

    process.exit(1);
  }
};

void init();
