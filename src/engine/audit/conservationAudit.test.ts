import { describe, expect, it } from 'vitest'
import { createDatabase } from '../db/sqlite'
import { loadSqlJs } from '../db/sqlite.node'
import { Engine } from '../engine'

describe('conservation audit', () => {
  it('passes after a mix of production, transfer, consumption, faucet, sink, and coin transfer', async () => {
    const SQL = await loadSqlJs()
    const db = createDatabase(SQL)
    const engine = Engine.bootstrap(db, { seed: 'audit-happy-path' })
    engine.createEntity('miller-edda', 'Edda')
    engine.createEntity('villager-1', 'Test Villager')

    engine.produceItem({ id: 'flour-1', type: 'flour', containerId: 'mill-storage', actorId: 'miller-edda' })
    engine.produceItem({ id: 'flour-2', type: 'flour', containerId: 'mill-storage', actorId: 'miller-edda' })
    engine.transferItem('flour-1', 'bakery-storage')
    engine.destroyItem('flour-2', 'spoiled')

    engine.faucetCoin('villager-1', 50, 'starting stake')
    engine.transferCoin('villager-1', 'miller-edda', 20, 'bought flour')
    engine.sinkCoin('miller-edda', 5, 'tax')

    const result = engine.runConservationAudit()
    expect(result.passed).toBe(true)
    expect(result.goods).toEqual({ expected: 1, actual: 1 }) // flour-1 active, flour-2 destroyed
    expect(result.coin).toEqual({ expected: 45, actual: 45 }) // 50 faucet - 5 sink; the 20-coin transfer just redistributes

    engine.dispose()
  })

  it('accounts for sinks in the expected coin total', async () => {
    const SQL = await loadSqlJs()
    const db = createDatabase(SQL)
    const engine = Engine.bootstrap(db, { seed: 'audit-sink-math' })
    engine.createEntity('villager-1', 'Test Villager')

    engine.faucetCoin('villager-1', 100)
    engine.sinkCoin('villager-1', 40)

    const result = engine.runConservationAudit()
    expect(result.passed).toBe(true)
    expect(result.coin).toEqual({ expected: 60, actual: 60 })

    engine.dispose()
  })

  it('runs automatically at the end of every in-game day and stays clean under normal play', async () => {
    const SQL = await loadSqlJs()
    const db = createDatabase(SQL)
    const engine = Engine.bootstrap(db, { seed: 'audit-nightly-cadence' })
    engine.createEntity('villager-1', 'Test Villager')
    engine.faucetCoin('villager-1', 10)

    engine.advanceTicks(24 * 60 * 3) // three full in-game days

    const worldLog = engine.queryLog('world', 20)
    expect(worldLog.some((e) => e.type === 'audit.failed')).toBe(false)

    engine.dispose()
  })

  it('catches drift when an item vanishes without going through destroyItem', async () => {
    const SQL = await loadSqlJs()
    const db = createDatabase(SQL)
    const engine = Engine.bootstrap(db, { seed: 'audit-catches-item-drift' })

    engine.produceItem({ id: 'cloak-1', type: 'cloak', containerId: 'wardrobe' })
    expect(engine.runConservationAudit().passed).toBe(true)

    // Bypasses destroyItem() entirely — simulates a bug that deletes state
    // directly instead of going through the sanctioned function.
    db.run('DELETE FROM items WHERE id = ?', ['cloak-1'])

    const result = engine.runConservationAudit()
    expect(result.passed).toBe(false)
    expect(result.goods).toEqual({ expected: 1, actual: 0 })

    const worldLog = engine.queryLog('world', 5)
    expect(worldLog.some((e) => e.type === 'audit.failed')).toBe(true)

    engine.dispose()
  })

  it('catches drift when a wallet balance is mutated outside faucet/sink/transfer', async () => {
    const SQL = await loadSqlJs()
    const db = createDatabase(SQL)
    const engine = Engine.bootstrap(db, { seed: 'audit-catches-coin-drift' })
    engine.createEntity('villager-1', 'Test Villager')
    engine.faucetCoin('villager-1', 10)

    expect(engine.runConservationAudit().passed).toBe(true)

    // Bypasses faucetCoin/sinkCoin/transferCoin — coin appears from nowhere.
    db.run('UPDATE wallets SET balance = balance + 500 WHERE owner_id = ?', ['villager-1'])

    const result = engine.runConservationAudit()
    expect(result.passed).toBe(false)
    expect(result.coin).toEqual({ expected: 10, actual: 510 })

    engine.dispose()
  })
})
