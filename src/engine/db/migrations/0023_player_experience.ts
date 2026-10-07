import type { Migration } from './types';

export const migration_0023_player_experience: Migration = {
  id: '0023_player_experience',
  up: `
    ALTER TABLE world_meta ADD COLUMN player_entity_id TEXT DEFAULT 'player';
    ALTER TABLE world_meta ADD COLUMN save_format_version INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE world_meta ADD COLUMN game_version TEXT NOT NULL DEFAULT '0.1.0';
    ALTER TABLE entities ADD COLUMN simulation_mode TEXT NOT NULL DEFAULT 'foreground'
      CHECK (simulation_mode IN ('foreground', 'background'));
    UPDATE entities SET simulation_mode = 'background'
      WHERE id IN (SELECT entity_id FROM household_members);
    UPDATE entities SET simulation_mode = 'foreground' WHERE id = 'player';
    CREATE INDEX idx_entities_simulation_mode ON entities (simulation_mode, id);
    CREATE TABLE player_preferences (
      entity_id TEXT PRIMARY KEY REFERENCES entities(id),
      attend_work INTEGER NOT NULL DEFAULT 1 CHECK (attend_work IN (0, 1)),
      eat_drink INTEGER NOT NULL DEFAULT 1 CHECK (eat_drink IN (0, 1)),
      maintain_provisions INTEGER NOT NULL DEFAULT 1 CHECK (maintain_provisions IN (0, 1)),
      sleep INTEGER NOT NULL DEFAULT 1 CHECK (sleep IN (0, 1)),
      lodging TEXT NOT NULL DEFAULT 'tavern' CHECK (lodging IN ('rough', 'tavern')),
      reserve_coin INTEGER NOT NULL DEFAULT 0 CHECK (reserve_coin >= 0)
    );
    INSERT INTO player_preferences (entity_id) SELECT id FROM entities WHERE id = 'player';
  `,
};
