import type { Migration } from './types';

export const migration_0013_items_container_type_index: Migration = {
  id: '0013_items_container_type_index',
  up: `
    -- §Stage 5 found the hard way: countActiveItemsOfType/findFirstActiveItem/
    -- consumeActiveItems (production/recipes.ts's hot path — restocking,
    -- selling, and weekly production, all called at least daily per company)
    -- filter by (container_id, type, status), but items only had a plain
    -- index on container_id alone. SQLite could narrow to a container's rows
    -- via that index but then had to linearly scan all of them to filter by
    -- type/status — cheap while a container holds a handful of items, but a
    -- company's own container can now genuinely accumulate hundreds of
    -- unsold units over a long run (production capacity grows with upgrade
    -- tiers; the daily sell cap doesn't scale with it yet — a real,
    -- separately-flagged follow-up, see DECISIONS.md). A 90-day headless run
    -- measurably slowed down checkpoint-interval over checkpoint-interval as
    -- a direct result (confirmed empirically: checkpoint export/import cost
    -- itself stayed flat at ~25ms throughout the same run — this index is
    -- the fix, not checkpoint tuning).
    CREATE INDEX idx_items_container_type_status ON items (container_id, type, status);
  `,
};
