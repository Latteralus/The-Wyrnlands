import { queryRows } from '../db/sqlite';
import { withOptional } from '../optional';
import type { EngineEvent, EventBus, EventScope } from '../eventBus';
import type { Database } from 'sql.js';

export function attachLogger(db: Database, bus: EventBus): () => void {
  return bus.subscribe((event) => {
    db.run(
      'INSERT INTO event_log (tick, scope, actor_id, type, message, data) VALUES (?, ?, ?, ?, ?, ?)',
      [
        event.tick,
        event.scope,
        event.actorId ?? null,
        event.type,
        event.message,
        event.data ? JSON.stringify(event.data) : null,
      ],
    );
  });
}

function rowToEvent(row: readonly unknown[]): EngineEvent {
  return withOptional(
    {
      tick: Number(row[0]),
      scope: row[1] as EventScope,
      type: String(row[3]),
      message: String(row[4]),
    },
    {
      actorId: typeof row[2] === 'string' ? row[2] : undefined,
      data: typeof row[5] === 'string' ? (JSON.parse(row[5]) as Record<string, unknown>) : undefined,
    },
  );
}

export function queryLog(db: Database, scope: EventScope, limit = 100): EngineEvent[] {
  const rows = queryRows(
    db,
    'SELECT tick, scope, actor_id, type, message, data FROM event_log WHERE scope = ? ORDER BY id DESC LIMIT ?',
    [scope, limit],
  );

  return rows.map(rowToEvent);
}
