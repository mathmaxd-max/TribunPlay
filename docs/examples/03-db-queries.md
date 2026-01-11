# Database Query Examples (Postgres)

## Create a new game (friend code)
```sql
insert into games (
  public_code, is_private,
  initial_board, initial_turn, starting_player_color, time_control,
  black_player_id, status, ply, next_turn, clock_black_ms, clock_white_ms
) values (
  'AB12CD', true,
  decode('<base64 or hex>', 'base64'),
  0, 1,
  jsonb_build_object('initialMs',600000,'bufferMs',5000,'incrementMs',2000,'maxGameMs',null),
  '<player_uuid>',
  'lobby',
  0, 0, 600000, 600000
);
```

## Append an accepted action (transaction)
```sql
begin;

insert into game_actions(game_id, ply, action_u32, actor_color, actor_player_id, think_ms)
values ($1, $2, $3, $4, $5, $6);

update games
set
  ply = ply + 1,
  next_turn = $7,
  clock_black_ms = $8,
  clock_white_ms = $9,
  total_think_black_ms = total_think_black_ms + $10,
  total_think_white_ms = total_think_white_ms + $11,
  draw_offer_by = $12,
  status = $13,
  winner_color = $14,
  end_opcode = $15,
  end_reason = $16,
  ended_at = $17
where id = $1;

commit;
```

## Load snapshot + actions for replay
```sql
select initial_board, initial_turn, time_control, clock_black_ms, clock_white_ms, draw_offer_by, ply
from games
where id = $1;

select ply, action_u32
from game_actions
where game_id = $1
order by ply asc;
```
