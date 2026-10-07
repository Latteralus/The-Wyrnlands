import { queryRow } from '../db/sqlite';
import { MINUTES_PER_DAY } from '../time/clock';
import { incrementCoinFaucetTotal, incrementCoinSinkTotal } from './counters';
import type { Database } from '../db/sqlite';
import type { EventBus, EventScope } from '../eventBus';

export function ensureWallet(db: Database, ownerId: string): void {
  db.run('INSERT OR IGNORE INTO wallets (owner_id, balance) VALUES (?, 0)', [ownerId]);
}

export function getBalance(db: Database, ownerId: string): number {
  const row = queryRow(db, 'SELECT balance FROM wallets WHERE owner_id = ?', [ownerId]);
  return row ? Number(row[0]) : 0;
}

export function sumWalletBalances(db: Database): number {
  const row = queryRow(db, 'SELECT COALESCE(SUM(balance), 0) FROM wallets');
  return Number(row?.[0]);
}

// Coin entering the closed system from outside it — castle provisioning,
// export sales, immigrants' savings (§8.1). The only legitimate way total
// coin should grow.
export function faucetCoin(
  db: Database,
  bus: EventBus,
  ownerId: string,
  amount: number,
  tick: number,
  note?: string,
  scope: EventScope = 'personal',
  // Which designed faucet/sink this is (§8.1 rule 2) — e.g. 'charity',
  // 'import', 'export', 'immigration' — recorded in the event so the
  // economy report can attribute money flows. Optional; untagged flows
  // report as 'other'.
  channel?: string,
): void {
  if (amount <= 0) throw new Error(`faucetCoin amount must be positive, got ${amount}`);
  ensureWallet(db, ownerId);
  db.run('UPDATE wallets SET balance = balance + ? WHERE owner_id = ?', [amount, ownerId]);
  incrementCoinFaucetTotal(db, amount);
  recordCoinFlow(db, tick, 'faucet', channel, amount);
  bus.emit({
    tick,
    scope,
    actorId: ownerId,
    type: 'coin.faucet',
    message: note ?? `${ownerId} received ${amount} coin from outside the economy.`,
    data: channel ? { amount, channel } : { amount },
    detail: true,
  });
}

// Coin leaving the closed system — taxes, imports, emigrants (§8.1). The
// only legitimate way total coin should shrink.
export function sinkCoin(
  db: Database,
  bus: EventBus,
  ownerId: string,
  amount: number,
  tick: number,
  note?: string,
  scope: EventScope = 'personal',
  // Which designed faucet/sink this is (§8.1 rule 2) — e.g. 'charity',
  // 'import', 'export', 'immigration' — recorded in the event so the
  // economy report can attribute money flows. Optional; untagged flows
  // report as 'other'.
  channel?: string,
): void {
  if (amount <= 0) throw new Error(`sinkCoin amount must be positive, got ${amount}`);
  const balance = getBalance(db, ownerId);
  if (balance < amount)
    throw new Error(`Insufficient balance: ${ownerId} has ${balance}, tried to sink ${amount}`);

  db.run('UPDATE wallets SET balance = balance - ? WHERE owner_id = ?', [amount, ownerId]);
  incrementCoinSinkTotal(db, amount);
  recordCoinFlow(db, tick, 'sink', channel, amount);
  bus.emit({
    tick,
    scope,
    actorId: ownerId,
    type: 'coin.sink',
    message: note ?? `${ownerId} paid ${amount} coin out of the economy.`,
    data: channel ? { amount, channel } : { amount },
    detail: true,
  });
}

// Moves coin between two owners already inside the system — a wage, a
// purchase, a haggled price. Conserved: no counters change.
export function transferCoin(
  db: Database,
  bus: EventBus,
  fromOwnerId: string,
  toOwnerId: string,
  amount: number,
  tick: number,
  note?: string,
  scope: EventScope = 'personal',
): void {
  if (amount <= 0) throw new Error(`transferCoin amount must be positive, got ${amount}`);
  const balance = getBalance(db, fromOwnerId);
  if (balance < amount) {
    throw new Error(`Insufficient balance: ${fromOwnerId} has ${balance}, tried to transfer ${amount}`);
  }

  ensureWallet(db, toOwnerId);
  db.run('UPDATE wallets SET balance = balance - ? WHERE owner_id = ?', [amount, fromOwnerId]);
  db.run('UPDATE wallets SET balance = balance + ? WHERE owner_id = ?', [amount, toOwnerId]);

  bus.emit({
    tick,
    scope,
    actorId: fromOwnerId,
    type: 'coin.transferred',
    message: note ?? `${fromOwnerId} paid ${toOwnerId} ${amount} coin.`,
    data: { amount, from: fromOwnerId, to: toOwnerId },
    // Wallets and company ledgers hold the money's history; whatever the
    // payment was for (a wage, a sale, a draw) has its own line where it
    // matters.
    detail: true,
  });
}

// Coin entering or leaving the economy, totalled per day and channel (§8.1
// rule 2; the economy report reads it — reports/economySnapshot.ts).
function recordCoinFlow(
  db: Database,
  tick: number,
  kind: 'faucet' | 'sink',
  channel: string | undefined,
  amount: number,
): void {
  db.run(
    `INSERT INTO coin_flows (day, kind, channel, amount) VALUES (?, ?, ?, ?)
     ON CONFLICT (day, kind, channel) DO UPDATE SET amount = amount + excluded.amount`,
    [Math.floor(tick / MINUTES_PER_DAY), kind, channel ?? 'other', amount],
  );
}
