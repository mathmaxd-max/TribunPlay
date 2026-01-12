# Board and Coordinates (Normative)

## Board shape
Tribun is played on a hex grid with **radius 5** (edge length 6), totaling **91 tiles**.

A tile at coordinate `(x, y)` is **on board** iff:

- Let `z = x - y`
- `max(|x|, |y|, |z|) <= 5`

This MUST be the canonical board validity rule.

## Coordinate system
- The center tile is `(0,0)`.
- Neighbor vectors (6 directions) are:

| dir | name       | vector (dx,dy) |
|-----|------------|----------------|
| 0   | up         | (+1,+1) |
| 1   | left-up    | (+1,+0) |
| 2   | right-up   | (+0,+1) |
| 3   | down       | (-1,-1) |
| 4   | right-down | (-1,+0) |
| 5   | left-down  | (+0,-1) |

Opposite direction is `dir ^ 3` under this numbering.

## Tile colors (board coloring)
The center `(0,0)` is **gray**. The tile at `(1,1)` is **black** and `(-1,-1)` is **white**.
Tiles of the same color do not touch. (This affects visuals only; it does not change legality.)

## cid encoding (7-bit coordinate id)
Moves encode coordinates using a 7-bit id `cid` derived from an 11×11 grid over `x,y ∈ [-5..5]`:

- `cid = (x + 5) * 11 + (y + 5)`  → range `[0..120]`
- Values `121..127` are **reserved** and MUST NOT appear in actions.

Decoding:
- `x = floor(cid / 11) - 5`
- `y = (cid % 11) - 5`
- A decoded `(x,y)` MUST be validated with the board rule above.

## Adjacency
Two tiles `(x1,y1)` and `(x2,y2)` are adjacent iff:
- `(x2-x1, y2-y1)` equals one of the 6 neighbor vectors.

Implementations SHOULD provide helper functions:
- `neighborCid(centerCid, dir) -> cid|invalid`
- `areAdjacent(cidA, cidB) -> bool`

## Implementation example (TypeScript)
```ts
export const R = 5;

export function onBoard(x: number, y: number): boolean {
  const z = x - y;
  return Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= R;
}

export function packCid(x: number, y: number): number {
  const cid = (x + 5) * 11 + (y + 5);
  if (cid < 0 || cid > 120) throw new Error("cid out of range");
  if (!onBoard(x, y)) throw new Error("off board");
  return cid;
}

export function unpackCid(cid: number): {x:number;y:number} {
  if (cid < 0 || cid > 120) throw new Error("cid out of range");
  const x = Math.floor(cid / 11) - 5;
  const y = (cid % 11) - 5;
  if (!onBoard(x, y)) throw new Error("off board");
  return {x, y};
}
```
