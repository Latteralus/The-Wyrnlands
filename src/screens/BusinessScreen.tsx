import { SceneHeader } from '../components/SceneHeader';
import type { UiApi } from '../engine/ui-api';

interface BusinessScreenProps {
  uiApi: UiApi;
  companyId: string;
  onBack: () => void;
}

// §14.2 "NPC business view: the observable subset (prices, staffing,
// visible stock, reputation later)" — deliberately does NOT show ledger
// figures (revenue/cost/net). §9.3 draws that line explicitly: "Player
// businesses expose the full ledger with history; NPC businesses expose
// what an observer would plausibly know." A passerby can see whether a
// business is hiring, thriving, or shuttered — not its books.
function describeStatus(company: { insolventSinceTick: number | null; closedAtTick: number | null }): string {
  if (company.closedAtTick !== null) return 'Closed.';
  if (company.insolventSinceTick !== null) return 'Struggling to make ends meet.';
  return 'Open for business.';
}

export function BusinessScreen({ uiApi, companyId, onBack }: BusinessScreenProps) {
  const calendar = uiApi.getCalendar();
  const company = uiApi.getCompany(companyId);
  const owner = company?.ownerId ? uiApi.getEntity(company.ownerId) : null;
  const slots = uiApi.listJobSlotsForCompany(companyId);
  // §14.3 "Business logs (the ledger as narrative)": everything visible
  // about this company, across both scopes it logs to (business-scope
  // routine sales, settlement-scope hirings/upgrades/closures).
  const log = uiApi.queryActorLog(companyId, 30);

  return (
    <section>
      <SceneHeader icon="🏛️" title={company?.name ?? 'Unknown Business'} calendar={calendar} />

      <button type="button" className="back-button" onClick={onBack}>
        ← Back
      </button>

      {company && (
        <>
          <p className="business-status">
            {company.kind[0]?.toUpperCase()}
            {company.kind.slice(1)} · tier {company.tier} · {describeStatus(company)}
          </p>
          {owner && <p className="business-owner">Run by {owner.name}.</p>}

          <h3>Staffing</h3>
          <ul className="business-jobslots">
            {slots.map((slot) => (
              <li key={slot.id}>
                {slot.title}: {uiApi.countActiveEmploymentsForSlot(slot.id)}/{slot.capacity} filled —{' '}
                {slot.wageMin}
                {slot.wageMin !== slot.wageMax ? `-${slot.wageMax}` : ''} coin/shift
              </li>
            ))}
          </ul>

          <h3>Business Log</h3>
          <ul className="log-list">
            {log.length === 0 && <li className="log-empty">Nothing notable on record.</li>}
            {log.map((event, i) => (
              <li key={i}>
                <span className="log-tick">[{event.tick}]</span> {event.message}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
