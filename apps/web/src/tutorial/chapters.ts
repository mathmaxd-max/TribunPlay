import type { TutorialBoardPresetId } from "./presets";
import type { TutorialInteractionMode } from "./interactionMode";
import {
  COMBINE_OPCODES,
  DAMAGE_OPCODES,
  GAMEFLOW_OPCODES,
  IMPERO_A_OPCODES,
  IMPERO_B_OPCODES,
  MOVEMENT_OPCODES,
  SPLIT_OPCODES,
  SYM_COMBINE_OPCODES,
} from "./opcodes";

export type TutorialChapterId =
  | "what-is-tribun"
  | "units"
  | "movement"
  | "damage"
  | "combine"
  | "split"
  | "gameflow"
  | "sym-combine"
  | "impero";

export type TutorialChapterKind = "content" | "unit-demo" | "interactive";

export type TutorialRestrictions = {
  noSymCombine?: boolean;
  noEnslave?: boolean;
};

export type TutorialPracticeMode = "consecutive" | "alternating";
export type TutorialMovementSelector = "1T" | "1" | "2/2T" | "3/3T" | "4/4T" | "6/6T" | "8/8T";

export type TutorialChapterDef = {
  id: TutorialChapterId;
  title: string;
  kind: TutorialChapterKind;
  summary: string;
  content: string[];
  boardPreset?: TutorialBoardPresetId;
  allowedOpcodes?: number[];
  restrictions?: TutorialRestrictions;
  practiceMode?: TutorialPracticeMode;
  hasMovementSelector?: boolean;
  boardPresetByMovementSelector?: Record<TutorialMovementSelector, TutorialBoardPresetId>;
  /** Extra lines shown below the movement pattern diagram for the active unit-type selector. */
  movementDiagramSubtext?: Partial<Record<TutorialMovementSelector, string[]>>;
  interactionMode?: TutorialInteractionMode;
};

