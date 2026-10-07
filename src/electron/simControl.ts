import type { SaveMetadata, StorageBackend } from '../shared/protocol';

// Messages between the main process and the simulation (utility) process.
// Separate from the renderer protocol: these carry file-system paths chosen
// in native dialogs and lifecycle orders, which the renderer can never send.

export interface SimInit {
  type: 'init';
  savesDir: string;
  logFile: string;
  backend: StorageBackend;
}

// A renderer connection: the message carries one end of a MessageChannel.
export interface SimConnect {
  type: 'connect';
}

export type ControlRequest =
  | { type: 'control'; id: number; op: 'suggestedExportName' }
  | { type: 'control'; id: number; op: 'exportTo'; file: string }
  | { type: 'control'; id: number; op: 'importFrom'; file: string }
  | { type: 'control'; id: number; op: 'shutdown' };

export type ControlOp = ControlRequest['op'];

export interface ControlResults {
  suggestedExportName: string;
  exportTo: null;
  importFrom: SaveMetadata;
  shutdown: null;
}

export type ControlResponse =
  | { type: 'control-result'; id: number; ok: true; result: unknown }
  | { type: 'control-result'; id: number; ok: false; message: string };

export type ToSimulation = SimInit | SimConnect | ControlRequest;
export type FromSimulation =
  { type: 'ready'; backend: StorageBackend } | { type: 'fatal'; message: string } | ControlResponse;
