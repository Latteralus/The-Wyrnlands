import { useEffect, useRef, useState } from 'react';
import { Hud } from './components/Hud';
import { LogPanel } from './components/LogPanel';
import { createDatabase } from './engine/db/sqlite';
import { loadSqlJs } from './engine/db/sqlite.browser';
import { Engine } from './engine/engine';
import { seedDemoWorld, PLAYER_ID } from './engine/seed/demoWorld';
import { createUiApi, type UiApi } from './engine/ui-api';
import { useGameClock } from './hooks/useGameClock';
import { BusinessScreen } from './screens/BusinessScreen';
import { HouseholdScreen } from './screens/HouseholdScreen';
import { JobsScreen } from './screens/JobsScreen';
import { LocationScreen } from './screens/LocationScreen';
import { MarketScreen } from './screens/MarketScreen';
import { NpcProfileScreen } from './screens/NpcProfileScreen';
import { SettlementScreen, type SettlementTab } from './screens/SettlementScreen';
import './App.css';

type View =
  | { kind: 'settlement' }
  | { kind: 'location'; siteId: string }
  | { kind: 'jobs' }
  | { kind: 'household'; householdId: string }
  | { kind: 'npc'; entityId: string }
  | { kind: 'business'; companyId: string };

function App() {
  const engineRef = useRef<Engine | null>(null);
  const [uiApi, setUiApi] = useState<UiApi | null>(null);
  const [view, setView] = useState<View>({ kind: 'settlement' });
  // Owned here (not inside SettlementScreen) so it survives drilling into a
  // location/household/business and back — SettlementScreen remounts fresh
  // each time it becomes the active view.
  const [settlementTab, setSettlementTab] = useState<SettlementTab>('locations');
  // Inspect mode for the person/household/business profiles: show what a
  // townsperson couldn't know (exact coin, belongings, traits, books). Held
  // here so it survives moving between profiles.
  const [inspect, setInspect] = useState(false);
  // Unread on purpose — its setter just forces a re-render so screens re-query
  // uiApi (a thin sync SQLite wrapper) after a tick batch or a queued action.
  const [, bumpCounter] = useState(0);
  const bump = () => bumpCounter((c) => c + 1);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const SQL = await loadSqlJs();
      const db = createDatabase(SQL);
      const engine = Engine.bootstrap(db, { seed: 'wyrnlands-dev' });
      seedDemoWorld(engine);
      // You live your day on your own — work your shift, eat, drink, sleep
      // (seed/demoWorld.ts's playerRoutine); anything you queue runs first.
      engine.setAutonomous(PLAYER_ID, true);
      if (cancelled) {
        engine.dispose();
        return;
      }
      engineRef.current = engine;
      setUiApi(createUiApi(engine));
    })();

    return () => {
      cancelled = true;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const clock = useGameClock(uiApi, bump);

  if (!uiApi) {
    return (
      <main className="boot-screen">
        <p>Booting the simulation…</p>
      </main>
    );
  }

  const site = view.kind === 'location' ? uiApi.getSite(view.siteId) : null;
  const profileProps = {
    inspect,
    onToggleInspect: () => setInspect((on) => !on),
    onBack: () => setView({ kind: 'settlement' }),
    onSelectNpc: (entityId: string) => setView({ kind: 'npc', entityId }),
    onSelectHousehold: (householdId: string) => setView({ kind: 'household', householdId }),
    onSelectBusiness: (companyId: string) => setView({ kind: 'business', companyId }),
  };

  return (
    <div className="game-shell">
      <h1>The Wyrnlands</h1>
      <Hud uiApi={uiApi} playerId={PLAYER_ID} clock={clock} onRefresh={bump} />

      <div className="game-body">
        <main className="game-main">
          {view.kind === 'jobs' ? (
            <JobsScreen
              uiApi={uiApi}
              playerId={PLAYER_ID}
              onBack={() => setView({ kind: 'settlement' })}
              onAction={bump}
            />
          ) : view.kind === 'location' && site ? (
            site.kind === 'market' ? (
              <MarketScreen
                uiApi={uiApi}
                site={site}
                playerId={PLAYER_ID}
                onBack={() => setView({ kind: 'settlement' })}
                onAction={bump}
                onSelectBusiness={(companyId) => setView({ kind: 'business', companyId })}
              />
            ) : (
              <LocationScreen
                uiApi={uiApi}
                site={site}
                playerId={PLAYER_ID}
                onBack={() => setView({ kind: 'settlement' })}
                onAction={bump}
                onOpenJobs={() => setView({ kind: 'jobs' })}
                onSelectNpc={(entityId) => setView({ kind: 'npc', entityId })}
              />
            )
          ) : view.kind === 'household' ? (
            <HouseholdScreen uiApi={uiApi} householdId={view.householdId} {...profileProps} />
          ) : view.kind === 'npc' ? (
            <NpcProfileScreen uiApi={uiApi} entityId={view.entityId} {...profileProps} />
          ) : view.kind === 'business' ? (
            <BusinessScreen
              uiApi={uiApi}
              companyId={view.companyId}
              playerId={PLAYER_ID}
              onAction={bump}
              {...profileProps}
            />
          ) : (
            <SettlementScreen
              uiApi={uiApi}
              tab={settlementTab}
              onTabChange={setSettlementTab}
              onSelectSite={(siteId) => setView({ kind: 'location', siteId })}
              onSelectHousehold={(householdId) => setView({ kind: 'household', householdId })}
              onSelectBusiness={(companyId) => setView({ kind: 'business', companyId })}
            />
          )}
        </main>
        <aside className="game-sidebar">
          <h3>Personal Log</h3>
          <LogPanel uiApi={uiApi} scope="personal" emptyMessage="Nothing has happened to you yet." />
        </aside>
      </div>
    </div>
  );
}

export default App;
