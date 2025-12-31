import { deepEqual } from "fast-equals";
import { DeviceDetectorService } from "ngx-device-detector";
import { Observable } from "rxjs";
import { DOCUMENT } from "@angular/common";
import { computed, inject, Injectable, Signal, signal, WritableSignal } from "@angular/core";
import {
  AISearchResponse,
  AITrackStoryResponse,
  AlbumRecognitionRequest,
  AlbumRecognitionResponse,
  ApiState,
  ClientRoonApiBrowseLoadOptions,
  ClientRoonApiBrowseOptions,
  ClientState,
  Command,
  CommandState,
  FoundItemIndexResponse,
  ItemIndexSearch,
  QueueState,
  RoonApiBrowseHierarchy,
  RoonApiBrowseLoadResponse,
  RoonApiBrowseResponse,
  RoonPath,
  RoonState,
  SearchAlbumsResponse,
  SharedConfig,
  SuggestedTrack,
  TranscriptionResponse,
  ZoneState,
} from "@model";
import {
  AISearchApiResult,
  ApiResultCallback,
  BrowseApiResult,
  BrowseWorkerApiRequest,
  CommandApiResult,
  CommandCallback,
  CommandWorkerApiRequest,
  FindItemIndexWorkerApiRequest,
  FoundItemIndexApiResult,
  LoadApiResult,
  LoadPathWorkerApiRequest,
  LoadWorkerApiRequest,
  NavigateWorkerApiRequest,
  OutputCallback,
  PlayItemApiResult,
  PlayItemWorkerApiRequest,
  PlayTracksApiResult,
  PlayTracksWorkerApiRequest,
  PreviousWorkerApiRequest,
  RawApiResult,
  RawWorkerApiRequest,
  RawWorkerEvent,
  RecognizeAlbumApiResult,
  RecognizeAlbumWorkerApiRequest,
  SearchAlbumsApiResult,
  SearchAlbumsWorkerApiRequest,
  TrackStoryApiResult,
  TrackStoryWorkerApiRequest,
  TranscriptionApiResult,
  TranscriptionWorkerApiRequest,
  VersionApiResult,
  VersionWorkerApiRequest,
  VisibilityState,
  WorkerClientActionMessage,
} from "@model/client";
import { CustomActionsService } from "@services/custom-actions.service";
import { SettingsService } from "@services/settings.service";
import { VisibilityService } from "@services/visibility.service";
import { buildRoonWorker } from "@services/worker.utils";

@Injectable({
  providedIn: "root",
})
export class RoonService {
  private static readonly THIS_IS_A_BUG_ERROR_MSG = "this is a bug!";

  private readonly _window: Window;
  private readonly _deviceDetectorService: DeviceDetectorService;
  private readonly _customActionsService: CustomActionsService;
  private readonly _settingsService: SettingsService;
  private readonly _visibilityService: VisibilityService;
  private readonly _$roonState: WritableSignal<ApiState>;
  private readonly _$isGrouping: WritableSignal<boolean>;
  private readonly _commandCallbacks: Map<string, CommandCallback>;
  private readonly _zoneStates: Map<
    string,
    {
      $zone?: WritableSignal<ZoneState>;
      $queue?: WritableSignal<QueueState>;
    }
  >;
  private readonly _apiStringCallbacks: Map<number, ApiResultCallback<string>>;
  private readonly _apiBrowseCallbacks: Map<number, ApiResultCallback<RoonApiBrowseResponse>>;
  private readonly _apiLoadCallbacks: Map<number, ApiResultCallback<RoonApiBrowseLoadResponse>>;
  private readonly _apiFoundItemIndexCallbacks: Map<number, ApiResultCallback<FoundItemIndexResponse>>;
  private readonly _apiAISearchCallbacks: Map<number, ApiResultCallback<AISearchResponse>>;
  private readonly _apiPlayTracksCallbacks: Map<
    number,
    { resolve: (value: AISearchResponse) => void; reject: (reason: Error | string) => void }
  >;
  private readonly _apiTrackStoryCallbacks: Map<number, ApiResultCallback<AITrackStoryResponse>>;
  private readonly _apiTranscriptionCallbacks: Map<number, ApiResultCallback<TranscriptionResponse>> = new Map();
  private readonly _apiSearchAlbumsCallbacks: Map<number, ApiResultCallback<SearchAlbumsResponse>> = new Map();
  private readonly _apiPlayItemCallbacks: Map<number, ApiResultCallback<undefined>> = new Map();
  private readonly _apiRecognizeAlbumCallbacks: Map<number, ApiResultCallback<AlbumRecognitionResponse>> = new Map();
  private _workerApiRequestId: number;
  private _isStarted: boolean;
  private _outputCallback?: OutputCallback;
  private _worker?: Worker;
  private _version: string;
  private _startResolve?: () => void;

