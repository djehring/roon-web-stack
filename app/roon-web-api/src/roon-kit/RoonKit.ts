import {
  RoonApi,
  RoonApiBrowse,
  RoonApiImage,
  RoonApiOptions,
  RoonApiSettings,
  RoonApiStatus,
  RoonApiTransport,
  RoonServer,
  SaveSettingsStatus,
  SettingsValues,
  SettingsLayout,
} from "@model";
import { logger } from "@infrastructure";

/**
 * Shared types and functions.
 *
 * #### Remarks
 * The `RoonKit` class exposes types for all of the classes & services it imports from the various
 * `node-roon-api-XXXX` packages. Applications working directly with the imported api classes should
 * call the [[RoonKit.createRoonApi]] method when creating new instances of the [[RoonKit.RoonApi]]
 * class. This is the only way to ensure that all of the API's services are properly converted to
 * being promise based.
 */
export class RoonKit {
  /**
   * [[RoonApi]] class imported from 'node-roon-api' package.
   */
  public static readonly RoonApi: new (
    options: RoonApiOptions
  ) => RoonApi = require("node-roon-api");

  /**
   * [[RoonApiBrowse]] service imported from 'node-roon-api-browse' package.
   */
  public static readonly RoonApiBrowse: new () => RoonApiBrowse = require("node-roon-api-browse");

  /**
   * [[RoonApiImage]] service imported from 'node-roon-api-image' package.
   */
  public static readonly RoonApiImage: new () => RoonApiImage = require("node-roon-api-image");

  /**
   * [[RoonApiStatus]] service imported from 'node-roon-api-status' package.
   */
  public static readonly RoonApiStatus: new (
    roon: RoonApi
  ) => RoonApiStatus = require("node-roon-api-status");

  /**
   * [[RoonApiTransport]] service imported from 'node-roon-api-transport' package.
   */
  public static readonly RoonApiTransport: new () => RoonApiTransport = require("node-roon-api-transport");

  /**
   * [[RoonApiSettings]] service imported from 'node-roon-api-settings' package.
   */
  public static readonly RoonApiSettings: new <T extends SettingsValues>(roon: RoonApi, options: {
    save_settings: (
      req: { send_complete: (status: SaveSettingsStatus, settings: { settings: SettingsLayout<T> }) => void },
      isDryRun: boolean,
      settingToSave: { values: Partial<T> }
    ) => void;
    get_settings: (sendSettings: (settingsLayout: SettingsLayout<T>) => void) => void
  }) => RoonApiSettings<T> = require("node-roon-api-settings");

  /**
   * Creates a new [[RoonApi]] instance.
   * @param options Options used to configure roon API.
   * @returns Created [[RoonApi]] instance.
   */
  public static createRoonApi(options: RoonApiOptions): RoonApi {
    // Patch core callbacks
    for (const key in options) {
      switch (key) {
        case "core_paired":
        case "core_unpaired":
        case "core_found":
        case "core_lost":
          const cb = options[key] as CoreCallback;
          if (typeof cb == "function") {
            options[key] = (core: RoonServer) => {
              cb(proxyCore(core));
            };
          }
          break;
      }
    }

    // Create API
    return new RoonKit.RoonApi(options);
  }
}

type CoreCallback = (core: RoonServer) => void;

interface RoonCoreProxy extends RoonServer {
  isProxy?: boolean;
}

function proxyCore(core: RoonCoreProxy): RoonServer {
  if (!core.isProxy) {
    // Proxy services
    if (core.services.RoonApiBrowse) {
      (core.services as any).RoonApiBrowse = proxyBrowse(
        core.services.RoonApiBrowse
      );
    }

    if (core.services.RoonApiImage) {
      (core.services as any).RoonApiImage = proxyImage(
        core.services.RoonApiImage
      );
    }

    if (core.services.RoonApiTransport) {
      (core.services as any).RoonApiTransport = proxyTransport(
        core.services.RoonApiTransport
      );
    }

    core.isProxy = true;
  }

  return core;
}

