import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import tsImport from "typescript";

const ts = tsImport.default ?? tsImport;

const HEIGHT_TO_INDEX = new Map([
  [0, 0],
  [1, 1],
  [2, 2],
  [3, 3],
  [4, 4],
  [6, 5],
  [8, 6],
]);
const INDEX_TO_HEIGHT = [0, 1, 2, 3, 4, 6, 8, 0];
const RADIUS = 5;

function onBoard(x, y) {
  const z = y - x;
  return Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= RADIUS;
}

function encodeCoord(x, y) {
  const value = (x + 5) * 11 + (y + 5);
  if (value < 0 || value > 120 || !onBoard(x, y)) throw new Error(`off board: (${x}, ${y})`);
  return value;
}

function isValidTile(cidValue) {
  if (cidValue < 0 || cidValue > 120) return false;
  const x = Math.floor(cidValue / 11) - 5;
  const y = (cidValue % 11) - 5;
  return onBoard(x, y);
}

function unitByteToUnit(byteValue) {
  if (byteValue === 0) return null;
  const p = INDEX_TO_HEIGHT[byteValue & 0x7] ?? 0;
  const s = INDEX_TO_HEIGHT[(byteValue >>> 3) & 0x7] ?? 0;
  const color = (byteValue >>> 6) & 0x1;
  const tribun = ((byteValue >>> 7) & 0x1) === 1;
  if (p === 0 && s === 0) return null;
  return { color, tribun, p, s };
}

function unitToUnitByte(unit) {
  if (!unit) return 0;
  const pIndex = HEIGHT_TO_INDEX.get(unit.p) ?? 0;
  const sIndex = HEIGHT_TO_INDEX.get(unit.s) ?? 0;
  const color = unit.color & 0x1;
  const tribun = unit.tribun ? 1 : 0;
  return (tribun << 7) | (color << 6) | (sIndex << 3) | pIndex;
}