  constructor() {
    const document = inject<Document>(DOCUMENT);
    if (document.defaultView === null) {
      throw new Error("this app does not support server rendering!");
    }
    this._window = document.defaultView;
    this._deviceDetectorService = inject(DeviceDetectorService);
    this._customActionsService = inject(CustomActionsService);
    this._settingsService = inject(SettingsService);
    this._visibilityService = inject(VisibilityService);
    this._$roonState = signal(
      {
        state: RoonState.STARTING,
        zones: [],
        outputs: [],
      },
      {
        equal: deepEqual,
      }
    );
    this._$isGrouping = signal(false);
    this._commandCallbacks = new Map<string, CommandCallback>();
    this._zoneStates = new Map<
      string,
      {
        $zone?: WritableSignal<ZoneState>;
        $queue?: WritableSignal<QueueState>;
      }
    >();
    this._isStarted = false;
    this._apiStringCallbacks = new Map<number, ApiResultCallback<string>>();
    this._apiBrowseCallbacks = new Map<number, ApiResultCallback<RoonApiBrowseResponse>>();
    this._apiLoadCallbacks = new Map<number, ApiResultCallback<RoonApiBrowseLoadResponse>>();
    this._apiFoundItemIndexCallbacks = new Map<number, ApiResultCallback<FoundItemIndexResponse>>();
    this._apiAISearchCallbacks = new Map<number, ApiResultCallback<AISearchResponse>>();
    this._apiPlayTracksCallbacks = new Map<
      number,
      { resolve: (value: AISearchResponse) => void; reject: (reason: Error | string) => void }
    >();
    this._apiTrackStoryCallbacks = new Map<number, ApiResultCallback<AITrackStoryResponse>>();
    this._apiTranscriptionCallbacks = new Map<number, ApiResultCallback<TranscriptionResponse>>();
    this._workerApiRequestId = 0;
    this._version = "unknown";
  }

  start: () => Promise<void> = async () => {
    const startPromise = new Promise<void>((resolve) => {
      this._startResolve = resolve;
    });
    this._worker = buildRoonWorker();
    this._worker.onmessage = (m: MessageEvent<RawWorkerEvent>) => {
      this.dispatchWorkerEvent(m);
    };
    const isDesktop = this._deviceDetectorService.isDesktop() && !this._deviceDetectorService.isTablet();
    const roonClientId = this._settingsService.roonClientId();
    const startMessage: WorkerClientActionMessage = {
      event: "worker-client",
      data: {
        action: "start-client",
        url: this._window.location.href,
        isDesktop,
        roonClientId,
      },
    };
    this._worker.postMessage(startMessage);
    try {
      await startPromise;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("error during app startup");
      throw err;
    }
    const id = this.nextWorkerApiRequestId();
    const apiRequest: VersionWorkerApiRequest = {
      id,
      type: "version",
      data: undefined,
    };
    const versionPromise = new Promise<void>((resolve) => {
      this._startResolve = resolve;
    });
    const apiResultCallback: ApiResultCallback<string> = {
      next: (versionApiResult) => {
        this._version = versionApiResult;
        if (this._startResolve) {
          this._startResolve();
          delete this._startResolve;
          this._visibilityService.listen((visibilityState: VisibilityState) => {
            if (visibilityState === VisibilityState.VISIBLE) {
              this.refresh();
            }
          });
        }
      },
    };
    this._apiStringCallbacks.set(id, apiResultCallback);
    this._worker.postMessage({
      event: "worker-api",
      data: apiRequest,
    });
    return versionPromise;
  };

