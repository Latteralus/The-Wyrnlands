import type { Database } from 'sql.js'

// Running totals stored on world_meta (migration 0004). The conservation
// audit's whole job is comparing these against what the live tables
// actually contain — see src/engine/audit/conservationAudit.ts.
export interface ConservationCounters {
  goodsCreated: number
  goodsDestroyed: number
  coinFaucetTotal: number
  coinSinkTotal: number
}

export function getConservationCounters(db: Database): ConservationCounters {
  const result = db.exec(
    'SELECT goods_created, goods_destroyed, coin_faucet_total, coin_sink_total FROM world_meta WHERE id = 1',
  )
  const [row] = result[0].values
  return {
    goodsCreated: Number(row[0]),
    goodsDestroyed: Number(row[1]),
    coinFaucetTotal: Number(row[2]),
    coinSinkTotal: Number(row[3]),
  }
}

export function incrementGoodsCreated(db: Database, amount = 1): void {
  db.run('UPDATE world_meta SET goods_created = goods_created + ? WHERE id = 1', [amount])
}

export function incrementGoodsDestroyed(db: Database, amount = 1): void {
  db.run('UPDATE world_meta SET goods_destroyed = goods_destroyed + ? WHERE id = 1', [amount])
}

export function incrementCoinFaucetTotal(db: Database, amount: number): void {
  db.run('UPDATE world_meta SET coin_faucet_total = coin_faucet_total + ? WHERE id = 1', [amount])
}

export function incrementCoinSinkTotal(db: Database, amount: number): void {
  db.run('UPDATE world_meta SET coin_sink_total = coin_sink_total + ? WHERE id = 1', [amount])
}
