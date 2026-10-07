import { useState } from 'react';
import { MarketChart } from '../components/MarketChart';
import { SceneHeader } from '../components/SceneHeader';
import { capitalize, formatDate, formatTimestamp } from '../components/profileFormat';
import type {
  MarketActivity,
  MarketActivityKind,
  MarketGood,
  MarketTradeKind,
  Site,
  UiApi,
} from '../engine/ui-api';

interface MarketScreenProps {
  uiApi: UiApi;
  site: Site;
  playerId: string;
  onBack: () => void;
  onAction: () => void;
  onSelectBusiness: (id: string) => void;
}

const GOOD_ICONS: Record<string, string> = {
  bread: '🍞',
  firewood: '🪵',
  grain: '🌾',
  flour: '🌾',
  axe: '🪓',
  hoe: '⚒',
  shoes: '🥾',
  cloak: '🧥',
  water: '💧',
};
const ACTIVITY_LABELS: Record<MarketActivityKind, string> = {
  purchase: 'Stall purchase',
  listed: 'Listed for sale',
  withdrawn: 'Withdrawn',
  imported: 'Merchant import',
  exported: 'Merchant export',
  direct: 'Direct business trade',
  sold_to_stall: 'Sold to stall',
};

function activityText(entry: MarketActivity): string {
  const goods = `${entry.quantity} ${entry.goodType}`;
  switch (entry.kind) {
    case 'listed':
      return `${entry.sellerName} put ${goods} on the stall.`;
    case 'withdrawn':
      return `${entry.sellerName} withdrew ${goods} unsold.`;
    case 'imported':
      return `A travelling merchant brought ${goods} into the village.`;
    case 'exported':
      return `A travelling merchant bought ${goods} from ${entry.sellerName} for export.`;
    case 'direct':
      return `${entry.buyerName} bought ${goods} directly from ${entry.sellerName}.`;
    case 'sold_to_stall':
      return `${entry.sellerName} sold ${goods} outright to the stall.`;
    case 'purchase':
      return `${entry.buyerName} bought ${goods} from ${entry.sellerName} at the stall.`;
  }
}

function QuantityInput({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <input
      type="number"
      min="1"
      max="1000"
      step="1"
      value={Number.isNaN(value) ? '' : value}
      aria-label={label}
      onChange={(event) => onChange(event.target.valueAsNumber)}
    />
  );
}

function purchaseReason(good: MarketGood, quantity: number, balance: number, freeKg: number): string | null {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000)
    return 'Choose a whole quantity between 1 and 1000.';
  if (good.quantity < quantity)
    return good.quantity === 0 ? 'Out of stock.' : `Only ${good.quantity} available.`;
  if (balance < good.price * quantity) return `You need ${good.price * quantity} coin.`;
  if (quantity * good.weightKg > freeKg)
    return `You need ${(quantity * good.weightKg).toFixed(1)} kg of pack space.`;
  return null;
}

