import { SceneHeader } from '../components/SceneHeader';
import { getLocationContent } from '../data/locationContent';
import type { Site, UiApi } from '../engine/ui-api';

interface LocationScreenProps {
  uiApi: UiApi;
  site: Site;
  playerId: string;
  onBack: () => void;
  onAction: () => void;
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
// on season/scarcity/time), presence roster, available actions." Presence
// rosters stay a stub until NPCs exist (Stage 4).
export function LocationScreen({ uiApi, site, playerId, onBack, onAction }: LocationScreenProps) {
  const calendar = uiApi.getCalendar();
  const content = getLocationContent(site.kind);
  const listings = uiApi.listMarketListings(site.id);

  const handleAction = (type: string) => {
    uiApi.queueAction(playerId, type);
    onAction();
  };

  return (
    <section>
      <SceneHeader icon={content.icon} title={site.name} calendar={calendar} />

      <button type="button" className="back-button" onClick={onBack}>
        ← Back to settlement
      </button>

      <p className="location-description">{content.description}</p>

      <h3>{"Who's here"}</h3>
      <p className="presence-roster-stub">You are here. NPCs arrive in Stage 4.</p>

      <h3>What you can do</h3>
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