async function loadBrushActions() {
  const sourcePath = resolve("apps/web/src/boardCanvas/brushActions.ts");
  const source = await readFile(sourcePath, "utf8");
  const patchedSource = source.replace(
    'import * as engine from "@tribunplay/engine";',
    'import * as engine from "./engine-shim.mjs";',
  );
  const transpiled = ts.transpileModule(patchedSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: sourcePath,
  }).outputText;

  const tempDir = await mkdtemp(join(tmpdir(), "tribun-brush-tests-"));
  const tempModulePath = join(tempDir, "brushActions.mjs");
  const shimModulePath = join(tempDir, "engine-shim.mjs");
  const shimSource = [
    "const HEIGHT_TO_INDEX = new Map([[0,0],[1,1],[2,2],[3,3],[4,4],[6,5],[8,6]]);",
    "const INDEX_TO_HEIGHT = [0,1,2,3,4,6,8,0];",
    "const RADIUS = 5;",
    "const onBoard = (x, y) => { const z = y - x; return Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= RADIUS; };",
    "export const isValidTile = (cid) => { if (cid < 0 || cid > 120) return false; const x = Math.floor(cid / 11) - 5; const y = (cid % 11) - 5; return onBoard(x, y); };",
    "export const unitByteToUnit = (byteValue) => { if (byteValue === 0) return null; const p = INDEX_TO_HEIGHT[byteValue & 0x7] ?? 0; const s = INDEX_TO_HEIGHT[(byteValue >>> 3) & 0x7] ?? 0; const color = (byteValue >>> 6) & 0x1; const tribun = ((byteValue >>> 7) & 0x1) === 1; if (p === 0 && s === 0) return null; return { color, tribun, p, s }; };",
    "export const unitToUnitByte = (unit) => { if (!unit) return 0; const pIndex = HEIGHT_TO_INDEX.get(unit.p) ?? 0; const sIndex = HEIGHT_TO_INDEX.get(unit.s) ?? 0; const color = unit.color & 0x1; const tribun = unit.tribun ? 1 : 0; return (tribun << 7) | (color << 6) | (sIndex << 3) | pIndex; };",
  ].join("\n");
  await writeFile(tempModulePath, transpiled, "utf8");
  await writeFile(shimModulePath, shimSource, "utf8");
  try {
    return await import(pathToFileURL(tempModulePath).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function emptyBoard() {
  return new Uint8Array(121);
}

function getUnit(board, cid) {
  return unitByteToUnit(board[cid]);
}

function setUnit(board, cid, unit) {
  board[cid] = unitToUnitByte(unit);
}

function cid(x, y) {
  return encodeCoord(x, y);
}

const tests = [];

tests.push(async ({ applyLeftBrush }) => {
  const board = emptyBoard();
  const target = cid(0, 0);
  setUnit(board, target, { color: 0, tribun: false, p: 4, s: 2 });
  const result = applyLeftBrush(board, target, {
    activeColor: 0,
    height: "eraser",
    tribun: false,
    enslave: false,
    overwrite: true,
  });
  assert(result !== null, "erase primary on slave should mutate");
  const unit = getUnit(result.board, target);
  assert(unit && unit.color === 1 && unit.tribun === false && unit.p === 2 && unit.s === 0, "slave should be liberated with flipped color");
});

tests.push(async ({ applyLeftBrush }) => {
  const board = emptyBoard();
  const target = cid(1, 0);
  setUnit(board, target, { color: 1, tribun: false, p: 4, s: 0 });
  const result = applyLeftBrush(board, target, {
    activeColor: 0,
    height: 3,
    tribun: false,
    enslave: true,
    overwrite: false,
  });
  assert(result !== null, "enemy enslave should mutate");
  const unit = getUnit(result.board, target);
  assert(unit && unit.color === 0 && unit.p === 3 && unit.s === 4 && unit.tribun === false, "enemy unit should become enslaved impero");
});

tests.push(async ({ applyLeftBrush }) => {
  const board = emptyBoard();
  const oldSameColorTribun = cid(-1, 0);
  const oldEnemyTribun = cid(-2, 0);
  const newTribun = cid(0, 1);
  setUnit(board, oldSameColorTribun, { color: 0, tribun: true, p: 3, s: 2 });
  setUnit(board, oldEnemyTribun, { color: 1, tribun: true, p: 2, s: 0 });
  const result = applyLeftBrush(board, newTribun, {
    activeColor: 0,
    height: 1,
    tribun: true,
    enslave: false,
    overwrite: false,
  });
  assert(result !== null, "placing tribun should mutate");
  const oldUnit = getUnit(result.board, oldSameColorTribun);
  const enemyTribun = getUnit(result.board, oldEnemyTribun);
  const newUnit = getUnit(result.board, newTribun);
  assert(oldUnit && oldUnit.color === 1 && oldUnit.tribun === false && oldUnit.p === 2 && oldUnit.s === 0, "removed own slave tribun should be liberated with flipped color");
  assert(enemyTribun && enemyTribun.tribun === true && enemyTribun.color === 1, "enemy tribun should stay untouched");
  assert(newUnit && newUnit.tribun === true && newUnit.color === 0 && newUnit.p === 1, "new tribun should be placed");
});

tests.push(async ({ applyLeftBrush }) => {
  const board = emptyBoard();
  const target = cid(0, -1);
  setUnit(board, target, { color: 0, tribun: false, p: 2, s: 0 });
  const result = applyLeftBrush(board, target, {
    activeColor: 0,
    height: 4,
    tribun: false,
    enslave: false,
    overwrite: false,
  });
  assert(result === null, "overwrite off on own occupied should no-op");
});

tests.push(async ({ applyLeftBrush }) => {
  const board = emptyBoard();
  const target = cid(1, -1);
  setUnit(board, target, { color: 0, tribun: false, p: 3, s: 2 });
  const result = applyLeftBrush(board, target, {
    activeColor: 0,
    height: 6,
    tribun: false,
    enslave: false,
    overwrite: true,
  });
  assert(result !== null, "overwrite on own slave should mutate");
  const unit = getUnit(result.board, target);
  assert(unit && unit.color === 0 && unit.p === 6 && unit.s === 0, "overwrite + enslave off should clear secondary");
});

tests.push(async ({ applyRightErase }) => {
  const board = emptyBoard();
  const target = cid(-1, 1);
  setUnit(board, target, { color: 1, tribun: false, p: 8, s: 0 });
  const result = applyRightErase(board, target);
  assert(result !== null, "right erase should mutate enemy occupied");
  const unit = getUnit(result.board, target);
  assert(unit === null, "right erase should clear tile");
});

tests.push(async ({ applyLeftBrush }) => {
  const board = emptyBoard();
  const target = cid(2, -1);
  setUnit(board, target, { color: 1, tribun: false, p: 4, s: 2 });
  const result = applyLeftBrush(board, target, {
    activeColor: 0,
    height: "eraser",
    tribun: false,
    enslave: true,
    overwrite: false,
  });
  assert(result !== null, "left eraser with enslave on should liberate slave units");
  const unit = getUnit(result.board, target);
  assert(unit && unit.color === 0 && unit.tribun === false && unit.p === 2 && unit.s === 0, "slave should be liberated with flipped color instead of deleted");
});

tests.push(async ({ applyRightErase }) => {
  const board = emptyBoard();
  const target = cid(3, -1);
  setUnit(board, target, { color: 1, tribun: false, p: 4, s: 2 });
  const result = applyRightErase(board, target, { enslave: true });
  assert(result !== null, "right erase with enslave on should mutate slave units");
  const unit = getUnit(result.board, target);
  assert(unit && unit.color === 0 && unit.tribun === false && unit.p === 2 && unit.s === 0, "right erase should liberate slave with flipped color");
});

tests.push(async ({ applyLeftBrush }) => {
  const board = emptyBoard();
  const target = cid(2, 0);
  setUnit(board, target, { color: 1, tribun: false, p: 6, s: 0 });
  const result = applyLeftBrush(board, target, {
    activeColor: 0,
    height: 2,
    tribun: false,
    enslave: true,
    overwrite: false,
  });
  assert(result === null, "enslave should be blocked when brush*2 is below target primary");
});

tests.push(async ({ applyLeftBrush }) => {
  const board = emptyBoard();
  const target = cid(2, 1);
  setUnit(board, target, { color: 1, tribun: false, p: 1, s: 0 });
  const result = applyLeftBrush(board, target, {
    activeColor: 0,
    height: 6,
    tribun: false,
    enslave: true,
    overwrite: false,
  });
  assert(result === null, "enslave should be blocked when resulting primary would exceed slave-cap primary");
});

async function run() {
  const brushActions = await loadBrushActions();
  for (let i = 0; i < tests.length; i += 1) {
    await tests[i](brushActions);
  }
  console.log(`brushActions tests passed (${tests.length})`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