  roonState: () => Signal<ApiState> = () => {
    return this._$roonState;
  };

  zoneState: ($zoneId: Signal<string>) => Signal<ZoneState> = ($zoneId: Signal<string>) => {
    this.ensureStarted();
    return computed(() => {
      const zs = this._zoneStates.get($zoneId());
      if (zs?.$zone) {
        return zs.$zone();
      } else {
        // FIXME: this is very dangerous (possible memoization of an Error)
        // find a better to handle this (especially because it should never happen)
        throw new Error(RoonService.THIS_IS_A_BUG_ERROR_MSG);
      }
    });
  };

  queueState: ($zoneId: Signal<string>) => Signal<QueueState> = ($zoneId: Signal<string>) => {
    this.ensureStarted();
    return computed(() => {
      const zs = this._zoneStates.get($zoneId());
      if (zs?.$queue) {
        return zs.$queue();
      } else {
        // FIXME: this is very dangerous (possible memoization of an Error)
        // find a better to handle this (especially because it should never happen)
        throw new Error(RoonService.THIS_IS_A_BUG_ERROR_MSG);
      }
    });
  };

  command: (command: Command, commandCallback?: CommandCallback) => void = (
    command: Command,
    commandCallback?: CommandCallback
  ) => {
    const worker = this.ensureStarted();
    const id = this.nextWorkerApiRequestId();
    const apiRequest: CommandWorkerApiRequest = {
      type: "command",
      id,
      data: command,
    };
    if (commandCallback) {
      const apiResultCallback: ApiResultCallback<string> = {
        next: (command_id: string) => {
          this._commandCallbacks.set(command_id, commandCallback);
        },
      };
      this._apiStringCallbacks.set(id, apiResultCallback);
    }
    worker.postMessage({
      event: "worker-api",
      data: apiRequest,
    });
  };

  loadPath: (zone_id: string, path: RoonPath) => Observable<RoonApiBrowseLoadResponse> = (
    zone_id: string,
    path: RoonPath
  ) => {
    const worker = this.ensureStarted();
    const apiRequest: LoadPathWorkerApiRequest = {
      id: this.nextWorkerApiRequestId(),
      type: "load-path",
      data: {
        zone_id,
        path,
      },
    };
    return this.buildLoadResponseObservable(worker, apiRequest);
  };

  previous: (
    zone_id: string,
    hierarchy: RoonApiBrowseHierarchy,
    levels: number,
    offset: number
  ) => Observable<RoonApiBrowseLoadResponse> = (
    zone_id: string,
    hierarchy: RoonApiBrowseHierarchy,
    levels: number,
    offset: number
  ) => {
    const worker = this.ensureStarted();
    const apiRequest: PreviousWorkerApiRequest = {
      id: this.nextWorkerApiRequestId(),
      type: "previous",
      data: {
        levels,
        zone_id,
        hierarchy,
        offset,
      },
    };
    return this.buildLoadResponseObservable(worker, apiRequest);
  };

  navigate: (
    zone_id: string,
    hierarchy: RoonApiBrowseHierarchy,
    item_key?: string,
    input?: string
  ) => Observable<RoonApiBrowseLoadResponse> = (
    zone_id: string,
    hierarchy: RoonApiBrowseHierarchy,
    item_key?: string,
    input?: string
  ) => {
    const worker = this.ensureStarted();
    const apiRequest: NavigateWorkerApiRequest = {
      id: this.nextWorkerApiRequestId(),
      type: "navigate",
      data: {
        item_key,
        hierarchy,
        zone_id,
        input,
      },
    };
    return this.buildLoadResponseObservable(worker, apiRequest);
  };

