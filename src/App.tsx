import { useEffect, useRef, useState } from 'react';
import { Hud } from './components/Hud';
import { LogPanel } from './components/LogPanel';
import { loadSqlJs } from './engine/db/sqlite.browser';
import { useGameClock } from './hooks/useGameClock';
import { GameSession } from './persistence/gameSession';
import { SaveStore, selectContinueSave, type SaveMetadata } from './persistence/saveStore';
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
import type { UiApi, NewGameConfig } from './engine/ui-api';
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

function App() {
  const sessionRef = useRef<GameSession | null>(null);
  const [store] = useState(() => new SaveStore());
  const [state, setState] = useState<AppState>('booting');
  const [saves, setSaves] = useState<SaveMetadata[]>([]);
  const savesRef = useRef<SaveMetadata[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const lastAutosaveTick = useRef(-1);
  const mutationRevision = useRef(0);
  const lastAutosaveRevision = useRef(-1);
  const [uiApi, setUiApi] = useState<UiApi | null>(null);
  const [view, setView] = useState<View>({ kind: 'character' });
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
  const bump = () => {
    mutationRevision.current++;
    bumpCounter((c) => c + 1);
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadSqlJs(), store.list()])
      .then(([, list]) => {
        if (!cancelled) {
          setSaves(list);
          savesRef.current = list;
          setState('title');
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setNotice(error instanceof Error ? error.message : 'Could not open the game.');
          setState('title');
        }
      });
    return () => {
      cancelled = true;
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, [store]);

  const clock = useGameClock(state === 'playing' ? uiApi : null, bump);
  const refreshSaves = async () => {
    const list = await store.list();
    savesRef.current = list;
    setSaves(list);
  };
  const persist = (id: string, name: string, kind: SaveMetadata['kind'], previous?: SaveMetadata) => {
    const session = sessionRef.current;
    if (!session) return Promise.resolve();
    // Export synchronously between tick batches. Serialize writes so an older snapshot cannot win.
    const save = session.snapshot(id, name, kind, previous);
    const pending = writeQueue.current.then(() => store.put(save));
    writeQueue.current = pending.catch(() => {});
    return pending;
  };
  const autosave = async (force = false) => {
    const session = sessionRef.current;
    if (
      !session ||
      (!force &&
        session.api.getTick() === lastAutosaveTick.current &&
        mutationRevision.current === lastAutosaveRevision.current)
    )
      return;
    const tick = session.api.getTick();
    const revision = mutationRevision.current;
    await persist(
      'autosave',
      'Autosave',
      'autosave',
      savesRef.current.find((save) => save.id === 'autosave'),
    );
    if (sessionRef.current === session) {
      lastAutosaveTick.current = tick;
      lastAutosaveRevision.current = revision;
    }
    await refreshSaves();
  };
  const autosaveRef = useRef(autosave);
  useEffect(() => {
    autosaveRef.current = autosave;
  });
  useEffect(() => {
    if (state !== 'playing') return;
    const save = () => {
      void autosaveRef
        .current()
        .catch((error: unknown) =>
          setNotice(error instanceof Error ? error.message : 'Autosave failed. Export a portable copy.'),
        );
    };
    const interval = setInterval(save, 60_000);
    const hidden = () => {
      if (document.visibilityState === 'hidden') save();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [state]);

  const perform = (action: () => Promise<void>) => {
    setBusy(true);
    setNotice('');
    clock.setSpeed('paused');
    void action()
      .catch((error: unknown) =>
        setNotice(error instanceof Error ? error.message : 'The operation could not be completed.'),
      )
      .finally(() => setBusy(false));
  };
  const enter = (session: GameSession) => {
    sessionRef.current?.dispose();
    sessionRef.current = session;
    setUiApi(session.api);
    setView({ kind: 'character' });
    setState('playing');
    lastAutosaveTick.current = -1;
    lastAutosaveRevision.current = -1;
  };
  const newGame = (config: NewGameConfig) =>
    perform(async () => {
      enter(await GameSession.create(config));
      await autosave();
    });
  const loadSlot = async (save: SaveMetadata) => {
    const stored = await store.get(save.id);
    if (!stored) throw new Error('This save is no longer available.');
    enter(await GameSession.load(stored.bytes));
    // Continue should subsequently return to the life that was just selected.
    await autosave();
  };
  const continueGame = () =>
    perform(async () => {
      const remaining = [...saves];
      while (remaining.length) {
        const chosen = selectContinueSave(remaining);
        if (!chosen) break;
        let session: GameSession;
        try {
          const stored = await store.get(chosen.id);
          if (!stored) throw new Error('Save missing.');
          session = await GameSession.load(stored.bytes);
        } catch {
          remaining.splice(
            remaining.findIndex((s) => s.id === chosen.id),
            1,
          );
          continue;
        }
        enter(session);
        await autosave();
        return;
      }
      throw new Error('No compatible local save could be loaded. Use Load Game to import a backup.');
    });
  const returnToTitle = () =>
    perform(async () => {
      await autosave(true);
      sessionRef.current?.dispose();
      sessionRef.current = null;
      setUiApi(null);
      setState('title');
    });
  const exportSave = () => {
    const session = sessionRef.current;
    if (!session) return;
    const bytes = session.export();
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/vnd.sqlite3' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `wyrnlands-${session.api
      .getPlayerProfile()
      .name.toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')}.sqlite`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const savePanel = (
    <SaveScreen
      saves={saves}
      canSave={Boolean(uiApi)}
      busy={busy}
      onSave={(name, slot) =>
        perform(async () => {
          if (!name.trim()) throw new Error('Enter a save name.');
          await persist(slot?.id ?? crypto.randomUUID(), name.trim(), 'manual', slot);
          await refreshSaves();
        })
      }
      onLoad={(save) => perform(() => loadSlot(save))}
      onDelete={(id) =>
        perform(async () => {
          await writeQueue.current;
          await store.delete(id);
          await refreshSaves();
        })
      }
      onImport={(file) =>
        perform(async () => {
          const imported = await GameSession.load(new Uint8Array(await file.arrayBuffer()));
          try {
            await store.put(
              imported.snapshot(crypto.randomUUID(), file.name.replace(/\.sqlite$/i, ''), 'import'),
            );
          } finally {
            imported.dispose();
          }
          await refreshSaves();
          setNotice('Imported save added. Select Load to resume it.');
        })
      }
      onExport={exportSave}
      onBack={() => setState(uiApi ? 'playing' : 'title')}
    />
  );

  if (state !== 'playing' || !uiApi)
    return (
      <main className="title-shell">
        <h1>The Wyrnlands</h1>
        {notice && (
          <p className="app-notice" role="alert">
            {notice}
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
              Autosave runs every minute while playing, when the browser tab is hidden, and when returning to
              title. Export a save for a portable backup.
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
            <button className="primary-button" disabled={busy || !saves.length} onClick={continueGame}>
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
            {selectContinueSave(saves) && (
              <p>
                Continue: {selectContinueSave(saves)?.characterName} · Year {selectContinueSave(saves)?.year},{' '}
                {selectContinueSave(saves)?.season}, day {selectContinueSave(saves)?.day}
              </p>
            )}
          </section>
        )}
      </main>
    );

  const playerId = uiApi.getPlayerEntityId();
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
      <h1>
        The Wyrnlands <span className="character-heading">{uiApi.getPlayerProfile().name}</span>
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
            perform(autosave);
          }}
        >
          Save
        </button>
        <button disabled={busy} onClick={returnToTitle}>
          Title
        </button>
      </nav>
      {notice && (
        <p className="app-notice" role="alert">
          {notice}
        </p>
      )}
      <Hud uiApi={uiApi} playerId={playerId} clock={clock} onRefresh={bump} />

      <div className="game-body">
        <main className="game-main">
          {view.kind === 'character' ? (
            <CharacterScreen
              uiApi={uiApi}
              onAction={bump}
              onHome={() => setView({ kind: 'home' })}
              onWork={() => setView({ kind: 'jobs' })}
              onBusiness={(id) => setView({ kind: 'business', companyId: id })}
            />
          ) : view.kind === 'home' ? (
            <PlayerHomeScreen
              uiApi={uiApi}
              onAction={bump}
              onBusiness={(id) => setView({ kind: 'business', companyId: id })}
            />
          ) : view.kind === 'businesses' ? (
            <PlayerBusinessesScreen
              uiApi={uiApi}
              onAction={bump}
              onSelectBusiness={(id) => setView({ kind: 'business', companyId: id })}
            />
          ) : view.kind === 'chronicle' ? (
            <section className="player-panel">
              <h2>Chronicle</h2>
              <h3>Settlement</h3>
              <LogPanel uiApi={uiApi} scope="settlement" limit={60} />
              <h3>World</h3>
              <LogPanel uiApi={uiApi} scope="world" limit={40} />
            </section>
          ) : view.kind === 'jobs' ? (
            <JobsScreen
              uiApi={uiApi}
              playerId={playerId}
              onBack={() => setView({ kind: 'settlement' })}
              onAction={bump}
            />
          ) : view.kind === 'location' && site ? (
            site.kind === 'market' ? (
              <MarketScreen
                uiApi={uiApi}
                site={site}
                playerId={playerId}
                onBack={() => setView({ kind: 'settlement' })}
                onAction={bump}
                onSelectBusiness={(companyId) => setView({ kind: 'business', companyId })}
              />
            ) : (
              <LocationScreen
                uiApi={uiApi}
                site={site}
                playerId={playerId}
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
              playerId={playerId}
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
