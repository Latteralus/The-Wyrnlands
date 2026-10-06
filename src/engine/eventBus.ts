export type EventScope = 'personal' | 'business' | 'settlement' | 'world';

export interface EngineEvent {
  tick: number;
  scope: EventScope;
  type: string;
  message: string;
  actorId?: string;
  data?: Record<string, unknown>;
  // Bookkeeping, not story: still delivered to every listener (the UI
  // refreshes on it), but not written to the event log. Per-item movements
  // (already kept item by item in provenance_events), coin transfers (in
  // wallets and ledgers), need top-ups (on the needs bars). The log keeps
  // the moments worth reading — §14.3.
  detail?: boolean;
}

type Listener = (event: EngineEvent) => void;

export class EventBus {
  private listeners: Listener[] = [];

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  emit(event: EngineEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