export const TUTORIAL_CHAPTERS: TutorialChapterDef[] = [
  {
    id: "what-is-tribun",
    title: "Chapter 1: What is Tribun?",
    kind: "content",
    summary: "Learn the core objective and turn rhythm.",
    content: [
      "Tribun is a strategy board game where your goal is to capture the enemy Tribun before they capture yours.",
      "You command an army of units with different strengths and movement patterns depending on their height.",
      "Players alternate turns. On each turn you must either restructure your army, move, or attack.",
      "All chapters are relevant. Although the last two chapters are titled \"Extra\" they are part of the intendet rule set. Because most of the game doesnt rely on them, it usually helps to learn the basics first, building intuition.",
    ],
  },
  {
    id: "units",
    title: "Chapter 2: Units",
    kind: "unit-demo",
    summary: "Understand height, icon/number rendering, and Tribun visuals.",
    content: [
      "A unit is a stack of pieces. The height controls movement pattern, attack potential, health, and damage behavior.",
      "What is always true: Height = Damage dealt = Health amount",
      "The same unit can be rendered with number glyphs or icon glyphs. Usually units are displayed as icons, to help identify movement and attack patterns. When restructuring units change to numbers to make clear how many pieces are on which tile.",
      "Use the toggles to compare how heights are rendered based on color and on whether they are the Tribun (leader of your army).",
    ],
  },
  {
    id: "movement",
    title: "Chapter 3: Movement",
    kind: "interactive",
    summary: "Practice move and kill patterns for a selected unit type.",
    content: [
      "Here you can play around with how units move and attack.",
      "Below is a board that you can interact with to develope a more intuitive understanding of each pattern.",
      "Choose one unit type and experiment with the legal moves you can make (all other moves have been disabled here).",
      "You can make consecutive moves without ending your training turn, but in a real game your turn would end after submitting it.",
      "To make a move click one of your pieces and select any interactable tile. You cannot make illegal moves, if the tile is empty you can walk, if its occupied you can take it.",
      "The diagram below the board tells you exactly how to move. Red=Attack, Blue=Move, Purple=Both. Dot=Stop, Arrow=Repeat until you hit something",
    ],
    boardPreset: "movement-1",
    boardPresetByMovementSelector: {
      "1T": "movement-1t",
      "1": "movement-1",
      "2/2T": "movement-2-2t",
      "3/3T": "movement-3-3t",
      "4/4T": "movement-4-4t",
      "6/6T": "movement-6-6t",
      "8/8T": "movement-8-8t",
    },
    allowedOpcodes: MOVEMENT_OPCODES,
    practiceMode: "consecutive",
    hasMovementSelector: true,
    movementDiagramSubtext: {
      "1": ["This is the only directional pattern. From your perspective it goes forward, so it swaps based on color."],
      "8/8T": ["This unit can move/attack 2 steps along the line. But it CANT jump over enemy units, only over owned ones."],
    },
    interactionMode: "move-only",
  },
  {
    id: "damage",
    title: "Chapter 4: Damage",
    kind: "interactive",
    summary: "Practice partial damage outcomes.",
    content: [
      "Damaging happens when your attack strength is less than the targets height.",
      "Instead of removing the target, its height is reduced by the exact attack amount. If the resulting height is invalid (like 5 or 7), an additional piece is removes (making it a 4 or 5).",
      "The attack strength is the sum of the heights of all attacking units. Like if a 3 and a 1 attack a 6, you can deal 1, 3 or 1+3=4 damage, depending on which units you want to attack.",
      "You can choose the damage by clicking a target. It will toggle through all unique, legal damage options for you.",
    ],
    boardPreset: "damage",
    allowedOpcodes: DAMAGE_OPCODES,
    practiceMode: "consecutive",
    interactionMode: "damage-only",
  },
  {
    id: "combine",
    title: "Chapter 5: Combination",
    kind: "interactive",
    summary: "Practice combining donors into a center tile.",
    content: [
      "Combination allows you to merge exactly 2 units on a shared empty tile.",
      "To make a move just select an empty tile (you can only click tiles that make sense). You will see the icons being swapped for numbers.",
      "Once you are in this combination mode you can click neighboring units to toggle through valid donation amounts.",
      "You can make invalid units here, but you cannot submit your move unless its valid.",
      "Valid = Exactly 2 donators + All unit heights are valid (1 to 4, 6 and 8 or empty)",
      "The Tribun may combine as well, but he never leaves people behind. Think of combining with the Tribun as gluing these pieces permanently to it. They cannot EVER be removed.",
    ],
    boardPreset: "combine",
    allowedOpcodes: COMBINE_OPCODES,
    restrictions: { noSymCombine: true },
    practiceMode: "consecutive",
    interactionMode: "combine-only",
  },
  {
    id: "split",
    title: "Chapter 6: Split",
    kind: "interactive",
    summary: "Practice split distribution from one actor into neighbors.",
    content: [
      "Splitting allows you to break a bigger unit up into smaller ones.",
      "You click a unit of yours again and can than donate to empty adjacent tiles. The heights must again be legal before you can submit your move (and you must split the unit into at least 2 units).",
      "In a real game you can move AND split. So you would toggle through the type of move you want to make by clicking the unit again.",
      "You may or may have not yet noticed that there are over 3500 moves initially. This is because you can freely distribute 8 pieces over 7 tiles. One free standing 8 high unit gives you more than 2500 moves that all follow these simple rules.",
      "You cant split a Tribun unit though.",
    ],
    boardPreset: "split",
    allowedOpcodes: SPLIT_OPCODES,
    practiceMode: "consecutive",
    interactionMode: "split-only",
  },
  {
    id: "gameflow",
    title: "Chapter 7: Gameflow",
    kind: "interactive",
    summary: "Play from the traditional setup with tutorial restrictions.",
    content: [
      "Here you can play around with all the moves you have already learned. You can also see the \"traditional setup\" here.",
      "Games usually end by Tribun capture, resignation, no legal moves, agreed draw, or clock events. But here there are no clocks, surrender or draw actions.",
      "Black is first to move, but who moves first isnt tied to color.",
    ],
    boardPreset: "traditional",
    allowedOpcodes: GAMEFLOW_OPCODES,
    restrictions: { noSymCombine: true, noEnslave: true },
    practiceMode: "alternating",
    interactionMode: "traditional",
  },
  {
    id: "sym-combine",
    title: "Extra 1: Symmetrical Combinations",
    kind: "interactive",
    summary: "Practice symmetrical combine patterns only.",
    content: [
      "Here you can symmetrically combine units.",
      "It is basically the same as combining, but here if you have exactly 3 or 6 exactly equal units, equally spaced around a tile, you can merge all of them at once.",
      "But you must donate the exact same amounts from all of them. This implies that you can only create 3 or 6 high units this way.",
      "To make the move donate from 2 units first. Then if you click a 3rd unit it will correctly toggle through the valid symmetrical combinations. You only ever select a 3rd unit. In a 6 symmetry all the other 3 donations are done for you.",
    ],
    boardPreset: "sym-combine",
    allowedOpcodes: SYM_COMBINE_OPCODES,
    practiceMode: "consecutive",
    interactionMode: "sym-combine-only",
  },
  {
    id: "impero",
    title: "Extra 2: Impero (Slave Units)",
    kind: "interactive",
    summary: "Switch between two Impero practice boards.",
    content: [
      "Impero completes the Tribun combat system. It allows you to enslave an enemy unit instead of killing it.",
      "Impero rule: 2× upper height ≥ lower height",
      "Liberating referrs to removing the upper unit (sentinel), setting the lower unit (slave) free.",
    ],
    boardPreset: "impero-a",
    allowedOpcodes: IMPERO_A_OPCODES,
    practiceMode: "consecutive",
    interactionMode: "impero-a",
  },
];

