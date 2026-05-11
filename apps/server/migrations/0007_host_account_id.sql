ALTER TABLE games ADD COLUMN host_account_id TEXT;

UPDATE games
SET host_account_id = COALESCE(host_account_id, black_player_id)
WHERE host_account_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_games_host_account_id
  ON games(host_account_id);
