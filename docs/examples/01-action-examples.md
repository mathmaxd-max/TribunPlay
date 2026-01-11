# Action Encoding Examples

All numbers below are shown as:
- `cid` (0..120)
- `word` as unsigned decimal
- `word` as 8-hex-digit (zero-padded) for readability

Helper:
- `cid(x,y) = (x+5)*11 + (y+5)`

## Example 1: MOVE primary from (0,0) to (1,1)

Coordinates:
- from `(0,0)` → `cid=60`
- to `(1,1)` → `cid=72`

Fields:
- opcode = 0 (MOVE)
- part = 0 (primary)

Result:
- word (hex) = `0x0000243C`
- word (u32) = `9276`

## Example 2: MOVE secondary (whole stack) from (0,0) to (1,1)
Same as above, but part=1.

Result:
- word (hex) = `0x0000643C`
- word (u32) = `25660`

## Example 3: KILL: attacker at (0,0) kills target at (2,2) using primary pattern
- attacker `(0,0)` → `cid=60`
- target `(2,2)` → `cid=84`

Fields:
- opcode = 1 (KILL)
- part = 0 (primary)

Result:
- word (hex) = `0x10002A3C`
- word (u32) = `268446268`

## Example 4: ATTACK_TRIBUN: attacker at (0,0) attacks tribun at (2,2), winner=black
- attacker cid=60
- tribun cid=84
- winnerColor=0

Result:
- word (hex) = `0x90002A3C`
- word (u32) = `2415929916`

## Example 5: DAMAGE: target at (1,1) takes effective damage 2
- target cid=72
- effectiveDamage=2 → effDmgMinus1=1

Result:
- word (hex) = `0x300000C8`
- word (u32) = `805306568`

## Example 6: DRAW: black offers a draw
- opcode=10 (DRAW)
- drawAction=0 (offer)
- actorColor=0 (black)

Result:
- word (hex) = `0xA0000000`
- word (u32) = `2684354560`

## Example 7: DRAW: white accepts (game ends as tie)
- drawAction=2 (accept)
- actorColor=1 (white)

Result:
- word (hex) = `0xA0000006`
- word (u32) = `2684354566`

## Example 8: END: max game time reached (tie)
- opcode=11 (END)
- endReason=3 (timeout-game-tie)

Result:
- word (hex) = `0xB0000003`
- word (u32) = `2952790019`

## Example decode snippet (TypeScript)
```ts
function opcode(word: number): number { return (word >>> 28) & 0xF; }
function payload(word: number): number { return word & 0x0FFFFFFF; }

function readMove(word: number) {
  const op = opcode(word);
  const p = payload(word);
  if (op === 0) {
    const fromCid = p & 0x7F;
    const toCid = (p >>> 7) & 0x7F;
    const part = (p >>> 14) & 1;
    return {op, fromCid, toCid, part};
  }
  return {op};
}
```