export function getTutorialChapterById(id: string | undefined): TutorialChapterDef | null {
  if (!id) return null;
  const normalized = id.toLowerCase();
  return TUTORIAL_CHAPTERS.find((chapter) => chapter.id === id || chapter.id.toLowerCase() === normalized) ?? null;
}

export function getTutorialChapterNeighbors(id: TutorialChapterId): {
  previous: TutorialChapterDef | null;
  next: TutorialChapterDef | null;
} {
  const index = TUTORIAL_CHAPTERS.findIndex((chapter) => chapter.id === id);
  if (index < 0) return { previous: null, next: null };
  return {
    previous: index > 0 ? TUTORIAL_CHAPTERS[index - 1] : null,
    next: index < TUTORIAL_CHAPTERS.length - 1 ? TUTORIAL_CHAPTERS[index + 1] : null,
  };
}

export function getImperoBoardConfig(mode: "A" | "B"): {
  title: string;
  copy: string[];
  boardPreset: TutorialBoardPresetId;
  allowedOpcodes: number[];
  interactionMode: TutorialInteractionMode;
} {
  if (mode === "A") {
    return {
      title: "Move / Kill / Enslave / Damage / Liberate",
      copy: [
        "Here you can play around with all primary actions. So here are the rules you need to know",
        "To enslave you would need enough damage to kill the unit. The unit who kills it must be smaller than 5 and follow the Impero rule.",
        "If you have an Impero unit, than before each move you must choose how to treat it. Does it use the movement and attack patterns of the upper or lower unit? Its attack strength is also tied to this choice (either sentinel or slave strenght).",
        "Choose the slave and you move the entire unit. Choose the sentinel and you will leave the slave, liberating it.",
        "If you attack an Impero unit, you only damage the sentinel. If it gets too small to comply with the Impero rule or gets entirely removed, the slave is liberated.",
      ],
      boardPreset: "impero-a",
      allowedOpcodes: IMPERO_A_OPCODES,
      interactionMode: "impero-a",
    };
  }
  return {
    title: "Combine / Sym-combine / Split / Backstabb",
    copy: [
      "Here you can again play around with restructuring moves.",
      "If you combine/split and an Impero unit is involved, you must make sure that the Impero rule says satisfied. Either leave the slave (liberating it) or leave enough sentinels.",
      "If you use the split interface to move the entire sentinel to an adjacent tile, you backstabb the slave. It doesnt get liberated, it gets removed instead. Tribun units can Backstabb, but not split.",
    ],
    boardPreset: "impero-b",
    allowedOpcodes: IMPERO_B_OPCODES,
    interactionMode: "impero-b",
  };
}
