import { useState } from 'react';
import { SceneHeader } from '../components/SceneHeader';
import { getLocationContent } from '../data/locationContent';
import { useCommand, useCalendar } from '../sim/hooks';
import type { LocationView } from '../../shared/protocol';

interface LocationScreenProps {
  view: LocationView;
  onBack: () => void;
  onOpenJobs: () => void;
  onSelectNpc: (entityId: string) => void;
}

// Market actions are named buy_<good>/sell_<good> (market/market.ts) — used
// here only to look up the matching listing for a price/stock hint, not to
// drive any behavior.
function marketGoodType(actionType: string): string | null {
  if (actionType.startsWith('buy_')) return actionType.slice('buy_'.length);
  if (actionType.startsWith('sell_')) return actionType.slice('sell_'.length);
  return null;
}

// §5.5 Location panels: "illustration, atmospheric description (conditional
// on season/scarcity/time), presence roster, available actions." §Stage 4
// gives the presence roster real NPCs (§Stage4's hourly presence lookup —
// see population/presence.ts).
export function LocationScreen({ view, onBack, onOpenJobs, onSelectNpc }: LocationScreenProps) {
  const calendar = useCalendar();
  const command = useCommand();
  const [notice, setNotice] = useState('');
  if (!calendar) return <section className="loading-panel">Loading…</section>;
  const { site, listings, present, holder } = view;
  const content = getLocationContent(site.kind);

  const handleAction = (type: string) => {
    command('player.queueAction', { type }).then(
      () => setNotice(''),
      (error: unknown) => setNotice(error instanceof Error ? error.message : 'That can’t be done right now.'),
    );
  };

  return (
    <section>
      <SceneHeader icon={content.icon} title={site.name} calendar={calendar} />

      <button type="button" className="back-button" onClick={onBack}>
        ← Back to settlement
      </button>

      <p className="location-description">{content.description}</p>
      {site.landValue ? (
        <p className="location-holder">
          {holder
            ? `${holder.kind === 'lease' ? 'Leased' : 'Held'} by ${holder.holderName}.`
            : 'Nobody works this land right now — it could be leased.'}
        </p>
      ) : null}

      <h3>{"Who's here"}</h3>
      {present.length === 0 ? (
        <p className="presence-roster-stub">{"You're the only one here right now."}</p>
      ) : (
        <div className="presence-roster">
          {present.map((entity) => (
            <button key={entity.entityId} type="button" onClick={() => onSelectNpc(entity.entityId)}>
              {entity.name}
            </button>
          ))}
        </div>
      )}

      {site.kind === 'notice_board' && (
        <button type="button" onClick={onOpenJobs}>
          Browse job openings →
        </button>
      )}

      <h3>What you can do</h3>
      {notice && <p role="alert">{notice}</p>}
      <div className="location-actions">
        {content.actions.map((action) => {
          const good = marketGoodType(action.type);
          const listing = good ? listings.find((l) => l.goodType === good) : undefined;
          return (
            <button key={action.type} type="button" onClick={() => handleAction(action.type)}>
              {action.label}
              {listing && ` (${listing.price} coin, ${listing.quantity} in stock)`}
            </button>
          );
        })}
      </div>
    </section>
  );
}