  browse: (options: ClientRoonApiBrowseOptions) => Promise<RoonApiBrowseResponse> = (options) => {
    const worker = this.ensureStarted();
    const id = this.nextWorkerApiRequestId();
    const apiRequest: BrowseWorkerApiRequest = {
      id,
      type: "browse",
      data: options,
    };
    return new Promise((resolve, reject) => {
      const apiResultCallback: ApiResultCallback<RoonApiBrowseResponse> = {
        next: (browseApiResult) => {
          resolve(browseApiResult);
        },
        error: (error) => {
          if (error instanceof Error) {
            reject(error);
          } else {
            reject(new Error("unknown error"));
          }
        },
      };
      this._apiBrowseCallbacks.set(id, apiResultCallback);
      worker.postMessage({
        event: "worker-api",
        data: apiRequest,
      });
    });
  };

  load: (options: ClientRoonApiBrowseLoadOptions) => Promise<RoonApiBrowseLoadResponse> = (options) => {
    const worker = this.ensureStarted();
    const id = this.nextWorkerApiRequestId();
    const apiRequest: LoadWorkerApiRequest = {
      id,
      type: "load",
      data: options,
    };
    return new Promise((resolve, reject) => {
      const apiResultCallback: ApiResultCallback<RoonApiBrowseLoadResponse> = {
        next: (browseApiResult) => {
          resolve(browseApiResult);
        },
        error: (error) => {
          if (error instanceof Error) {
            reject(error);
          } else {
            reject(new Error("unknown error"));
          }
        },
      };
      this._apiLoadCallbacks.set(id, apiResultCallback);
      worker.postMessage({
        event: "worker-api",
        data: apiRequest,
      });
    });
  };

  findItemIndex: (itemIndexSearch: ItemIndexSearch) => Promise<FoundItemIndexResponse> = (
    itemIndexSearch: ItemIndexSearch
  ) => {
    const worker = this.ensureStarted();
    const id = this.nextWorkerApiRequestId();
    const apiRequest: FindItemIndexWorkerApiRequest = {
      id,
      type: "find-item-index",
      data: {
        itemIndexSearch,
      },
    };
    return new Promise((resolve, reject) => {
      const apiResultCallback: ApiResultCallback<FoundItemIndexResponse> = {
        next: (foundItemIndexResponse) => {
          resolve(foundItemIndexResponse);
        },
        error: (error) => {
          if (error instanceof Error) {
            reject(error);
          } else {
            reject(new Error("unknown error"));
          }
        },
      };
      this._apiFoundItemIndexCallbacks.set(id, apiResultCallback);
      worker.postMessage({
        event: "worker-api",
        data: apiRequest,
      });
    });
  };

  version: () => string = () => {
    return this._version;
  };

  registerOutputCallback: (callback: OutputCallback) => void = (callback: OutputCallback) => {
    this._outputCallback = callback;
  };

  startGrouping() {
    this._$isGrouping.set(true);
  }

  endGrouping() {
    this._$isGrouping.set(false);
  }

  isGrouping(): Signal<boolean> {
    return this._$isGrouping;
  }

  playTracks: (tracks: SuggestedTrack[]) => Promise<AISearchResponse> = (tracks) => {
    const worker = this.ensureStarted(); // Ensure the worker is started
    const id = this.nextWorkerApiRequestId(); // Generate a new request ID
    const currentZoneId = this._settingsService.displayedZoneId()(); // Get the current zone ID

    const apiRequest: PlayTracksWorkerApiRequest = {
      id,
      type: "play-tracks",
      data: { zoneId: currentZoneId, tracks: tracks }, // Construct the API request payload
    };

    // Call the Promise-based buildPlayTracksResponsePromise method
    return this.buildPlayTracksResponsePromise(worker, apiRequest);
  };

  aiSearch: (query: string) => Observable<AISearchResponse> = (query) => {
    const worker = this.ensureStarted(); // Ensure the worker is started
    const id = this.nextWorkerApiRequestId(); // Get the next request ID

    const apiRequest: RawWorkerApiRequest = {
      id,
      type: "ai-search", // Specify the type of request
      data: { query }, // Pass the query as data
    };
    return this.buildAISearchResponseObservable(worker, apiRequest);
  };

