import { useEffect, useRef, useState } from 'react';
import { Hud } from './components/Hud';
import { LogPanel } from './components/LogPanel';
import { createDatabase } from './engine/db/sqlite';
import { loadSqlJs } from './engine/db/sqlite.browser';
import { Engine } from './engine/engine';
import { seedDemoWorld, PLAYER_ID } from './engine/seed/demoWorld';
import { createUiApi, type UiApi } from './engine/ui-api';
import { useGameClock } from './hooks/useGameClock';
import { JobsScreen } from './screens/JobsScreen';
import { LocationScreen } from './screens/LocationScreen';
import { SettlementScreen } from './screens/SettlementScreen';
import './App.css';

type View = { kind: 'settlement' } | { kind: 'location'; siteId: string } | { kind: 'jobs' };

function App() {
  const engineRef = useRef<Engine | null>(null);
  const [uiApi, setUiApi] = useState<UiApi | null>(null);
  const [view, setView] = useState<View>({ kind: 'settlement' });
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
            <LocationScreen
              uiApi={uiApi}
              site={site}
              playerId={PLAYER_ID}
              onBack={() => setView({ kind: 'settlement' })}
              onAction={bump}
              onOpenJobs={() => setView({ kind: 'jobs' })}
            />
          ) : (
            <SettlementScreen
              uiApi={uiApi}
              onSelectSite={(siteId) => setView({ kind: 'location', siteId })}
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
