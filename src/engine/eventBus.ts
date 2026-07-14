export type EventScope = 'personal' | 'business' | 'settlement' | 'world';

export interface EngineEvent {
  tick: number;
  scope: EventScope;
  type: string;
  message: string;
  actorId?: string;
  data?: Record<string, unknown>;
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
