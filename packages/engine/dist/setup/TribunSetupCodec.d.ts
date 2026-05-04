export type UnitKind = "_" | "1" | "2" | "3" | "1T" | "2T" | "3T";
export type Orientation = "UP" | "DOWN";
export interface SetupMasks {
    tribTile: number;
    mask3: bigint;
    mask2: bigint;
    mask1: bigint;
}
export interface SetupDecoded extends SetupMasks {
    tribunHeight: 1 | 2 | 3;
    freeN: number;
    costArmy: number;
    armySize: number;
}
export type EncodeError = {
    kind: "OUT_OF_RANGE_TRIB_TILE";
    tribTile: number;
} | {
    kind: "MASK_OUT_OF_RANGE";
    which: "mask1" | "mask2" | "mask3";
} | {
    kind: "OVERLAP";
    tile: number;
} | {
    kind: "TRIB_TILE_NOT_OCCUPIED";
    tribTile: number;
} | {
    kind: "TRIB_TILE_MULTIPLE_HEIGHTS";
    tribTile: number;
} | {
    kind: "PAYMENT_2_FOR_3_FAIL";
    n2: number;
    n3: number;
} | {
    kind: "PAYMENT_1_FOR_2_FAIL";
    n1: number;
    n2: number;
} | {
    kind: "TRIANGLE_EQUAL_UNITS";
    center: number;
    orientation: Orientation;
    vertices: [number, number, number];
    unit: UnitKind;
};
export interface EncodeResult {
    code: string;
    ok: boolean;
    error?: EncodeError;
    characteristics?: {
        tribunHeight: 1 | 2 | 3;
        armySize: number;
    };
}
export interface DecodeResult {
    ok: boolean;
    setup?: SetupDecoded;
    error?: {
        kind: "INVALID_CODE" | "OUT_OF_RANGE_PAYLOAD" | "DECODED_SETUP_INVALID";
        details?: EncodeError;
    };
}
export declare const INVALID_SETUP_CODE: string;
export declare const SETUP_REGION_RED = 15;
export declare const SETUP_REGION_ORANGE = 26;
export declare const SETUP_REGION_YELLOW = 32;
export declare const SETUP_REGION_LIME = 37;
export declare const SETUP_TILE_COUNT = 37;
export declare const SETUP_ROW_LENGTHS: number[];
export declare const ALPHABET37 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ#";
/**
 * Legacy name kept for UI compatibility: a "position" is now a bitmap setup.
 */
export type Position = SetupMasks;
export declare function encodePosition(setup: SetupMasks): string;
export declare function encodePositionDetailed(setup: SetupMasks): EncodeResult;
export declare function decodeCode(code: string): SetupDecoded | null;
export declare function decodeCodeDetailed(code: string): DecodeResult;
export declare function validatePositionDetailed(setup: SetupMasks): {
    ok: true;
    position: SetupMasks;
} | {
    ok: false;
    error: EncodeError;
};
/**
 * Parses a 37-tile semicolon string into masks.
 *
 * Accepted cell tokens:
 * - `_` or empty: empty tile
 * - `1`, `2`, `3`: non-trib units
 * - `1T`, `2T`, `3T`: tribun tile at given height (exactly one must exist)
 */
export declare function parseBoardString(board: string): SetupMasks | null;
export declare function group4(code16: string): string;
export declare function selfTestDefault(): {
    ok: boolean;
    code: string;
    grouped: string;
};
//# sourceMappingURL=TribunSetupCodec.d.ts.map