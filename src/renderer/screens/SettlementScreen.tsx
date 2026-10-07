import { LogPanel } from '../components/LogPanel';
import { SceneHeader } from '../components/SceneHeader';
import { getLocationContent, hasLocalActions } from '../data/locationContent';
import { useCalendar, useView } from '../sim/hooks';

export type SettlementTab = 'locations' | 'households' | 'businesses' | 'log';

interface SettlementScreenProps {
  tab: SettlementTab;
  onTabChange: (tab: SettlementTab) => void;
  onSelectSite: (siteId: string) => void;
  onSelectHousehold: (householdId: string) => void;
  onSelectBusiness: (companyId: string) => void;
}

// §5.5 Navigation Model / §Stage 1: "settlement screen with clickable
// locations (stub panels)... settlement log tab." §Stage 4 adds a
// Households tab; §Stage 5 adds a Businesses tab (§14.2's NPC business view
// needs a way in). Tab selection is owned by App.tsx (not local state) so
// it survives drilling into a location/household/business and back — this
// screen remounts on every return trip since App.tsx renders it only in the
// 'settlement' view branch.
export function SettlementScreen({
  tab,
  onTabChange,
  onSelectSite,
  onSelectHousehold,
  onSelectBusiness,
}: SettlementScreenProps) {
  const calendar = useCalendar();
  const view = useView('view.settlement', undefined).data;
  const sites = view?.sites ?? [];
  const households = view?.households ?? [];
  const companies = view?.companies ?? [];
  // A site an open business works, with nothing else to do there, is that
  // business — it's on the Businesses tab, not listed twice. Shared ground
  // (the forest, where anyone can chop wood) and empty land stay listed.
  const workedSites = new Set(companies.filter((c) => c.closedAtTick === null).map((c) => c.siteId));
  const places = sites.filter((site) => !workedSites.has(site.id) || hasLocalActions(site.kind));

  return (
    <section>
      {calendar && <SceneHeader icon="🏘️" title="Oakford" calendar={calendar} />}

      <div className="tabs">
        <button
          type="button"
          className={tab === 'locations' ? 'active' : ''}
          onClick={() => onTabChange('locations')}
        >
          Locations
        </button>
        <button
          type="button"
          className={tab === 'households' ? 'active' : ''}
          onClick={() => onTabChange('households')}
        >
          Households
        </button>
        <button
          type="button"
          className={tab === 'businesses' ? 'active' : ''}
          onClick={() => onTabChange('businesses')}
        >
          Businesses
        </button>
        <button type="button" className={tab === 'log' ? 'active' : ''} onClick={() => onTabChange('log')}>
          Settlement Log
        </button>
      </div>

      {tab === 'locations' && (
        <div className="location-grid">
          {places.map((site) => {
            const content = getLocationContent(site.kind);
            return (
              <button
                key={site.id}
                type="button"
                className="location-card"
                onClick={() => onSelectSite(site.id)}
              >
                <span className="location-card-icon" aria-hidden="true">
                  {content.icon}
                </span>
                <span className="location-card-name">{site.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {tab === 'households' && (
        <div className="location-grid">
          {households.map((household) => (
            <button
              key={household.id}
              type="button"
              className="location-card"
              onClick={() => onSelectHousehold(household.id)}
            >
              <span className="location-card-icon" aria-hidden="true">
                🏠
              </span>
              <span className="location-card-name">
                {household.name}
                {household.departedAtTick !== null && ' (departed)'}
              </span>
            </button>
          ))}
        </div>
      )}

      {tab === 'businesses' && (
        <div className="location-grid">
          {companies.map((company) => (
            <button
              key={company.id}
              type="button"
              className="location-card"
              onClick={() => onSelectBusiness(company.id)}
            >
              <span className="location-card-icon" aria-hidden="true">
                🏛️
              </span>
              <span className="location-card-name">
                {company.name}
                {company.closedAtTick !== null && ' (closed)'}
              </span>
            </button>
          ))}
        </div>
      )}

      {tab === 'log' && <LogPanel scope="settlement" emptyMessage="Nothing has happened here yet." />}
    </section>
  );
}
