# Scoring and Tournament Format (Normative)

## Scoring
- Win = **3**
- Tie = **1**
- Loss = **0**

## Match types

### Single
- One game.
- Starting player is chosen randomly.

### Pair
- Two games between the same players.
- In one game player A starts; in the other player B starts.
- Match score is the sum of both game scores.

### Quad (final 4)
- 4 players play a pair against each opponent:
  - There are 6 opponent pairs total.
  - Each pair is a Pair match (2 games), so 12 games total.

## Tie-breaker
If two tournament scores are equal, the tie-breaker is **accumulated total think time**:
- Lower total think time ranks higher.

## Tournament structure

### Stage 1: Singles qualifier
1. Players play singles.
2. Players are ranked primarily by accumulated score, secondarily by accumulated think time.
3. The top `2^k` players are selected, where `2^k` is the largest power of 2 not exceeding the number of players.

**Pairing rule for Stage 1** is not uniquely specified in the rules text.
Implementations SHOULD use a deterministic, documented pairing algorithm, e.g.:
- random pairings each round with no-repeat if possible, for a fixed number of rounds, or
- Swiss-style pairing (out of scope).

### Stage 2: Knockout pairs
1. Remaining players are seeded by Stage 1 ranking.
2. In each knockout round:
   - worst plays best (seed 1 vs seed N, seed 2 vs seed N-1, etc.)
   - each matchup is a Pair match
3. Winners advance, player count halves each round.

Scores and think time from these matches are added to tournament totals.

### Stage 3: Quad finals
When 4 players remain:
- a Quad match determines 1st–4th places
- prior tournament score is irrelevant in the final placement; placement is determined only by the Quad results.
