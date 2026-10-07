import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { serveConnection, type HostPort } from '../sim-host/rpcServer';
import { SaveLibrary } from '../sim-host/saveLibrary';
import { SimulationHost } from '../sim-host/simulationHost';
import { NativeStorage, SqlJsStorage, type GameStorage } from '../sim-host/storage';
import type { ControlRequest, FromSimulation, SimInit, ToSimulation } from './simControl';
import type { MessagePortMain } from 'electron';

// Entry point of the simulation process — an Electron utility process
// (MigrationPlan.md Phase 5): a Node.js child with no window, no renderer
// access and no Electron UI APIs. It owns the Engine, the SQLite database,
// the game clock and the RNG, and serves the renderer over a MessagePort
// the main process brokers. This file is only wiring; the host itself
// (src/sim-host) is plain Node and runs the same in tests.

const parentPort = process.parentPort;
let host: SimulationHost | null = null;
let logFile: string | null = null;

function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stdout.write(`[simulation] ${line}`);
  if (!logFile) return;
  try {
    // Keep one previous log; never let logs grow without bound.
    if ((statSync(logFile, { throwIfNoEntry: false })?.size ?? 0) > 5 * 1024 * 1024)
      renameSync(logFile, `${logFile}.1`);
    appendFileSync(logFile, line);
  } catch {
    // Logging must never take the simulation down.
  }
}

function send(message: FromSimulation): void {
  parentPort.postMessage(message);
}

async function createStorage(init: SimInit): Promise<GameStorage> {
  // Native, file-backed SQLite (node:sqlite, built into Electron's Node).
  if (init.backend === 'native') return new NativeStorage();
  // sql.js finds its .wasm beside its own script — inside app.asar when
  // packaged, which Electron's fs reads transparently.
  const wasmDir = path.dirname(require.resolve('sql.js'));
  return new SqlJsStorage(await initSqlJs({ locateFile: (file) => path.join(wasmDir, file) }));
}

function adaptPort(port: MessagePortMain): HostPort {
  return {
    postMessage: (message) => port.postMessage(message),
    onMessage: (listener) => port.on('message', (event) => listener(event.data)),
    onClose: (listener) => port.on('close', listener),
    start: () => port.start(),
  };
}

function control(request: ControlRequest): unknown {
  if (!host) throw new Error('The simulation is still starting.');
  switch (request.op) {
    case 'suggestedExportName':
      return host.suggestedExportName();
    case 'exportTo':
      host.exportTo(request.file);
      return null;
    case 'importFrom':
      return host.importFrom(request.file);
    case 'shutdown':
      host.shutdown();
      log('Shut down cleanly.');
      return null;
  }
}

parentPort.on('message', (event: { data: ToSimulation; ports: MessagePortMain[] }) => {
  const message = event.data;
  switch (message.type) {
    case 'init':
      logFile = message.logFile;
      mkdirSync(path.dirname(message.logFile), { recursive: true });
      createStorage(message)
        .then((storage) => {
          host = new SimulationHost({ library: new SaveLibrary(message.savesDir), storage, log });
          log(`Started: ${storage.backend} storage, saves in ${message.savesDir}`);
          send({ type: 'ready', backend: storage.backend });
        })
        .catch((error: unknown) => {
          log(`Failed to start: ${String(error)}`);
          send({ type: 'fatal', message: error instanceof Error ? error.message : String(error) });
        });
      break;
    case 'connect': {
      const port = event.ports[0];
      if (!host || !port) {
        port?.close();
        break;
      }
      serveConnection(host, adaptPort(port), log);
      break;
    }
    case 'control':
      try {
        send({ type: 'control-result', id: message.id, ok: true, result: control(message) });
      } catch (error) {
        send({
          type: 'control-result',
          id: message.id,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      break;
  }
});

// An error nothing caught may have left the in-memory world inconsistent:
// stop rather than carry on. The main process restarts the simulation, and
// the player continues from the last save (for a file-backed save, the last
// committed batch of ticks).
process.on('uncaughtException', (error) => {
  log(`Uncaught: ${error.stack ?? String(error)}`);
  process.exit(1);
});
