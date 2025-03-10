import { nanoid } from "nanoid";
import { interval, map, mergeWith, Observable, Subject } from "rxjs";
import { dataConverter, zoneManager } from "@data";
import { logger, roon } from "@infrastructure";
import {
  Client,
  ClientManager,
  Command,
  CommandState,
  RoonApiBrowseHierarchy,
  RoonApiBrowseLoadOptions,
  RoonApiBrowseLoadResponse,
  RoonApiBrowseOptions,
  RoonApiBrowseResponse,
  RoonSseMessage,
} from "@model";
import { commandDispatcher } from "@service";
import { Track } from "../ai-service/types/track";
import { findTracksInRoon } from "./client-tracks-manager";

class InternalClient implements Client {
  private static readonly PING_PERIOD = 45;
  private readonly client_id: string;
  private readonly commandChannel: Subject<CommandState>;
  private readonly onCloseListener: (client: InternalClient) => void;
  private eventChannel?: Observable<RoonSseMessage>;

  constructor(client_id: string, onCloseListener: (client: InternalClient) => void) {
    this.client_id = client_id;
    this.commandChannel = new Subject<CommandState>();
    this.onCloseListener = onCloseListener;
  }

  events = (): Observable<RoonSseMessage> => {
    if (this.eventChannel === undefined) {
      const pingObservable: Observable<RoonSseMessage> = interval(InternalClient.PING_PERIOD * 1000).pipe(
        map(() => ({
          event: "ping",
          data: {
            next: InternalClient.PING_PERIOD,
          },
        }))
      );
      this.eventChannel = this.commandChannel
        .pipe(map(dataConverter.toRoonSseMessage))
        .pipe(mergeWith(roon.sharedConfigEvents(), zoneManager.events(), pingObservable));
    }
    return this.eventChannel;
  };

  close = (): void => {
    this.onCloseListener(this);
  };

  command = (command: Command): string => {
    return commandDispatcher.dispatch(command, this.commandChannel);
  };

  browse = async (options: RoonApiBrowseOptions): Promise<RoonApiBrowseResponse> => {
    options.multi_session_key = this.client_id;
    return roon.browse(options);
  };

  load = async (options: RoonApiBrowseLoadOptions): Promise<RoonApiBrowseLoadResponse> => {
    options.multi_session_key = this.client_id;
    return roon.load(options);
  };

  playTracks = async (zoneId: string, tracks: Track[]): Promise<Track[]> => {
    const browseOptions: RoonApiBrowseOptions = {
      hierarchy: "browse",
      zone_or_output_id: zoneId,
      multi_session_key: this.client_id,
    };
    return await findTracksInRoon(tracks, browseOptions);
  };

  id = (): string => {
    return this.client_id;
  };

  cleanHierarchies = (): void => {
    this.cleanHierarchy("albums");
    this.cleanHierarchy("artists");
    this.cleanHierarchy("browse");
    this.cleanHierarchy("composers");
    this.cleanHierarchy("genres");
    this.cleanHierarchy("internet_radio");
    this.cleanHierarchy("playlists");
  };

  private cleanHierarchy = (hierarchy: RoonApiBrowseHierarchy): void => {
    // this seems to be the closest thing to a close browsing session in roon API
    this.browse({
      hierarchy,
      pop_all: true,
      set_display_offset: true,
    }).catch((err: unknown) => {
      logger.error(err, "error while cleaning client '%s' state", this.client_id);
    });
  };
}

const generateClientId = (): string => {
  return nanoid();
};

class InternalClientManager implements ClientManager {
  private readonly clients: Map<string, InternalClient>;
  private isStarted: boolean;

  constructor() {
    this.clients = new Map<string, InternalClient>();
    this.isStarted = false;
  }

  register = (previous_client_id?: string): string => {
    this.ensureStarted();
    const client_id = previous_client_id ?? generateClientId();
    if (this.clients.has(client_id)) {
      return client_id;
    }
    const client = new InternalClient(client_id, (c: InternalClient) => {
      this.clients.delete(c.id());
      c.cleanHierarchies();
    });
    this.clients.set(client_id, client);
    return client_id;
  };

  get = (client_id: string): Client => {
    this.ensureStarted();
    const client = this.clients.get(client_id);
    if (!client) {
      throw new Error(`'${client_id}' is not a registered client_id`);
    }
    return client;
  };

  unregister = (client_id: string): void => {
    this.ensureStarted();
    const client = this.clients.get(client_id);
    client?.close();
  };

  start = (): Promise<void> => {
    if (!this.isStarted) {
      this.isStarted = true;
      return zoneManager.start();
    } else {
      return Promise.resolve();
    }
  };

  stop = (): void => {
    if (this.isStarted) {
      for (const client_id of this.clients.keys()) {
        this.unregister(client_id);
      }
      zoneManager.stop();
      this.isStarted = false;
    }
  };

  private ensureStarted = (): void => {
    if (!this.isStarted || !zoneManager.isStarted()) {
      throw new Error("clientManager is not started");
    }
  };
}

export const clientManager: ClientManager = new InternalClientManager();
