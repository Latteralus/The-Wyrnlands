import { LogPanel } from '../components/LogPanel';
import { SceneHeader } from '../components/SceneHeader';
import { getLocationContent } from '../data/locationContent';
import type { UiApi } from '../engine/ui-api';

export type SettlementTab = 'locations' | 'households' | 'businesses' | 'log';

interface SettlementScreenProps {
  uiApi: UiApi;
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
  uiApi,
  tab,
  onTabChange,
  onSelectSite,
  onSelectHousehold,
  onSelectBusiness,
}: SettlementScreenProps) {
  const sites = uiApi.listSites();
  const households = uiApi.listHouseholds();
  const companies = uiApi.listCompanies();
  const calendar = uiApi.getCalendar();

  return (
    <section>
      <SceneHeader icon="🏘️" title="Oakford" calendar={calendar} />

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
          {sites.map((site) => {
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
              <span className="location-card-name">{household.name}</span>
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

      {tab === 'log' && (
        <LogPanel uiApi={uiApi} scope="settlement" emptyMessage="Nothing has happened here yet." />
      )}
    </section>
  );
}
