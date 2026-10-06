import { SceneHeader } from '../components/SceneHeader';
import { getLocationContent } from '../data/locationContent';
import type { Site, UiApi } from '../engine/ui-api';

interface LocationScreenProps {
  uiApi: UiApi;
  site: Site;
  playerId: string;
  onBack: () => void;
  onAction: () => void;
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

// work_shift_<jobSlotId> actions (jobs/shifts.ts) — same "parse the action
// type for a display hint" precedent as marketGoodType above.
function workShiftJobSlotId(actionType: string): string | null {
  return actionType.startsWith('work_shift_') ? actionType.slice('work_shift_'.length) : null;
}

// §5.5 Location panels: "illustration, atmospheric description (conditional
// on season/scarcity/time), presence roster, available actions." §Stage 4
// gives the presence roster real NPCs (§Stage4's hourly presence lookup —
// see population/presence.ts).
export function LocationScreen({
  uiApi,
  site,
  playerId,
  onBack,
  onAction,
  onOpenJobs,
  onSelectNpc,
}: LocationScreenProps) {
  const calendar = uiApi.getCalendar();
  const content = getLocationContent(site.kind);
  const listings = uiApi.listMarketListings(site.id);
  const employment = uiApi.getEmployment(playerId);
  const present = uiApi.listPresentEntities(site.id);
  const holder = site.landValue ? uiApi.getSiteHolder(site.id) : null;
  // A site kind's content lists the shift action of the business seeded
  // there (data/locationContent.ts); only offer it where that business
  // actually works — not at every parcel of the same kind (a vacant field
  // isn't Oster Farm), and not once it has closed.
  const openings = uiApi.listJobOpenings();
  const actions = content.actions.filter((action) => {
    const jobSlotId = workShiftJobSlotId(action.type);
    if (jobSlotId === null) return true;
    const slot = openings.find((s) => s.id === jobSlotId);
    return slot !== undefined && uiApi.getCompany(slot.companyId)?.siteId === site.id;
  });

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
      <div className="location-actions">
        {actions.map((action) => {
          const good = marketGoodType(action.type);
          const listing = good ? listings.find((l) => l.goodType === good) : undefined;
          const jobSlotId = workShiftJobSlotId(action.type);
          const jobHint =
            jobSlotId === null
              ? null
              : employment && employment.jobSlotId === jobSlotId
                ? ` (wage ${employment.wage} coin/shift)`
                : ` (you don't work here)`;
          return (
            <button key={action.type} type="button" onClick={() => handleAction(action.type)}>
              {action.label}
              {listing && ` (${listing.price} coin, ${listing.quantity} in stock)`}
              {jobHint}
            </button>
          );
        })}
      </div>
    </section>
  );
}