  aiGetTrackStory: (track: SuggestedTrack) => Observable<AITrackStoryResponse> = (track) => {
    const worker = this.ensureStarted();
    const id = this.nextWorkerApiRequestId();
    const apiRequest: TrackStoryWorkerApiRequest = {
      id,
      type: "track-story",
      data: { track },
    };
    return this.buildTrackStoryResponseResponseObservable(worker, apiRequest);
  };

  transcribeAudio: (audioBlob: Blob) => Promise<string> = (audioBlob) => {
    const worker = this.ensureStarted();
    const id = this.nextWorkerApiRequestId();
    const apiRequest: TranscriptionWorkerApiRequest = {
      id,
      type: "transcribe",
      data: { audio: audioBlob },
    };
    return new Promise((resolve, reject) => {
      const apiResultCallback: ApiResultCallback<TranscriptionResponse> = {
        next: (response) => {
          resolve(response.text);
        },
        error: (error) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      };
      this._apiTranscriptionCallbacks.set(apiRequest.id, apiResultCallback);
      worker.postMessage({
        event: "worker-api",
        data: apiRequest,
      });
    });
  };

  searchAlbums: (zoneId: string, query: string) => Promise<SearchAlbumsResponse> = (zoneId, query) => {
    const worker = this.ensureStarted();
    const id = this.nextWorkerApiRequestId();
    const apiRequest: SearchAlbumsWorkerApiRequest = {
      id,
      type: "search-albums",
      data: { zoneId, query },
    };
    return new Promise((resolve, reject) => {
      const apiResultCallback: ApiResultCallback<SearchAlbumsResponse> = {
        next: (response) => {
          resolve(response);
        },
        error: (error) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      };
      this._apiSearchAlbumsCallbacks.set(id, apiResultCallback);
      worker.postMessage({
        event: "worker-api",
        data: apiRequest,
      });
    });
  };

  playItem: (zoneId: string, itemKey: string, actionTitle: string) => Promise<void> = (
    zoneId,
    itemKey,
    actionTitle
  ) => {
    const worker = this.ensureStarted();
    const id = this.nextWorkerApiRequestId();
    const apiRequest: PlayItemWorkerApiRequest = {
      id,
      type: "play-item",
      data: { zoneId, itemKey, actionTitle },
    };
    return new Promise((resolve, reject) => {
      const apiResultCallback: ApiResultCallback<undefined> = {
        next: () => {
          resolve();
        },
        error: (error) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      };
      this._apiPlayItemCallbacks.set(id, apiResultCallback);
      worker.postMessage({
        event: "worker-api",
        data: apiRequest,
      });
    });
  };

  recognizeAlbum: (request: AlbumRecognitionRequest) => Promise<AlbumRecognitionResponse> = (request) => {
    const worker = this.ensureStarted();
    const id = this.nextWorkerApiRequestId();
    const apiRequest: RecognizeAlbumWorkerApiRequest = {
      id,
      type: "recognize-album",
      data: request,
    };
    return new Promise((resolve, reject) => {
      const apiResultCallback: ApiResultCallback<AlbumRecognitionResponse> = {
        next: (response) => {
          resolve(response);
        },
        error: (error) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      };
      this._apiRecognizeAlbumCallbacks.set(id, apiResultCallback);
      worker.postMessage({
        event: "worker-api",
        data: apiRequest,
      });
    });
  };

  private reconnect: () => void = () => {
    if (this._worker) {
      const message: WorkerClientActionMessage = {
        event: "worker-client",
        data: {
          action: "restart-client",
        },
      };
      this._worker.postMessage(message);
    }
  };

  private refresh: () => void = () => {
    if (this._worker) {
      const message: WorkerClientActionMessage = {
        event: "worker-client",
        data: {
          action: "refresh-client",
        },
      };
      this._worker.postMessage(message);
    }
  };

  private ensureStarted(): Worker {
    if (!this._isStarted || !this._worker) {
      throw new Error("you must wait for RoonService#start to complete before calling any other methods");
    }
    return this._worker;
  }

