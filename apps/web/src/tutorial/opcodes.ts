import * as engine from "@tribunplay/engine";

// Engine opcode definitions live in packages/engine/src/index.ts encode*/decodeAction.
const SAMPLE_FROM = engine.encodeCoord(0, 0);
const SAMPLE_TO = engine.encodeCoord(0, 1);

function op(action: number): number {
  return engine.decodeAction(action).opcode;
}

export const OPCODE_MOVE = op(engine.encodeMove(SAMPLE_FROM, SAMPLE_TO, 0));
export const OPCODE_KILL = op(engine.encodeKill(SAMPLE_FROM, SAMPLE_TO, 0));
export const OPCODE_LIBERATE = op(engine.encodeLiberate(SAMPLE_TO));
export const OPCODE_DAMAGE = op(engine.encodeDamage(SAMPLE_TO, 1));
export const OPCODE_ENSLAVE = op(engine.encodeEnslave(SAMPLE_FROM, SAMPLE_TO));
export const OPCODE_COMBINE = op(engine.encodeCombine(SAMPLE_TO, 0, 1, 1, 1));
export const OPCODE_SYM_COMBINE = op(engine.encodeSymCombine(SAMPLE_TO, 1, 1));
export const OPCODE_SPLIT = op(engine.encodeSplit(SAMPLE_FROM, [1, 0, 0, 0, 0, 0]));
export const OPCODE_BACKSTABB = op(engine.encodeBackstabb(SAMPLE_FROM, 0));
export const OPCODE_ATTACK_TRIBUN = op(engine.encodeAttackTribun(SAMPLE_FROM, SAMPLE_TO, 0));

export const MOVEMENT_OPCODES = [OPCODE_MOVE, OPCODE_KILL];
export const DAMAGE_OPCODES = [OPCODE_DAMAGE];
export const COMBINE_OPCODES = [OPCODE_COMBINE];
export const SPLIT_OPCODES = [OPCODE_SPLIT];
export const GAMEFLOW_OPCODES = [
  OPCODE_MOVE,
  OPCODE_KILL,
  OPCODE_LIBERATE,
  OPCODE_DAMAGE,
  OPCODE_COMBINE,
  OPCODE_SPLIT,
  OPCODE_BACKSTABB,
  OPCODE_ATTACK_TRIBUN,
];
export const SYM_COMBINE_OPCODES = [OPCODE_SYM_COMBINE];
export const IMPERO_A_OPCODES = [OPCODE_MOVE, OPCODE_KILL, OPCODE_ENSLAVE, OPCODE_DAMAGE, OPCODE_LIBERATE];
export const IMPERO_B_OPCODES = [OPCODE_COMBINE, OPCODE_SYM_COMBINE, OPCODE_SPLIT, OPCODE_BACKSTABB];

export const ALL_TUTORIAL_BOARD_OPCODES = [
  OPCODE_MOVE,
  OPCODE_KILL,
  OPCODE_LIBERATE,
  OPCODE_DAMAGE,
  OPCODE_ENSLAVE,
  OPCODE_COMBINE,
  OPCODE_SYM_COMBINE,
  OPCODE_SPLIT,
  OPCODE_BACKSTABB,
  OPCODE_ATTACK_TRIBUN,
];
