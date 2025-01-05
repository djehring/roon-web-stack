import { MatDialogConfig } from "@angular/material/dialog";
import { RoonApiBrowseHierarchy, RoonPath, SuggestedTrack } from "@model";

// app/roon-web-ng-client/src/app/model/action.model.ts

export enum ActionType {
  LOAD = "LOAD",
  QUEUE = "QUEUE",
  CUSTOM = "CUSTOM",
  AI_SEARCH = "AI_SEARCH",
  AI_TRACK_STORY = "AI_TRACK_STORY",
}

export interface AISearchAction {
  id: string;
  button: ActionButton;
  type: ActionType.AI_SEARCH;
  query: string;
}

export interface AITrackStoryAction {
  id: string;
  button: ActionButton;
  type: ActionType.AI_TRACK_STORY;
  track: SuggestedTrack;
}

export interface ActionButton {
  label: string;
  icon: string;
}

export interface SharedCustomActions {
  id: string;
  label: string;
  icon: string;
  roonPath: RoonPath;
  actionIndex?: number;
}

export interface CustomAction {
  id: string;
  button: ActionButton;
  type: ActionType.CUSTOM;
  path: RoonPath;
  actionIndex?: number;
}

export interface EditedCustomAction {
  id: string;
  label?: string;
  icon?: string;
  hierarchy?: RoonApiBrowseHierarchy;
  path: string[];
  actionIndex?: number;
}

export interface RecordedAction {
  title: string;
  actionIndex: number;
}

export type Action = LoadAction | QueueAction | CustomAction | AISearchAction | AITrackStoryAction; // Update the union type

export interface LoadAction {
  button: ActionButton;
  id: string;
  type: ActionType.LOAD;
  path: RoonPath;
}

export const AlbumsAction: LoadAction = {
  id: "albums-action",
  type: ActionType.LOAD,
  path: {
    hierarchy: "albums",
    path: [],
  },
  button: {
    label: "Albums",
    icon: "album",
  },
};

export const ArtistsAction: LoadAction = {
  id: "artists-action",
  type: ActionType.LOAD,
  path: {
    hierarchy: "artists",
    path: [],
  },
  button: {
    label: "Artists",
    icon: "artist",
  },
};

export const AISearchAction: AISearchAction = {
  id: "ai-search-action",
  type: ActionType.AI_SEARCH,
  query: "search query",
  button: {
    label: "AI Search",
    icon: "search",
  },
};

export const BrowseAction: LoadAction = {
  id: "browse-action",
  type: ActionType.LOAD,
  path: {
    hierarchy: "browse",
    path: [],
  },
  button: {
    label: "Browse",
    icon: "explore",
  },
};

export const ComposersAction: LoadAction = {
  id: "composers-action",
  type: ActionType.LOAD,
  path: {
    hierarchy: "composers",
    path: [],
  },
  button: {
    label: "Composers",
    icon: "music_note",
  },
};

export const GenresAction: LoadAction = {
  id: "genres-action",
  type: ActionType.LOAD,
  path: {
    hierarchy: "genres",
    path: [],
  },
  button: {
    label: "Genres",
    icon: "theater_comedy",
  },
};

export const LibraryAction: LoadAction = {
  id: "library-action",
  type: ActionType.LOAD,
  path: {
    hierarchy: "browse",
    path: ["Library"],
  },
  button: {
    label: "Library",
    icon: "list_alt",
  },
};

export const PlaylistsAction: LoadAction = {
  id: "playlists-action",
  type: ActionType.LOAD,
  path: {
    hierarchy: "playlists",
    path: [],
  },
  button: {
    label: "Playlists",
    icon: "featured_play_list",
  },
};

export const RadiosAction: LoadAction = {
  id: "radios-action",
  type: ActionType.LOAD,
  path: {
    hierarchy: "internet_radio",
    path: [],
  },
  button: {
    label: "Radios",
    icon: "radio",
  },
};

export interface QueueAction {
  button: ActionButton;
  id: string;
  type: ActionType.QUEUE;
}

export const ToggleQueueAction: QueueAction = {
  button: {
    label: "Queue",
    icon: "queue_music",
  },
  id: "toggle-queue-action",
  type: ActionType.QUEUE,
};

export const AITrackStoryAction: AITrackStoryAction = {
  id: "ai-track-story-action",
  type: ActionType.AI_TRACK_STORY,
  button: {
    label: "Track Story",
    icon: "info",
  },
  track: {
    artist: "",
    track: "",
  },
};

export const DefaultActions: Action[] = [
  AlbumsAction,
  AISearchAction,
  ArtistsAction,
  BrowseAction,
  ComposersAction,
  GenresAction,
  LibraryAction,
  PlaylistsAction,
  RadiosAction,
  ToggleQueueAction,
];

export const CustomActionsManagerDialogConfig: MatDialogConfig = {
  restoreFocus: false,
  autoFocus: false,
  width: "500px",
  maxWidth: "95svw",
  maxHeight: "95svh",
  position: {
    top: "5svh",
  },
  data: {
    reset: false,
  },
};

export const CustomActionsManagerDialogConfigBigFonts: MatDialogConfig = {
  ...CustomActionsManagerDialogConfig,
  width: "800px",
};
