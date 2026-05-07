import * as engine from '@tribunplay/engine';

export const OPPONENT_MOVE_EASING = 'cubic-bezier(0.42, 0, 0.58, 1)';

const PHASE_MS = {
  short: 220,
  medium: 320,
} as const;

const NEIGHBOR_VECTORS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, 0],
  [0, 1],
  [-1, -1],
  [-1, 0],
  [0, -1],
];

export type UnitAnchor = 'center' | 'primary' | 'secondary';

export type PositionRef =
  | { type: 'tile'; cid: number; anchor?: UnitAnchor }
  | { type: 'between'; fromCid: number; toCid: number; ratio: number }
  | { type: 'polar'; cid: number; angleRad: number; distancePx: number };

export type VisualUnit = {
  p: number;
  s: number;
  color: engine.Color;
  tribun: boolean;
};

type UnitPrimitiveType =
  | 'spawn'
  | 'remove'
  | 'translate'
  | 'translateFromPrimary'
  | 'morphLiberate'
  | 'morphEnslave';

export type UnitPrimitive = {
  kind: UnitPrimitiveType;
  unit: VisualUnit;
  from: PositionRef;
  to: PositionRef;
  fromScale: number;
  toScale: number;
  fromOpacity: number;
  toOpacity: number;
  startMs: number;
  durationMs: number;
};

export type NumberPrimitive = {
  kind: 'numberMove';
  value: number;
  from: PositionRef;
  to: PositionRef;
  fromScale: number;
  toScale: number;
  fromOpacity: number;
  toOpacity: number;
  startMs: number;
  durationMs: number;
};

export type AnimationPrimitive = UnitPrimitive | NumberPrimitive;
type PhasePrimitive =
  | Omit<UnitPrimitive, 'startMs' | 'durationMs'>
  | Omit<NumberPrimitive, 'startMs' | 'durationMs'>;

export type AnimationPhase = {
  label: string;
  durationMs: number;
  primitives: PhasePrimitive[];
};

export type FlattenedAnimationPrimitive = AnimationPrimitive & { id: string };

export type OpponentMoveTimeline = {
  opcode: number;
  changedCids: number[];
  phases: AnimationPhase[];
  primitives: FlattenedAnimationPrimitive[];
  hiddenStaticUnitCids: number[];
  totalDurationMs: number;
  fallbackNotes: string[];
};

const toVisualUnit = (unit: engine.Unit | null): VisualUnit | null => {
  if (!unit) return null;
  return { p: unit.p, s: unit.s, color: unit.color, tribun: unit.tribun };
};

const getNeighborCid = (cid: number, dir: number): number | null => {
  if (dir < 0 || dir >= NEIGHBOR_VECTORS.length) return null;
  try {
    const { x, y } = engine.decodeCoord(cid);
    const [dx, dy] = NEIGHBOR_VECTORS[dir];
    return engine.encodeCoord(x + dx, y + dy);
  } catch {
    return null;
  }
};

const getSymCombineDonorCids = (centerCid: number, config: number): number[] => {
  if (config === 0) {
    const all = Array.from({ length: 6 }, (_, dir) => getNeighborCid(centerCid, dir)).filter(
      (cid): cid is number => cid !== null,
    );
    return all;
  }
  const dirs = config === 1 ? [0, 4, 5] : config === 2 ? [3, 1, 2] : [];
  return dirs.map((dir) => getNeighborCid(centerCid, dir)).filter((cid): cid is number => cid !== null);
};

const getDamageAngle = (actionWord: number, ply: number): number => {
  const seed = ((actionWord >>> 0) ^ ((ply + 1) * 2654435761)) >>> 0;
  return (seed % 360) * (Math.PI / 180);
};

