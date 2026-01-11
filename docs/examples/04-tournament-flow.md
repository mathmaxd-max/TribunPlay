# Tournament Flow Example (High-Level)

This example illustrates how a backend tournament manager might schedule games.

## Inputs
- 10 players
- time control: 5+1 (example)
- Stage 1: 3 rounds of singles (example pairing policy)

## Stage 1 (Singles)
For each round:
1. Pair players deterministically (e.g., shuffle with fixed seed, avoid repeats).
2. Create one game per pairing.
3. After each game ends, update:
   - score (3/1/0)
   - think_ms totals

After round 3:
- Rank players by (score desc, think_ms asc)
- Select top `2^k` = 8 players.

## Stage 2 (Knockout pairs)
Seed 1..8. Pair:
- 1 vs 8
- 2 vs 7
- 3 vs 6
- 4 vs 5

For each matchup:
- create two games (Pair match), swapping starting player.
- aggregate match score + think time
- winner advances

## Stage 3 (Quad)
Remaining 4 players:
- each pair plays a Pair match against each other (6 matchups total)
- final placement is based on quad results (prior totals ignored)

## Spectators
Eliminated players are granted spectator access to all remaining games.
