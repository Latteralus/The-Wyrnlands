import { createDatabase, type SqlJsStatic } from './db/sqlite';
import { Engine } from './engine';

// The real fix for the sql.js/WASM memory ceiling (see DECISIONS.md's
// checkpoint/rehydration entry and the wyrnlands-sqljs-memory-ceiling
// memory for the full empirical trail — Stage 2 through Stage 4 all hit
// this and shipped exit tests at a reduced duration rather than solving it).
//
// The mechanism, confirmed both by the project's own testing and by
// upstream sql.js issues (sql-js/sql.js#482, #571): a WASM module's linear
// memory can only grow, never shrink, and has no garbage collector — every
// allocation sql.js's WASM binding makes has to be explicitly freed, and
// evidently not all of them are. `db/sqlite.{node,browser}.ts`'s
// `loadSqlJs()` memoizes `initSqlJs()`, so there is exactly *one* WASM
// module instance — one linear-memory heap — for the life of the process
// (or browser tab). Every `new SQL.Database()` created from it, no matter
// how many times, shares that same heap; closing one connection and opening
// another does not reclaim anything, because the leak/fragmentation lives in
// the module's memory, not the connection.
//
// The only way to actually get a fresh heap is a fresh WASM module instance
// — and simply calling `initSqlJs()` again does NOT give you one: sql.js's
// own bundled code caches its module promise at that module's top level, so
// a second call through the same import silently returns the *original*
// instance (confirmed empirically — see sqlite.node.ts's loadFreshSqlJs()
// for the real mechanism and how that false start was caught). This
// function doesn't know or care how its `loadFreshSqlJs` option actually
// gets a fresh instance — only that it's the caller's job to supply one
// that genuinely does.
//
// checkpointEngine below exports the current world to bytes, disposes the
// old Engine, instantiates a *new* WASM module via options.loadFreshSqlJs(),
// and rehydrates a new Engine from those bytes inside it. Determinism
// survives the boundary because Engine.export() syncs the RNG's current
// state into world_meta first, and Engine's constructor resumes from that
// saved state instead of re-deriving it from the seed string (see rng.ts's
// SeededRng and engine.ts's constructor comment) — so a checkpointed run
// produces the exact same outcome as an uninterrupted one would have
// (proven in checkpoint.test.ts).
//
// Deliberately NOT automatic/hidden inside Engine.advanceTicks(): that
// method is synchronous and called in tight loops (every scripted test,
// the UI's tick interval); loadFreshSqlJs() is inherently async (it
// recompiles a wasm binary), so checkpointing has to be an explicit,
// caller-driven operation at a boundary the caller chooses — not silently
// injected into a hot path.
export interface CheckpointOptions {
  seed: string;
  loadFreshSqlJs: () => Promise<SqlJsStatic>;
}

// Call this occasionally (every N in-game days, not every tick) during a
// long-running simulation — headless or in the browser — to escape the
// accumulated heap damage before it crashes the run. How occasionally is
// empirically tuned per caller (see stage4.test.ts): too rare and the run
// still crashes between checkpoints; too frequent wastes time recompiling
// the wasm binary for no benefit.
//
// IMPORTANT — the Engine this returns has an *empty* ActionRegistry. Action
// *definitions* are code, held only in-memory (§Stage 0's decision), never
// persisted to the DB — a rehydrated Engine is exactly a reload from the
// registry's point of view. Callers must re-run whatever registers their
// action types (e.g. seed/demoWorld.ts's registerDemoActionTypes(), via
// seedDemoWorld()) on the returned Engine before using it, exactly as they
// already must after Engine.bootstrap() itself. Forgetting this throws
// "Unknown action type" the moment a queued action tries to resolve — not
// a checkpoint.ts bug, the same pre-existing reload contract every caller
// already has to honor.
export async function checkpointEngine(engine: Engine, options: CheckpointOptions): Promise<Engine> {
  const bytes = engine.export();
  engine.dispose();
  const SQL = await options.loadFreshSqlJs();
  const db = createDatabase(SQL, bytes);
  return Engine.bootstrap(db, { seed: options.seed });
}
