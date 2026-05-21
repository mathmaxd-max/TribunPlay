export type TutorialInteractionMode =
  | "move-only"
  | "damage-only"
  | "combine-only"
  | "split-only"
  | "traditional"
  | "sym-combine-only"
  | "impero-a"
  | "impero-b";

export function modeAllowsOwnPrimary(mode: TutorialInteractionMode): boolean {
  return mode === "move-only" || mode === "traditional" || mode === "impero-a";
}

export function modeAllowsEnemy(mode: TutorialInteractionMode): boolean {
  return mode === "damage-only" || mode === "traditional" || mode === "impero-a";
}

export function modeAllowsEmpty(mode: TutorialInteractionMode): boolean {
  return mode === "combine-only" || mode === "traditional" || mode === "sym-combine-only" || mode === "impero-b";
}

export function modeAllowsOwnSecondary(mode: TutorialInteractionMode): boolean {
  return mode === "split-only" || mode === "traditional" || mode === "impero-b";
}

export function modeAllowsSymmetry(mode: TutorialInteractionMode): boolean {
  return mode === "sym-combine-only" || mode === "impero-b";
}
