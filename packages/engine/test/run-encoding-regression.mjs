import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '..', 'dist');
const distIndexPath = join(distDir, 'index.js');
const distPositionPath = join(distDir, 'default-position.json');
const importLine = "import defaultPosition from './default-position.json';";
const uiBackendExportLine = "export * from './ui-backend';";

async function loadEngineForTest() {
  const [indexSource, defaultPositionSource] = await Promise.all([
    readFile(distIndexPath, 'utf8'),
    readFile(distPositionPath, 'utf8'),
  ]);

  if (!indexSource.includes(importLine)) {
    throw new Error(`Expected JSON import line not found in ${distIndexPath}`);
  }
  if (!indexSource.includes(uiBackendExportLine)) {
    throw new Error(`Expected UI backend export line not found in ${distIndexPath}`);
  }

  const patchedSource = indexSource.replace(
    importLine,
    `const defaultPosition = ${defaultPositionSource.trim()};`
  ).replace(
    uiBackendExportLine,
    '// UI backend export removed for isolated encoding regression test execution.'
  );

  const tempDir = await mkdtemp(join(tmpdir(), 'tribun-engine-test-'));
  const tempModulePath = join(tempDir, 'index.testable.mjs');
  await writeFile(tempModulePath, patchedSource, 'utf8');

  try {
    return await import(pathToFileURL(tempModulePath).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function legalSet(engine, state) {
  return new Set(Array.from(engine.generateLegalActions(state), (word) => word >>> 0));
}

function makeState(engine, overrides = {}) {
  return {
    board: engine.createInitialBoard(),
    turn: 0,
    ply: 0,
    drawOfferBy: null,
    drawOfferBlocked: null,
    status: 'active',
    winner: undefined,
    ...overrides,
  };
}

async function run() {
  const engine = await loadEngineForTest();

  assert.equal(engine.payload(0x7fffffff >>> 0), 0x0fffffff);

  const splitEncoded = engine.encodeSplit(1, [0, 0, 0, 0, 0, 7]);
  const splitDecoded = engine.decodeAction(splitEncoded);
  assert.equal(splitDecoded.opcode, 7);
  assert.equal(splitDecoded.fields.h5, 7);

  const whiteOffer = engine.encodeDraw(0, 1);
  const whiteAccept = engine.encodeDraw(2, 1);
  const whiteOfferDecoded = engine.decodeAction(whiteOffer);
  const whiteAcceptDecoded = engine.decodeAction(whiteAccept);
  assert.deepEqual(
    {
      drawAction: whiteOfferDecoded.fields.drawAction,
      actorColor: whiteOfferDecoded.fields.actorColor,
    },
    { drawAction: 0, actorColor: 1 }
  );
  assert.deepEqual(
    {
      drawAction: whiteAcceptDecoded.fields.drawAction,
      actorColor: whiteAcceptDecoded.fields.actorColor,
    },
    { drawAction: 2, actorColor: 1 }
  );

  const stateOffer = makeState(engine);
  const legalOffer = legalSet(engine, stateOffer);
  const canonicalWhiteOffer = engine.encodeDraw(0, 1) >>> 0;
  const legacyWhiteOffer = ((10 << 28) | (1 << 1) | 0) >>> 0;
  assert.equal(canonicalWhiteOffer, 0xa0000004);
  assert.equal(legacyWhiteOffer, 0xa0000002);
  assert.equal(legalOffer.has(canonicalWhiteOffer), true);
  assert.equal(legalOffer.has(legacyWhiteOffer), false);

  const stateRetract = makeState(engine, { drawOfferBy: 1 });
  const legalRetract = legalSet(engine, stateRetract);
  const canonicalWhiteRetract = engine.encodeDraw(1, 1) >>> 0;
  const legacyWhiteRetract = ((10 << 28) | (1 << 1) | 1) >>> 0;
  const decodedLegacyWhiteRetract = engine.decodeAction(legacyWhiteRetract);
  assert.equal(canonicalWhiteRetract, 0xa0000005);
  assert.equal(legacyWhiteRetract, 0xa0000003);
  assert.equal(legalRetract.has(canonicalWhiteRetract), true);
  assert.deepEqual(
    {
      drawAction: decodedLegacyWhiteRetract.fields.drawAction,
      actorColor: decodedLegacyWhiteRetract.fields.actorColor,
    },
    { drawAction: 3, actorColor: 0 }
  );

  console.log('Encoding regression checks passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
