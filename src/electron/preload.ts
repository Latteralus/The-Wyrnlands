import { contextBridge, ipcRenderer } from 'electron';
import { isMethodName, type WyrnlandsBridge } from '../shared/protocol';
import { RpcClient } from '../shared/rpcClient';
import type { RpcMessage } from '../shared/rpc';

// The renderer's only window into the desktop host (MigrationPlan.md
// Phase 2). Runs sandboxed with context isolation; React sees just the
// object exposed below as window.wyrnlands — a request function limited to
// the protocol's method names, a notification subscription, and the two
// dialog-backed save operations. No ipcRenderer, no MessagePort, no Node,
// no file system.
//
// The MessagePort to the simulation process stays in here: requests go
// straight to the simulation (the main process isn't on the hot path), and
// anything sent before the port arrives waits in a short queue.

let port: MessagePort | null = null;
const queued: RpcMessage[] = [];
const receivers: ((data: unknown) => void)[] = [];

const client = new RpcClient({
  postMessage: (message) => {
    if (port) port.postMessage(message);
    else queued.push(message);
  },
  onMessage: (listener) => {
    receivers.push(listener);
  },
});

ipcRenderer.on('wyrnlands:simulation-port', (event) => {
  const [received] = event.ports;
  if (!received) return;
  port = received;
  received.onmessage = (message) => {
    for (const receiver of receivers) receiver(message.data);
  };
  for (const message of queued.splice(0)) received.postMessage(message);
});
ipcRenderer.send('wyrnlands:connect');

const bridge: WyrnlandsBridge = {
  host: 'electron',
  versions: { electron: process.versions.electron ?? '', chrome: process.versions.chrome ?? '' },
  request: (method, params) =>
    isMethodName(method) ? client.request(method, params) : Promise.reject(new Error('Unknown request.')),
  onNotification: (listener) => client.onNotification(listener),
  exportSave: () => ipcRenderer.invoke('wyrnlands:export-save'),
  importSave: () => ipcRenderer.invoke('wyrnlands:import-save'),
};

contextBridge.exposeInMainWorld('wyrnlands', bridge);
