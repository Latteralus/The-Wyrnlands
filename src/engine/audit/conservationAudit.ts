import { getConservationCounters } from '../inventory/counters';
import { countActiveItems } from '../inventory/items';
import { sumWalletBalances } from '../inventory/wallet';
import type { Database } from '../db/sqlite';
import type { EventBus } from '../eventBus';

export interface AuditResult {
  tick: number;
  passed: boolean;
  goods: { expected: number; actual: number };
  coin: { expected: number; actual: number };
}

// "All goods and coin vs. prior audit ± logged faucets/sinks/spoilage/wear.
// Drift = bug, caught same day" (§16). Expected totals come from counters
// updated only by items.ts/wallet.ts's sanctioned functions; actual totals
// come from live tables. Anything that mutated items/wallets without going
// through those functions shows up here as a mismatch.
export function runConservationAudit(db: Database, bus: EventBus, tick: number): AuditResult {
  const result = inspectConservation(db, tick);
  const {
    passed,
    coin: { actual: actualCoin },
    goods: { actual: actualGoods },
  } = result;

  db.run('INSERT INTO audits (tick, total_coin, total_goods, passed, note) VALUES (?, ?, ?, ?, ?)', [
    tick,
    actualCoin,
    actualGoods,
    passed ? 1 : 0,
    passed ? null : 'Conservation drift detected',
  ]);
  if (!passed) {
    bus.emit({
      tick,
      scope: 'world',
      type: 'audit.failed',
      message: `Conservation audit failed at tick ${tick}: goods ${actualGoods}/${result.goods.expected}, coin ${actualCoin}/${result.coin.expected}.`,
      data: result as unknown as Record<string, unknown>,
    });
  }
  return result;
}

// Read-only validation for imports; loading must not add an audit to world history.
export function inspectConservation(db: Database, tick: number): AuditResult {
  const counters = getConservationCounters(db);

  const expectedGoods = counters.goodsCreated - counters.goodsDestroyed;
  const actualGoods = countActiveItems(db);

  const expectedCoin = counters.coinFaucetTotal - counters.coinSinkTotal;
  const actualCoin = sumWalletBalances(db);

  const passed = expectedGoods === actualGoods && expectedCoin === actualCoin;

  return {
    tick,
    passed,
    goods: { expected: expectedGoods, actual: actualGoods },
    coin: { expected: expectedCoin, actual: actualCoin },
  };
}
