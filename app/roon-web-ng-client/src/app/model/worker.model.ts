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
  SearchAlbumsResponse,
  SharedConfig,
  SuggestedTrack,
  TranscriptionResponse,
  ZoneState,
} from "@model";

export type WorkerMessageData =
  | WorkerClientStartAction
  | WorkerClientRefreshAction
  | WorkerClientStopAction
  | WorkerClientRestartAction
  | RawWorkerApiRequest;

export interface WorkerMessage<T extends WorkerMessageData> {
  data: T;
}

export interface WorkerClientStartAction {
  action: "start-client";
  url: string;
  isDesktop: boolean;
  roonClientId?: string;
}

export interface WorkerClientRefreshAction {
  action: "refresh-client";
}

export interface WorkerClientStopAction {
  action: "stop-client";
}

export interface WorkerClientRestartAction {
  action: "restart-client";
}

export type WorkerClientAction =
  | WorkerClientStartAction
  | WorkerClientRefreshAction
  | WorkerClientStopAction
  | WorkerClientRestartAction;

export interface WorkerClientActionMessage extends WorkerMessage<WorkerClientAction> {
  event: "worker-client";
}

export interface WorkerApiRequest<T> {
  data: T;
  id: number;
}

export interface BrowseWorkerApiRequest extends WorkerApiRequest<ClientRoonApiBrowseOptions> {
  type: "browse";
}

export interface PlayTracksWorkerApiRequest extends WorkerApiRequest<{ zoneId: string; tracks: SuggestedTrack[] }> {
  type: "play-tracks";
}

export interface LoadWorkerApiRequest extends WorkerApiRequest<ClientRoonApiBrowseLoadOptions> {
  type: "load";
}

export interface VersionWorkerApiRequest extends WorkerApiRequest<void> {
  type: "version";
}

export interface CommandWorkerApiRequest extends WorkerApiRequest<Command> {
  type: "command";
}

export interface LoadPathWorkerApiRequest extends WorkerApiRequest<{ zone_id: string; path: RoonPath }> {
  type: "load-path";
}

export interface PreviousWorkerApiRequest
  extends WorkerApiRequest<{ zone_id: string; hierarchy: RoonApiBrowseHierarchy; levels: number; offset: number }> {
  type: "previous";
}

export interface NavigateWorkerApiRequest
  extends WorkerApiRequest<{ zone_id: string; hierarchy: RoonApiBrowseHierarchy; item_key?: string; input?: string }> {
  type: "navigate";
}

export interface FindItemIndexWorkerApiRequest extends WorkerApiRequest<{ itemIndexSearch: ItemIndexSearch }> {
  type: "find-item-index";
}

export interface AISearchWorkerApiRequest extends WorkerApiRequest<{ query: string }> {
  type: "ai-search";
}

export interface TrackStoryWorkerApiRequest extends WorkerApiRequest<{ track: SuggestedTrack }> {
  type: "track-story";
}

export interface TranscriptionWorkerApiRequest extends WorkerApiRequest<{ audio: Blob }> {
  type: "transcribe";
}

export interface SearchAlbumsWorkerApiRequest extends WorkerApiRequest<{ zoneId: string; query: string }> {
  type: "search-albums";
}

export interface PlayItemWorkerApiRequest
  extends WorkerApiRequest<{ zoneId: string; itemKey: string; actionTitle: string }> {
  type: "play-item";
}

export interface RecognizeAlbumWorkerApiRequest extends WorkerApiRequest<AlbumRecognitionRequest> {
  type: "recognize-album";
}

export type RawWorkerApiRequest =
  | BrowseWorkerApiRequest
  | LoadWorkerApiRequest
  | VersionWorkerApiRequest
  | CommandWorkerApiRequest
  | LoadPathWorkerApiRequest
  | PreviousWorkerApiRequest
  | NavigateWorkerApiRequest
  | FindItemIndexWorkerApiRequest
  | AISearchWorkerApiRequest
  | PlayTracksWorkerApiRequest
  | TrackStoryWorkerApiRequest
  | TranscriptionWorkerApiRequest
  | SearchAlbumsWorkerApiRequest
  | PlayItemWorkerApiRequest
  | RecognizeAlbumWorkerApiRequest;

