import { isRpcNotification, isRpcResponse, SimulationRequestError, type RpcMessage } from './rpc';
import type { MethodName, SimulationNotification } from './protocol';

// The calling end of a simulation-host connection: numbers requests, matches
// responses, fans out notifications. Runs in the preload (over the
// MessagePort the main process hands it) and in tests (over an in-memory
// port). Pure — no Electron or DOM dependency.
export interface ClientPort {
  postMessage(message: RpcMessage): void;
  onMessage(listener: (data: unknown) => void): void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class RpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(notification: SimulationNotification) => void>();
  private readonly port: ClientPort;

  constructor(port: ClientPort) {
    this.port = port;
    port.onMessage((data) => this.receive(data));
  }

  request(method: MethodName, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.port.postMessage({ kind: 'request', id, method, params: params ?? null });
    });
  }

  onNotification(listener: (notification: SimulationNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // The connection is gone (simulation process exited, port closed): every
  // outstanding request fails rather than hanging.
  failAll(message: string): void {
    for (const { reject } of this.pending.values())
      reject(new SimulationRequestError({ code: 'failed', message }));
    this.pending.clear();
  }

  private receive(data: unknown): void {
    if (isRpcResponse(data)) {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (data.ok) pending.resolve(data.result);
      else pending.reject(new SimulationRequestError(data.error));
    } else if (isRpcNotification(data)) {
      for (const listener of this.listeners) listener(data.notification);
    }
  }
}
