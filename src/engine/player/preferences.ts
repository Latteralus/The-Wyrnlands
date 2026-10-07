import { queryRow } from '../db/sqlite';
import type { Database } from '../db/sqlite';

export interface RoutinePreferences {
  attendWork: boolean;
  eatDrink: boolean;
  maintainProvisions: boolean;
  sleep: boolean;
  lodging: 'rough' | 'tavern';
  reserveCoin: number;
}

export const DEFAULT_ROUTINE: RoutinePreferences = {
  attendWork: true,
  eatDrink: true,
  maintainProvisions: true,
  sleep: true,
  lodging: 'tavern',
  reserveCoin: 0,
};

export function getRoutinePreferences(db: Database, entityId: string): RoutinePreferences {
  const row = queryRow(
    db,
    'SELECT attend_work, eat_drink, maintain_provisions, sleep, lodging, reserve_coin FROM player_preferences WHERE entity_id = ?',
    [entityId],
  );
  return row
    ? {
        attendWork: Boolean(row[0]),
        eatDrink: Boolean(row[1]),
        maintainProvisions: Boolean(row[2]),
        sleep: Boolean(row[3]),
        lodging: row[4] as RoutinePreferences['lodging'],
        reserveCoin: Number(row[5]),
      }
    : { ...DEFAULT_ROUTINE };
}

export function setRoutinePreferences(db: Database, entityId: string, prefs: RoutinePreferences): void {
  if (
    !Number.isSafeInteger(prefs.reserveCoin) ||
    prefs.reserveCoin < 0 ||
    prefs.reserveCoin > 1_000_000 ||
    !['rough', 'tavern'].includes(prefs.lodging) ||
    [prefs.attendWork, prefs.eatDrink, prefs.maintainProvisions, prefs.sleep].some(
      (value) => typeof value !== 'boolean',
    )
  ) {
    throw new Error('Choose valid routine settings and a whole coin reserve between 0 and 1,000,000.');
  }
  db.run(
    `INSERT INTO player_preferences (entity_id, attend_work, eat_drink, maintain_provisions, sleep, lodging, reserve_coin)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(entity_id) DO UPDATE SET
    attend_work=excluded.attend_work, eat_drink=excluded.eat_drink, maintain_provisions=excluded.maintain_provisions,
    sleep=excluded.sleep, lodging=excluded.lodging, reserve_coin=excluded.reserve_coin`,
    [
      entityId,
      Number(prefs.attendWork),
      Number(prefs.eatDrink),
      Number(prefs.maintainProvisions),
      Number(prefs.sleep),
      prefs.lodging,
      prefs.reserveCoin,
    ],
  );
}
