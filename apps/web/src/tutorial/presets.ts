import type * as engine from "@tribunplay/engine";
import { loadTutorialBoardState, type TutorialBoardPresetId } from "./loadBoardFromDefinition";

export type { TutorialBoardPresetId };

export function createTutorialPresetState(preset: TutorialBoardPresetId): engine.State {
  return loadTutorialBoardState(preset);
}

