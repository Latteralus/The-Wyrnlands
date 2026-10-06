import type { Migration } from './types';

export const migration_0021_autonomous_routines: Migration = {
  id: '0021_autonomous_routines',
  up: `
    -- Characters who live their daily routine on their own — work their
    -- shift, eat, drink and sleep — instead of waiting for every action to be
    -- queued by hand (Engine.applyRoutines). The player, in the interactive
    -- game. last_shift_day is the day they last went to work, so a reload
    -- doesn't send them twice.
    CREATE TABLE autonomous_actors (
      entity_id TEXT PRIMARY KEY REFERENCES entities (id),
      last_shift_day INTEGER
    );

    -- §8.1 rule 2: coin entering and leaving the economy, per day and
    -- designed channel (import, export, land, rent, immigration, ...). The
    -- economy report read these from coin.faucet/coin.sink rows in event_log
    -- until those became unlogged detail (they're bookkeeping, not story).
    CREATE TABLE coin_flows (
      day INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('faucet', 'sink')),
      channel TEXT NOT NULL,
      amount INTEGER NOT NULL,
      PRIMARY KEY (day, kind, channel)
    );
    INSERT INTO coin_flows (day, kind, channel, amount)
      SELECT tick / 1440, CASE type WHEN 'coin.faucet' THEN 'faucet' ELSE 'sink' END,
             COALESCE(json_extract(data, '$.channel'), 'other'), SUM(json_extract(data, '$.amount'))
      FROM event_log WHERE type IN ('coin.faucet', 'coin.sink') GROUP BY 1, 2, 3;
  `,
};
