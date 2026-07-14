import { useEffect, useRef, useState } from 'react'
import { createDatabase } from './engine/db/sqlite'
import { loadSqlJs } from './engine/db/sqlite.browser'
import { Engine } from './engine/engine'
import { createUiApi, type UiApi } from './engine/ui-api'
import type { EngineEvent } from './engine/eventBus'
import './App.css'

function App() {
  const engineRef = useRef<Engine | null>(null)
  const [uiApi, setUiApi] = useState<UiApi | null>(null)
  const [tick, setTick] = useState(0)
  const [worldLog, setWorldLog] = useState<EngineEvent[]>([])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const SQL = await loadSqlJs()
      const db = createDatabase(SQL)
      const engine = Engine.bootstrap(db, { seed: 'wyrnlands-dev' })
      if (cancelled) {
        engine.dispose()
        return
      }
      engineRef.current = engine
      const api = createUiApi(engine)
      setUiApi(api)
      setTick(api.getTick())
      setWorldLog(api.queryLog('world', 5))
    })()

    return () => {
      cancelled = true
      engineRef.current?.dispose()
      engineRef.current = null
    }
  }, [])

  const advance = (count: number) => {
    if (!uiApi) return
    uiApi.advanceTicks(count)
    setTick(uiApi.getTick())
    setWorldLog(uiApi.queryLog('world', 5))
  }

  if (!uiApi) {
    return (
      <main className="boot-screen">
        <p>Booting the simulation…</p>
      </main>
    )
  }

  const calendar = uiApi.getCalendar()

  return (
    <main className="boot-screen">
      <h1>The Wyrnlands</h1>
      <p className="subtitle">Stage 0 scaffold — the interface reads engine state through ui-api only.</p>

      <dl className="vitals">
        <dt>Tick</dt>
        <dd>{tick}</dd>
        <dt>Calendar</dt>
        <dd>
          Year {calendar.year}, {calendar.season}, day {calendar.day}
        </dd>
      </dl>

      <div className="time-controls">
        <button type="button" onClick={() => advance(60)}>
          Advance 1 hour
        </button>
        <button type="button" onClick={() => advance(60 * 24)}>
          Advance 1 day
        </button>
      </div>

      <h2>World log</h2>
      <ul className="world-log">
        {worldLog.map((event, i) => (
          <li key={i}>
            [{event.tick}] {event.message}
          </li>
        ))}
      </ul>
    </main>
  )
}

export default App
