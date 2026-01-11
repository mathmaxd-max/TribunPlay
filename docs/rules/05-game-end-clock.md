# Game End and Clocks (Normative)

## Game end conditions

### Win
A player wins immediately if they **attack the opponent's tribun**.

### Loss
A player loses if any of the following occurs:
- They resign (give up).
- They have **no legal turn available** at the start of their turn.
- Their **player clock** runs out (after applying buffer rules).
- Tournament-specific forfeits (out of scope for this spec).

### Tie
A game ends in a tie if:
- Both players mutually agree to a draw (draw offer accepted).
- The game reaches a configured **maximum total game time** (tournament rule).

## Time controls

### Parameters
A time control is defined by:
- `initial`: starting main time for each player.
- `buffer`: per-turn free thinking time before main time is deducted.
- `increment`: added to a player's main time after they complete a turn.
- `maxGameTime` (optional): maximum total elapsed game time; reaching it ends the game in a tie.

Units SHOULD be milliseconds in implementation for precision.

### Clock algorithm (authoritative)
When it becomes a player's turn:
1. Start a per-turn timer.
2. Player has `buffer` time free.
3. Any thinking time beyond `buffer` is subtracted from their remaining main time.
4. If remaining main time drops below 0, that player loses by timeout.
5. After a legal turn is completed, `increment` is added to their remaining main time.
6. Turn passes to the opponent.

### Total game time
If `maxGameTime` is configured and total elapsed time reaches the limit, the game ends immediately as a tie.

## Tournament tiebreak clock metric
For tournament tiebreaks, accumulate each player's **total think time** (time spent on turns, excluding or including buffer is an implementation choice; RECOMMENDED: include total elapsed per turn to avoid ambiguity).
