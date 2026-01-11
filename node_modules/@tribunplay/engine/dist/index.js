// Coordinate encoding/decoding
const R = 5;
export function onBoard(x, y) {
    const z = -x - y;
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
export function encodeAttackTribun(attackerCid) {
    return (9 << 28) | attackerCid;
}
// DRAW: opcode 10
export function encodeDraw(drawAction, actorColor) {
    // drawAction: 0=offer, 1=retract, 2=accept
    return (10 << 28) | (actorColor << 1) | drawAction;
}
// END: opcode 11
export function encodeEnd(endReason, winnerColor) {
    // endReason: 0=resign, 1=no-legal-moves, 2=timeout-player, 3=timeout-game-tie
    let payload = endReason;
    if (winnerColor !== undefined) {
        payload |= (winnerColor << 2);
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
            break;
        case 10: // DRAW
            fields.drawAction = pay & 0x3;
            fields.actorColor = (pay >>> 1) & 0x1;
            break;
        case 11: // END
            fields.endReason = pay & 0x3;
            fields.winnerColor = (pay >>> 2) & 0x1;
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
// MVP: Simple legal moves generator (only MOVE to adjacent tiles)
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
export function generateLegalActions(state) {
    const actions = [];
    // MVP: Simple rules - only MOVE actions
    // Find units of current player's color
    for (let cid = 0; cid < 121; cid++) {
        const unitByte = state.board[cid];
        const unit = unitByteToUnit(unitByte);
        if (unit && unit.color === state.turn && unit.p > 0) {
            // Try moving to each neighbor
            for (let dir = 0; dir < 6; dir++) {
                const toCid = getNeighborCid(cid, dir);
                if (toCid !== null) {
                    const targetUnit = unitByteToUnit(state.board[toCid]);
                    // MVP: Only allow moving to empty tiles
                    if (targetUnit === null) {
                        actions.push(encodeMove(cid, toCid, 0)); // primary pattern
                    }
                }
            }
        }
    }
    // Always allow resign (END opcode 11, reason 0)
    actions.push(encodeEnd(0, state.turn));
    // Allow draw offer/retract/accept based on state
    if (state.drawOfferBy === null) {
        // Can offer draw
        actions.push(encodeDraw(0, state.turn));
    }
    else if (state.drawOfferBy === state.turn) {
        // Can retract own offer
        actions.push(encodeDraw(1, state.turn));
    }
    else {
        // Can accept opponent's offer
        actions.push(encodeDraw(2, state.turn));
    }
    // Sort for stability
    actions.sort((a, b) => a - b);
    return new Uint32Array(actions);
}
// MVP: Simple applyAction (only handles MOVE, DRAW, END)
export function applyAction(state, action) {
    const { opcode: op, fields } = decodeAction(action);
    // Create new state
    const newBoard = new Uint8Array(state.board);
    let newTurn = state.turn === 0 ? 1 : 0;
    let newPly = state.ply + 1;
    let newDrawOfferBy = state.drawOfferBy;
    switch (op) {
        case 0: // MOVE
            {
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
                if (part === 0) {
                    // Primary pattern: move only primary
                    const movedUnit = { ...fromUnit, s: 0 }; // Leave secondary behind
                    newBoard[toCid] = unitToUnitByte(movedUnit);
                    // Update from tile: if had secondary, keep it; otherwise empty
                    if (fromUnit.s > 0) {
                        const remainingUnit = {
                            color: fromUnit.color,
                            tribun: false, // Secondary never has tribun
                            p: 0,
                            s: fromUnit.s,
                        };
                        newBoard[fromCid] = unitToUnitByte(remainingUnit);
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
            }
            break;
        case 10: // DRAW
            {
                const drawAction = fields.drawAction;
                const actorColor = fields.actorColor;
                if (actorColor !== state.turn) {
                    throw new Error(`Illegal DRAW: not actor's turn`);
                }
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
                    // Accept - game ends (for MVP, we'll just mark it)
                    // In full implementation, this would set status to 'ended'
                    newDrawOfferBy = null;
                }
            }
            break;
        case 11: // END
            {
                // Game ends - for MVP, we just accept it
                // In full implementation, would set status and winner
            }
            break;
        default:
            throw new Error(`Opcode ${op} not implemented in MVP`);
    }
    return {
        board: newBoard,
        turn: newTurn,
        ply: newPly,
        drawOfferBy: newDrawOfferBy,
    };
}
//# sourceMappingURL=index.js.map