-- Tribun database schema (PostgreSQL / Supabase)
-- Notes:
-- - action_u32 stored as BIGINT with range check to represent uint32 safely.
-- - initial_board and snapshot boards stored as 121-byte BYTEA indexed by cid 0..120.

create type game_status as enum ('lobby', 'active', 'ended');
create type tournament_status as enum ('lobby','active','ended');

-- Optional players table (skip if using Supabase auth.users)
create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  public_code text unique,
  is_private boolean not null default true,

  -- initial configuration
  initial_board bytea not null,
  initial_turn smallint not null,          -- 0 black, 1 white
  starting_player_color smallint not null, -- 0/1 (may differ from black/white)
  time_control jsonb not null,             -- {initialMs, bufferMs, incrementMs, maxGameMs?}

  black_player_id uuid references players(id),
  white_player_id uuid references players(id),

  status game_status not null default 'lobby',

  -- runtime summary (denormalized, updated transactionally)
  ply int not null default 0,
  next_turn smallint,
  clock_black_ms bigint,
  clock_white_ms bigint,
  total_think_black_ms bigint not null default 0,
  total_think_white_ms bigint not null default 0,
  draw_offer_by smallint,

  -- outcome
  winner_color smallint,
  end_opcode smallint,
  end_reason smallint,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz
);

create index if not exists games_status_idx on games(status);
create index if not exists games_public_code_idx on games(public_code);

create table if not exists game_actions (
  game_id uuid not null references games(id) on delete cascade,
  ply int not null,
  action_u32 bigint not null,
  actor_color smallint,
  actor_player_id uuid references players(id),
  think_ms int,
  created_at timestamptz not null default now(),

  primary key (game_id, ply),
  constraint action_u32_range check (action_u32 >= 0 and action_u32 <= 4294967295)
);

create index if not exists game_actions_game_idx on game_actions(game_id, ply);

-- Optional snapshots for long games
create table if not exists game_snapshots (
  game_id uuid not null references games(id) on delete cascade,
  ply int not null,
  board bytea not null,
  next_turn smallint not null,
  clock_black_ms bigint not null,
  clock_white_ms bigint not null,
  draw_offer_by smallint,
  created_at timestamptz not null default now(),
  primary key (game_id, ply)
);

-- Tournaments
create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cfg jsonb not null,
  status tournament_status not null default 'lobby',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);

create table if not exists tournament_players (
  tournament_id uuid not null references tournaments(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  score int not null default 0,
  think_ms bigint not null default 0,
  eliminated boolean not null default false,
  seed int,
  primary key (tournament_id, player_id)
);

create table if not exists tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  stage smallint not null,
  round int not null,
  a_player_id uuid not null references players(id),
  b_player_id uuid not null references players(id),
  created_at timestamptz not null default now()
);

create table if not exists tournament_match_games (
  match_id uuid not null references tournament_matches(id) on delete cascade,
  game_id uuid not null references games(id) on delete cascade,
  ord smallint not null,
  primary key (match_id, game_id)
);
