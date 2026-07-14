import type { EventScope, UiApi } from '../engine/ui-api';

interface LogPanelProps {
  uiApi: UiApi;
  scope: EventScope;
  limit?: number;
  emptyMessage?: string;
}

// Reusable log view (§14.3): the same component renders the personal log in
// the HUD and the settlement log tab — only the scope differs.
export function LogPanel({ uiApi, scope, limit = 20, emptyMessage = 'Nothing yet.' }: LogPanelProps) {
  const entries = uiApi.queryLog(scope, limit);
  return (
    <ul className="log-list">
      {entries.length === 0 && <li className="log-empty">{emptyMessage}</li>}
      {entries.map((event, i) => (
        <li key={i}>
          <span className="log-tick">[{event.tick}]</span> {event.message}
        </li>
      ))}
    </ul>
  );
}
