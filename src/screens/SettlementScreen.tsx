import { useState } from 'react';
import { LogPanel } from '../components/LogPanel';
import { SceneHeader } from '../components/SceneHeader';
import { getLocationContent } from '../data/locationContent';
import type { UiApi } from '../engine/ui-api';

interface SettlementScreenProps {
  uiApi: UiApi;
  onSelectSite: (siteId: string) => void;
}

type Tab = 'locations' | 'log';

// §5.5 Navigation Model / §Stage 1: "settlement screen with clickable
// locations (stub panels)... settlement log tab."
export function SettlementScreen({ uiApi, onSelectSite }: SettlementScreenProps) {
  const [tab, setTab] = useState<Tab>('locations');
  const sites = uiApi.listSites();
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

      {tab === 'log' && (
        <LogPanel uiApi={uiApi} scope="settlement" emptyMessage="Nothing has happened here yet." />
      )}
    </section>
  );
}