export function MarketScreen({
  uiApi,
  site,
  playerId,
  onBack,
  onAction,
  onSelectBusiness,
}: MarketScreenProps) {
  const [tab, setTab] = useState<'goods' | 'activity' | 'listings'>('goods');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState('name');
  const [selectedGood, setSelectedGood] = useState('bread');
  const [buyQuantity, setBuyQuantity] = useState(1);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [windowDays, setWindowDays] = useState(28);
  const [activityGood, setActivityGood] = useState('all');
  const [activityKind, setActivityKind] = useState<MarketActivityKind | 'all'>('all');
  const [activityCursors, setActivityCursors] = useState<number[]>([]);
  const [notice, setNotice] = useState('');
  const overview = uiApi.getMarketOverview(site.id, playerId);
  const balance = uiApi.getBalance(playerId);
  const freeKg = overview.capacityKg - overview.carriedWeightKg;
  const selected = overview.goods.find((good) => good.goodType === selectedGood) ?? overview.goods[0];
  const history = selected ? uiApi.getMarketHistory(site.id, selected.goodType, windowDays) : [];
  const activity =
    tab === 'activity'
      ? uiApi.queryMarketActivity(site.id, {
          ...(activityGood === 'all' ? {} : { goodType: activityGood }),
          ...(activityKind === 'all' ? {} : { kind: activityKind }),
          ...(activityCursors.length ? { beforeId: activityCursors[activityCursors.length - 1] } : {}),
          limit: 40,
        })
      : [];
  const visibleGoods = overview.goods
    .filter(
      (good) =>
        (category === 'all' || good.category === category) &&
        good.goodType.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'price'
        ? a.price - b.price
        : sort === 'stock'
          ? b.quantity - a.quantity
          : a.goodType.localeCompare(b.goodType),
    );
  const quantity = (key: string) => quantities[key] ?? 1;
  const updateQuantity = (key: string, value: number) =>
    setQuantities((previous) => ({ ...previous, [key]: value }));
  const invalidQuantity = (value: number, max: number) =>
    !Number.isSafeInteger(value) || value < 1 || value > Math.min(1000, max);
  const trade = (kind: MarketTradeKind, goodType: string, units: number) => {
    try {
      uiApi.queueMarketTrade(playerId, { siteId: site.id, kind, goodType, quantity: units });
      setNotice(`Queued: ${kind === 'list' ? 'list for sale' : kind} ${units} ${goodType}.`);
      onAction();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'This trade could not be queued.');
    }
  };
  const reason = selected ? purchaseReason(selected, buyQuantity, balance, freeKg) : null;

  return (
    <section className="market-screen">
      <SceneHeader icon="🧺" title={site.name} calendar={uiApi.getCalendar()} />
      <button type="button" className="back-button" onClick={onBack}>
        ← Back to settlement
      </button>
      <div className="market-intro">
        <div>
          <h2>The village market</h2>
          <p>What the village makes, needs, and trades.</p>
        </div>
        <div className="market-wallet">
          <strong>{balance} coin</strong>
          <span>
            Pack {overview.carriedWeightKg.toFixed(1)} / {overview.capacityKg} kg
          </span>
        </div>
      </div>
      <div className="tabs market-tabs" aria-label="Market sections">
        {(
          [
            { key: 'goods', label: 'Goods' },
            { key: 'activity', label: 'Activity' },
            { key: 'listings', label: 'My Listings' },
          ] as const
        ).map((entry) => (
          <button
            type="button"
            key={entry.key}
            className={tab === entry.key ? 'active' : ''}
            aria-pressed={tab === entry.key}
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
            {entry.key === 'listings' && overview.myListings.length > 0
              ? ` (${overview.myListings.reduce((sum, listing) => sum + listing.quantity, 0)})`
              : ''}
          </button>
        ))}
      </div>
      <p className="market-notice" role="status">
        {notice ||
          'Market errands take five minutes once they start. Prices and availability are checked when you trade.'}
      </p>

      {tab === 'goods' && (
        <>
          <div className="market-toolbar">
            <label>
              Find goods
              <input
                type="search"
                placeholder="Bread, tools, firewood…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label>
              Category
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="all">All goods</option>
                {['food', 'drink', 'material', 'gear', 'tool'].map((value) => (
                  <option key={value} value={value}>
                    {capitalize(value)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sort by
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="name">Name</option>
                <option value="price">Lowest price</option>
                <option value="stock">Most stock</option>
              </select>
            </label>
          </div>
          <div className="market-table-scroll">
            <table className="market-table market-goods-table">
              <caption className="sr-only">Available market goods</caption>
              <thead>
                <tr>
                  <th>Good</th>
                  <th>Price / unit</th>
                  <th>Since last record</th>
                  <th>Available</th>
                  <th>In your pack</th>
                </tr>
              </thead>
              <tbody>
                {visibleGoods.map((good) => (
                  <tr
                    key={good.goodType}
                    className={selected?.goodType === good.goodType ? 'market-selected-row' : ''}
                  >
                    <th scope="row">
                      <button
                        type="button"
                        className="market-good-button"
                        aria-pressed={selected?.goodType === good.goodType}
                        onClick={() => {
                          setSelectedGood(good.goodType);
                          setBuyQuantity(1);
                        }}
                      >
                        <span aria-hidden="true">{GOOD_ICONS[good.goodType] ?? '📦'}</span>
                        {capitalize(good.goodType)}
                        <small>{good.category}</small>
                      </button>
                    </th>
                    <td>
                      <strong>{good.price}</strong> coin
                    </td>
                    <td
                      className={
                        good.priceChange && good.priceChange > 0 ? 'market-price-up' : 'profile-muted'
                      }
                    >
                      {good.priceChange === null
                        ? '—'
                        : good.priceChange === 0
                          ? 'Steady'
                          : `${good.priceChange > 0 ? '↑ +' : '↓ '}${good.priceChange} coin`}
                    </td>
                    <td>
                      {good.quantity === 0 ? (
                        <span className="market-out-of-stock">Out of stock</span>
                      ) : (
                        good.quantity
                      )}
                    </td>
                    <td>{overview.pack.find((line) => line.goodType === good.goodType)?.quantity ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visibleGoods.length === 0 && <p className="profile-empty">No goods match these filters.</p>}
          {selected && (
            <div className="market-detail-grid">
              <div className="market-panel">
                <MarketChart
                  key={selected.goodType}
                  uiApi={uiApi}
                  goodType={selected.goodType}
                  points={history}
                  windowDays={windowDays}
                  onWindowChange={setWindowDays}
                />
              </div>
              <div className="market-panel market-trade-panel">
                <h3>
                  {GOOD_ICONS[selected.goodType]} {capitalize(selected.goodType)}
                </h3>
                <p className="market-unit-price">
                  {selected.price} <span>coin per unit</span>
                </p>
                <p className="profile-muted">
                  {selected.quantity} available · {selected.weightKg} kg each
                </p>
                <div className="market-trade-controls">
                  <label>
                    Quantity
                    <QuantityInput
                      value={buyQuantity}
                      onChange={setBuyQuantity}
                      label={`Quantity of ${selected.goodType} to buy`}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={reason !== null}
                    onClick={() => trade('buy', selected.goodType, buyQuantity)}
                  >
                    Buy {Number.isSafeInteger(buyQuantity) && buyQuantity > 0 ? buyQuantity : ''} ·{' '}
                    {Number.isSafeInteger(buyQuantity) && buyQuantity > 0
                      ? selected.price * buyQuantity
                      : '—'}{' '}
                    coin
                  </button>
                </div>
                {reason && <p className="market-trade-reason">{reason}</p>}
                <h4>On the stall</h4>
                {selected.sellers.length === 0 ? (
                  <p className="profile-empty">Nobody has stock here right now.</p>
                ) : (
                  <ul className="market-sellers">
                    {selected.sellers.map((seller) => (
                      <li key={seller.sellerId ?? 'merchant'}>
                        {seller.isCompany && seller.sellerId ? (
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => onSelectBusiness(seller.sellerId ?? '')}
                          >
                            {seller.sellerName}
                          </button>
                        ) : (
                          <span>{seller.sellerName}</span>
                        )}
                        <strong>{seller.quantity}</strong>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="market-fine-print">
                  All sellers use the current market price. Older stock sells first. Your own unsold goods can
                  be withdrawn in My Listings.
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'activity' && (
        <div className="market-panel">
          <div className="market-panel-heading">
            <h3>Trade in the village</h3>
            <span className="profile-muted">Most recent first</span>
          </div>
          <div className="market-toolbar">
            <label>
              Good
              <select
                value={activityGood}
                onChange={(event) => {
                  setActivityGood(event.target.value);
                  setActivityCursors([]);
                }}
              >
                <option value="all">All goods</option>
                {overview.goods.map((good) => (
                  <option key={good.goodType} value={good.goodType}>
                    {capitalize(good.goodType)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Activity
              <select
                value={activityKind}
                onChange={(event) => {
                  setActivityKind(event.target.value as MarketActivityKind | 'all');
                  setActivityCursors([]);
                }}
              >
                <option value="all">All activity</option>
                {Object.entries(ACTIVITY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {activity.length === 0 ? (
            <p className="profile-empty">No matching trade recorded yet.</p>
          ) : (
            <ol className="market-activity-list">
              {activity.map((entry) => (
                <li key={entry.id}>
                  <div className="market-activity-meta">
                    <span className={`market-activity-tag market-activity-tag--${entry.kind}`}>
                      {ACTIVITY_LABELS[entry.kind]}
                    </span>
                    <time>{formatTimestamp(uiApi, entry.tick)}</time>
                  </div>
                  <p>{activityText(entry)}</p>
                  <span className="profile-muted">
                    {entry.kind === 'withdrawn'
                      ? 'Returned to pack'
                      : `${entry.unitPrice} coin each · ${entry.unitPrice * entry.quantity} coin ${entry.kind === 'listed' || entry.kind === 'imported' ? 'at the recorded asking price' : 'in total'}`}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <div className="market-toolbar">
            {activityCursors.length > 0 && (
              <button type="button" onClick={() => setActivityCursors((previous) => previous.slice(0, -1))}>
                Newer activity
              </button>
            )}
            {activity.length === 40 && (
              <button
                type="button"
                onClick={() => {
                  const last = activity.at(-1);
                  if (last) setActivityCursors((previous) => [...previous, last.id]);
                }}
              >
                Older activity
              </button>
            )}
            {activityCursors.length > 0 && (
              <button type="button" onClick={() => setActivityCursors([])}>
                Latest activity
              </button>
            )}
          </div>
          <p className="market-fine-print">
            Trade activity is recorded from this update onward. Older daily price history remains available
            under Goods.
          </p>
        </div>
      )}

      {tab === 'listings' && (
        <>
          <div className="market-panel">
            <h3>Your goods for sale</h3>
            <p>
              Goods leave your pack when listed. You receive coin when a buyer purchases them, at the market
              price at that time.
            </p>
            {overview.myListings.length === 0 ? (
              <p className="profile-empty">You have no unsold listings. List goods from your pack below.</p>
            ) : (
              <div className="market-table-scroll">
                <table className="market-table">
                  <caption className="sr-only">Your unsold listings</caption>
                  <thead>
                    <tr>
                      <th>Good</th>
                      <th>Unsold</th>
                      <th>Current price</th>
                      <th>First listed</th>
                      <th>Withdraw</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.myListings.map((listing) => {
                      const key = `withdraw-${listing.goodType}`;
                      const units = quantity(key);
                      const good = overview.goods.find((entry) => entry.goodType === listing.goodType);
                      const noRoom = good ? units * good.weightKg > freeKg : true;
                      return (
                        <tr key={listing.goodType}>
                          <th scope="row">{capitalize(listing.goodType)}</th>
                          <td>{listing.quantity}</td>
                          <td>{listing.price} coin</td>
                          <td>{formatDate(uiApi, listing.firstListedTick)}</td>
                          <td>
                            <div className="market-inline-trade">
                              <QuantityInput
                                value={units}
                                onChange={(value) => updateQuantity(key, value)}
                                label={`Quantity of ${listing.goodType} to withdraw`}
                              />
                              <button
                                type="button"
                                disabled={invalidQuantity(units, listing.quantity) || noRoom}
                                onClick={() => trade('withdraw', listing.goodType, units)}
                              >
                                Withdraw
                              </button>
                            </div>
                            {noRoom && <small>Not enough pack space.</small>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="market-fine-print">
              Food can spoil while listed. Travelling merchants may buy old surplus for export at a discount.
            </p>
          </div>
          <div className="market-panel market-pack">
            <div className="market-panel-heading">
              <h3>In your pack</h3>
              <span>
                {overview.carriedWeightKg.toFixed(1)} / {overview.capacityKg} kg
              </span>
            </div>
            {overview.pack.length === 0 ? (
              <p className="profile-empty">Your pack is empty.</p>
            ) : (
              <div className="market-table-scroll">
                <table className="market-table">
                  <caption className="sr-only">Pack inventory and listing controls</caption>
                  <thead>
                    <tr>
                      <th>Good</th>
                      <th>Carried</th>
                      <th>Condition</th>
                      <th>List for sale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.pack.map((line) => {
                      const key = `list-${line.goodType}`;
                      const units = quantity(key);
                      return (
                        <tr key={line.goodType}>
                          <th scope="row">
                            {GOOD_ICONS[line.goodType]} {capitalize(line.goodType)}
                          </th>
                          <td>{line.quantity}</td>
                          <td>
                            {line.avgCondition === null
                              ? '—'
                              : `${Math.round(line.avgCondition * 100)}% average`}
                          </td>
                          <td>
                            <div className="market-inline-trade">
                              <QuantityInput
                                value={units}
                                onChange={(value) => updateQuantity(key, value)}
                                label={`Quantity of ${line.goodType} to list`}
                              />
                              <button
                                type="button"
                                disabled={!line.marketable || invalidQuantity(units, line.listableQuantity)}
                                onClick={() => trade('list', line.goodType, units)}
                              >
                                List for sale
                              </button>
                            </div>
                            {!line.marketable ? (
                              <small>Free supplies are not sold at the market.</small>
                            ) : (
                              line.listableQuantity < line.quantity && (
                                <small>Worn equipment stays with you.</small>
                              )
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
      <div className="market-toolbar" aria-label="Everyday needs">
        {[
          { type: 'stock_up_bread', label: 'Stock up on bread' },
          { type: 'eat', label: 'Eat from your pack' },
          { type: 'drink', label: 'Drink from your pack' },
          { type: 'rest_rough', label: 'Rest here' },
        ].map((action) => (
          <button
            type="button"
            key={action.type}
            onClick={() => {
              uiApi.queueAction(playerId, action.type);
              setNotice(`Queued: ${action.label.toLowerCase()}.`);
              onAction();
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}
