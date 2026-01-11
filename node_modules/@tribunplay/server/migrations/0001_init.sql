-- Games table
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'lobby',
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  black_player_id TEXT,
  white_player_id TEXT,
  black_token TEXT,
  white_token TEXT,
  starting_player_color INTEGER,
  initial_turn INTEGER NOT NULL,
  initial_board BLOB NOT NULL,
  time_control_json TEXT,
  ply INTEGER NOT NULL DEFAULT 0,
  turn INTEGER NOT NULL,
  clock_black_ms INTEGER,
  clock_white_ms INTEGER,
  draw_offer_by INTEGER,
  winner_color INTEGER,
  end_opcode INTEGER,
  end_reason INTEGER
);

-- Game actions table (append-only)
CREATE TABLE IF NOT EXISTS game_actions (
  game_id TEXT NOT NULL,
  ply INTEGER NOT NULL,
  action_u32 INTEGER NOT NULL,
  actor_color INTEGER,
  think_ms INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (game_id, ply),
  FOREIGN KEY (game_id) REFERENCES games(id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_game_actions_game_id ON game_actions(game_id);
CREATE INDEX IF NOT EXISTS idx_games_code ON games(code);
