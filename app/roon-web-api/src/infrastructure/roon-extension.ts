import { BehaviorSubject, Observable, Subject } from "rxjs";
import { hostInfo, logger } from "@infrastructure";
import {
  EmptyObject,
  ExtensionSettings,
  OutputListener,
  Roon,
  RoonApiBrowseLoadOptions,
  RoonApiBrowseLoadResponse,
  RoonApiBrowseOptions,
  RoonApiBrowseResponse,
  RoonApiImageResultOptions,
  RoonExtension,
  RoonServer,
  ServerListener,
  SettingsManager,
  SharedConfig,
  SharedConfigMessage,
  SharedConfigUpdate,
  ZoneListener,
} from "@model";
import { Extension } from "@roon-kit";
import { settingsOptions } from "./roon-extension-settings";

export const extension_version = process.env.npm_package_version ?? "0.0.0";

const ROON_CORE_HOST = process.env.ROON_CORE_HOST;
const ROON_CORE_PORT = parseInt(process.env.ROON_CORE_PORT ?? "9330", 10);

const MIN_WS_RECONNECT_DELAY_MS = 1_000;
const MAX_WS_RECONNECT_DELAY_MS = 60_000;

const extension: RoonExtension<ExtensionSettings> = new Extension({
  description: {
    extension_id: "roon-web-stack",
    display_name: `roon web stack @${hostInfo.hostname}`,
    display_version: extension_version,
    publisher: "jehring.org",
    email: "david@jehring.org",
    website: `http://${hostInfo.ipV4}:${hostInfo.port}`,
  },
  RoonApiBrowse: "required",
  RoonApiImage: "required",
  RoonApiTransport: "required",
  RoonApiSettings: settingsOptions,
  subscribe_outputs: true,
  subscribe_zones: true,
  log_level: "none",
});

let wsReconnectTimer: NodeJS.Timeout | undefined;
let wsReconnectAttempt = 0;

const clearWsReconnectTimer = (): void => {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = undefined;
  }
};

const computeReconnectDelayMs = (attempt: number): number => {
  const backoff = MIN_WS_RECONNECT_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1));
  const capped = Math.min(backoff, MAX_WS_RECONNECT_DELAY_MS);
  const jitter = Math.floor(Math.random() * Math.min(1_000, capped / 4));
  return Math.min(capped + jitter, MAX_WS_RECONNECT_DELAY_MS);
};

const connectCoreWebsocket = (reason: string): void => {
  if (!ROON_CORE_HOST) {
    return;
  }

  const connectMsg = `connecting to core websocket (${reason}) at ${ROON_CORE_HOST}:${ROON_CORE_PORT}`;
  logger.info(connectMsg);

  extension.api().ws_connect({
    host: ROON_CORE_HOST,
    port: ROON_CORE_PORT,
    onclose: () => {
      logger.warn("core websocket connection closed");
      scheduleReconnect("close");
    },
    onerror: (moo: unknown) => {
      logger.warn("core websocket connection error");
      const typedMoo = moo as { transport?: { close?: () => void } };
      if (typedMoo.transport && typeof typedMoo.transport.close === "function") {
        try {
          typedMoo.transport.close();
        } catch (err: unknown) {
          logger.warn(err, "failed to close websocket transport after error");
        }
      }
      // Always schedule a reconnect on error. In some failure modes, calling
      // transport.close() does not reliably trigger the ws_connect onclose hook,
      // which would otherwise schedule the reconnect.
      scheduleReconnect("error");
    },
  });
};

const scheduleReconnect = (trigger: string): void => {
  if (!ROON_CORE_HOST) {
    return;
  }

  if (wsReconnectTimer) {
    return;
  }

  wsReconnectAttempt += 1;
  const delayMs = computeReconnectDelayMs(wsReconnectAttempt);
  logger.info(
    `scheduling core websocket reconnect (trigger=${trigger}, attempt=${wsReconnectAttempt}, delayMs=${delayMs})`
  );
  extension.set_status("connecting...");
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = undefined;
    connectCoreWebsocket("reconnect");
  }, delayMs);
};

const onServerPaired = (listener: ServerListener): void => {
  extension.on("core_paired", listener);
};

const onServerPairedDefaultListener: ServerListener = (server: RoonServer) => {
  wsReconnectAttempt = 0;
  clearWsReconnectTimer();
  extension.set_status(`paired, exposed at http://${hostInfo.ipV4}:${hostInfo.port}`);
  logger.info(
    `extension version: ${extension_version}, paired roon server: ${server.display_name} (v${server.display_version} - ${server.core_id})`
  );
  publishSharedConfigMessage();
};

