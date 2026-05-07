import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '..', 'dist');
const distIndexPath = join(distDir, 'index.js');
const distPositionPath = join(distDir, 'default-position.json');
const distSetupDirPath = join(distDir, 'setup');
const importLine = "import defaultPosition from './default-position.json';";
const setupImportLine = "from './setup/TribunSetupCodec';";
const uiBackendExportLine = "export * from './ui-backend';";
const setupExportLine = "export * from \"./setup/TribunSetupCodec\";";

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
    setupImportLine,
    "from './setup/TribunSetupCodec.js';"
  ).replace(
    setupExportLine,
    "export * from \"./setup/TribunSetupCodec.js\";"
  ).replace(
    uiBackendExportLine,
    '// UI backend export removed for isolated encoding regression test execution.'
  );

  const tempDir = await mkdtemp(join(tmpdir(), 'tribun-engine-test-'));
  const tempModulePath = join(tempDir, 'index.testable.mjs');
  await writeFile(tempModulePath, patchedSource, 'utf8');
  await cp(distSetupDirPath, join(tempDir, 'setup'), { recursive: true });

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

  const defaultDecoded = engine.decodeCodeDetailed("TRADITIONALSETUP");
  assert.equal(defaultDecoded.ok, true);
  assert.ok(defaultDecoded.setup);
  assert.equal(engine.encodePosition(defaultDecoded.setup), "TRADITIONALSETUP");
  const flippedOnce = engine.flipSetup(defaultDecoded.setup);
  const flippedTwice = engine.flipSetup(flippedOnce);
  assert.equal(flippedTwice.tribTile, defaultDecoded.setup.tribTile);
  assert.equal(flippedTwice.mask1, defaultDecoded.setup.mask1);
  assert.equal(flippedTwice.mask2, defaultDecoded.setup.mask2);
  assert.equal(flippedTwice.mask3, defaultDecoded.setup.mask3);

  const builtBoard = engine.buildBoardFromSetups({
    config: engine.normalizeSetupConfig({
      enabled: true,
      mode: "shared",
      sharedSelection: {
        hash: "TRADITIONALSETUP",
        flipBlack: false,
        flipWhite: true,
      },
      allowedTribunHeights: [1, 2, 3],
      armySize: { min: null, max: null },
    }),
  });
  assert.equal(builtBoard.ok, true);
  assert.equal(builtBoard.board.length, 121);

  const invalidDecoded = engine.decodeCodeDetailed("!!!!!!!!!!!!!!!!");
  assert.equal(invalidDecoded.ok, false);
  assert.equal(invalidDecoded.error?.kind, "INVALID_CODE");

  // Payment/budget sanity checks.
  //
  // These tests only care about counts/budget rules, but the codec enforces the triangle rule too.
  // So we construct *valid* (triangle-clean) setups by trying multiple placements until encoding succeeds.
  const makeSetupByCounts = ({ tribunHeight, n1, n2, n3 }) => {
    const tribTile = 0;

    // Deterministic PRNG (xorshift32) for reproducible shuffles.
    let seed = 0xC0FFEE;
    const randU32 = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return seed >>> 0;
    };
    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = randU32() % (i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };

    const candidates3 = shuffle(Array.from({ length: 14 }, (_, k) => k + 1)); // 1..14
    const candidates2 = shuffle(Array.from({ length: 25 }, (_, k) => k + 1)); // 1..25
    const candidates1 = shuffle(Array.from({ length: 36 }, (_, k) => k + 1)); // 1..36

    const tryBuild = (startOffsets) => {
      let mask1 = 0n;
      let mask2 = 0n;
      let mask3 = 0n;

      // Tribun tile at requested height
      if (tribunHeight === 1) mask1 |= 1n << 0n;
      if (tribunHeight === 2) mask2 |= 1n << 0n;
      if (tribunHeight === 3) mask3 |= 1n << 0n;

      // Add 3s
      let added3 = 0;
      for (let i = startOffsets.o3; i < candidates3.length && added3 < n3; i++) {
        const t = candidates3[i];
        mask3 |= 1n << BigInt(t);
        added3++;
      }
      if (added3 !== n3) return null;

      // Add 2s (avoid overlap with 3s)
      let added2 = 0;
      for (let i = startOffsets.o2; i < candidates2.length && added2 < n2; i++) {
        const t = candidates2[i];
        if (((mask3 >> BigInt(t)) & 1n) === 1n) continue;
        mask2 |= 1n << BigInt(t);
        added2++;
      }
      if (added2 !== n2) return null;

      // Add 1s (avoid overlap with 2s/3s)
      let added1 = 0;
      for (let i = startOffsets.o1; i < candidates1.length && added1 < n1; i++) {
        const t = candidates1[i];
        if (((mask3 >> BigInt(t)) & 1n) === 1n) continue;
        if (t <= 25 && ((mask2 >> BigInt(t)) & 1n) === 1n) continue;
        mask1 |= 1n << BigInt(t);
        added1++;
      }
      if (added1 !== n1) return null;

      return { tribTile, mask1, mask2, mask3 };
    };

    // Retry by shifting the starting offsets through the shuffled candidate lists.
    for (let attempt = 0; attempt < 400; attempt++) {
      const setup =
        tryBuild({ o3: attempt % 5, o2: (attempt * 3) % 7, o1: (attempt * 5) % 11 }) ??
        tryBuild({ o3: 0, o2: 0, o1: 0 });
      if (!setup) continue;

      const enc = engine.encodePositionDetailed(setup);
      if (enc.ok) return setup;
      // If we hit a triangle issue, keep searching; other failures should be surfaced by the calling test.
      if (enc.error?.kind === "TRIANGLE_EQUAL_UNITS") continue;
      return setup;
    }

    throw new Error("Could not construct a triangle-clean setup for payment/budget test.");
  };

  // Valid: 8×1, 9×2, 3×3 with 1T (budget 36, free-2 interpretation).
  {
    const setup = makeSetupByCounts({ tribunHeight: 1, n1: 8, n2: 9, n3: 3 });
    const enc = engine.encodePositionDetailed(setup);
    assert.equal(enc.ok, true);
  }

  // Valid: 10×1, 8×2, 3×3 with 1T (1+1 remainder interpretation is now stricter: n1 >= n2+2 holds).
  {
    const setup = makeSetupByCounts({ tribunHeight: 1, n1: 10, n2: 8, n3: 3 });
    const enc = engine.encodePositionDetailed(setup);
    assert.equal(enc.ok, true);
  }

  // Previously invalid due to budget check; should now be valid (still satisfies payments).
  {
    const setup = makeSetupByCounts({ tribunHeight: 1, n1: 8, n2: 8, n3: 3 });
    const enc = engine.encodePositionDetailed(setup);
    assert.equal(enc.ok, true);
  }

  // Invalid: 1T, variant B would require n1 >= n2+2 but fails; variant A also fails.
  // - 3-payment fails for variant A: (n2-1) >= 2*n3 is false
  // - 3-payment fails for variant B: n2 >= 2*n3 is false
  {
    const setup = makeSetupByCounts({ tribunHeight: 1, n1: 8, n2: 5, n3: 3 });
    const enc = engine.encodePositionDetailed(setup);
    assert.equal(enc.ok, false);
    assert.equal(enc.error?.kind, "PAYMENT_2_FOR_3_FAIL");
  }

  // 2T: requires n1 >= n2+1 (one free 1-high unit). This should fail if n1==n2.
  {
    const setup = makeSetupByCounts({ tribunHeight: 2, n1: 8, n2: 8, n3: 0 });
    const enc = engine.encodePositionDetailed(setup);
    assert.equal(enc.ok, false);
    assert.equal(enc.error?.kind, "PAYMENT_1_FOR_2_FAIL");
  }

  console.log('Encoding regression checks passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
