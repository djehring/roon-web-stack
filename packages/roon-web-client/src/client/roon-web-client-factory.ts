import {
  AISearchResponse,
  AITrackStoryResponse,
  ApiState,
  ClientRoonApiBrowseLoadOptions,
  ClientRoonApiBrowseOptions,
  ClientStateListener,
  ClientStatus,
  Command,
  CommandState,
  CommandStateListener,
  FoundItemIndexResponse,
  Item,
  ItemIndexSearch,
  Ping,
  QueueState,
  QueueStateListener,
  RoonApiBrowseLoadResponse,
  RoonApiBrowseResponse,
  RoonPath,
  RoonState,
  RoonStateListener,
  RoonWebClient,
  RoonWebClientFactory,
  SharedConfig,
  SharedConfigListener,
  SuggestedTrack,
  TrackStory,
  TranscriptionResponse,
  ZoneState,
  ZoneStateListener,
} from "@model";

interface ZoneStates {
  zone?: ZoneState;
  queue?: QueueState;
}

interface LoadPath extends RoonPath {
  levelToLoad: number;
  item_key?: string;
}

class InternalRoonWebClient implements RoonWebClient {
  private static readonly X_ROON_WEB_STACK_VERSION_HEADER = "x-roon-web-stack-version";
  private static readonly CLIENT_NOT_STARTED_ERROR_MESSAGE = "client has not been started";
  private _eventSource?: EventSource;
  private _apiState?: ApiState;
  private readonly _zones: Map<string, ZoneStates>;
  private readonly _roonStateListeners: RoonStateListener[];
  private readonly _commandStateListeners: CommandStateListener[];
  private readonly _zoneStateListeners: ZoneStateListener[];
  private readonly _queueStateListeners: QueueStateListener[];
  private readonly _clientStateListeners: ClientStateListener[];
  private readonly _sharedConfigListeners: SharedConfigListener[];
  private readonly _apiHost: URL;
  private _abortController?: AbortController;
  private _roonWebStackVersion?: string;
  private _clientPath?: string;
  private _isClosed: boolean;
  private _mustRefresh: boolean;
  private _pingInterval?: ReturnType<typeof setTimeout>;

  constructor(apiHost: URL) {
    this._apiHost = apiHost;
    this._zones = new Map<string, ZoneStates>();
    this._roonStateListeners = [];
    this._commandStateListeners = [];
    this._zoneStateListeners = [];
    this._queueStateListeners = [];
    this._clientStateListeners = [];
    this._sharedConfigListeners = [];
    this._isClosed = true;
    this._mustRefresh = false;
  }

  start: (clientId?: string) => Promise<void> = async (clientId) => {
    if (this._isClosed) {
      this._abortController = new AbortController();
      const versionUrl = new URL("/api/version", this._apiHost);
      const versionReq = new Request(versionUrl, {
        method: "GET",
        mode: "cors",
        signal: this._abortController.signal,
      });
      const versionResponse = await fetch(versionReq);
      const version = versionResponse.headers.get(InternalRoonWebClient.X_ROON_WEB_STACK_VERSION_HEADER);
      if (versionResponse.status === 204 && version) {
        if (this._roonWebStackVersion && this._roonWebStackVersion !== version) {
          this.onClientStateMessage("outdated");
        } else {
          this._roonWebStackVersion = version;
        }
      } else {
        throw new Error("unable to validate roon-web-stack version");
      }
      const roonClientId = this.currentClientId() ?? clientId;
      const registerPath = "/api/register" + (roonClientId ? `/${roonClientId}` : "");
      const registerUrl = new URL(registerPath, this._apiHost);
      const registerReq = new Request(registerUrl, {
        method: "POST",
        mode: "cors",
        headers: {
          Accept: "application/json",
        },
        signal: this._abortController.signal,
      });
      const registerResponse = await fetch(registerReq);
      delete this._abortController;
      if (registerResponse.status === 201) {
        const locationHeader = registerResponse.headers.get("Location");
        if (locationHeader) {
          this._clientPath = locationHeader;
          this.connectEventSource();
          this._isClosed = false;
          this._mustRefresh = false;
          this.onClientStateMessage("started", this.currentClientId());
          return;
        }
      }
      throw new Error("unable to register client");
    }
  };

