import { queryRow, queryRows } from '../db/sqlite';
import type { Database } from '../db/sqlite';

export interface PresentEntity {
  entityId: string;
  name: string;
  activity: string | null;
  startedAtTick: number | null;
  endsAtTick: number | null;
}

export interface ActivitySnapshot {
  label: string;
  siteId: string | null;
  destinationSiteId: string | null;
  startedAtTick: number;
  endsAtTick: number;
}

function activityLabel(type: string | null, payload: Record<string, unknown> | null): string | null {
  if (!type) return null;
  if (typeof payload?.label === 'string') return payload.label;
  const labels: Record<string, string> = {
    'settlement:rest': 'Sleeping at home',
    'settlement:eating': 'Eating at home',
    'settlement:water': 'Fetching water',
    'settlement:shopping': 'Shopping',
    'settlement:unload': 'Putting supplies away',
    'settlement:visit': 'Visiting the tavern',
    'settlement:travel': 'Travelling',
    'settlement:seek_work': 'Seeking work',
  };
  return labels[type] ?? type.replaceAll('_', ' ');
}

export function getActivitySnapshot(db: Database, actorId: string): ActivitySnapshot | null {
  const row = queryRow(
    db,
    `SELECT actions.type, actions.payload, entities.current_site_id,
      actions.started_at_tick, actions.ends_at_tick FROM actions
    JOIN entities ON entities.id = actions.actor_id
    WHERE actor_id = ? AND status = 'in_progress' LIMIT 1`,
    [actorId],
  );
  if (!row) return null;
  const payload = typeof row[1] === 'string' ? (JSON.parse(row[1]) as Record<string, unknown>) : null;
  return {
    label: activityLabel(String(row[0]), payload) ?? '',
    siteId: typeof row[2] === 'string' ? row[2] : null,
    destinationSiteId: typeof payload?.destination === 'string' ? payload.destination : null,
    startedAtTick: Number(row[3]),
    endsAtTick: Number(row[4]),
  };
}

// Presence reads recorded location and the current action. Travellers have no
// site until arrival, and departed households have no presence.
export function listPresentEntities(db: Database, siteId: string, _hourOfDay: number): PresentEntity[] {
  return queryRows(
    db,
    `SELECT entities.id, entities.name, actions.type, actions.payload,
      actions.started_at_tick, actions.ends_at_tick
    FROM entities JOIN household_members ON household_members.entity_id = entities.id
    JOIN households ON households.id = household_members.household_id
    LEFT JOIN actions ON actions.actor_id = entities.id AND actions.status = 'in_progress'
    WHERE entities.current_site_id = ? AND households.departed_at_tick IS NULL
    ORDER BY entities.id`,
    [siteId],
  ).map((row) => {
    const payload = typeof row[3] === 'string' ? (JSON.parse(row[3]) as Record<string, unknown>) : null;
    const type = typeof row[2] === 'string' ? row[2] : null;
    return {
      entityId: String(row[0]),
      name: String(row[1]),
      activity: activityLabel(type, payload),
      startedAtTick: row[4] === null ? null : Number(row[4]),
      endsAtTick: row[5] === null ? null : Number(row[5]),
    };
  });
}
