import type { RpcMessage } from '../../shared/rpc';
import type { ClientPort } from '../../shared/rpcClient';
import type { HostPort } from '../rpcServer';

// A linked pair of in-memory ports with the properties that matter of a real
// MessagePort: delivery is asynchronous and every message is structured-
// cloned (so nothing shares object identity across "processes", and a
// non-cloneable value fails the same way it would over Electron IPC).
export function createMemoryPorts(): {
  host: HostPort;
  client: ClientPort & { close(): void };
  // Bytes of every message, as JSON, in each direction — for IPC payload
  // measurements.
  traffic: { toHost: number[]; toClient: number[] };
} {
  const hostListeners: ((data: unknown) => void)[] = [];
  const clientListeners: ((data: unknown) => void)[] = [];
  const closeListeners: (() => void)[] = [];
  const traffic = { toHost: [] as number[], toClient: [] as number[] };
  let closed = false;
  let started = false;
  const backlog: unknown[] = [];

  const deliver = (listeners: ((data: unknown) => void)[], message: RpcMessage) => {
    const copy = structuredClone(message);
    setImmediate(() => {
      if (closed) return;
      for (const listener of listeners) listener(copy);
    });
  };

  return {
    traffic,
    host: {
      postMessage: (message) => {
        traffic.toClient.push(JSON.stringify(message).length);
        deliver(clientListeners, message);
      },
      onMessage: (listener) => {
        hostListeners.push(listener);
      },
      onClose: (listener) => {
        closeListeners.push(listener);
      },
      start: () => {
        started = true;
        for (const message of backlog.splice(0)) deliver(hostListeners, message as RpcMessage);
      },
    },
    client: {
      postMessage: (message) => {
        traffic.toHost.push(JSON.stringify(message).length);
        if (!started) backlog.push(message);
        else deliver(hostListeners, message);
      },
      onMessage: (listener) => {
        clientListeners.push(listener);
      },
      close: () => {
        if (closed) return;
        closed = true;
        for (const listener of closeListeners) listener();
      },
    },
  };
}
