import { describe, expect, it } from 'vitest'
import { createDatabase } from '../db/sqlite'
import { loadSqlJs } from '../db/sqlite.node'
import { Engine } from '../engine'

describe('wallet / coin conservation', () => {
  it('faucet, sink, and transfer move balances correctly', async () => {
    const SQL = await loadSqlJs()
    const db = createDatabase(SQL)
    const engine = Engine.bootstrap(db, { seed: 'wallet-basic' })
    engine.createEntity('villager-1', 'Test Villager')
    engine.createEntity('villager-2', 'Test Villager 2')

    engine.faucetCoin('villager-1', 100, 'starting coin')
    expect(engine.getBalance('villager-1')).toBe(100)

    engine.transferCoin('villager-1', 'villager-2', 30, 'wages')
    expect(engine.getBalance('villager-1')).toBe(70)
    expect(engine.getBalance('villager-2')).toBe(30)

    engine.sinkCoin('villager-2', 10, 'tax')
    expect(engine.getBalance('villager-2')).toBe(20)

    engine.dispose()
  })

  it('rejects sinking or transferring more coin than the balance holds', async () => {
    const SQL = await loadSqlJs()
    const db = createDatabase(SQL)
    const engine = Engine.bootstrap(db, { seed: 'wallet-guards' })
    engine.createEntity('villager-1', 'Test Villager')
    engine.faucetCoin('villager-1', 10)

    expect(() => engine.sinkCoin('villager-1', 20)).toThrow(/Insufficient balance/)
    expect(() => engine.transferCoin('villager-1', 'villager-2', 20)).toThrow(/Insufficient balance/)
    expect(() => engine.faucetCoin('villager-1', -5)).toThrow(/must be positive/)

    engine.dispose()
  })

  it('reads zero for a wallet that has never received coin', async () => {
    const SQL = await loadSqlJs()
    const db = createDatabase(SQL)
    const engine = Engine.bootstrap(db, { seed: 'wallet-empty' })

    expect(engine.getBalance('nobody')).toBe(0)

    engine.dispose()
  })
})
