import { useState } from 'react';
import { LogPanel } from '../components/LogPanel';
import { SceneHeader } from '../components/SceneHeader';
import { getLocationContent } from '../data/locationContent';
import type { UiApi } from '../engine/ui-api';

interface SettlementScreenProps {
  uiApi: UiApi;
  onSelectSite: (siteId: string) => void;
  onSelectHousehold: (householdId: string) => void;
  onSelectBusiness: (companyId: string) => void;
}

type Tab = 'locations' | 'households' | 'businesses' | 'log';

// §5.5 Navigation Model / §Stage 1: "settlement screen with clickable
// locations (stub panels)... settlement log tab." §Stage 4 adds a
// Households tab; §Stage 5 adds a Businesses tab (§14.2's NPC business view
// needs a way in).
export function SettlementScreen({
  uiApi,
  onSelectSite,
  onSelectHousehold,
  onSelectBusiness,
}: SettlementScreenProps) {
  const [tab, setTab] = useState<Tab>('locations');
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
          onClick={() => setTab('locations')}
        >
          Locations
        </button>
        <button
          type="button"
          className={tab === 'households' ? 'active' : ''}
          onClick={() => setTab('households')}
        >
          Households
        </button>
        <button
          type="button"
          className={tab === 'businesses' ? 'active' : ''}
          onClick={() => setTab('businesses')}
        >
          Businesses
        </button>
        <button type="button" className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>
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