  private dispatchWorkerEvent(m: MessageEvent<RawWorkerEvent>) {
    switch (m.data.event) {
      case "state":
        this.onRoonState(m.data.data);
        break;
      case "zone":
        this.onZoneState(m.data.data);
        break;
      case "queue":
        this.onQueueState(m.data.data);
        break;
      case "command":
        this.onCommandState(m.data.data);
        break;
      case "clientState":
        this.onClientState(m.data.data);
        break;
      case "config":
        this.onSharedConfig(m.data.data);
        break;
      case "apiResult":
        this.onApiResult(m.data.data);
        break;
    }
  }

  private onRoonState(state: ApiState) {
    this._$roonState.set(state);
    if (state.state === RoonState.SYNC) {
      if (this._outputCallback) {
        this._outputCallback(state.outputs);
        delete this._outputCallback;
      }
    } else if (state.state === RoonState.STOPPED) {
      this.reconnect();
    }
  }

  private onZoneState(state: ZoneState) {
    const zs = this._zoneStates.get(state.zone_id);
    if (zs) {
      if (zs.$zone) {
        zs.$zone.set(state);
      } else {
        zs.$zone = signal(state);
      }
    } else {
      this._zoneStates.set(state.zone_id, {
        $zone: signal(state),
      });
    }
  }

  private onQueueState(state: QueueState) {
    const zs = this._zoneStates.get(state.zone_id);
    if (zs) {
      if (zs.$queue) {
        zs.$queue.set(state);
      } else {
        zs.$queue = signal(state);
      }
    } else {
      this._zoneStates.set(state.zone_id, {
        $queue: signal(state),
      });
    }
  }

  private onCommandState(notification: CommandState) {
    const commandCallback = this._commandCallbacks.get(notification.command_id);
    if (commandCallback) {
      this._commandCallbacks.delete(notification.command_id);
      commandCallback(notification);
    }
  }

  private onClientState(clientState: ClientState) {
    switch (clientState.status) {
      case "outdated":
        this._window.location.reload();
        break;
      case "started":
      case "not-started":
        if (this._startResolve) {
          if (clientState.status === "not-started") {
            // eslint-disable-next-line no-console
            console.error("startup failed, is roon-web-stack-extension enabled in roon settings?");
          } else if (clientState.roonClientId) {
            this._settingsService.saveRoonClientId(clientState.roonClientId);
          }
          this._isStarted = true;
          this._startResolve();
          delete this._startResolve;
        }
        break;
    }
  }

  private onSharedConfig(sharedConfig: SharedConfig) {
    this._customActionsService.updateCustomActions(sharedConfig.customActions);
  }

  private onApiResult(apiResultEvent: RawApiResult) {
    switch (apiResultEvent.type) {
      case "browse":
        this.onBrowseApiResult(apiResultEvent);
        break;
      case "command":
        this.onStringApiResult(apiResultEvent);
        break;
      case "load":
        this.onLoadApiResult(apiResultEvent);
        break;
      case "version":
        this.onStringApiResult(apiResultEvent);
        break;
      case "found-item-index":
        this.onNumberApiResult(apiResultEvent);
        break;
      case "ai-search": // New hook for AI Search
        this.onAISearchApiResult(apiResultEvent);
        break;
      case "play-tracks": // New hook for AI Search
        this.onPlayTracksApiResult(apiResultEvent);
        break;
      case "track-story":
        this.onTrackStoryApiResult(apiResultEvent);
        break;
      case "transcribe":
        this.onTranscriptionApiResult(apiResultEvent);
        break;
      case "search-albums":
        this.onSearchAlbumsApiResult(apiResultEvent);
        break;
      case "play-item":
        this.onPlayItemApiResult(apiResultEvent);
        break;
      case "recognize-album":
        this.onRecognizeAlbumApiResult(apiResultEvent);
        break;
    }
  }

  private onBrowseApiResult(apiResult: BrowseApiResult) {
    const callback = this._apiBrowseCallbacks.get(apiResult.id);
    if (callback) {
      if (apiResult.data) {
        callback.next(apiResult.data);
      } else if (apiResult.error && callback.error) {
        callback.error(apiResult.error);
      }
      this._apiBrowseCallbacks.delete(apiResult.id);
    }
  }