export interface WorkerApiRequestMessage extends WorkerMessage<RawWorkerApiRequest> {
  event: "worker-api";
}

export type WorkerActionMessage = WorkerClientActionMessage | WorkerApiRequestMessage;

export interface WorkerEvent<T> {
  data: T;
}

export interface ApiStateWorkerEvent extends WorkerEvent<ApiState> {
  event: "state";
}

export interface ZoneStateWorkerEvent extends WorkerEvent<ZoneState> {
  event: "zone";
}

export interface QueueStateWorkerEvent extends WorkerEvent<QueueState> {
  event: "queue";
}

export interface CommandStateWorkerEvent extends WorkerEvent<CommandState> {
  event: "command";
}

export interface ClientStateWorkerEvent extends WorkerEvent<ClientState> {
  event: "clientState";
}

export interface SharedConfigWorkerEvent extends WorkerEvent<SharedConfig> {
  event: "config";
}

export type RawWorkerEvent =
  | ApiStateWorkerEvent
  | ZoneStateWorkerEvent
  | QueueStateWorkerEvent
  | CommandStateWorkerEvent
  | ClientStateWorkerEvent
  | ApiResultWorkerEvent
  | SharedConfigWorkerEvent;

export interface ApiResult<T> {
  data?: T;
  error?: unknown;
  id: number;
}

export interface BrowseApiResult extends ApiResult<RoonApiBrowseResponse> {
  type: "browse";
}

export interface LoadApiResult extends ApiResult<RoonApiBrowseLoadResponse> {
  type: "load";
}

export interface CommandApiResult extends ApiResult<string> {
  type: "command";
}

export interface VersionApiResult extends ApiResult<string> {
  type: "version";
}

export interface FoundItemIndexApiResult extends ApiResult<FoundItemIndexResponse> {
  type: "found-item-index";
}

export interface AISearchApiResult extends ApiResult<AISearchResponse> {
  type: "ai-search";
}

export interface PlayTracksApiResult extends ApiResult<AISearchResponse> {
  type: "play-tracks";
}

export interface TrackStoryApiResult extends ApiResult<AITrackStoryResponse> {
  type: "track-story";
}

export interface TranscriptionApiResult extends ApiResult<TranscriptionResponse> {
  type: "transcribe";
}

export interface SearchAlbumsApiResult extends ApiResult<SearchAlbumsResponse> {
  type: "search-albums";
}

export interface PlayItemApiResult extends ApiResult<void> {
  type: "play-item";
}

export interface RecognizeAlbumApiResult extends ApiResult<AlbumRecognitionResponse> {
  type: "recognize-album";
}

export type RawApiResult =
  | BrowseApiResult
  | LoadApiResult
  | CommandApiResult
  | VersionApiResult
  | FoundItemIndexApiResult
  | AISearchApiResult
  | PlayTracksApiResult
  | TrackStoryApiResult
  | TranscriptionApiResult
  | SearchAlbumsApiResult
  | PlayItemApiResult
  | RecognizeAlbumApiResult;

export interface ApiResultWorkerEvent extends WorkerEvent<RawApiResult> {
  event: "apiResult";
}

export interface ApiResultCallback<
  U extends
    | string
    | number
    | undefined
    | RoonApiBrowseResponse
    | RoonApiBrowseLoadResponse
    | AISearchResponse
    | AITrackStoryResponse
    | TranscriptionResponse
    | SearchAlbumsResponse
    | AlbumRecognitionResponse,
> {
  next: (u: U) => void;
  error?: (error: unknown) => void;
}
