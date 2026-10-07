import { isRpcRequest, type RpcMessage, type RpcResponse } from '../shared/rpc';
import { InvalidRequestError } from './validate';
import type { SimulationHost } from './simulationHost';

// The minimal message-port shape the host needs: Electron's MessagePortMain
// in the utility process (electron/simProcess.ts), an in-memory pair in
// tests (testing/memoryPorts.ts).
export interface HostPort {
  postMessage(message: RpcMessage): void;
  onMessage(listener: (data: unknown) => void): void;
  onClose(listener: () => void): void;
  start(): void;
}

// Serves one renderer connection: requests in, responses and notifications
// out. Returns a function that disconnects it.
export function serveConnection(
  host: SimulationHost,
  port: HostPort,
  log?: (message: string) => void,
): () => void {
  let open = true;
  host.clientConnected();
  const unsubscribe = host.onNotification((notification) => {
    if (open) port.postMessage({ kind: 'notification', notification });
  });
  const disconnect = () => {
    if (!open) return;
    open = false;
    unsubscribe();
    host.clientDisconnected();
  };

  port.onMessage((data) => {
    if (!open || !isRpcRequest(data)) return;
    let response: RpcResponse;
    try {
      const result = host.request(data.method, data.params);
      response = { kind: 'response', id: data.id, ok: true, result: result ?? null };
    } catch (error) {
      const invalid = error instanceof InvalidRequestError;
      if (!invalid)
        log?.(
          `Request ${data.method} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        );
      response = {
        kind: 'response',
        id: data.id,
        ok: false,
        error: {
          code: invalid ? 'invalid' : 'failed',
          message: error instanceof Error ? error.message : 'The request failed.',
        },
      };
    }
    port.postMessage(response);
  });
  port.onClose(disconnect);
  port.start();
  return disconnect;
}
