import { ALL_DOMAINS, type Domain } from '../shared/protocol';
import type { EngineEvent } from '../engine/eventBus';

// Turns what happened during a batch of ticks into the coarse change
// domains the renderer refreshes by (shared/protocol.ts's VIEW_DOMAINS).
// Errs towards invalidating more: a needless refresh costs one snapshot; a
// missed one leaves a stale screen.
export class DomainTracker {
  private domains = new Set<Domain>();
  private loggedEvents = 0;

  private readonly playerId: () => string | null;

  constructor(playerId: () => string | null) {
    this.playerId = playerId;
  }

  observe(event: EngineEvent): void {
    if (!event.detail) {
      this.domains.add('logs');
      this.loggedEvents++;
    }
    const player = this.playerId();
    if (event.scope === 'personal' || (player !== null && event.actorId === player))
      this.domains.add('player');
    const prefix = event.type.slice(0, event.type.indexOf('.') + 1);
    switch (prefix) {
      case 'market.':
        this.domains.add('market');
        this.domains.add('world');
        break;
      case 'item.':
      case 'coin.':
        // Goods and coin move between people, businesses and the stall.
        this.domains.add('player');
        this.domains.add('market');
        this.domains.add('world');
        break;
      case 'need.':
      case 'gear.':
      case 'action.':
      case 'player.':
        this.domains.add('player');
        break;
      default:
        // business., company., job., household., entrepreneur., audit., world.
        this.domains.add('world');
    }
  }

  // Every update moves the clock; crossing midnight runs the whole daily
  // economy (labor, companies, merchant, prices, households, spoilage), so
  // everything may have changed.
  take(options: { dayBoundary: boolean; everything?: boolean }): { domains: Domain[]; events: number } {
    const result =
      options.dayBoundary || options.everything
        ? [...ALL_DOMAINS]
        : ALL_DOMAINS.filter((d) => d === 'clock' || d === 'player' || this.domains.has(d));
    const events = this.loggedEvents;
    this.domains.clear();
    this.loggedEvents = 0;
    return { domains: result, events };
  }
}