const flattenPhases = (opcode: number, changedCids: number[], phases: AnimationPhase[], fallbackNotes: string[]): OpponentMoveTimeline => {
  const primitives: FlattenedAnimationPrimitive[] = [];
  const hidden = new Set<number>();
  let offsetMs = 0;
  let index = 0;

  for (const phase of phases) {
    for (const primitive of phase.primitives) {
      const withTiming: AnimationPrimitive =
        primitive.kind === 'numberMove'
          ? {
              ...primitive,
              startMs: offsetMs,
              durationMs: phase.durationMs,
            }
          : {
              ...primitive,
              startMs: offsetMs,
              durationMs: phase.durationMs,
            };
      primitives.push({ ...withTiming, id: `op-${opcode}-${index}` });
      index += 1;

      if (withTiming.kind !== 'numberMove') {
        if (withTiming.kind === 'translate' || withTiming.kind === 'translateFromPrimary') {
          if (withTiming.to.type === 'tile') hidden.add(withTiming.to.cid);
        } else if (
          withTiming.kind === 'spawn' ||
          withTiming.kind === 'morphLiberate' ||
          withTiming.kind === 'morphEnslave'
        ) {
          if (withTiming.to.type === 'tile') hidden.add(withTiming.to.cid);
        }
      }
    }
    offsetMs += phase.durationMs;
  }

  return {
    opcode,
    changedCids,
    phases,
    primitives,
    hiddenStaticUnitCids: Array.from(hidden),
    totalDurationMs: offsetMs,
    fallbackNotes,
  };
};

const buildFallbackTimeline = (opcode: number, changedCids: number[]): OpponentMoveTimeline => {
  const phases: AnimationPhase[] = [];
  const fallbackNotes = ['Fallback: generic spawn/remove pulse for changed tiles.'];
  return flattenPhases(opcode, changedCids, phases, fallbackNotes);
};

export const cubicEaseInOut = (progress: number): number => {
  const t = Math.max(0, Math.min(1, progress));
  if (t < 0.5) return 4 * t * t * t;
  return 1 - Math.pow(-2 * t + 2, 3) / 2;
};

type BuildTimelineParams = {
  beforeState: engine.State;
  afterState: engine.State;
  actionWord: number;
  changedCids: number[];
};

