/** Browse keys expire with their session. Keep a verified route to the selection instead. */
export interface CinemaMusicStep {
  title: string;
  subtitle?: string;
  imageKey?: string;
  index: number;
  input?: string;
}
export interface CinemaMusicPath {
  hierarchy: "browse" | "albums" | "playlists" | "search";
  query?: string;
  steps: CinemaMusicStep[];
}
export const cinemaTrackLimit = 1000;

export function validateMusicPath(value: unknown): CinemaMusicPath {
  const input = value as Partial<CinemaMusicPath> | null;
  if (
    !input ||
    !["browse", "albums", "playlists", "search"].includes(input.hierarchy ?? "") ||
    !Array.isArray(input.steps) ||
    input.steps.length > 12
  ) {
    throw new Error("Choose music from Albums, Playlists or Search.");
  }
  return {
    hierarchy: input.hierarchy as CinemaMusicPath["hierarchy"],
    ...(typeof input.query === "string" ? { query: input.query.slice(0, 2000) } : {}),
    steps: input.steps.map((value: unknown) => {
      const step = value as Partial<CinemaMusicStep> | null;
      if (
        !step ||
        typeof step.title !== "string" ||
        !step.title.trim() ||
        step.title.length > 1000 ||
        typeof step.index !== "number" ||
        !Number.isInteger(step.index) ||
        step.index < 0 ||
        step.index > 100000
      ) {
        throw new Error("This music selection is no longer available. Browse to it again.");
      }
      const result: CinemaMusicStep = { title: step.title, index: step.index };
      for (const key of ["subtitle", "imageKey", "input"] as const) {
        if (step[key] !== undefined) {
          if (typeof step[key] !== "string" || step[key].length > 2000) throw new Error("Invalid music selection.");
          result[key] = step[key];
        }
      }
      return result;
    }),
  };
}