  private onLoadApiResult(apiResult: LoadApiResult) {
    const callback = this._apiLoadCallbacks.get(apiResult.id);
    if (callback) {
      if (apiResult.data) {
        callback.next(apiResult.data);
      } else if (apiResult.error && callback.error) {
        callback.error(apiResult.error);
      }
      this._apiLoadCallbacks.delete(apiResult.id);
    }
  }

  private onStringApiResult(apiResult: CommandApiResult | VersionApiResult) {
    const callback = this._apiStringCallbacks.get(apiResult.id);
    if (callback) {
      if (apiResult.data) {
        callback.next(apiResult.data);
      } else if (apiResult.error && callback.error) {
        const errorStr = apiResult.error instanceof Error ? apiResult.error.message : String(apiResult.id);
        callback.error(errorStr);
      }
      this._apiStringCallbacks.delete(apiResult.id);
    }
  }

  private onNumberApiResult(apiResult: FoundItemIndexApiResult) {
    const callback = this._apiFoundItemIndexCallbacks.get(apiResult.id);
    if (callback) {
      if (apiResult.data !== undefined) {
        callback.next(apiResult.data);
      } else if (apiResult.error && callback.error) {
        callback.error(apiResult.error);
      }
      this._apiFoundItemIndexCallbacks.delete(apiResult.id);
    }
  }

  private onAISearchApiResult(apiResult: AISearchApiResult) {
    const callback = this._apiAISearchCallbacks.get(apiResult.id);
    if (callback) {
      if (apiResult.data) {
        callback.next(apiResult.data); // Send the result to the callback
      } else if (apiResult.error && callback.error) {
        const errorStr = apiResult.error instanceof Error ? apiResult.error.message : String(apiResult.id);
        callback.error(errorStr);
      }
      this._apiStringCallbacks.delete(apiResult.id); // Cleanup the callback
    }
  }

  private onPlayTracksApiResult(apiResult: PlayTracksApiResult) {
    const handlers = this._apiPlayTracksCallbacks.get(apiResult.id);
    if (handlers) {
      if (apiResult.data) {
        handlers.resolve(apiResult.data); // Resolve the promise
      } else if (apiResult.error) {
        const error =
          apiResult.error instanceof Error
            ? apiResult.error
            : new Error(
                typeof apiResult.error === "string" ? apiResult.error : JSON.stringify(apiResult.error, null, 2)
              );
        handlers.reject(error); // Reject the promise
      }
      this._apiPlayTracksCallbacks.delete(apiResult.id); // Cleanup
    }
  }

  private onTrackStoryApiResult(apiResult: TrackStoryApiResult) {
    const callback = this._apiTrackStoryCallbacks.get(apiResult.id);
    if (callback) {
      if (apiResult.data) {
        callback.next(apiResult.data);
      } else if (callback.error) {
        callback.error(apiResult.error || new Error("No data received"));
      }
      this._apiTrackStoryCallbacks.delete(apiResult.id);
    }
  }

  private onTranscriptionApiResult(apiResult: TranscriptionApiResult) {
    const callback = this._apiTranscriptionCallbacks.get(apiResult.id);
    if (callback) {
      if (apiResult.data) {
        callback.next(apiResult.data);
      } else if (callback.error) {
        callback.error(apiResult.error || new Error("No data received"));
      }
      this._apiTranscriptionCallbacks.delete(apiResult.id);
    }
  }

  private onSearchAlbumsApiResult(apiResult: SearchAlbumsApiResult) {
    const callback = this._apiSearchAlbumsCallbacks.get(apiResult.id);
    if (callback) {
      if (apiResult.data) {
        callback.next(apiResult.data);
      } else if (callback.error) {
        callback.error(apiResult.error || new Error("No data received"));
      }
      this._apiSearchAlbumsCallbacks.delete(apiResult.id);
    }
  }

  private onPlayItemApiResult(apiResult: PlayItemApiResult) {
    const callback = this._apiPlayItemCallbacks.get(apiResult.id);
    if (callback) {
      if (apiResult.error) {
        if (callback.error) {
          callback.error(apiResult.error);
        }
      } else {
        callback.next(undefined);
      }
      this._apiPlayItemCallbacks.delete(apiResult.id);
    }
  }