export const buildOpponentMoveTimeline = (params: BuildTimelineParams): OpponentMoveTimeline => {
  const { beforeState, afterState, actionWord, changedCids } = params;
  const decoded = engine.decodeAction(actionWord >>> 0);
  const fallbackNotes: string[] = [];
  const phases: AnimationPhase[] = [];
  const fields = decoded.fields;
  const opcode = decoded.opcode;

  const beforeUnitAt = (cid: number): VisualUnit | null => toVisualUnit(engine.unitByteToUnit(beforeState.board[cid]));
  const afterUnitAt = (cid: number): VisualUnit | null => toVisualUnit(engine.unitByteToUnit(afterState.board[cid]));

  switch (opcode) {
    case 0: {
      const fromCid = fields.fromCid;
      const toCid = fields.toCid;
      const part = fields.part;
      const originBefore = beforeUnitAt(fromCid);
      if (!originBefore) {
        fallbackNotes.push('MOVE fallback: missing origin unit in before-state.');
        break;
      }
      if (originBefore.s > 0 && part === 0) {
        const liberated = afterUnitAt(fromCid);
        const movedPrimary: VisualUnit = { p: originBefore.p, s: 0, color: originBefore.color, tribun: originBefore.tribun };
        const primitives: AnimationPhase['primitives'] = [
          {
            kind: 'translateFromPrimary',
            unit: movedPrimary,
            from: { type: 'tile', cid: fromCid, anchor: 'primary' },
            to: { type: 'tile', cid: toCid, anchor: 'center' },
            fromScale: 0.8,
            toScale: 1,
            fromOpacity: 1,
            toOpacity: 1,
          },
        ];
        if (liberated) {
          primitives.push({
            kind: 'morphLiberate',
            unit: liberated,
            from: { type: 'tile', cid: fromCid, anchor: 'secondary' },
            to: { type: 'tile', cid: fromCid, anchor: 'center' },
            fromScale: 0.78,
            toScale: 1,
            fromOpacity: 1,
            toOpacity: 1,
          });
        }
        phases.push({
          label: 'move.slavePrimary',
          durationMs: PHASE_MS.medium,
          primitives,
        });
      } else {
        phases.push({
          label: 'move.translate',
          durationMs: PHASE_MS.medium,
          primitives: [
            {
              kind: 'translate',
              unit: originBefore,
              from: { type: 'tile', cid: fromCid, anchor: 'center' },
              to: { type: 'tile', cid: toCid, anchor: 'center' },
              fromScale: 1,
              toScale: 1,
              fromOpacity: 1,
              toOpacity: 1,
            },
          ],
        });
      }
      break;
    }

    case 1: {
      const attackerCid = fields.attackerCid;
      const targetCid = fields.targetCid;
      const part = fields.part;
      const attackerBefore = beforeUnitAt(attackerCid);
      const targetBefore = beforeUnitAt(targetCid);
      if (!attackerBefore) {
        fallbackNotes.push('KILL fallback: missing attacker unit in before-state.');
        break;
      }
      const primitives: AnimationPhase['primitives'] = [];
      if (attackerBefore.s > 0 && part === 0) {
        const liberated = afterUnitAt(attackerCid);
        const movedPrimary: VisualUnit = { p: attackerBefore.p, s: 0, color: attackerBefore.color, tribun: attackerBefore.tribun };
        primitives.push({
          kind: 'translateFromPrimary',
          unit: movedPrimary,
          from: { type: 'tile', cid: attackerCid, anchor: 'primary' },
          to: { type: 'tile', cid: targetCid, anchor: 'center' },
          fromScale: 0.8,
          toScale: 1,
          fromOpacity: 1,
          toOpacity: 1,
        });
        if (liberated) {
          primitives.push({
            kind: 'morphLiberate',
            unit: liberated,
            from: { type: 'tile', cid: attackerCid, anchor: 'secondary' },
            to: { type: 'tile', cid: attackerCid, anchor: 'center' },
            fromScale: 0.78,
            toScale: 1,
            fromOpacity: 1,
            toOpacity: 1,
          });
        }
      } else {
        primitives.push({
          kind: 'translate',
          unit: attackerBefore,
          from: { type: 'tile', cid: attackerCid, anchor: 'center' },
          to: { type: 'tile', cid: targetCid, anchor: 'center' },
          fromScale: 1,
          toScale: 1,
          fromOpacity: 1,
          toOpacity: 1,
        });
      }
      if (targetBefore) {
        primitives.push({
          kind: 'remove',
          unit: targetBefore,
          from: { type: 'tile', cid: targetCid, anchor: 'center' },
          to: { type: 'tile', cid: targetCid, anchor: 'center' },
          fromScale: 1,
          toScale: 0,
          fromOpacity: 1,
          toOpacity: 0,
        });
      }
      phases.push({ label: 'kill', durationMs: PHASE_MS.medium, primitives });
      break;
    }

    case 4: {
      const attackerCid = fields.attackerCid;
      const targetCid = fields.targetCid;
      const attackerBefore = beforeUnitAt(attackerCid);
      const targetBefore = beforeUnitAt(targetCid);
      if (!attackerBefore) {
        fallbackNotes.push('ENSLAVE fallback: missing attacker unit in before-state.');
        break;
      }
      const primitives: AnimationPhase['primitives'] = [];
      if (attackerBefore.s > 0) {
        const liberated = afterUnitAt(attackerCid);
        if (liberated) {
          primitives.push({
            kind: 'morphLiberate',
            unit: liberated,
            from: { type: 'tile', cid: attackerCid, anchor: 'secondary' },
            to: { type: 'tile', cid: attackerCid, anchor: 'center' },
            fromScale: 0.78,
            toScale: 1,
            fromOpacity: 1,
            toOpacity: 1,
          });
        }
      }
      primitives.push({
        kind: 'translateFromPrimary',
        unit: { p: attackerBefore.p, s: 0, color: attackerBefore.color, tribun: attackerBefore.tribun },
        from: { type: 'tile', cid: attackerCid, anchor: 'primary' },
        to: { type: 'tile', cid: targetCid, anchor: 'center' },
        fromScale: 0.8,
        toScale: 1,
        fromOpacity: 1,
        toOpacity: 1,
      });
      if (targetBefore) {
        primitives.push({
          kind: 'morphEnslave',
          unit: targetBefore,
          from: { type: 'tile', cid: targetCid, anchor: 'center' },
          to: { type: 'tile', cid: targetCid, anchor: 'secondary' },
          fromScale: 1,
          toScale: 0.78,
          fromOpacity: 1,
          toOpacity: 0.4,
        });
      }
      phases.push({ label: 'enslave', durationMs: PHASE_MS.medium, primitives });
      break;
    }

    case 8: {
      const actorCid = fields.actorCid;
      const dir = fields.dir;
      const targetCid = getNeighborCid(actorCid, dir);
      const actorBefore = beforeUnitAt(actorCid);
      if (!actorBefore || targetCid === null) {
        fallbackNotes.push('BACKSTABB fallback: missing actor or target tile.');
        break;
      }
      phases.push({
        label: 'backstabb',
        durationMs: PHASE_MS.medium,
        primitives: [
          {
            kind: 'translateFromPrimary',
            unit: { p: actorBefore.p, s: 0, color: actorBefore.color, tribun: actorBefore.tribun },
            from: { type: 'tile', cid: actorCid, anchor: 'primary' },
            to: { type: 'tile', cid: targetCid, anchor: 'center' },
            fromScale: 0.8,
            toScale: 1,
            fromOpacity: 1,
            toOpacity: 1,
          },
          {
            kind: 'remove',
            unit: actorBefore,
            from: { type: 'tile', cid: actorCid, anchor: 'center' },
            to: { type: 'tile', cid: actorCid, anchor: 'center' },
            fromScale: 1,
            toScale: 0,
            fromOpacity: 1,
            toOpacity: 0,
          },
        ],
      });
      fallbackNotes.push('BACKSTABB fallback: removes full origin stack while primary translates.');
      break;
    }

    case 3: {
      const targetCid = fields.targetCid;
      const effectiveDamage = fields.effectiveDamage;
      const beforeTarget = beforeUnitAt(targetCid);
      const afterTarget = afterUnitAt(targetCid);
      const angle = getDamageAngle(actionWord, beforeState.ply);
      if (beforeTarget) {
        phases.push({
          label: 'damage.out',
          durationMs: PHASE_MS.short,
          primitives: [
            {
              kind: 'remove',
              unit: beforeTarget,
              from: { type: 'tile', cid: targetCid, anchor: 'center' },
              to: { type: 'tile', cid: targetCid, anchor: 'center' },
              fromScale: 1,
              toScale: 0,
              fromOpacity: 1,
              toOpacity: 0,
            },
            {
              kind: 'numberMove',
              value: effectiveDamage,
              from: { type: 'tile', cid: targetCid, anchor: 'center' },
              to: { type: 'polar', cid: targetCid, angleRad: angle, distancePx: 34 },
              fromScale: 0,
              toScale: 1,
              fromOpacity: 1,
              toOpacity: 1,
            },
          ],
        });
      }
      if (afterTarget) {
        phases.push({
          label: 'damage.in',
          durationMs: PHASE_MS.short,
          primitives: [
            {
              kind: 'spawn',
              unit: afterTarget,
              from: { type: 'tile', cid: targetCid, anchor: 'center' },
              to: { type: 'tile', cid: targetCid, anchor: 'center' },
              fromScale: 0,
              toScale: 1,
              fromOpacity: 0,
              toOpacity: 1,
            },
            {
              kind: 'numberMove',
              value: effectiveDamage,
              from: { type: 'polar', cid: targetCid, angleRad: angle, distancePx: 34 },
              to: { type: 'tile', cid: targetCid, anchor: 'center' },
              fromScale: 1,
              toScale: 0,
              fromOpacity: 1,
              toOpacity: 0,
            },
          ],
        });
      }
      fallbackNotes.push('DAMAGE fallback: icon-level remove/spawn for target instead of primary-only sub-part morph.');
      break;
    }

    case 2: {
      const targetCid = fields.targetCid;
      const beforeTarget = beforeUnitAt(targetCid);
      const afterTarget = afterUnitAt(targetCid);
      if (beforeTarget) {
        phases.push({
          label: 'liberate.remove',
          durationMs: PHASE_MS.short,
          primitives: [
            {
              kind: 'remove',
              unit: beforeTarget,
              from: { type: 'tile', cid: targetCid, anchor: 'center' },
              to: { type: 'tile', cid: targetCid, anchor: 'center' },
              fromScale: 1,
              toScale: 0,
              fromOpacity: 1,
              toOpacity: 0,
            },
          ],
        });
      }
      if (afterTarget) {
        phases.push({
          label: 'liberate.morph',
          durationMs: PHASE_MS.short,
          primitives: [
            {
              kind: 'morphLiberate',
              unit: afterTarget,
              from: { type: 'tile', cid: targetCid, anchor: 'secondary' },
              to: { type: 'tile', cid: targetCid, anchor: 'center' },
              fromScale: 0.78,
              toScale: 1,
              fromOpacity: 1,
              toOpacity: 1,
            },
          ],
        });
      }
      fallbackNotes.push('LIBERATE fallback: icon-level remove then secondary->center morph.');
      break;
    }

    case 5:
    case 6: {
      const centerCid = fields.centerCid;
      const receiverAfter = afterUnitAt(centerCid);
      const donors: Array<{ cid: number; donate: number }> = [];
      if (opcode === 5) {
        const donorA = getNeighborCid(centerCid, fields.dirA);
        const donorB = getNeighborCid(centerCid, fields.dirB);
        if (donorA !== null) donors.push({ cid: donorA, donate: fields.donateA });
        if (donorB !== null) donors.push({ cid: donorB, donate: fields.donateB });
      } else {
        const donate = fields.donate;
        for (const donorCid of getSymCombineDonorCids(centerCid, fields.config)) {
          donors.push({ cid: donorCid, donate });
        }
      }
      if (donors.length === 0) {
        fallbackNotes.push('COMBINE fallback: no donors resolved from action fields.');
        break;
      }

      const phaseOne: AnimationPhase['primitives'] = [];
      const phaseTwo: AnimationPhase['primitives'] = [];
      for (const donor of donors) {
        const donorBefore = beforeUnitAt(donor.cid);
        const donorAfter = afterUnitAt(donor.cid);
        if (donorBefore) {
          phaseOne.push({
            kind: 'remove',
            unit: donorBefore,
            from: { type: 'tile', cid: donor.cid, anchor: 'center' },
            to: { type: 'tile', cid: donor.cid, anchor: 'center' },
            fromScale: 1,
            toScale: 0,
            fromOpacity: 1,
            toOpacity: 0,
          });
          phaseOne.push({
            kind: 'numberMove',
            value: donor.donate,
            from: { type: 'tile', cid: donor.cid, anchor: 'center' },
            to: { type: 'between', fromCid: donor.cid, toCid: centerCid, ratio: 0.5 },
            fromScale: 0,
            toScale: 1,
            fromOpacity: 1,
            toOpacity: 1,
          });
        }
        if (donorAfter) {
          if (donorBefore && donorBefore.s > 0 && donorBefore.p - donor.donate <= 0) {
            phaseTwo.push({
              kind: 'morphLiberate',
              unit: donorAfter,
              from: { type: 'tile', cid: donor.cid, anchor: 'secondary' },
              to: { type: 'tile', cid: donor.cid, anchor: 'center' },
              fromScale: 0.78,
              toScale: 1,
              fromOpacity: 1,
              toOpacity: 1,
            });
          } else {
            phaseTwo.push({
              kind: 'spawn',
              unit: donorAfter,
              from: { type: 'tile', cid: donor.cid, anchor: 'center' },
              to: { type: 'tile', cid: donor.cid, anchor: 'center' },
              fromScale: 0,
              toScale: 1,
              fromOpacity: 0,
              toOpacity: 1,
            });
          }
        }
        phaseTwo.push({
          kind: 'numberMove',
          value: donor.donate,
          from: { type: 'between', fromCid: donor.cid, toCid: centerCid, ratio: 0.5 },
          to: { type: 'tile', cid: centerCid, anchor: 'center' },
          fromScale: 1,
          toScale: 0,
          fromOpacity: 1,
          toOpacity: 0,
        });
      }
      if (receiverAfter) {
        phaseTwo.push({
          kind: 'spawn',
          unit: receiverAfter,
          from: { type: 'tile', cid: centerCid, anchor: 'center' },
          to: { type: 'tile', cid: centerCid, anchor: 'center' },
          fromScale: 0,
          toScale: 1,
          fromOpacity: 0,
          toOpacity: 1,
        });
      }
      phases.push({ label: 'combine.out', durationMs: PHASE_MS.short, primitives: phaseOne });
      phases.push({ label: 'combine.in', durationMs: PHASE_MS.medium, primitives: phaseTwo });
      fallbackNotes.push('COMBINE/SYMMETRY_COMBINE fallback: donor primary removal approximated as full icon remove.');
      break;
    }

    case 7: {
      const actorCid = fields.actorCid;
      const allocations = [fields.h0, fields.h1, fields.h2, fields.h3, fields.h4, fields.h5];
      const actorBefore = beforeUnitAt(actorCid);
      if (!actorBefore) {
        fallbackNotes.push('SPLIT fallback: missing actor unit in before-state.');
        break;
      }
      const donations = allocations
        .map((value: number, dir: number) => ({ value, dir }))
        .filter((entry) => entry.value > 0)
        .map((entry) => {
          const targetCid = getNeighborCid(actorCid, entry.dir);
          return targetCid === null ? null : { targetCid, donate: entry.value };
        })
        .filter((entry): entry is { targetCid: number; donate: number } => entry !== null);

      const phaseOne: AnimationPhase['primitives'] = [
        {
          kind: 'remove',
          unit: actorBefore,
          from: { type: 'tile', cid: actorCid, anchor: 'center' },
          to: { type: 'tile', cid: actorCid, anchor: 'center' },
          fromScale: 1,
          toScale: 0,
          fromOpacity: 1,
          toOpacity: 0,
        },
      ];
      const phaseTwo: AnimationPhase['primitives'] = [];
      for (const donation of donations) {
        phaseOne.push({
          kind: 'numberMove',
          value: donation.donate,
          from: { type: 'tile', cid: actorCid, anchor: 'center' },
          to: { type: 'between', fromCid: actorCid, toCid: donation.targetCid, ratio: 0.5 },
          fromScale: 0,
          toScale: 1,
          fromOpacity: 1,
          toOpacity: 1,
        });
        const receiverAfter = afterUnitAt(donation.targetCid);
        if (receiverAfter) {
          phaseTwo.push({
            kind: 'spawn',
            unit: receiverAfter,
            from: { type: 'tile', cid: donation.targetCid, anchor: 'center' },
            to: { type: 'tile', cid: donation.targetCid, anchor: 'center' },
            fromScale: 0,
            toScale: 1,
            fromOpacity: 0,
            toOpacity: 1,
          });
        }
        phaseTwo.push({
          kind: 'numberMove',
          value: donation.donate,
          from: { type: 'between', fromCid: actorCid, toCid: donation.targetCid, ratio: 0.5 },
          to: { type: 'tile', cid: donation.targetCid, anchor: 'center' },
          fromScale: 1,
          toScale: 0,
          fromOpacity: 1,
          toOpacity: 0,
        });
      }

      const actorAfter = afterUnitAt(actorCid);
      if (actorAfter) {
        if (actorAfter.color !== actorBefore.color && actorBefore.s > 0) {
          phaseTwo.push({
            kind: 'morphLiberate',
            unit: actorAfter,
            from: { type: 'tile', cid: actorCid, anchor: 'secondary' },
            to: { type: 'tile', cid: actorCid, anchor: 'center' },
            fromScale: 0.78,
            toScale: 1,
            fromOpacity: 1,
            toOpacity: 1,
          });
        } else {
          phaseTwo.push({
            kind: 'spawn',
            unit: actorAfter,
            from: { type: 'tile', cid: actorCid, anchor: 'center' },
            to: { type: 'tile', cid: actorCid, anchor: 'center' },
            fromScale: 0,
            toScale: 1,
            fromOpacity: 0,
            toOpacity: 1,
          });
        }
      }

      phases.push({ label: 'split.out', durationMs: PHASE_MS.short, primitives: phaseOne });
      phases.push({ label: 'split.in', durationMs: PHASE_MS.medium, primitives: phaseTwo });
      fallbackNotes.push('SPLIT fallback: donor primary removal approximated as full icon remove.');
      break;
    }
  }

  if (phases.length === 0) {
    const fallback = buildFallbackTimeline(opcode, changedCids);
    fallback.fallbackNotes.push(...fallbackNotes);
    return fallback;
  }

  return flattenPhases(opcode, changedCids, phases, fallbackNotes);
};
