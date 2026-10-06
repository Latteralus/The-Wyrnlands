import { createDatabase, type SqlJsStatic } from './db/sqlite';
import { Engine } from './engine';

// Export the world, dispose the Engine, and rehydrate a new Engine from the
// exported bytes inside a genuinely fresh sql.js WASM module — exactly a
// save/reload, mid-run.
//
// HISTORY (read before relying on this for memory): this was built as "the
// fix" for the sql.js memory ceiling that crashed long runs from Stage 2 to
// Stage 5, on the theory that WASM heap fragmentation accumulated per
// module. The real cause, found 2026-10-06 (PERFORMANCE_AUDIT.md), was
// narrower: sql.js 1.14.1's db.exec() leaks 16 bytes of the module's fixed
// 5 MB *stack* per call, so any module died after ~327,680 exec() calls. A
// fresh module reset the stack, which is why checkpointing appeared to
// work. db/sqlite.ts no longer calls exec(), so long runs no longer need
// checkpoints at all — a 730-day run completes in one module — and
// checkpointing now costs memory instead (discarded modules aren't fully
// released: RSS 325 MB with 24 checkpoints vs 174 MB with none).
//
// It remains correct and deterministic (checkpoint.test.ts; and a 730-day
// run with 24 checkpoints reaches the identical logical-state fingerprint
// as one with none), so it's kept as a tested facility.
//
// Determinism across the boundary: Engine.export() syncs the RNG's current
// state into world_meta first, and Engine's constructor resumes from it.
//
// Deliberately NOT automatic/hidden inside Engine.advanceTicks(): that
// method is synchronous; loading a fresh module is async.
export interface CheckpointOptions {
  seed: string;
  loadFreshSqlJs: () => Promise<SqlJsStatic>;
}

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