function proxyBrowse(browse: RoonApiBrowse): RoonApiBrowse {
  return new Proxy(browse, {
    get(t, p, r) {
      let v: any = Reflect.get(t, p, r);
      switch (p) {
        case "browse":
        case "load":
          const fn = v as Function;
          v = (...args: any[]) => {
            // Enhanced logging for browse/load calls
            const options = args[0] || {};
            logger.debug({
              method: p,
              options: {
                hierarchy: options.hierarchy,
                item_key: options.item_key,
                input: options.input,
                pop_all: options.pop_all,
                refresh_list: options.refresh_list,
                multi_session_key: options.multi_session_key,
                level: options.level,
                offset: options.offset,
                count: options.count,
                zone_or_output_id: options.zone_or_output_id
              }
            }, `RoonApiBrowse.${p} called with options`);
            
            return new Promise((resolve, reject) => {
              args.push((err: string | false, body: any) => {
                if (err) {
                  logger.error({ 
                    method: p, 
                    error: err,
                    options: args[0]
                  }, `RoonApiBrowse.${p} failed`);
                  reject(err);
                } else {
                  logger.debug({ 
                    method: p,
                    responseType: body?.action,
                    listLevel: body?.list?.level,
                    listCount: body?.list?.count,
                    itemCount: body?.items?.length,
                    items: body?.items?.map((item: any) => ({
                      title: item.title,
                      subtitle: item.subtitle,
                      hint: item.hint,
                      item_key: item.item_key
                    }))
                  }, `RoonApiBrowse.${p} succeeded`);
                  resolve(body);
                }
              });
              fn.apply(t, args);
            });
          };
          break;
      }

      return v;
    },
  });
}

function proxyImage(image: RoonApiImage): RoonApiImage {
  return new Proxy(image, {
    get(t, p, r) {
      let v: any = Reflect.get(t, p, r);
      switch (p) {
        case "get_image":
          const fn = v as Function;
          v = (...args: any[]) => {
            logger.debug({
              method: p,
              imageKey: args[0]
            }, `RoonApiImage.${p} called`);
            
            return new Promise((resolve, reject) => {
              args.push(
                (err: string | false, content_type: string, image: Buffer) => {
                  if (err) {
                    logger.error({ method: p, error: err }, `RoonApiImage.${p} failed`);
                    reject(err);
                  } else {
                    logger.debug({ 
                      method: p,
                      contentType: content_type,
                      imageSize: image.length
                    }, `RoonApiImage.${p} succeeded`);
                    resolve({ content_type, image });
                  }
                }
              );
              fn.apply(t, args);
            });
          };
          break;
      }

      return v;
    },
  });
}

function proxyTransport(transport: RoonApiTransport): RoonApiTransport {
  return new Proxy(transport, {
    get(t, p, r) {
      let fn: Function;
      let v: any = Reflect.get(t, p, r);
      switch (p) {
        case "change_settings":
        case "change_volume":
        case "control":
        case "convenience_switch":
        case "group_outputs":
        case "mute":
        case "mute_all":
        case "pause_all":
        case "seek":
        case "standby":
        case "toggle_standby":
        case "transfer_zone":
        case "ungroup_outputs":
          fn = v;
          v = (...args: any[]) => {
            // Enhanced logging for transport control calls
            const options = args[0] || {};
            logger.debug({
              method: p,
              options: {
                zone_id: options.zone_id,
                zone_or_output_id: options.zone_or_output_id,
                cmd: options.cmd,
                item_key: options.item_key,
                seek_position: options.seek_position,
                volume: options.volume
              }
            }, `RoonApiTransport.${p} called with options`);
            
            return new Promise<void>((resolve, reject) => {
              args.push((err: string | false) => {
                if (err) {
                  logger.error({ 
                    method: p, 
                    error: err,
                    options: args[0]
                  }, `RoonApiTransport.${p} failed`);
                  reject(err);
                } else {
                  logger.debug({ 
                    method: p,
                    success: true
                  }, `RoonApiTransport.${p} succeeded`);
                  resolve();
                }
              });
              fn.apply(t, args);
            });
          };
          break;
        case "get_outputs":
        case "get_zones":
        case "play_from_here":
          fn = v;
          v = (...args: any[]) => {
            // Enhanced logging for transport query calls
            const options = args[0] || {};
            logger.debug({
              method: p,
              options: {
                zone_id: options.zone_id,
                zone_or_output_id: options.zone_or_output_id,
                output_id: options.output_id
              }
            }, `RoonApiTransport.${p} called with options`);
            
            return new Promise((resolve, reject) => {
              args.push((err: string | false, body: any) => {
                if (err) {
                  logger.error({ 
                    method: p, 
                    error: err,
                    options: args[0]
                  }, `RoonApiTransport.${p} failed`);
                  reject(err);
                } else {
                  logger.debug({ 
                    method: p,
                    responseType: typeof body,
                    itemCount: Array.isArray(body) ? body.length : undefined,
                    response: body
                  }, `RoonApiTransport.${p} succeeded`);
                  resolve(body);
                }
              });
              fn.apply(t, args);
            });
          };
          break;
      }

      return v;
    },
  });
}
