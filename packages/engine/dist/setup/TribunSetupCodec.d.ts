export type Scenario = 0 | 1 | 2 | 3;
export type UnitKind = "_" | "1" | "1T" | "2" | "2T" | "3" | "3T";
export interface Position {
    scenario: Scenario;
    tribTile: number;
    threes: number[];
    twos: number[];
    ones: number[];
}
export type EncodeError = {
    kind: "NO_TRIBUN";
} | {
    kind: "MULTIPLE_TRIBUNS";
} | {
    kind: "OUT_OF_RANGE_TILE";
    tile: number;
} | {
    kind: "OVERLAP";
    tile: number;
} | {
    kind: "AREA_VIOLATION";
    unit: UnitKind;
    tile: number;
} | {
    kind: "PAYMENT_2_FOR_3_FAIL";
    n2: number;
    n3: number;
} | {
    kind: "PAYMENT_1_FOR_2_FAIL";
    n1: number;
    n2: number;
    scenario: Scenario;
} | {
    kind: "N_BUDGET_FAIL";
    usedN: number;
    expectedN: number;
} | {
    kind: "TRIANGLE_EQUAL_UNITS";
    center: number;
    orientation: "UP" | "DOWN";
    vertices: [number, number, number];
    unit: UnitKind;
} | {
    kind: "UNKNOWN_CASE_COUNTS";
    n1: number;
    n2: number;
    n3: number;
    scenario: Scenario;
};
export interface EncodeResult {
    code: string;
    ok: boolean;
    error?: EncodeError;
}
export interface DecodeResult {
    ok: boolean;
    position?: Position;
    error?: {
        kind: "INVALID_CODE" | "OUT_OF_RANGE_RANK" | "DECODED_POSITION_INVALID";
        details?: EncodeError;
    };
}
export declare const INVALID_SETUP_CODE = "------------";
export declare const SETUP_REGION_RED = 15;
export declare const SETUP_REGION_ORANGE = 26;
export declare const SETUP_REGION_YELLOW = 32;
export declare const SETUP_REGION_LIME = 37;
export declare const SETUP_TILE_COUNT = 37;
export declare const SETUP_ROW_LENGTHS: number[];
type ScenarioDef = {
    scenario: Scenario;
    tribKind: UnitKind;
    tribHeight: 1 | 2 | 3;
    free1: number;
    free2: number;
    relaxOneVsTwoBy: number;
    tribAreaMaxExclusive: number;
};
export declare function getScenarioDefinition(scenario: Scenario): ScenarioDef;
export declare function encodePosition(pos: Position): string;
export declare function encodePositionDetailed(pos: Position): EncodeResult;
export declare function decodeCode(code: string): Position | null;
export declare function decodeCodeDetailed(code: string): DecodeResult;
export declare function validatePositionDetailed(pos: Position): {
    ok: true;
    position: Position;
} | {
    ok: false;
    error: EncodeError;
};
export declare function parseBoardString(board: string, scenario: Scenario): Position | null;
export {};
//# sourceMappingURL=TribunSetupCodec.d.ts.map