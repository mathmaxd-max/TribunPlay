# UI FSM Examples

These examples show UI interactions as sequences of clicks and resulting pending actions.

## Example 1: Enemy state cycles damage then liberation
1. Idle: click enemy tile `T` (left)
2. UI enters Enemy(T), options = [DAMAGE(T,1), DAMAGE(T,2), LIBERATE(T)]
3. Click `T` again (left): selects DAMAGE(T,2)
4. Click `T` again (left): selects LIBERATE(T)
5. Submit: sends selected action word (binary uint32)

## Example 2: Own.Primary cycles between secondary and primary move
1. Idle: click own tile `A` (left) → Own.Primary(A)
2. Highlighted includes empty tile `E`.
3. Click `E` (left):
   - options = [MOVE(A→E, secondary), MOVE(A→E, primary)]
   - i=0 selects secondary move first
4. Click `E` again (left): cycles to MOVE primary
5. Submit: sends selected MOVE word

## Example 3: Own.Secondary allocator avoids cycling to large heights
Assume origin primary H0=4.
1. Enter Own.Secondary
2. Click neighbor dir0: allowed values {0,1,2,3,4}. (No 6/8 because remainder is 4.)
3. Click neighbor dir0 repeatedly cycles 0→1→2→3→4→0.

## Example 4: Backstabb derived from allocator
Origin has primary H0=3 and secondary>0.
1. Allocate full primary to exactly one neighbor (alloc[k]=3, others 0)
2. UI constructs BACKSTABB(origin,k)
3. Submit is enabled iff that BACKSTABB word is in legalSet.
