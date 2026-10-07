import type { SimulationNotification } from './protocol';

// The wire format on a MessagePort between the renderer (via the preload)
// and the simulation host. Request ids are per connection.
export interface RpcRequest {
  kind: 'request';
  id: number;
  method: string;
  params: unknown;
}

export interface RpcError {
  message: string;
  // 'invalid' — refused before running (unknown method, bad parameters);
  // 'failed' — ran and failed (the message is meant for the player).
  code: 'invalid' | 'failed';
}

export type RpcResponse =
  | { kind: 'response'; id: number; ok: true; result: unknown }
  | { kind: 'response'; id: number; ok: false; error: RpcError };

export interface RpcNotification {
  kind: 'notification';
  notification: SimulationNotification;
}

export type RpcMessage = RpcRequest | RpcResponse | RpcNotification;

export function isRpcRequest(value: unknown): value is RpcRequest {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<RpcRequest>;
  return message.kind === 'request' && Number.isSafeInteger(message.id) && typeof message.method === 'string';
}

export function isRpcResponse(value: unknown): value is RpcResponse {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<RpcResponse>;
  return message.kind === 'response' && Number.isSafeInteger(message.id) && typeof message.ok === 'boolean';
}

export function isRpcNotification(value: unknown): value is RpcNotification {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<RpcNotification>;
  return message.kind === 'notification' && typeof message.notification === 'object';
}

// A request the renderer sent that failed — carries the host's message so
// screens can show it ("You need 40 more coin…").
export class SimulationRequestError extends Error {
  readonly code: RpcError['code'];
  constructor(error: RpcError) {
    super(error.message);
    this.name = 'SimulationRequestError';
    this.code = error.code;
  }
}
