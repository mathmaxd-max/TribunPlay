import * as engine from "@tribunplay/engine";
import { buildCache } from "../ui/cache/buildCache";
import type { UiMoveCache } from "../ui/cache/UiMoveCache";
import type { TutorialInteractionMode } from "./interactionMode";
import { modeAllowsEmpty, modeAllowsEnemy, modeAllowsOwnPrimary, modeAllowsOwnSecondary, modeAllowsSymmetry } from "./interactionMode";
import { type MovementSelector, unitMatchesMovementSelector } from "./policy";

function hasAllowedSecondaryAction(actionsByOrigin: Map<number, number[]>, originCid: number): boolean {
  const actions = actionsByOrigin.get(originCid);
  if (!actions) return false;
  return actions.some((action) => {
    const op = engine.decodeAction(action).opcode;
    return op === 7 || op === 8;
  });
}

export function buildTutorialCache(
  state: engine.State,
  filteredActions: readonly number[],
  mode: TutorialInteractionMode,
  selectedUnitType?: MovementSelector | null,
): UiMoveCache {
  const full = buildCache(state, {} as never);
  const allowedSet = new Set<number>(filteredActions.map((action) => action >>> 0));

  const filteredByOrigin = new Map<number, number[]>();
  const allowedCombineCenters = new Set<number>();
  for (const action of filteredActions) {
    const decoded = engine.decodeAction(action);
    if (decoded.opcode === 0) {
      const fromCid = decoded.fields.fromCid;
      filteredByOrigin.set(fromCid, [...(filteredByOrigin.get(fromCid) ?? []), action >>> 0]);
    } else if (decoded.opcode === 1 || decoded.opcode === 4 || decoded.opcode === 9) {
      const attackerCid = decoded.fields.attackerCid;
      filteredByOrigin.set(attackerCid, [...(filteredByOrigin.get(attackerCid) ?? []), action >>> 0]);
    } else if (decoded.opcode === 7 || decoded.opcode === 8) {
      const actorCid = decoded.fields.actorCid;
      filteredByOrigin.set(actorCid, [...(filteredByOrigin.get(actorCid) ?? []), action >>> 0]);
    } else if (decoded.opcode === 5 || decoded.opcode === 6) {
      allowedCombineCenters.add(decoded.fields.centerCid);
    }
  }

  const enemy = new Map<UiMoveCache["enemy"]>();
  if (modeAllowsEnemy(mode)) {
    for (const [cid, entry] of full.enemy.entries()) {
      const damageOptions = entry.damageOptions.filter((action) => allowedSet.has(action >>> 0));
      const liberateAction = entry.liberateAction && allowedSet.has(entry.liberateAction >>> 0) ? entry.liberateAction : undefined;
      const options = [...damageOptions, ...(liberateAction ? [liberateAction] : [])];
      if (options.length > 0) {
        enemy.set(cid, {
          damageOptions,
          hasLiberate: Boolean(liberateAction),
          liberateAction,
          options,
        });
      }
    }
  }

  const ownPrimary = new Map<UiMoveCache["ownPrimary"]>();
  if (modeAllowsOwnPrimary(mode)) {
    for (const [cid, entry] of full.ownPrimary.entries()) {
      if (mode === "move-only" && !unitMatchesMovementSelector(state, cid, selectedUnitType ?? null)) {
        continue;
      }
      const targets = new Map<typeof entry.targets>();
      const highlighted = new Set<number>();
      for (const [targetCid, target] of entry.targets.entries()) {
        const options = target.options.filter((action) => allowedSet.has(action >>> 0));
        if (options.length === 0) continue;
        targets.set(targetCid, { ...target, options });
        highlighted.add(targetCid);
      }
      if (targets.size === 0) continue;
      ownPrimary.set(cid, {
        targets,
        highlighted,
        canEnterSecondary: mode === "traditional" ? hasAllowedSecondaryAction(filteredByOrigin, cid) : false,
      });
    }
  }

  const ownSecondary = new Map<UiMoveCache["ownSecondary"]>();
  if (modeAllowsOwnSecondary(mode)) {
    for (const [cid, entry] of full.ownSecondary.entries()) {
      if (!hasAllowedSecondaryAction(filteredByOrigin, cid)) continue;
      ownSecondary.set(cid, {
        split: {
          ...entry.split,
          deriveBackstabbAction: (alloc) => {
            const action = entry.split.deriveBackstabbAction(alloc);
            if (action === null) return null;
            return allowedSet.has(action >>> 0) ? action : null;
          },
        },
      });
    }
  }

  const empty = new Map<UiMoveCache["empty"]>();
  if (modeAllowsEmpty(mode)) {
    for (const [cid, entry] of full.empty.entries()) {
      if (!allowedCombineCenters.has(cid)) continue;
      if (modeAllowsSymmetry(mode)) {
        empty.set(cid, entry);
        continue;
      }
      empty.set(cid, {
        ...entry,
        symmetryModeForThird: () => null,
        allowedSymmetricDonations: () => [0],
      });
    }
  }

  return {
    enemy,
    ownPrimary,
    ownSecondary,
    empty,
    legalSet: allowedSet,
  };
}
