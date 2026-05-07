import defaultPosition from './default-position.json';
import { type SetupDecoded, type SetupMasks } from './setup/TribunSetupCodec';
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
    drawOfferBlocked: Color | null;
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
export declare function encodeDraw(drawAction: 0 | 1 | 2 | 3, actorColor: Color): number;
export declare function encodeEnd(endReason: number, loserColor?: Color): number;
export declare function decodeAction(action: number): {
    opcode: number;
    fields: Record<string, number>;
};
export declare function packBoard(board: Uint8Array): string;
export declare function unpackBoard(b64: string): Uint8Array;
export interface TileChange {
    cid: number;
    beforeByte: number;
    afterByte: number;
    beforeUnit: Unit | null;
    afterUnit: Unit | null;
}
export interface BoardDelta {
    changedCids: number[];
    tileChanges: TileChange[];
}
export declare function deriveBoardDelta(beforeBoard: Uint8Array, afterBoard: Uint8Array): BoardDelta;
export declare function getAttackReachableTiles(fromCid: number, height: Height, color: Color, isTribun: boolean, board: Uint8Array): number[];
export declare function generateLegalActions(state: State): Uint32Array;
export declare function applyAction(state: State, action: number): State;
export type SetupMode = 'shared' | 'free';
export interface SetupSelection {
    hash: string;
    flip: boolean;
}
export interface SetupConfig {
    enabled: boolean;
    mode: SetupMode;
    sharedSelection: {
        hash: string;
        flipBlack: boolean;
        flipWhite: boolean;
    } | null;
    allowedTribunHeights: Array<1 | 2 | 3>;
    armySize: {
        min: number | null;
        max: number | null;
    };
}
export type SetupSelectionsBySide = {
    black: SetupSelection | null;
    white: SetupSelection | null;
};
export interface SetupLibraryItem {
    id: string;
    name: string;
    hash: string;
    armySize: number;
    tribunHeight: 1 | 2 | 3;
    createdAt: string;
    updatedAt: string;
}
export type SetupValidationErrorCode = 'INVALID_HASH' | 'TRIBUN_HEIGHT_NOT_ALLOWED' | 'ARMY_SIZE_TOO_SMALL' | 'ARMY_SIZE_TOO_LARGE' | 'SETUP_OVERLAP' | 'SETUP_REQUIRED';
export interface SetupValidationIssue {
    code: SetupValidationErrorCode;
    message: string;
    side?: 'black' | 'white';
}
export type SetupBoardBuildResult = {
    ok: true;
    board: Uint8Array;
    selections: {
        black: SetupSelection;
        white: SetupSelection;
    };
    decoded: {
        black: SetupDecoded;
        white: SetupDecoded;
    };
} | {
    ok: false;
    issues: SetupValidationIssue[];
};
export declare function flipSetup(setup: SetupMasks): SetupMasks;
export declare function normalizeSetupHash(hash: string): string;
export declare function normalizeSetupConfig(raw?: Partial<SetupConfig> | null): SetupConfig;
export declare function validateSetupSelection(selection: SetupSelection | null, config: SetupConfig, side: 'black' | 'white'): {
    ok: true;
    selection: SetupSelection;
    decoded: SetupDecoded;
} | {
    ok: false;
    issues: SetupValidationIssue[];
};
export declare function buildBoardFromSetups(params: {
    config: SetupConfig;
    freeSelections?: SetupSelectionsBySide | null;
}): SetupBoardBuildResult;
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
export * from "./setup/TribunSetupCodec";
export * from './ui-backend';
//# sourceMappingURL=index.d.ts.map