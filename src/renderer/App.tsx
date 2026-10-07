import { useEffect, useState } from 'react';
import { Hud } from './components/Hud';
import { LogPanel } from './components/LogPanel';
import { useGameClock } from './hooks/useGameClock';
import { BusinessScreen } from './screens/BusinessScreen';
import { CharacterCreationScreen } from './screens/CharacterCreationScreen';
import { CharacterScreen } from './screens/CharacterScreen';
import { HouseholdScreen } from './screens/HouseholdScreen';
import { JobsScreen } from './screens/JobsScreen';
import { LocationScreen } from './screens/LocationScreen';
import { MarketScreen } from './screens/MarketScreen';
import { NpcProfileScreen } from './screens/NpcProfileScreen';
import { PlayerBusinessesScreen } from './screens/PlayerBusinessesScreen';
import { PlayerHomeScreen } from './screens/PlayerHomeScreen';
import { SaveScreen } from './screens/SaveScreen';
import { SettlementScreen, type SettlementTab } from './screens/SettlementScreen';
import { useSimulation, useSimulationValue, useView } from './sim/hooks';
import type { NewGameConfig, SaveListing, SaveMetadata, SessionInfo } from '../shared/protocol';
import './App.css';

type AppState = 'booting' | 'title' | 'character-creation' | 'playing' | 'load-game' | 'settings';

type View =
  | { kind: 'character' }
  | { kind: 'home' }
  | { kind: 'businesses' }
  | { kind: 'chronicle' }
  | { kind: 'settlement' }
  | { kind: 'location'; siteId: string }
  | { kind: 'jobs' }
  | { kind: 'household'; householdId: string }
  | { kind: 'npc'; entityId: string }
  | { kind: 'business'; companyId: string };

const message = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

// A place in the settlement: the market has its own screen, everywhere else
// the general location panel.
function PlaceScreen({
  siteId,
  onBack,
  onOpenJobs,
  onSelectNpc,
  onSelectBusiness,
}: {
  siteId: string;
  onBack: () => void;
  onOpenJobs: () => void;
  onSelectNpc: (entityId: string) => void;
  onSelectBusiness: (companyId: string) => void;
}) {
  const { data: place } = useView('view.location', { siteId });
  if (place === undefined) return <section className="loading-panel">Loading…</section>;
  if (place === null)
    return (
      <section>
        <p>That place is not known here.</p>
        <button type="button" className="back-button" onClick={onBack}>
          ← Back to settlement
        </button>
      </section>
    );
  return place.site.kind === 'market' ? (
    <MarketScreen site={place.site} onBack={onBack} onSelectBusiness={onSelectBusiness} />
  ) : (
    <LocationScreen view={place} onBack={onBack} onOpenJobs={onOpenJobs} onSelectNpc={onSelectNpc} />
  );
}