  private onRecognizeAlbumApiResult(apiResult: RecognizeAlbumApiResult) {
    const callback = this._apiRecognizeAlbumCallbacks.get(apiResult.id);
    if (callback) {
      if (apiResult.data) {
        callback.next(apiResult.data);
      } else if (callback.error) {
        callback.error(apiResult.error || new Error("No data received"));
      }
      this._apiRecognizeAlbumCallbacks.delete(apiResult.id);
    }
  }

  private buildLoadResponseObservable(worker: Worker, apiRequest: RawWorkerApiRequest) {
    return new Observable<RoonApiBrowseLoadResponse>((subscriber) => {
      const apiResultCallback: ApiResultCallback<RoonApiBrowseLoadResponse> = {
        next: (loadResponse) => {
          subscriber.next(loadResponse);
          subscriber.complete();
        },
        error: (error) => {
          subscriber.error(error);
          subscriber.complete();
        },
      };
      this._apiLoadCallbacks.set(apiRequest.id, apiResultCallback);
      worker.postMessage({
        event: "worker-api",
        data: apiRequest,
      });
    });
  }

  private buildAISearchResponseObservable(worker: Worker, apiRequest: RawWorkerApiRequest) {
    return new Observable<AISearchResponse>((subscriber) => {
      const apiResultCallback: ApiResultCallback<AISearchResponse> = {
        next: (response) => {
          subscriber.next(response); // Emit the response
          subscriber.complete(); // Mark observable as complete
        },
        error: (error) => {
          subscriber.error(error); // Emit the error
          subscriber.complete();
        },
      };
      // Store the callback for response handling
      this._apiAISearchCallbacks.set(apiRequest.id, apiResultCallback);
      // Post the request to the worker
      worker.postMessage({
        event: "worker-api",
        data: apiRequest,
      });
    });
  }

  private buildPlayTracksResponsePromise(worker: Worker, apiRequest: RawWorkerApiRequest): Promise<AISearchResponse> {
    return new Promise<AISearchResponse>((resolve, reject) => {
      // Store the resolve and reject callbacks
      this._apiPlayTracksCallbacks.set(apiRequest.id, {
        resolve: (data: AISearchResponse) => {
          // if tracks are returned they are missing so log them
          if (data.items.length) {
            // eslint-disable-next-line no-console
            console.log("Missing tracks:", JSON.stringify(data.items, null, 2));
          }
          resolve(data);
        },
        reject: (error: unknown) => {
          reject(error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error)));
        },
      });

      // Post the request to the worker
      worker.postMessage({
        event: "worker-api",
        data: apiRequest,
      });
    });
  }

  private buildTrackStoryResponseResponseObservable(worker: Worker, apiRequest: RawWorkerApiRequest) {
    return new Observable<AITrackStoryResponse>((subscriber) => {
      const apiResultCallback: ApiResultCallback<AITrackStoryResponse> = {
        next: (response) => {
          subscriber.next(response);
          subscriber.complete();
        },
        error: (error) => {
          subscriber.error(error);
          subscriber.complete();
        },
      };
      this._apiTrackStoryCallbacks.set(apiRequest.id, apiResultCallback);
      worker.postMessage({
        event: "worker-api",
        data: apiRequest,
      });
    });
  }

  private buildTranscriptionResponseObservable(worker: Worker, apiRequest: RawWorkerApiRequest) {
    return new Observable<TranscriptionResponse>((subscriber) => {
      const apiResultCallback: ApiResultCallback<TranscriptionResponse> = {
        next: (response) => {
          subscriber.next(response);
          subscriber.complete();
        },
        error: (error) => {
          subscriber.error(error);
          subscriber.complete();
        },
      };
      this._apiTranscriptionCallbacks.set(apiRequest.id, apiResultCallback);
      worker.postMessage({
        event: "worker-api",
        data: apiRequest,
      });
    });
  }

  private nextWorkerApiRequestId() {
    return this._workerApiRequestId++;
  }
}
