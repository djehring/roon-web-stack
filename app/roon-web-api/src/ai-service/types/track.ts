import type { CinemaMusicPath } from "../../service/cinema-music-model";

export interface Track {
  roonPath?: CinemaMusicPath;
  matchPolicy?: "exact";
  imageKey?: string;
  artist: string;
  track: string;
  album: string;
  error?: string; // Optional error message when track can't be found
  wasAutoCorrected?: boolean; // Indicates if the album was automatically corrected
  correctionMessage?: string; // Information message about auto-correction
}

export interface TrackStory {
  title: string;
  content: string;
}