// The interface shell. It owns navigation and the save/load flow; the game
// itself runs in the simulation process, reached through sim/simulation.tsx.
function App() {
  const { client, store } = useSimulation();
  // Only what the shell itself shows — not the clock, which would redraw
  // the whole tree on every batch of ticks.
  const session = useSimulationValue((s) => s.session);
  const savesVersion = useSimulationValue((s) => s.savesVersion);
  const hostError = useSimulationValue((s) => s.hostError);
  const [state, setState] = useState<AppState>('booting');
  const [listing, setListing] = useState<SaveListing>({ saves: [], activeSaveId: null });
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>({ kind: 'character' });
  // Owned here (not inside SettlementScreen) so it survives drilling into a
  // location/household/business and back — SettlementScreen remounts fresh
  // each time it becomes the active view.
  const [settlementTab, setSettlementTab] = useState<SettlementTab>('locations');
  // Inspect mode for the person/household/business profiles: show what a
  // townsperson couldn't know (exact coin, belongings, traits, books). Held
  // here so it survives moving between profiles.
  const [inspect, setInspect] = useState(false);
  const clock = useGameClock(setNotice);
  const hasSession = session !== null;

  // Start-up: a game may already be running in the simulation process (the
  // window was reloaded); otherwise show the title screen.
  useEffect(() => {
    let cancelled = false;
    Promise.all([client.request('session.get'), client.request('saves.list')])
      .then(([session, saves]) => {
        if (cancelled) return;
        store.setSession(session);
        setListing(saves);
        setState(session ? 'playing' : 'title');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setNotice(message(error, 'Could not open the game.'));
        setState('title');
      });
    return () => {
      cancelled = true;
    };
  }, [client, store]);

  // The save list, whenever it may have changed and is on screen.
  const showingSaves = state === 'title' || state === 'load-game';
  useEffect(() => {
    if (!showingSaves) return;
    let cancelled = false;
    client
      .request('saves.list')
      .then((saves) => !cancelled && setListing(saves))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client, showingSaves, savesVersion]);

  // Problems the simulation reports on its own (an autosave that failed…)
  // show until the player's next action.
  const shownNotice = notice || hostError || '';

  const perform = (action: () => Promise<void>) => {
    setBusy(true);
    setNotice('');
    store.clearHostError();
    void action()
      .catch((error: unknown) => setNotice(message(error, 'The operation could not be completed.')))
      .finally(() => setBusy(false));
  };
  const enter = (session: SessionInfo) => {
    store.setSession(session);
    setView({ kind: 'character' });
    setState('playing');
  };
  const newGame = (config: NewGameConfig) =>
    perform(async () => enter(await client.request('session.newGame', config)));
  const continueGame = () => perform(async () => enter(await client.request('session.continue')));
  const loadSlot = (save: SaveMetadata) =>
    perform(async () => enter(await client.request('session.load', { saveId: save.id })));
  const returnToTitle = () =>
    perform(async () => {
      await client.request('session.close');
      store.setSession(null);
      setState('title');
    });
  const exportSave = () =>
    perform(async () => {
      const result = await client.exportSave();
      if (result.status === 'saved') setNotice(`Exported ${result.fileName}.`);
      else if (result.status === 'failed') setNotice(result.message);
    });
  const importSave = () =>
    perform(async () => {
      const result = await client.importSave();
      if (result.status === 'imported') setNotice('Imported save added. Select Load to resume it.');
      else if (result.status === 'failed') setNotice(result.message);
    });

  const savePanel = (
    <SaveScreen
      saves={listing.saves}
      activeSaveId={hasSession ? listing.activeSaveId : null}
      canSave={hasSession}
      busy={busy}
      onSave={(name, slot) =>
        perform(async () => {
          if (!name.trim()) throw new Error('Enter a save name.');
          await client.request('saves.create', { name: name.trim(), overwriteId: slot?.id ?? null });
        })
      }
      onLoad={loadSlot}
      onDelete={(id) => perform(() => client.request('saves.delete', { saveId: id }))}
      onImport={importSave}
      onExport={exportSave}
      onBack={() => setState(hasSession ? 'playing' : 'title')}
    />
  );

  const newest = listing.saves[0];
  // (A game that ended under us — the simulation was restarted — lands on
  // the title screen.)
  if (state !== 'playing' || !hasSession)
    return (
      <main className="title-shell">
        <h1>The Wyrnlands</h1>
        {shownNotice && (
          <p className="app-notice" role="alert">
            {shownNotice}
          </p>
        )}
        {state === 'booting' ? (
          <p>Opening the game and your save library…</p>
        ) : state === 'character-creation' ? (
          <CharacterCreationScreen onCreate={newGame} onBack={() => setState('title')} busy={busy} />
        ) : state === 'load-game' ? (
          savePanel
        ) : state === 'settings' ? (
          <section className="player-panel">
            <h2>Settings</h2>
            <p>
              Games begin paused. Use the clock to run at 1×, 4×, or 16×. Your character’s routine and lodging
              preferences are available from Home once you start a life.
            </p>
            <p>
              The game saves itself every minute while playing, and when you return to the title screen or
              close the window. Export a save for a portable backup.
            </p>
            <button onClick={() => setState('title')}>Back</button>
          </section>
        ) : (
          <section className="title-menu">
            <p className="eyebrow">A life earned, one day at a time</p>
            <p>
              Find your place in Oakford. Learn a trade, keep a roof over your head, and build something that
              lasts.
            </p>
            <button
              className="primary-button"
              disabled={busy || !listing.saves.length}
              onClick={continueGame}
            >
              Continue
            </button>
            <button disabled={busy} onClick={() => setState('character-creation')}>
              New Game
            </button>
            <button disabled={busy} onClick={() => setState('load-game')}>
              Load Game
            </button>
            <button disabled={busy} onClick={() => setState('settings')}>
              Settings
            </button>
            {newest && (
              <p>
                Continue: {newest.characterName} · Year {newest.year}, {newest.season}, day {newest.day}
              </p>
            )}
          </section>
        )}
      </main>
    );

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
      <h1>
        The Wyrnlands <span className="character-heading">{session?.playerName}</span>
      </h1>
      <nav className="primary-nav" aria-label="Main navigation">
        <button aria-pressed={view.kind === 'character'} onClick={() => setView({ kind: 'character' })}>
          Character
        </button>
        <button aria-pressed={view.kind === 'home'} onClick={() => setView({ kind: 'home' })}>
          Home
        </button>
        <button onClick={() => setView({ kind: 'jobs' })}>Work / Jobs</button>
        <button onClick={() => setView({ kind: 'businesses' })}>Businesses</button>
        <button onClick={() => setView({ kind: 'settlement' })}>Settlement</button>
        <button onClick={() => setView({ kind: 'location', siteId: 'market' })}>Market</button>
        <button onClick={() => setView({ kind: 'chronicle' })}>Chronicle</button>
        <button
          disabled={busy}
          onClick={() => {
            clock.setSpeed('paused');
            setState('load-game');
            perform(() => client.request('saves.autosave'));
          }}
        >
          Save
        </button>
        <button disabled={busy} onClick={returnToTitle}>
          Title
        </button>
      </nav>
      {shownNotice && (
        <p className="app-notice" role="alert">
          {shownNotice}
        </p>
      )}
      <Hud clock={clock} onError={setNotice} />

      <div className="game-body">
        <main className="game-main">
          {view.kind === 'character' ? (
            <CharacterScreen
              onHome={() => setView({ kind: 'home' })}
              onWork={() => setView({ kind: 'jobs' })}
              onBusiness={(id) => setView({ kind: 'business', companyId: id })}
            />
          ) : view.kind === 'home' ? (
            <PlayerHomeScreen onBusiness={(id) => setView({ kind: 'business', companyId: id })} />
          ) : view.kind === 'businesses' ? (
            <PlayerBusinessesScreen onSelectBusiness={(id) => setView({ kind: 'business', companyId: id })} />
          ) : view.kind === 'chronicle' ? (
            <section className="player-panel">
              <h2>Chronicle</h2>
              <h3>Settlement</h3>
              <LogPanel scope="settlement" limit={60} />
              <h3>World</h3>
              <LogPanel scope="world" limit={40} />
            </section>
          ) : view.kind === 'jobs' ? (
            <JobsScreen onBack={() => setView({ kind: 'settlement' })} />
          ) : view.kind === 'location' ? (
            <PlaceScreen
              key={view.siteId}
              siteId={view.siteId}
              onBack={() => setView({ kind: 'settlement' })}
              onOpenJobs={() => setView({ kind: 'jobs' })}
              onSelectNpc={(entityId) => setView({ kind: 'npc', entityId })}
              onSelectBusiness={(companyId) => setView({ kind: 'business', companyId })}
            />
          ) : view.kind === 'household' ? (
            <HouseholdScreen householdId={view.householdId} {...profileProps} />
          ) : view.kind === 'npc' ? (
            <NpcProfileScreen entityId={view.entityId} {...profileProps} />
          ) : view.kind === 'business' ? (
            <BusinessScreen companyId={view.companyId} {...profileProps} />
          ) : (
            <SettlementScreen
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
          <LogPanel scope="personal" emptyMessage="Nothing has happened to you yet." />
        </aside>
      </div>
    </div>
  );
}

export default App;