const onServerLostDefaultListener: ServerListener = (server: RoonServer) => {
  logger.warn(`lost roon server: ${server.display_name} (v${server.display_version} - ${server.core_id})`);
  logger.info(`waiting for adoption...`);
  if (ROON_CORE_HOST) {
    scheduleReconnect("core_unpaired");
  }
};

const onServerLost = (listener: ServerListener): void => {
  extension.on("core_unpaired", listener);
};

const server = async (): Promise<RoonServer> => extension.get_core();

const onZones = (listener: ZoneListener): void => {
  extension.on("subscribe_zones", listener);
};

const offZones = (listener: ZoneListener): void => {
  extension.off("subscribe_zones", listener);
};

const onOutputs = (outputListener: OutputListener): void => {
  extension.on("subscribe_outputs", outputListener);
};

const offOutputs = (outputListener: OutputListener): void => {
  extension.off("subscribe_outputs", outputListener);
};

let mustBeStarted: boolean = true;

const startExtension = (): void => {
  if (mustBeStarted) {
    mustBeStarted = false;
    onServerPaired(onServerPairedDefaultListener);
    onServerLost(onServerLostDefaultListener);
    if (ROON_CORE_HOST) {
      logger.info(`starting discovery and connecting to core at ${ROON_CORE_HOST}:${ROON_CORE_PORT}`);
    } else {
      logger.info("starting discovery, don't forget to enable the extension in roon settings if needed.");
    }
    extension.start_discovery();
    if (ROON_CORE_HOST) {
      extension.set_status("connecting...");
      connectCoreWebsocket("startup");
    } else {
      extension.set_status("starting...");
    }
  }
};

const getImage = async (
  image_key: string,
  options: RoonApiImageResultOptions
): Promise<{ content_type: string; image: Buffer }> => {
  const roonServer = await server();
  return roonServer.services.RoonApiImage.get_image(image_key, options);
};

const browse = async (options: RoonApiBrowseOptions | EmptyObject): Promise<RoonApiBrowseResponse> => {
  const server = await extension.get_core();
  return server.services.RoonApiBrowse.browse(options).catch((err: unknown) => {
    logger.error(err, "error during roon#browse");
    throw err;
  });
};

const load = async (options: RoonApiBrowseLoadOptions): Promise<RoonApiBrowseLoadResponse> => {
  const server = await extension.get_core();
  return server.services.RoonApiBrowse.load(options).catch((err: unknown) => {
    logger.error(err, "error during roon#load");
    throw err;
  });
};

const SHARED_CONFIG_KEY = "roon_web_stack_shared_config";
const EMPTY_SHARED_CONFIG: SharedConfig = {
  customActions: [],
};

const updateSharedConfig = (sharedConfigUpdate: SharedConfigUpdate): void => {
  const sharedConfig = extension.api().load_config<SharedConfig>(SHARED_CONFIG_KEY) ?? EMPTY_SHARED_CONFIG;
  let saveAndPublish = false;
  if (sharedConfigUpdate.customActions) {
    sharedConfig.customActions = sharedConfigUpdate.customActions;
    saveAndPublish = true;
  }
  if (saveAndPublish) {
    extension.api().save_config(SHARED_CONFIG_KEY, sharedConfig);
    publishSharedConfigMessage(sharedConfig);
  }
};

let sharedConfigSubject: Subject<SharedConfigMessage> | undefined;

const publishSharedConfigMessage = (sharedConfig?: SharedConfig): void => {
  const data = sharedConfig ?? extension.api().load_config<SharedConfig>(SHARED_CONFIG_KEY) ?? EMPTY_SHARED_CONFIG;
  const msg: SharedConfigMessage = {
    event: "config",
    data,
  };
  if (sharedConfigSubject == undefined) {
    sharedConfigSubject = new BehaviorSubject(msg);
  } else {
    sharedConfigSubject.next(msg);
  }
};

const sharedConfigEvents = (): Observable<SharedConfigMessage> => {
  if (sharedConfigSubject === undefined) {
    throw new Error("server has not be paired yet!");
  }
  return sharedConfigSubject;
};

const settings = (): SettingsManager<ExtensionSettings> | undefined => {
  return extension.settings();
};

export const roon: Roon = {
  onServerPaired,
  onServerLost,
  server,
  onZones,
  offZones,
  onOutputs,
  offOutputs,
  startExtension,
  getImage,
  browse,
  load,
  updateSharedConfig,
  sharedConfigEvents,
  settings,
};
