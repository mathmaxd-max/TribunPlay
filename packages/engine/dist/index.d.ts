import defaultPosition from './default-position.json';
export type Color = 0 | 1;
export type Height = 0 | 1 | 2 | 3 | 4 | 6 | 8;
export interface Unit {
    color: Color;
    tribun: boolean;
    p: Height;
    s: Height;
}
export interface State {
    board: Uint8Array;
    turn: Color;
    ply: number;
    drawOfferBy: Color | null;
    status?: 'active' | 'ended';
    winner?: Color | null;
}
export declare function onBoard(x: number, y: number): boolean;
export declare function encodeCoord(x: number, y: number): number;
export declare function decodeCoord(cid: number): {
    x: number;
    y: number;
};
export declare function isValidTile(cid: number): boolean;
export declare function unitByteToUnit(b: number): Unit | null;
export declare function unitToUnitByte(u: Unit | null): number;
export declare function opcode(word: number): number;
export declare function payload(word: number): number;
export declare function encodeMove(fromCid: number, toCid: number, part: 0 | 1): number;
export declare function encodeKill(attackerCid: number, targetCid: number, part: 0 | 1): number;
export declare function encodeLiberate(targetCid: number): number;
export declare function encodeDamage(targetCid: number, effectiveDamage: number): number;
export declare function encodeEnslave(attackerCid: number, targetCid: number): number;
export declare function encodeCombine(centerCid: number, dirA: number, dirB: number, donateA: number, donateB: number): number;
export declare function encodeSymCombine(centerCid: number, config: 0 | 1 | 2, donate: number): number;
export declare function encodeSplit(actorCid: number, heights: [number, number, number, number, number, number]): number;
export declare function encodeBackstabb(actorCid: number, dir: number): number;
export declare function encodeAttackTribun(attackerCid: number, tribunCid: number, winnerColor: Color): number;
export declare function encodeDraw(drawAction: 0 | 1 | 2, actorColor: Color): number;
export declare function encodeEnd(endReason: number, loserColor?: Color): number;
export declare function decodeAction(action: number): {
    opcode: number;
    fields: Record<string, number>;
};
export declare function packBoard(board: Uint8Array): string;
export declare function unpackBoard(b64: string): Uint8Array;
export declare function generateLegalActions(state: State): Uint32Array;
export declare function applyAction(state: State, action: number): State;
export interface DefaultPosition {
    black: {
        [unitType: string]: number[][];
    };
    white: {
        [unitType: string]: number[][];
    };
}
export declare function createInitialBoard(customInput?: DefaultPosition | Uint8Array | string): Uint8Array;
export { defaultPosition };
export declare function createInitialBoardFromCids(units: Record<string, number[]>): Uint8Array;
export * from './ui-backend';
//# sourceMappingURL=index.d.ts.map