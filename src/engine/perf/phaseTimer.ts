// A measurement tool, not simulation logic: accumulates wall-clock time per
// named engine phase (per-tick needs, per-tick actions, daily households,
// daily companies, weekly labor, nightly audit, ...). Engine.phaseTimer is
// null in normal play; only the long-run performance harness (perf/
// longRun.ts) installs one. Uses `performance.now()`, available in Node and
// browsers alike.
export interface PhaseStat {
  phase: string;
  calls: number;
  totalMs: number;
}

export class PhaseTimer {
  private stats = new Map<string, PhaseStat>();

  record(phase: string, ms: number): void {
    let stat = this.stats.get(phase);
    if (!stat) {
      stat = { phase, calls: 0, totalMs: 0 };
      this.stats.set(phase, stat);
    }
    stat.calls++;
    stat.totalMs += ms;
  }

  snapshot(): PhaseStat[] {
    return [...this.stats.values()].sort((a, b) => b.totalMs - a.totalMs).map((s) => ({ ...s }));
  }

  reset(): void {
    this.stats.clear();
  }
}
