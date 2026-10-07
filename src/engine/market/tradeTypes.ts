import { getGoodDefinition } from '../goods/catalog';

// A queued market trade's parameters live in its action type string (see
// marketTradeType), so this encoding is shared by the engine (which queues
// and resolves trades) and the interface (which labels them). Pure — no
// database access — so the renderer can import it through src/shared.

export type MarketTradeKind = 'buy' | 'list' | 'withdraw';
export interface MarketTradeRequest {
  kind: MarketTradeKind;
  siteId: string;
  goodType: string;
  quantity: number;
}

// Parameters are persisted in the action type, so queued/in-progress trades
// survive an engine export/reload without a transient closure or new queue schema.
export function marketTradeType(request: MarketTradeRequest): string {
  if (!Number.isSafeInteger(request.quantity) || request.quantity < 1 || request.quantity > 1000) {
    throw new Error('Choose a whole quantity between 1 and 1000.');
  }
  const good = getGoodDefinition(request.goodType);
  if (request.kind !== 'withdraw' && good.basePrice <= 0)
    throw new Error('This good is not sold at the market.');
  return `market:${request.kind}:${encodeURIComponent(request.siteId)}:${encodeURIComponent(request.goodType)}:${request.quantity}`;
}

export function parseMarketTrade(type: string): MarketTradeRequest | null {
  if (!type.startsWith('market:')) return null;
  const parts = type.split(':');
  if (parts.length !== 5 || !['buy', 'list', 'withdraw'].includes(parts[1] ?? ''))
    throw new Error('Invalid market action.');
  const request: MarketTradeRequest = {
    kind: parts[1] as MarketTradeKind,
    siteId: decodeURIComponent(parts[2] ?? ''),
    goodType: decodeURIComponent(parts[3] ?? ''),
    quantity: Number(parts[4]),
  };
  marketTradeType(request);
  return request;
}

export function actionLabel(type: string): string {
  const trade = parseMarketTrade(type);
  return trade
    ? `${trade.kind === 'list' ? 'List for sale' : trade.kind === 'buy' ? 'Buy' : 'Withdraw'} ${trade.quantity} ${trade.goodType}`
    : type.replaceAll('_', ' ');
}