  restart: () => Promise<void> = async () => {
    this.ensureStared();
    this._isClosed = true;
    this._eventSource?.close();
    delete this._eventSource;
    this._abortController?.abort();
    await this.start();
  };

  refresh: () => Promise<void> = async () => {
    if (this._mustRefresh) {
      this._mustRefresh = false;
      try {
        await this.restart();
      } catch (err) {
        this._mustRefresh = true;
        throw err;
      }
    }
  };

  stop: () => Promise<void> = async () => {
    const clientPath = this.ensureStared();
    const unregisterUrl = new URL(`${clientPath}/unregister`, this._apiHost);
    const unregisterRequest = new Request(unregisterUrl, {
      method: "POST",
      mode: "cors",
    });
    const response = await fetch(unregisterRequest);
    if (response.status === 204) {
      this.closeClient();
      return;
    }
    throw new Error("unable to unregister client");
  };

  getAISearch: (query: string) => Promise<AISearchResponse> = async (query: string): Promise<AISearchResponse> => {
    //For this to work, the server must have the /aisearch endpoint
    const clientPath = this.ensureStared();
    const commandUrl = new URL(`${clientPath}/aisearch`, this._apiHost);
    const req = new Request(commandUrl, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(query),
    });
    const response = await this.fetchRefreshed(req);
    if (response.status === 200) {
      const tracks = (await response.json()) as SuggestedTrack[];
      return { items: tracks };
    }
    throw new Error("unable to send command");
  };

  getTrackStory: (track: SuggestedTrack) => Promise<AITrackStoryResponse> = async (
    track: SuggestedTrack
  ): Promise<AITrackStoryResponse> => {
    const clientPath = this.ensureStared();
    const commandUrl = new URL(`${clientPath}/trackstory`, this._apiHost);
    // eslint-disable-next-line no-console
    console.log("Going to get track info", track);

    const req = new Request(commandUrl, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(track),
    });

    const response = await this.fetchRefreshed(req);
    if (response.status === 200) {
      const trackStory = (await response.json()) as TrackStory;
      return { story: trackStory };
    }

    throw new Error("Unable to fetch track story");
  };

  playTracks: (zoneId: string, tracks: SuggestedTrack[]) => Promise<AISearchResponse> = async (
    zoneId: string,
    tracks: SuggestedTrack[]
  ) => {
    // For this to work, the server must have the /play-tracks endpoint
    const clientPath = this.ensureStared();
    const commandUrl = new URL(`${clientPath}/play-tracks`, this._apiHost);
    // Create the request payload
    const payload = {
      zoneId,
      tracks,
    };
    const req = new Request(commandUrl, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const response = await this.fetchRefreshed(req);
    if (response.status === 200) {
      const tracks = (await response.json()) as SuggestedTrack[];
      return { items: tracks };
    }
    throw new Error("unable to send command");
  };

  onRoonState: (listener: RoonStateListener) => void = (listener: RoonStateListener) => {
    if (this._apiState && this._apiState.state !== RoonState.STOPPED) {
      listener(this._apiState);
    } else if (this._apiState === undefined) {
      listener({ state: RoonState.STARTING, zones: [], outputs: [] });
    }
    this._roonStateListeners.push(listener);
  };

  offRoonState: (listener: RoonStateListener) => void = (listener: RoonStateListener) => {
    const listenerIndex = this._roonStateListeners.indexOf(listener);
    if (listenerIndex !== -1) {
      this._roonStateListeners.splice(listenerIndex, 1);
    }
  };

  onCommandState: (listener: CommandStateListener) => void = (listener: CommandStateListener) => {
    this._commandStateListeners.push(listener);
  };

  offCommandState: (listener: CommandStateListener) => void = (listener: CommandStateListener) => {
    const listenerIndex = this._commandStateListeners.indexOf(listener);
    if (listenerIndex !== -1) {
      this._commandStateListeners.splice(listenerIndex, 1);
    }
  };

  onZoneState: (listener: ZoneStateListener) => void = (listener: ZoneStateListener) => {
    for (const zs of this._zones.values()) {
      if (zs.zone) {
        listener(zs.zone);
      }
    }
    this._zoneStateListeners.push(listener);
  };

  offZoneState: (listener: ZoneStateListener) => void = (listener: ZoneStateListener) => {
    const listenerIndex = this._zoneStateListeners.indexOf(listener);
    if (listenerIndex !== -1) {
      this._zoneStateListeners.splice(listenerIndex, 1);
    }
  };

  onQueueState: (listener: QueueStateListener) => void = (listener: QueueStateListener) => {
    for (const zs of this._zones.values()) {
      if (zs.queue) {
        listener(zs.queue);
      }
    }
    this._queueStateListeners.push(listener);
  };

  offQueueState: (listener: QueueStateListener) => void = (listener: QueueStateListener) => {
    const listenerIndex = this._queueStateListeners.indexOf(listener);
    if (listenerIndex !== -1) {
      this._queueStateListeners.splice(listenerIndex, 1);
    }
  };

  onClientState: (listener: ClientStateListener) => void = (listener: ClientStateListener) => {
    this._clientStateListeners.push(listener);
  };

  offClientState: (listener: ClientStateListener) => void = (listener: ClientStateListener) => {
    const listenerIndex = this._clientStateListeners.indexOf(listener);
    if (listenerIndex !== -1) {
      this._clientStateListeners.splice(listenerIndex, 1);
    }
  };

  onSharedConfig: (listener: SharedConfigListener) => void = (listener: SharedConfigListener) => {
    this._sharedConfigListeners.push(listener);
  };

  offSharedConfig: (listener: SharedConfigListener) => void = (listener: SharedConfigListener) => {
    const listenerIndex = this._sharedConfigListeners.indexOf(listener);
    if (listenerIndex !== -1) {
      this._sharedConfigListeners.splice(listenerIndex, 1);
    }
  };

  command: (command: Command) => Promise<string> = async (command: Command): Promise<string> => {
    const clientPath = this.ensureStared();
    const commandUrl = new URL(`${clientPath}/command`, this._apiHost);
    const req = new Request(commandUrl, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });
    const response = await this.fetchRefreshed(req);
    if (response.status === 202) {
      const json: CommandJsonResponse = (await response.json()) as unknown as CommandJsonResponse;
      return json.command_id;
    }
    throw new Error("unable to send command");
  };

  browse: (options: ClientRoonApiBrowseOptions) => Promise<RoonApiBrowseResponse> = async (
    options: ClientRoonApiBrowseOptions
  ): Promise<RoonApiBrowseResponse> => {
    const clientPath = this.ensureStared();
    const browseUrl = new URL(`${clientPath}/browse`, this._apiHost);
    const req = new Request(browseUrl, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options),
    });
    const response = await this.fetchRefreshed(req);
    if (response.status === 200) {
      return (await response.json()) as unknown as RoonApiBrowseResponse;
    } else {
      throw new Error("unable to browse content");
    }
  };

  load: (options: ClientRoonApiBrowseLoadOptions) => Promise<RoonApiBrowseLoadResponse> = async (
    options: ClientRoonApiBrowseLoadOptions
  ): Promise<RoonApiBrowseLoadResponse> => {
    const clientPath = this.ensureStared();
    const loadUrl = new URL(`${clientPath}/load`, this._apiHost);
    const req = new Request(loadUrl, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options),
    });
    const response = await this.fetchRefreshed(req);
    if (response.status === 200) {
      return (await response.json()) as unknown as RoonApiBrowseLoadResponse;
    } else {
      throw new Error("unable to load content");
    }
  };

  version: () => string = () => {
    if (this._roonWebStackVersion) {
      return this._roonWebStackVersion;
    } else {
      throw new Error(InternalRoonWebClient.CLIENT_NOT_STARTED_ERROR_MESSAGE);
    }
  };

  loadPath: (zone_id: string, path: RoonPath) => Promise<RoonApiBrowseLoadResponse> = async (
    zone_id: string,
    path: RoonPath
  ): Promise<RoonApiBrowseLoadResponse> => {
    const loadPath: LoadPath = {
      ...path,
      levelToLoad: 0,
    };
    return this._loadPath(zone_id, loadPath);
  };

  private _loadPath: (zone_id: string, path: LoadPath) => Promise<RoonApiBrowseLoadResponse> = async (
    zone_id: string,
    path: LoadPath
  ): Promise<RoonApiBrowseLoadResponse> => {
    const browseResponse = await this.browse({
      hierarchy: path.hierarchy,
      item_key: path.item_key,
      zone_or_output_id: zone_id,
    });
    const loadResponse = await this.load({
      hierarchy: path.hierarchy,
      level: browseResponse.list?.level,
      count: browseResponse.list?.count,
    });
    if (path.path.length !== path.levelToLoad) {
      const item_key = loadResponse.items.find((i) => i.title === path.path[path.levelToLoad])?.item_key;
      if (item_key) {
        path.item_key = item_key;
        path.levelToLoad = path.levelToLoad + 1;
        return this._loadPath(zone_id, path);
      } else {
        const pathString = path.path.reduce((s, p) => `${s} -> ${p}`);
        throw new Error(`invalid path: '${path.hierarchy}' - '${pathString}' not found`);
      }
    } else {
      return loadResponse;
    }
  };

  // FIXME?: As nothing is indexed in roon API, there's no way to implement this feature without browsing all the data,
  //  the tradeoff to load everything and return the complete collection is a little extreme, but the data have been loaded 🤷
  findItemIndex: (itemIndexSearch: ItemIndexSearch) => Promise<FoundItemIndexResponse> = async (
    itemIndexSearch: ItemIndexSearch
  ): Promise<FoundItemIndexResponse> => {
    let items = itemIndexSearch.items;
    if (items === undefined) {
      const { hierarchy, list } = itemIndexSearch;
      const loadResponse = await this.load({
        hierarchy,
        level: list.level,
        count: list.count,
        offset: 0,
      });
      items = loadResponse.items;
    }
    const sliceSize = Math.floor(itemIndexSearch.list.count / 26);
    const letterIndex = itemIndexSearch.letter.charCodeAt(0) - 65;
    const firstIndex = letterIndex * sliceSize;
    const lastIndex = items.length;
    const itemIndex = this._findItemIndex(
      firstIndex,
      lastIndex,
      sliceSize,
      items,
      itemIndexSearch.letter.toUpperCase()
    );
    return {
      items,
      itemIndex,
      list: itemIndexSearch.list,
      offset: 0,
    };
  };

  private _findItemIndex: (
    firstIndex: number,
    lastIndex: number,
    sliceSize: number,
    items: Item[],
    letter: string
  ) => number = (firstIndex: number, lastIndex: number, sliceSize: number, items: Item[], letter: string): number => {
    let index = -1;
    for (let i = firstIndex; i < lastIndex; i++) {
      const item = items[i];
      const title = item.title.toUpperCase().replace("THE ", "").trimStart();
      const comp = title.charAt(0).localeCompare(letter);
      if (i === firstIndex && comp >= 0) {
        return this._findItemIndex(firstIndex - sliceSize, firstIndex + 1, sliceSize, items, letter);
      } else if (comp === 0) {
        index = i;
        break;
      } else if (comp > 0 && i > firstIndex) {
        index = i - 1;
        break;
      }
    }
    return index;
  };

  private ensureStared: () => string = () => {
    if (this._clientPath === undefined) {
      throw new Error(InternalRoonWebClient.CLIENT_NOT_STARTED_ERROR_MESSAGE);
    }
    return this._clientPath;
  };

  private connectEventSource: () => void = (): void => {
    if (this._eventSource === undefined) {
      const clientPath = this.ensureStared();
      const eventSourceUrl = new URL(`${clientPath}/events`, this._apiHost);
      this._eventSource = new EventSource(eventSourceUrl);
      this._eventSource.addEventListener("state", this.onApiStateMessage);
      this._eventSource.addEventListener("command_state", this.onCommandStateMessage);
      this._eventSource.addEventListener("zone", this.onZoneMessage);
      this._eventSource.addEventListener("queue", this.onQueueMessage);
      this._eventSource.addEventListener("ping", this.onPingMessage);
      this._eventSource.addEventListener("config", this.onSharedConfigMessage);
      this._eventSource.onerror = () => {
        this._mustRefresh = true;
      };
    }
  };

  private onApiStateMessage = (m: MessageEvent<string>): void => {
    const apiState = parseJson<ApiState>(m.data);
    if (apiState) {
      this._apiState = apiState;
      for (const roonStateListener of this._roonStateListeners) {
        roonStateListener(apiState);
      }
    }
  };

  private onCommandStateMessage = (m: MessageEvent<string>): void => {
    const commandState = parseJson<CommandState>(m.data);
    if (commandState) {
      for (const commandStateListener of this._commandStateListeners) {
        commandStateListener(commandState);
      }
    }
  };

  private onZoneMessage = (m: MessageEvent<string>): void => {
    const zoneState = parseJson<ZoneState>(m.data);
    if (zoneState) {
      const zoneStates = this._zones.get(zoneState.zone_id);
      if (!zoneStates) {
        this._zones.set(zoneState.zone_id, {
          zone: zoneState,
        });
      } else {
        zoneStates.zone = zoneState;
      }
      for (const zoneStateListener of this._zoneStateListeners) {
        zoneStateListener(zoneState);
      }
    }
  };

  private onQueueMessage = (m: MessageEvent<string>): void => {
    const queueState = parseJson<QueueState>(m.data);
    if (queueState) {
      const zoneStates = this._zones.get(queueState.zone_id);
      if (!zoneStates) {
        this._zones.set(queueState.zone_id, {
          queue: queueState,
        });
      } else {
        zoneStates.queue = queueState;
      }
      for (const queueStateListener of this._queueStateListeners) {
        queueStateListener(queueState);
      }
    }
  };

  private onPingMessage = (m: MessageEvent<string>): void => {
    const ping = parseJson<Ping>(m.data);
    if (ping) {
      if (this._pingInterval) {
        clearTimeout(this._pingInterval);
      }
      this._pingInterval = setTimeout(
        () => {
          delete this._pingInterval;
          this._mustRefresh = true;
        },
        ping.next * 1.5 * 1000
      );
    }
  };

  private onClientStateMessage = (status: ClientStatus, roonClientId?: string): void => {
    for (const clientStateListener of this._clientStateListeners) {
      clientStateListener({
        status,
        roonClientId,
      });
    }
  };

  private onSharedConfigMessage = (m: MessageEvent<string>): void => {
    const sharedConfig = parseJson<SharedConfig>(m.data);
    if (sharedConfig) {
      for (const sharedConfigListener of this._sharedConfigListeners) {
        sharedConfigListener(sharedConfig);
      }
    }
  };

  private closeClient = (): void => {
    this._eventSource?.close();
    delete this._eventSource;
    delete this._apiState;
    this._zones.clear();
    for (const stateListener of this._roonStateListeners) {
      stateListener({ state: RoonState.STOPPED, zones: [], outputs: [] });
    }
    this._roonStateListeners.splice(0, Infinity);
    this._commandStateListeners.splice(0, Infinity);
    this._zoneStateListeners.splice(0, Infinity);
    this._queueStateListeners.splice(0, Infinity);
    this._isClosed = true;
  };

  private fetchRefreshed = async (req: Request): Promise<Response> => {
    const response = await fetch(req);
    if (response.status === 403) {
      this._mustRefresh = true;
      await this.refresh();
      return this.fetchRefreshed(req);
    } else {
      return response;
    }
  };

  private currentClientId = (): string | undefined => {
    return this._clientPath?.substring(5);
  };

  transcribe: (audio: Blob) => Promise<TranscriptionResponse> = async (audio: Blob): Promise<TranscriptionResponse> => {
    const clientPath = this.ensureStared();
    const formData = new FormData();
    formData.append("audio", audio, "audio.webm");

    const transcribeUrl = new URL(`${clientPath}/transcribe`, this._apiHost);
    const req = new Request(transcribeUrl, {
      method: "POST",
      body: formData,
    });

    const response = await this.fetchRefreshed(req);
    if (response.status === 200) {
      return response.json() as Promise<TranscriptionResponse>;
    }
    throw new Error("Unable to transcribe audio");
  };
}

const build: (apiUrl: URL) => RoonWebClient = (apiUrl: URL) => {
  return new InternalRoonWebClient(apiUrl);
};

export const roonWebClientFactory: RoonWebClientFactory = {
  build,
};

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
const parseJson = <T>(json: string): T | undefined => {
  try {
    return JSON.parse(json) as unknown as T;
  } catch {
    return undefined;
  }
};

type CommandJsonResponse = { command_id: string };
