// Core types
import defaultPositionData from './default-position.json';
// Coordinate encoding/decoding
const R = 5;
export function onBoard(x, y) {
    const z = x - y;
    return Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= R;
}
export function encodeCoord(x, y) {
    const cid = (x + 5) * 11 + (y + 5);
    if (cid < 0 || cid > 120) {
        throw new Error(`cid out of range: ${cid} for (${x}, ${y})`);
    }
    if (!onBoard(x, y)) {
        throw new Error(`off board: (${x}, ${y})`);
    }
    return cid;
}
export function decodeCoord(cid) {
    if (cid < 0 || cid > 120) {
        throw new Error(`cid out of range: ${cid}`);
    }
    const x = Math.floor(cid / 11) - 5;
    const y = (cid % 11) - 5;
    if (!onBoard(x, y)) {
        throw new Error(`off board: cid ${cid} decodes to (${x}, ${y})`);
    }
    return { x, y };
}
export function isValidTile(cid) {
    if (cid < 0 || cid > 120)
        return false;
    try {
        decodeCoord(cid);
        return true;
    }
    catch {
        return false;
    }
}
// Unit byte encoding/decoding
const HEIGHT_TO_INDEX = {
    0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 6: 5, 8: 6,
};
const INDEX_TO_HEIGHT = [0, 1, 2, 3, 4, 6, 8, 0]; // 7 is reserved
export function unitByteToUnit(b) {
    if (b === 0)
        return null;
    const pIndex = b & 0x7;
    const sIndex = (b >>> 3) & 0x7;
    const color = ((b >>> 6) & 0x1);
    const tribun = ((b >>> 7) & 0x1) === 1;
    const p = INDEX_TO_HEIGHT[pIndex];
    const s = INDEX_TO_HEIGHT[sIndex];
    if (p === 0 && s === 0)
        return null;
    return { color, tribun, p, s };
}
export function unitToUnitByte(u) {
    if (u === null)
        return 0;
    const pIndex = HEIGHT_TO_INDEX[u.p] ?? 0;
    const sIndex = HEIGHT_TO_INDEX[u.s] ?? 0;
    const color = u.color & 0x1;
    const tribun = u.tribun ? 1 : 0;
    return (tribun << 7) | (color << 6) | (sIndex << 3) | pIndex;
}
// Action word encoding/decoding
export function opcode(word) {
    return (word >>> 28) & 0xf;
}
export function payload(word) {
    return word & 0x0ffffff;
}
// MOVE: opcode 0
export function encodeMove(fromCid, toCid, part) {
    return (0 << 28) | (part << 14) | (toCid << 7) | fromCid;
}
// KILL: opcode 1
export function encodeKill(attackerCid, targetCid, part) {
    return (1 << 28) | (part << 14) | (targetCid << 7) | attackerCid;
}
// LIBERATE: opcode 2
export function encodeLiberate(targetCid) {
    return (2 << 28) | targetCid;
}
// DAMAGE: opcode 3
export function encodeDamage(targetCid, effectiveDamage) {
    const effDmgMinus1 = effectiveDamage - 1;
    if (effDmgMinus1 < 0 || effDmgMinus1 > 7) {
        throw new Error(`effectiveDamage must be 1..8, got ${effectiveDamage}`);
    }
    return (3 << 28) | (effDmgMinus1 << 7) | targetCid;
}
// ENSLAVE: opcode 4
export function encodeEnslave(attackerCid, targetCid) {
    return (4 << 28) | (targetCid << 7) | attackerCid;
}
// COMBINE: opcode 5
export function encodeCombine(centerCid, dirA, dirB, donateA, donateB) {
    const donAminus1 = donateA - 1;
    const donBminus1 = donateB - 1;
    return ((5 << 28) |
        (donBminus1 << 16) |
        (donAminus1 << 13) |
        (dirB << 10) |
        (dirA << 7) |
        centerCid);
}
// SYM_COMBINE: opcode 6
export function encodeSymCombine(centerCid, config, donate) {
    const donMinus1 = donate - 1;
    return (6 << 28) | (donMinus1 << 9) | (config << 7) | centerCid;
}
// SPLIT: opcode 7
export function encodeSplit(actorCid, heights) {
    let word = 7 << 28;
    for (let i = 0; i < 6; i++) {
        word |= (heights[i] & 0x7) << (7 + i * 3);
    }
    word |= actorCid;
    return word;
}
// BACKSTABB: opcode 8
export function encodeBackstabb(actorCid, dir) {
    return (8 << 28) | (dir << 7) | actorCid;
}
// ATTACK_TRIBUN: opcode 9
export function encodeAttackTribun(attackerCid, tribunCid, winnerColor) {
    return (9 << 28) | (winnerColor << 14) | (tribunCid << 7) | attackerCid;
}
// DRAW: opcode 10
export function encodeDraw(drawAction, actorColor) {
    // drawAction: 0=offer, 1=retract, 2=accept
    return (10 << 28) | (actorColor << 1) | drawAction;
}
// END: opcode 11
export function encodeEnd(endReason, loserColor) {
    // endReason: 0=resign, 1=no-legal-moves, 2=timeout-player, 3=timeout-game-tie
    let payload = endReason;
    if (loserColor !== undefined) {
        payload |= (loserColor << 2);
    }
    return (11 << 28) | payload;
}
export function decodeAction(action) {
    const op = opcode(action);
    const pay = payload(action);
    const fields = {};
    switch (op) {
        case 0: // MOVE
            fields.fromCid = pay & 0x7f;
            fields.toCid = (pay >>> 7) & 0x7f;
            fields.part = (pay >>> 14) & 0x1;
            break;
        case 1: // KILL
            fields.attackerCid = pay & 0x7f;
            fields.targetCid = (pay >>> 7) & 0x7f;
            fields.part = (pay >>> 14) & 0x1;
            break;
        case 2: // LIBERATE
            fields.targetCid = pay & 0x7f;
            break;
        case 3: // DAMAGE
            fields.targetCid = pay & 0x7f;
            fields.effectiveDamage = ((pay >>> 7) & 0x7) + 1;
            break;
        case 4: // ENSLAVE
            fields.attackerCid = pay & 0x7f;
            fields.targetCid = (pay >>> 7) & 0x7f;
            break;
        case 5: // COMBINE
            fields.centerCid = pay & 0x7f;
            fields.dirA = (pay >>> 7) & 0x7;
            fields.dirB = (pay >>> 10) & 0x7;
            fields.donateA = ((pay >>> 13) & 0x7) + 1;
            fields.donateB = ((pay >>> 16) & 0x7) + 1;
            break;
        case 6: // SYM_COMBINE
            fields.centerCid = pay & 0x7f;
            fields.config = (pay >>> 7) & 0x3;
            fields.donate = ((pay >>> 9) & 0x3) + 1;
            break;
        case 7: // SPLIT
            fields.actorCid = pay & 0x7f;
            fields.h0 = (pay >>> 7) & 0x7;
            fields.h1 = (pay >>> 10) & 0x7;
            fields.h2 = (pay >>> 13) & 0x7;
            fields.h3 = (pay >>> 16) & 0x7;
            fields.h4 = (pay >>> 19) & 0x7;
            fields.h5 = (pay >>> 22) & 0x7;
            break;
        case 8: // BACKSTABB
            fields.actorCid = pay & 0x7f;
            fields.dir = (pay >>> 7) & 0x7;
            break;
        case 9: // ATTACK_TRIBUN
            fields.attackerCid = pay & 0x7f;
            fields.tribunCid = (pay >>> 7) & 0x7f;
            fields.winnerColor = (pay >>> 14) & 0x1;
            break;
        case 10: // DRAW
            fields.drawAction = pay & 0x3;
            fields.actorColor = (pay >>> 1) & 0x1;
            break;
        case 11: // END
            fields.endReason = pay & 0x3;
            fields.loserColor = (pay >>> 2) & 0x1;
            break;
    }
    return { opcode: op, fields };
}
// Board packing/unpacking
export function packBoard(board) {
    // Convert Uint8Array to base64
    const binary = String.fromCharCode(...board);
    return btoa(binary);
}
export function unpackBoard(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
// Neighbor vectors
const NEIGHBOR_VECTORS = [
    [1, 1], // 0: up
    [1, 0], // 1: left-up
    [0, 1], // 2: right-up
    [-1, -1], // 3: down
    [-1, 0], // 4: right-down
    [0, -1], // 5: left-down
];
function getNeighborCid(cid, dir) {
    try {
        const { x, y } = decodeCoord(cid);
        const [dx, dy] = NEIGHBOR_VECTORS[dir];
        const nx = x + dx;
        const ny = y + dy;
        if (onBoard(nx, ny)) {
            return encodeCoord(nx, ny);
        }
    }
    catch {
        return null;
    }
    return null;
}
// Normalization functions
function roundDownInvalidHeight(h) {
    if (h <= 0)
        return 0;
    if (h === 5)
        return 4;
    if (h === 7)
        return 6;
    if (h >= 9)
        return 8; // Cap at 8
    if (h === 1 || h === 2 || h === 3 || h === 4 || h === 6 || h === 8) {
        return h;
    }
    // For other invalid values, round down to nearest valid
    if (h < 4)
        return h;
    if (h < 6)
        return 4;
    if (h < 8)
        return 6;
    return 8;
}
function enforceSP(unit) {
    if (unit.s > 0) {
        if (unit.p > 4 || 2 * unit.p < unit.s) {
            // SP violated, set primary to 0
            return { ...unit, p: 0 };
        }
    }
    return unit;
}
function normalizeUnit(unit) {
    // Step 1: Round down invalid heights
    let p = roundDownInvalidHeight(unit.p);
    let s = roundDownInvalidHeight(unit.s);
    // Step 2: Enforce SP
    let normalized = { ...unit, p, s };
    normalized = enforceSP(normalized);
    // Step 3: Liberation
    if (normalized.p === 0 && normalized.s > 0) {
        p = roundDownInvalidHeight(normalized.s);
        normalized = {
            color: normalized.color === 0 ? 1 : 0,
            tribun: false, // Liberation cannot create tribun
            p,
            s: 0,
        };
    }
    // Final check: empty unit
    if (normalized.p === 0 && normalized.s === 0) {
        return null;
    }
    return normalized;
}
// Movement pattern generators
function getHeight1MoveOffsets(color) {
    if (color === 0) { // black
        return [[1, 1]];
    }
    else { // white
        return [[-1, -1]];
    }
}
function getHeight1AttackOffsets(color) {
    if (color === 0) { // black
        return [[1, 0], [0, 1]];
    }
    else { // white
        return [[-1, 0], [0, -1]];
    }
}
function getHeight2Offsets() {
    const base = [[1, 2], [-1, 1], [2, 1]];
    const result = [];
    for (const [x, y] of base) {
        result.push([x, y]);
        result.push([-x, -y]);
    }
    return result;
}
function getHeight3Offsets() {
    const base = [[3, 2], [2, 3], [1, 3], [3, 1], [-1, 2], [2, -1]];
    const result = [];
    for (const [x, y] of base) {
        result.push([x, y]);
        result.push([-x, -y]);
    }
    return result;
}
function getHeight4DirectionVectors() {
    return getHeight2Offsets();
}
function getHeight6T1ExpansionOffsets() {
    // t1 adjacency expansion - all tiles reachable by repeated t1 moves
    // This is a breadth-first expansion of the 6 neighbors
    const visited = new Set();
    const result = [];
    const queue = [];
    // Start with all 6 neighbors
    for (const vec of NEIGHBOR_VECTORS) {
        queue.push([...vec]);
    }
    // Expand outward (limit to reasonable distance)
    for (let depth = 0; depth < 10 && queue.length > 0; depth++) {
        const current = queue.shift();
        const key = `${current[0]},${current[1]}`;
        if (visited.has(key))
            continue;
        visited.add(key);
        result.push([...current]);
        // Add neighbors
        for (const vec of NEIGHBOR_VECTORS) {
            const next = [current[0] + vec[0], current[1] + vec[1]];
            const nextKey = `${next[0]},${next[1]}`;
            if (!visited.has(nextKey)) {
                queue.push(next);
            }
        }
    }
    return result;
}
function getHeight8Offsets() {
    // Height 8: t1 adjacency (all 6 neighbors)
    return NEIGHBOR_VECTORS.map(v => [...v]);
}
function getHeight8JumpOffsets() {
    // Height 8: jump moves (+2*v where v is adjacency vector)
    return NEIGHBOR_VECTORS.map(v => [v[0] * 2, v[1] * 2]);
}
// Get all reachable tiles for a movement pattern
function getReachableTiles(fromCid, height, color, isTribun, board, forAttack = false) {
    const { x, y } = decodeCoord(fromCid);
    const reachable = [];
    if (height === 1) {
        if (isTribun) {
            // t1: all 6 neighbors
            for (let dir = 0; dir < 6; dir++) {
                const cid = getNeighborCid(fromCid, dir);
                if (cid !== null) {
                    reachable.push(cid);
                }
            }
        }
        else {
            // Height 1: color-dependent move
            const offsets = forAttack ? getHeight1AttackOffsets(color) : getHeight1MoveOffsets(color);
            for (const [dx, dy] of offsets) {
                try {
                    const cid = encodeCoord(x + dx, y + dy);
                    reachable.push(cid);
                }
                catch { }
            }
        }
    }
    else if (height === 2) {
        const offsets = getHeight2Offsets();
        for (const [dx, dy] of offsets) {
            try {
                const cid = encodeCoord(x + dx, y + dy);
                reachable.push(cid);
            }
            catch { }
        }
    }
    else if (height === 3) {
        const offsets = getHeight3Offsets();
        for (const [dx, dy] of offsets) {
            try {
                const cid = encodeCoord(x + dx, y + dy);
                reachable.push(cid);
            }
            catch { }
        }
    }
    else if (height === 4) {
        // Sliding: choose direction vector, slide until hit unit or border
        const dirVectors = getHeight4DirectionVectors();
        for (const [vx, vy] of dirVectors) {
            let step = 1;
            while (true) {
                try {
                    const nx = x + vx * step;
                    const ny = y + vy * step;
                    const cid = encodeCoord(nx, ny);
                    const unit = unitByteToUnit(board[cid]);
                    if (forAttack) {
                        // Attack: can only attack first occupied tile
                        if (unit !== null) {
                            reachable.push(cid);
                            break;
                        }
                    }
                    else {
                        // Move: can move to any empty tile before first occupied
                        if (unit !== null) {
                            break;
                        }
                        reachable.push(cid);
                    }
                    step++;
                }
                catch {
                    break;
                }
            }
        }
    }
    else if (height === 6) {
        if (forAttack) {
            // Height 6 attack: t1 adjacency expansion outward until hit unit
            // Use BFS to expand t1 adjacency
            const visited = new Set();
            const queue = [];
            // Start with all 6 neighbors
            for (let dir = 0; dir < 6; dir++) {
                const neighborCid = getNeighborCid(fromCid, dir);
                if (neighborCid !== null) {
                    queue.push({ cid: neighborCid, depth: 1 });
                }
            }
            while (queue.length > 0) {
                const { cid: currentCid, depth } = queue.shift();
                if (visited.has(currentCid))
                    continue;
                visited.add(currentCid);
                const unit = unitByteToUnit(board[currentCid]);
                if (unit !== null) {
                    // First unit encountered - can attack if enemy
                    reachable.push(currentCid);
                    break; // Only first encountered unit
                }
                // Expand to neighbors (t1 adjacency)
                if (depth < 10) { // Limit depth
                    for (let dir = 0; dir < 6; dir++) {
                        const neighborCid = getNeighborCid(currentCid, dir);
                        if (neighborCid !== null && !visited.has(neighborCid)) {
                            queue.push({ cid: neighborCid, depth: depth + 1 });
                        }
                    }
                }
            }
        }
        else {
            // Height 6 move: same as height 4
            const dirVectors = getHeight4DirectionVectors();
            for (const [vx, vy] of dirVectors) {
                let step = 1;
                while (true) {
                    try {
                        const nx = x + vx * step;
                        const ny = y + vy * step;
                        const cid = encodeCoord(nx, ny);
                        const unit = unitByteToUnit(board[cid]);
                        if (unit !== null) {
                            break;
                        }
                        reachable.push(cid);
                        step++;
                    }
                    catch {
                        break;
                    }
                }
            }
        }
    }
    else if (height === 8) {
        // Height 8: t1 adjacency + jump moves
        const adjOffsets = getHeight8Offsets();
        for (const [dx, dy] of adjOffsets) {
            try {
                const cid = encodeCoord(x + dx, y + dy);
                reachable.push(cid);
            }
            catch { }
        }
        // Jump moves: +2*v if intermediate is empty or friendly
        const jumpOffsets = getHeight8JumpOffsets();
        for (let i = 0; i < jumpOffsets.length; i++) {
            const [jdx, jdy] = jumpOffsets[i];
            const [midDx, midDy] = NEIGHBOR_VECTORS[i];
            try {
                const midCid = encodeCoord(x + midDx, y + midDy);
                const midUnit = unitByteToUnit(board[midCid]);
                if (midUnit === null || midUnit.color === color) {
                    // Can jump: intermediate is empty or friendly
                    const cid = encodeCoord(x + jdx, y + jdy);
                    reachable.push(cid);
                }
            }
            catch { }
        }
    }
    return reachable;
}
// Attack pattern: height 8 always attacks as height 2
function getAttackReachableTiles(fromCid, height, color, isTribun, board) {
    if (height === 8) {
        // Height 8 always attacks as height 2
        const { x, y } = decodeCoord(fromCid);
        const offsets = getHeight2Offsets();
        const reachable = [];
        for (const [dx, dy] of offsets) {
            try {
                const cid = encodeCoord(x + dx, y + dy);
                reachable.push(cid);
            }
            catch { }
        }
        return reachable;
    }
    return getReachableTiles(fromCid, height, color, isTribun, board, true);
}
// Generate all legal actions
export function generateLegalActions(state) {
    const actions = [];
    if (state.status === 'ended') {
        return new Uint32Array(0);
    }
    // Generate move actions
    for (let cid = 0; cid < 121; cid++) {
        const unitByte = state.board[cid];
        const unit = unitByteToUnit(unitByte);
        if (unit && unit.color === state.turn && unit.p > 0) {
            // Try primary pattern
            const primaryReachable = getReachableTiles(cid, unit.p, unit.color, unit.tribun, state.board, false);
            for (const toCid of primaryReachable) {
                const targetUnit = unitByteToUnit(state.board[toCid]);
                if (targetUnit === null) {
                    actions.push(encodeMove(cid, toCid, 0));
                }
            }
            // Try secondary pattern if available
            if (unit.s > 0) {
                const secondaryReachable = getReachableTiles(cid, unit.s, unit.color, false, state.board, false);
                for (const toCid of secondaryReachable) {
                    const targetUnit = unitByteToUnit(state.board[toCid]);
                    if (targetUnit === null) {
                        actions.push(encodeMove(cid, toCid, 1));
                    }
                }
            }
        }
    }
    // Generate attack actions
    for (let targetCid = 0; targetCid < 121; targetCid++) {
        const targetUnit = unitByteToUnit(state.board[targetCid]);
        if (!targetUnit || targetUnit.color === state.turn)
            continue;
        // Find all attackers
        const attackers = [];
        for (let cid = 0; cid < 121; cid++) {
            const unit = unitByteToUnit(state.board[cid]);
            if (!unit || unit.color !== state.turn)
                continue;
            // Check primary pattern
            const primaryAttackReachable = getAttackReachableTiles(cid, unit.p, unit.color, unit.tribun, state.board);
            if (primaryAttackReachable.includes(targetCid)) {
                attackers.push({ cid, height: unit.p, part: 0 });
            }
            // Check secondary pattern
            if (unit.s > 0) {
                const secondaryAttackReachable = getAttackReachableTiles(cid, unit.s, unit.color, false, state.board);
                if (secondaryAttackReachable.includes(targetCid)) {
                    attackers.push({ cid, height: unit.s, part: 1 });
                }
            }
        }
        if (attackers.length === 0)
            continue;
        // Calculate total strength
        const totalStrength = attackers.reduce((sum, a) => sum + a.height, 0);
        const targetPrimary = targetUnit.p;
        // Check for tribun attack (instant win)
        if (targetUnit.tribun) {
            // Must have at least one attacker that can reach
            if (attackers.length > 0) {
                // Use first attacker as the moving attacker
                const movingAttacker = attackers[0];
                actions.push(encodeAttackTribun(movingAttacker.cid, targetCid, state.turn));
            }
            continue;
        }
        // Calculate damage
        const damage = Math.min(targetPrimary, totalStrength);
        if (damage >= targetPrimary) {
            // Can kill or enslave
            // Check if can enslave (target not tribun, no secondary, S >= T)
            if (targetUnit.s === 0 && totalStrength >= targetPrimary) {
                // Try enslave for each attacker
                for (const attacker of attackers) {
                    if (attacker.part === 0) { // Only primary pattern can enslave
                        const attackerUnit = unitByteToUnit(state.board[attacker.cid]);
                        // Check if moving primary would satisfy SP
                        const testUnit = {
                            color: state.turn,
                            tribun: attackerUnit.tribun,
                            p: attackerUnit.p,
                            s: targetPrimary,
                        };
                        const normalized = normalizeUnit(testUnit);
                        if (normalized && normalized.p > 0) {
                            actions.push(encodeEnslave(attacker.cid, targetCid));
                        }
                    }
                }
            }
            // Can kill (one attacker moves in)
            for (const attacker of attackers) {
                const attackerUnit = unitByteToUnit(state.board[attacker.cid]);
                // Check if attacker can move to target
                const moveReachable = getReachableTiles(attacker.cid, attacker.part === 0 ? attackerUnit.p : attackerUnit.s, attackerUnit.color, false, state.board, false);
                if (moveReachable.includes(targetCid)) {
                    actions.push(encodeKill(attacker.cid, targetCid, attacker.part));
                }
            }
            // Can liberate if target has secondary
            if (targetUnit.s > 0) {
                actions.push(encodeLiberate(targetCid));
            }
        }
        else {
            // Can only damage
            if (damage > 0) {
                actions.push(encodeDamage(targetCid, damage));
            }
        }
    }
    // Generate combine actions
    for (let centerCid = 0; centerCid < 121; centerCid++) {
        const centerUnit = unitByteToUnit(state.board[centerCid]);
        if (centerUnit !== null)
            continue; // Center must be empty
        // Find adjacent owned units
        const adjacentOwned = [];
        for (let dir = 0; dir < 6; dir++) {
            const neighborCid = getNeighborCid(centerCid, dir);
            if (neighborCid !== null) {
                const unit = unitByteToUnit(state.board[neighborCid]);
                if (unit && unit.color === state.turn && unit.p > 0) {
                    adjacentOwned.push(neighborCid);
                }
            }
        }
        // 2-donor combine
        for (let i = 0; i < adjacentOwned.length; i++) {
            for (let j = i + 1; j < adjacentOwned.length; j++) {
                const donorA = unitByteToUnit(state.board[adjacentOwned[i]]);
                const donorB = unitByteToUnit(state.board[adjacentOwned[j]]);
                // Try different donation amounts
                for (let donA = 1; donA <= Math.min(donorA.p, 8); donA++) {
                    for (let donB = 1; donB <= Math.min(donorB.p, 8); donB++) {
                        const dirA = Array.from({ length: 6 }, (_, d) => getNeighborCid(centerCid, d)).indexOf(adjacentOwned[i]);
                        const dirB = Array.from({ length: 6 }, (_, d) => getNeighborCid(centerCid, d)).indexOf(adjacentOwned[j]);
                        if (dirA >= 0 && dirB >= 0) {
                            actions.push(encodeCombine(centerCid, dirA, dirB, donA, donB));
                        }
                    }
                }
            }
        }
        // Symmetrical combine (3 or 6 donors)
        // Check for 6 donors (all neighbors)
        if (adjacentOwned.length === 6) {
            actions.push(encodeSymCombine(centerCid, 0, 1));
        }
        // Check for 3-donor configurations
        const configs = [
            { dirs: [0, 4, 5], config: 1 },
            { dirs: [3, 1, 2], config: 2 },
        ];
        for (const { dirs, config } of configs) {
            const donorCids = dirs.map(dir => getNeighborCid(centerCid, dir)).filter(cid => cid !== null);
            if (donorCids.length === 3) {
                const units = donorCids.map(cid => unitByteToUnit(state.board[cid])).filter(u => u !== null);
                if (units.length === 3) {
                    // Check if all units are equal and not tribun
                    const firstUnit = units[0];
                    if (!firstUnit.tribun && units.every(u => u.p === firstUnit.p && u.s === firstUnit.s && u.color === firstUnit.color)) {
                        // Try donations of 1 or 2
                        for (let donate = 1; donate <= 2; donate++) {
                            if (firstUnit.p >= donate) {
                                actions.push(encodeSymCombine(centerCid, config, donate));
                            }
                        }
                    }
                }
            }
        }
    }
    // Generate split actions
    for (let actorCid = 0; actorCid < 121; actorCid++) {
        const unit = unitByteToUnit(state.board[actorCid]);
        if (!unit || unit.color !== state.turn || unit.p === 0 || unit.tribun)
            continue;
        // Get adjacent empty tiles
        const adjacentEmpty = [];
        for (let dir = 0; dir < 6; dir++) {
            const neighborCid = getNeighborCid(actorCid, dir);
            if (neighborCid !== null) {
                const neighborUnit = unitByteToUnit(state.board[neighborCid]);
                if (neighborUnit === null) {
                    adjacentEmpty.push(neighborCid);
                }
            }
        }
        // Try all valid splits
        const maxSplits = Math.min(adjacentEmpty.length, 6);
        for (let numSplits = 1; numSplits <= maxSplits; numSplits++) {
            // Generate all combinations of heights
            const heights = new Array(6).fill(0);
            function trySplit(depth, remaining) {
                if (depth === numSplits) {
                    if (remaining === 0)
                        return;
                    const sum = heights.slice(0, numSplits).reduce((a, b) => a + b, 0);
                    const remainder = unit.p - sum;
                    if (remainder > 0 && sum > 0) {
                        // Check validity: all heights must be valid, at least 2 tiles with units
                        const validHeights = [...heights.slice(0, numSplits), remainder].filter(h => h > 0);
                        if (validHeights.length >= 2) {
                            const allValid = validHeights.every(h => [1, 2, 3, 4, 6, 8].includes(h));
                            if (allValid) {
                                actions.push(encodeSplit(actorCid, heights));
                            }
                        }
                    }
                    return;
                }
                for (let h = 1; h <= Math.min(remaining, 7); h++) {
                    if ([1, 2, 3, 4, 6, 8].includes(h) || h <= 4) {
                        heights[depth] = h;
                        trySplit(depth + 1, remaining - h);
                    }
                }
            }
            trySplit(0, unit.p);
        }
    }
    // Generate backstabb actions
    for (let actorCid = 0; actorCid < 121; actorCid++) {
        const unit = unitByteToUnit(state.board[actorCid]);
        if (!unit || unit.color !== state.turn || unit.s === 0)
            continue;
        // Find adjacent empty tiles
        for (let dir = 0; dir < 6; dir++) {
            const neighborCid = getNeighborCid(actorCid, dir);
            if (neighborCid !== null) {
                const neighborUnit = unitByteToUnit(state.board[neighborCid]);
                if (neighborUnit === null) {
                    actions.push(encodeBackstabb(actorCid, dir));
                }
            }
        }
    }
    // Always allow resign
    actions.push(encodeEnd(0, state.turn));
    // Allow draw offer/retract/accept based on state
    if (state.drawOfferBy === null) {
        actions.push(encodeDraw(0, state.turn));
    }
    else if (state.drawOfferBy === state.turn) {
        actions.push(encodeDraw(1, state.turn));
    }
    else {
        actions.push(encodeDraw(2, state.turn));
    }
    // Sort for stability
    actions.sort((a, b) => a - b);
    return new Uint32Array(actions);
}
// Apply action to state
export function applyAction(state, action) {
    if (state.status === 'ended') {
        throw new Error('Cannot apply action to ended game');
    }
    const { opcode: op, fields } = decodeAction(action);
    const newBoard = new Uint8Array(state.board);
    let newTurn = state.turn === 0 ? 1 : 0;
    let newPly = state.ply + 1;
    let newDrawOfferBy = state.drawOfferBy;
    let newStatus = state.status || 'active';
    let newWinner = state.winner;
    switch (op) {
        case 0: { // MOVE
            const fromCid = fields.fromCid;
            const toCid = fields.toCid;
            const part = fields.part;
            const fromUnit = unitByteToUnit(newBoard[fromCid]);
            if (!fromUnit || fromUnit.color !== state.turn) {
                throw new Error(`Illegal MOVE: no unit or wrong color at fromCid ${fromCid}`);
            }
            const toUnit = unitByteToUnit(newBoard[toCid]);
            if (toUnit !== null) {
                throw new Error(`Illegal MOVE: target tile not empty at toCid ${toCid}`);
            }
            // Validate move is legal
            const reachable = getReachableTiles(fromCid, part === 0 ? fromUnit.p : fromUnit.s, fromUnit.color, part === 0 ? fromUnit.tribun : false, newBoard, false);
            if (!reachable.includes(toCid)) {
                throw new Error(`Illegal MOVE: destination not reachable`);
            }
            if (part === 0) {
                // Primary pattern: move only primary
                const movedUnit = {
                    color: fromUnit.color,
                    tribun: fromUnit.tribun,
                    p: fromUnit.p,
                    s: 0,
                };
                newBoard[toCid] = unitToUnitByte(movedUnit);
                // Update from tile: if had secondary, keep it; otherwise empty
                if (fromUnit.s > 0) {
                    const remainingUnit = {
                        color: fromUnit.color,
                        tribun: false,
                        p: 0,
                        s: fromUnit.s,
                    };
                    const normalized = normalizeUnit(remainingUnit);
                    newBoard[fromCid] = normalized ? unitToUnitByte(normalized) : 0;
                }
                else {
                    newBoard[fromCid] = 0;
                }
            }
            else {
                // Secondary pattern: move entire stack
                newBoard[toCid] = newBoard[fromCid];
                newBoard[fromCid] = 0;
            }
            break;
        }
        case 1: { // KILL
            const attackerCid = fields.attackerCid;
            const targetCid = fields.targetCid;
            const part = fields.part;
            const attackerUnit = unitByteToUnit(newBoard[attackerCid]);
            const targetUnit = unitByteToUnit(newBoard[targetCid]);
            if (!attackerUnit || attackerUnit.color !== state.turn) {
                throw new Error(`Illegal KILL: invalid attacker`);
            }
            if (!targetUnit || targetUnit.color === state.turn) {
                throw new Error(`Illegal KILL: invalid target`);
            }
            // Remove target
            newBoard[targetCid] = 0;
            // Move attacker
            const moveHeight = part === 0 ? attackerUnit.p : attackerUnit.s;
            const reachable = getReachableTiles(attackerCid, moveHeight, attackerUnit.color, false, newBoard, false);
            if (!reachable.includes(targetCid)) {
                throw new Error(`Illegal KILL: attacker cannot reach target`);
            }
            if (part === 0) {
                // Move primary only
                const movedUnit = {
                    color: attackerUnit.color,
                    tribun: attackerUnit.tribun,
                    p: attackerUnit.p,
                    s: 0,
                };
                newBoard[targetCid] = unitToUnitByte(movedUnit);
                if (attackerUnit.s > 0) {
                    const remainingUnit = {
                        color: attackerUnit.color,
                        tribun: false,
                        p: 0,
                        s: attackerUnit.s,
                    };
                    const normalized = normalizeUnit(remainingUnit);
                    newBoard[attackerCid] = normalized ? unitToUnitByte(normalized) : 0;
                }
                else {
                    newBoard[attackerCid] = 0;
                }
            }
            else {
                // Move entire stack
                newBoard[targetCid] = newBoard[attackerCid];
                newBoard[attackerCid] = 0;
            }
            break;
        }
        case 2: { // LIBERATE
            const targetCid = fields.targetCid;
            const targetUnit = unitByteToUnit(newBoard[targetCid]);
            if (!targetUnit || targetUnit.color === state.turn || targetUnit.s === 0) {
                throw new Error(`Illegal LIBERATE: invalid target`);
            }
            // Liberation: flip color, p := s, s := 0, tribun := false
            const liberatedUnit = {
                color: targetUnit.color === 0 ? 1 : 0,
                tribun: false,
                p: targetUnit.s,
                s: 0,
            };
            const normalized = normalizeUnit(liberatedUnit);
            newBoard[targetCid] = normalized ? unitToUnitByte(normalized) : 0;
            break;
        }
        case 3: { // DAMAGE
            const targetCid = fields.targetCid;
            const effectiveDamage = fields.effectiveDamage;
            const targetUnit = unitByteToUnit(newBoard[targetCid]);
            if (!targetUnit || targetUnit.color === state.turn) {
                throw new Error(`Illegal DAMAGE: invalid target`);
            }
            // Apply effective damage (already normalized)
            const newP = Math.max(0, targetUnit.p - effectiveDamage);
            const damagedUnit = {
                ...targetUnit,
                p: newP,
            };
            const normalized = normalizeUnit(damagedUnit);
            newBoard[targetCid] = normalized ? unitToUnitByte(normalized) : 0;
            break;
        }
        case 4: { // ENSLAVE
            const attackerCid = fields.attackerCid;
            const targetCid = fields.targetCid;
            const attackerUnit = unitByteToUnit(newBoard[attackerCid]);
            const targetUnit = unitByteToUnit(newBoard[targetCid]);
            if (!attackerUnit || attackerUnit.color !== state.turn) {
                throw new Error(`Illegal ENSLAVE: invalid attacker`);
            }
            if (!targetUnit || targetUnit.color === state.turn || targetUnit.tribun || targetUnit.s > 0) {
                throw new Error(`Illegal ENSLAVE: invalid target`);
            }
            // Enslave: target becomes enslaved, attacker's primary moves to target
            const enslavedUnit = {
                color: state.turn,
                tribun: attackerUnit.tribun,
                p: attackerUnit.p,
                s: targetUnit.p,
            };
            const normalized = normalizeUnit(enslavedUnit);
            if (!normalized || normalized.p === 0) {
                throw new Error(`Illegal ENSLAVE: would violate SP`);
            }
            newBoard[targetCid] = unitToUnitByte(normalized);
            // Attacker loses primary, any slave is liberated
            if (attackerUnit.s > 0) {
                const remainingUnit = {
                    color: attackerUnit.color,
                    tribun: false,
                    p: 0,
                    s: attackerUnit.s,
                };
                const libUnit = normalizeUnit(remainingUnit);
                newBoard[attackerCid] = libUnit ? unitToUnitByte(libUnit) : 0;
            }
            else {
                newBoard[attackerCid] = 0;
            }
            break;
        }
        case 5: { // COMBINE
            const centerCid = fields.centerCid;
            const dirA = fields.dirA;
            const dirB = fields.dirB;
            const donateA = fields.donateA;
            const donateB = fields.donateB;
            const centerUnit = unitByteToUnit(newBoard[centerCid]);
            if (centerUnit !== null) {
                throw new Error(`Illegal COMBINE: center not empty`);
            }
            const donorACid = getNeighborCid(centerCid, dirA);
            const donorBCid = getNeighborCid(centerCid, dirB);
            if (donorACid === null || donorBCid === null) {
                throw new Error(`Illegal COMBINE: invalid donor positions`);
            }
            const donorA = unitByteToUnit(newBoard[donorACid]);
            const donorB = unitByteToUnit(newBoard[donorBCid]);
            if (!donorA || !donorB || donorA.color !== state.turn || donorB.color !== state.turn) {
                throw new Error(`Illegal COMBINE: invalid donors`);
            }
            if (donateA > donorA.p || donateB > donorB.p) {
                throw new Error(`Illegal COMBINE: donation exceeds primary`);
            }
            // Create new unit
            const newPrimary = donateA + donateB;
            const hasTribun = donorA.tribun || donorB.tribun;
            if (hasTribun && (donateA !== donorA.p || donateB !== donorB.p)) {
                throw new Error(`Illegal COMBINE: tribun must donate entire primary`);
            }
            const combinedUnit = {
                color: state.turn,
                tribun: hasTribun,
                p: roundDownInvalidHeight(newPrimary),
                s: 0,
            };
            const normalized = normalizeUnit(combinedUnit);
            if (!normalized || normalized.p === 0) {
                throw new Error(`Illegal COMBINE: invalid resulting height`);
            }
            newBoard[centerCid] = unitToUnitByte(normalized);
            // Update donors
            const newDonorA = {
                ...donorA,
                p: (donorA.p - donateA),
                tribun: donorA.tribun && donateA === donorA.p ? false : donorA.tribun,
            };
            const normA = normalizeUnit(newDonorA);
            newBoard[donorACid] = normA ? unitToUnitByte(normA) : 0;
            const newDonorB = {
                ...donorB,
                p: (donorB.p - donateB),
                tribun: donorB.tribun && donateB === donorB.p ? false : donorB.tribun,
            };
            const normB = normalizeUnit(newDonorB);
            newBoard[donorBCid] = normB ? unitToUnitByte(normB) : 0;
            break;
        }
        case 6: { // SYM_COMBINE
            const centerCid = fields.centerCid;
            const config = fields.config;
            const donate = fields.donate;
            const centerUnit = unitByteToUnit(newBoard[centerCid]);
            if (centerUnit !== null) {
                throw new Error(`Illegal SYM_COMBINE: center not empty`);
            }
            let donorCids = [];
            if (config === 0) {
                // 6 donors
                if (donate !== 1) {
                    throw new Error(`Illegal SYM_COMBINE: 6-donor must donate 1`);
                }
                for (let dir = 0; dir < 6; dir++) {
                    const cid = getNeighborCid(centerCid, dir);
                    if (cid !== null)
                        donorCids.push(cid);
                }
            }
            else if (config === 1) {
                // 3 donors: dirs 0, 4, 5
                donorCids = [0, 4, 5].map(dir => getNeighborCid(centerCid, dir)).filter(cid => cid !== null);
            }
            else if (config === 2) {
                // 3 donors: dirs 3, 1, 2
                donorCids = [3, 1, 2].map(dir => getNeighborCid(centerCid, dir)).filter(cid => cid !== null);
            }
            if (donorCids.length !== (config === 0 ? 6 : 3)) {
                throw new Error(`Illegal SYM_COMBINE: wrong number of donors`);
            }
            const donors = donorCids.map(cid => unitByteToUnit(newBoard[cid])).filter(u => u !== null);
            if (donors.length !== donorCids.length) {
                throw new Error(`Illegal SYM_COMBINE: missing donors`);
            }
            // Check all donors are equal and not tribun
            const firstDonor = donors[0];
            if (firstDonor.tribun || !donors.every(d => d.p === firstDonor.p && d.s === firstDonor.s && d.color === firstDonor.color)) {
                throw new Error(`Illegal SYM_COMBINE: donors must be equal and not tribun`);
            }
            if (donate > firstDonor.p) {
                throw new Error(`Illegal SYM_COMBINE: donation exceeds primary`);
            }
            // Create combined unit
            const newPrimary = donate * donorCids.length;
            const combinedUnit = {
                color: state.turn,
                tribun: false,
                p: roundDownInvalidHeight(newPrimary),
                s: 0,
            };
            const normalized = normalizeUnit(combinedUnit);
            if (!normalized || normalized.p === 0) {
                throw new Error(`Illegal SYM_COMBINE: invalid resulting height`);
            }
            newBoard[centerCid] = unitToUnitByte(normalized);
            // Update donors
            for (const cid of donorCids) {
                const donor = unitByteToUnit(newBoard[cid]);
                const newDonor = {
                    ...donor,
                    p: (donor.p - donate),
                };
                const normDonor = normalizeUnit(newDonor);
                newBoard[cid] = normDonor ? unitToUnitByte(normDonor) : 0;
            }
            break;
        }
        case 7: { // SPLIT
            const actorCid = fields.actorCid;
            const heights = [fields.h0, fields.h1, fields.h2, fields.h3, fields.h4, fields.h5];
            const actorUnit = unitByteToUnit(newBoard[actorCid]);
            if (!actorUnit || actorUnit.color !== state.turn || actorUnit.p === 0 || actorUnit.tribun) {
                throw new Error(`Illegal SPLIT: invalid actor`);
            }
            const totalSplit = heights.reduce((a, b) => a + b, 0);
            const remainder = actorUnit.p - totalSplit;
            if (remainder < 0) {
                throw new Error(`Illegal SPLIT: split exceeds primary`);
            }
            // Get adjacent tiles
            const adjacentCids = [];
            for (let dir = 0; dir < 6; dir++) {
                adjacentCids.push(getNeighborCid(actorCid, dir));
            }
            // Place heights on adjacent tiles
            let placedCount = remainder > 0 ? 1 : 0; // Count origin if remainder > 0
            for (let i = 0; i < 6; i++) {
                if (heights[i] > 0) {
                    const targetCid = adjacentCids[i];
                    if (targetCid === null) {
                        throw new Error(`Illegal SPLIT: invalid target position`);
                    }
                    const targetUnit = unitByteToUnit(newBoard[targetCid]);
                    if (targetUnit !== null) {
                        throw new Error(`Illegal SPLIT: target not empty`);
                    }
                    const splitUnit = {
                        color: state.turn,
                        tribun: false,
                        p: roundDownInvalidHeight(heights[i]),
                        s: 0,
                    };
                    const normalized = normalizeUnit(splitUnit);
                    if (!normalized || normalized.p === 0) {
                        throw new Error(`Illegal SPLIT: invalid split height`);
                    }
                    newBoard[targetCid] = unitToUnitByte(normalized);
                    placedCount++;
                }
            }
            if (placedCount < 2) {
                throw new Error(`Illegal SPLIT: must create at least 2 units`);
            }
            // Update origin
            if (remainder > 0) {
                const remainingUnit = {
                    ...actorUnit,
                    p: roundDownInvalidHeight(remainder),
                };
                const normalized = normalizeUnit(remainingUnit);
                newBoard[actorCid] = normalized ? unitToUnitByte(normalized) : 0;
            }
            else {
                // Origin becomes empty or has secondary
                if (actorUnit.s > 0) {
                    const remainingUnit = {
                        color: actorUnit.color,
                        tribun: false,
                        p: 0,
                        s: actorUnit.s,
                    };
                    const normalized = normalizeUnit(remainingUnit);
                    newBoard[actorCid] = normalized ? unitToUnitByte(normalized) : 0;
                }
                else {
                    newBoard[actorCid] = 0;
                }
            }
            break;
        }
        case 8: { // BACKSTABB
            const actorCid = fields.actorCid;
            const dir = fields.dir;
            const actorUnit = unitByteToUnit(newBoard[actorCid]);
            if (!actorUnit || actorUnit.color !== state.turn || actorUnit.s === 0) {
                throw new Error(`Illegal BACKSTABB: invalid actor`);
            }
            const targetCid = getNeighborCid(actorCid, dir);
            if (targetCid === null) {
                throw new Error(`Illegal BACKSTABB: invalid target position`);
            }
            const targetUnit = unitByteToUnit(newBoard[targetCid]);
            if (targetUnit !== null) {
                throw new Error(`Illegal BACKSTABB: target not empty`);
            }
            // Place primary on target, destroy secondary
            const newUnit = {
                color: actorUnit.color,
                tribun: actorUnit.tribun,
                p: actorUnit.p,
                s: 0,
            };
            newBoard[targetCid] = unitToUnitByte(newUnit);
            newBoard[actorCid] = 0;
            break;
        }
        case 9: { // ATTACK_TRIBUN
            const attackerCid = fields.attackerCid;
            const tribunCid = fields.tribunCid;
            const winnerColor = fields.winnerColor;
            if (winnerColor !== state.turn) {
                throw new Error(`Illegal ATTACK_TRIBUN: winner must be current player`);
            }
            const attackerUnit = unitByteToUnit(newBoard[attackerCid]);
            const tribunUnit = unitByteToUnit(newBoard[tribunCid]);
            if (!attackerUnit || attackerUnit.color !== state.turn) {
                throw new Error(`Illegal ATTACK_TRIBUN: invalid attacker`);
            }
            if (!tribunUnit || !tribunUnit.tribun || tribunUnit.color === state.turn) {
                throw new Error(`Illegal ATTACK_TRIBUN: invalid tribun target`);
            }
            // Game ends with winner
            newStatus = 'ended';
            newWinner = winnerColor;
            break;
        }
        case 10: { // DRAW
            const drawAction = fields.drawAction;
            const actorColor = fields.actorColor;
            if (drawAction === 0) {
                // Offer
                newDrawOfferBy = actorColor;
            }
            else if (drawAction === 1) {
                // Retract
                if (newDrawOfferBy === actorColor) {
                    newDrawOfferBy = null;
                }
            }
            else if (drawAction === 2) {
                // Accept - game ends as tie
                if (newDrawOfferBy !== null && newDrawOfferBy !== actorColor) {
                    newStatus = 'ended';
                    newWinner = null; // Tie
                    newDrawOfferBy = null;
                }
                else {
                    throw new Error(`Illegal DRAW accept: no active offer from opponent`);
                }
            }
            break;
        }
        case 11: { // END
            const endReason = fields.endReason;
            const loserColor = fields.loserColor;
            newStatus = 'ended';
            if (endReason === 3) {
                // Timeout game tie
                newWinner = null;
            }
            else {
                // Resign, no-legal-moves, or timeout-player
                newWinner = loserColor === 0 ? 1 : 0;
            }
            break;
        }
        default:
            throw new Error(`Unknown opcode: ${op}`);
    }
    return {
        board: newBoard,
        turn: newTurn,
        ply: newPly,
        drawOfferBy: newDrawOfferBy,
        status: newStatus,
        winner: newWinner,
    };
}
// Create initial board from default position
export function createInitialBoard() {
    const board = new Uint8Array(121);
    // Use default position from JSON file
    const defaultPosition = defaultPositionData;
    // Place black units
    for (const [unitType, coords] of Object.entries(defaultPosition.black)) {
        const height = unitType === "t1" ? 1 : parseInt(unitType);
        const isTribun = unitType === "t1";
        for (const [x, y] of coords) {
            const cid = encodeCoord(x, y);
            const unit = {
                color: 0, // black
                tribun: isTribun,
                p: height,
                s: 0,
            };
            board[cid] = unitToUnitByte(unit);
        }
    }
    // Place white units
    for (const [unitType, coords] of Object.entries(defaultPosition.white)) {
        const height = unitType === "t1" ? 1 : parseInt(unitType);
        const isTribun = unitType === "t1";
        for (const [x, y] of coords) {
            const cid = encodeCoord(x, y);
            const unit = {
                color: 1, // white
                tribun: isTribun,
                p: height,
                s: 0,
            };
            board[cid] = unitToUnitByte(unit);
        }
    }
    return board;
}
//# sourceMappingURL=index.js.map