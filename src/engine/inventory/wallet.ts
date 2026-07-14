import { queryRow } from '../db/sqlite';
import { incrementCoinFaucetTotal, incrementCoinSinkTotal } from './counters';
import type { EventBus } from '../eventBus';
import type { Database } from 'sql.js';

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
): void {
  if (amount <= 0) throw new Error(`faucetCoin amount must be positive, got ${amount}`);
  ensureWallet(db, ownerId);
  db.run('UPDATE wallets SET balance = balance + ? WHERE owner_id = ?', [amount, ownerId]);
  incrementCoinFaucetTotal(db, amount);
  bus.emit({
    tick,
    scope: 'personal',
    actorId: ownerId,
    type: 'coin.faucet',
    message: note ?? `${ownerId} received ${amount} coin from outside the economy.`,
    data: { amount },
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
): void {
  if (amount <= 0) throw new Error(`sinkCoin amount must be positive, got ${amount}`);
  const balance = getBalance(db, ownerId);
  if (balance < amount)
    throw new Error(`Insufficient balance: ${ownerId} has ${balance}, tried to sink ${amount}`);

  db.run('UPDATE wallets SET balance = balance - ? WHERE owner_id = ?', [amount, ownerId]);
  incrementCoinSinkTotal(db, amount);
  bus.emit({
    tick,
    scope: 'personal',
    actorId: ownerId,
    type: 'coin.sink',
    message: note ?? `${ownerId} paid ${amount} coin out of the economy.`,
    data: { amount },
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
    scope: 'personal',
    actorId: fromOwnerId,
    type: 'coin.transferred',
    message: note ?? `${fromOwnerId} paid ${toOwnerId} ${amount} coin.`,
    data: { amount, from: fromOwnerId, to: toOwnerId },
  });
}
