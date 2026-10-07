import { useCalendarAt, useView } from '../sim/hooks';
import { formatTimestamp } from './profileFormat';
import type { EventScope } from '../../shared/protocol';

interface LogPanelProps {
  scope: EventScope;
  limit?: number;
  emptyMessage?: string;
}

// Reusable log view (§14.3): the same component renders the personal log in
// the HUD and the settlement log tab — only the scope differs.
export function LogPanel({ scope, limit = 20, emptyMessage = 'Nothing yet.' }: LogPanelProps) {
  const calendarAt = useCalendarAt();
  const entries = useView('view.log', { scope, limit }).data ?? [];
  return (
    <ul className="log-list">
      {entries.length === 0 && <li className="log-empty">{emptyMessage}</li>}
      {entries.map((event, i) => (
        <li key={i}>
          <span className="log-tick">{formatTimestamp(calendarAt, event.tick)}</span> {event.message}
        </li>
      ))}
    </ul>
  );
}
