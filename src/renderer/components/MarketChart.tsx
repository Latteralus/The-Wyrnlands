import { useState } from 'react';
import { MINUTES_PER_DAY } from '../../shared/gameRules';
import { useCalendarAt } from '../sim/hooks';
import { formatDate } from './profileFormat';
import type { MarketHistoryPoint } from '../../shared/protocol';

type Metric = 'price' | 'quantity' | 'sold' | 'imported' | 'exported';
const METRICS: { key: Metric; label: string }[] = [
  { key: 'price', label: 'Price' },
  { key: 'quantity', label: 'Stock' },
  { key: 'sold', label: 'Traded' },
  { key: 'imported', label: 'Imports' },
  { key: 'exported', label: 'Exports' },
];

interface MarketChartProps {
  currentTick: number;
  goodType: string;
  points: MarketHistoryPoint[];
  windowDays: number;
  onWindowChange: (days: number) => void;
}

export function MarketChart({ currentTick, goodType, points, windowDays, onWindowChange }: MarketChartProps) {
  const calendarAt = useCalendarAt();
  const [metric, setMetric] = useState<Metric>('price');
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const valid = points.filter((point) => point[metric] !== null);
  const values = valid.map((point) => point[metric] ?? 0);
  const low = metric === 'price' ? Math.max(0, Math.min(...values, 0)) : 0;
  const high = Math.max(1, ...values) * 1.15;
  const end = Math.floor(currentTick / MINUTES_PER_DAY);
  const start = Math.max(0, end - windowDays + 1);
  const x = (day: number) => 48 + ((day - start) / Math.max(1, end - start)) * 512;
  const y = (value: number) => 158 - ((value - low) / (high - low)) * 136;
  const paths: string[] = [];
  let previousDay: number | null = null;
  for (const point of points) {
    const value = point[metric];
    if (value === null) {
      previousDay = null;
      continue;
    }
    const connected = previousDay !== null && point.day === previousDay + 1;
    paths.push(`${connected ? 'L' : 'M'}${x(point.day)},${y(value)}`);
    previousDay = point.day;
  }
  const hovered = valid.find((point) => point.day === hoverDay) ?? valid.at(-1);
  const prices = points.flatMap((point) => (point.price === null ? [] : [point.price]));
  const avg = prices.length ? prices.reduce((total, price) => total + price, 0) / prices.length : null;
  const total = (key: 'sold' | 'imported' | 'exported') => points.reduce((sum, point) => sum + point[key], 0);

  return (
    <div className="market-chart">
      <div className="market-panel-heading">
        <h3>Market history</h3>
        <div className="market-segment" aria-label="History period">
          {[7, 28, 90].map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={windowDays === days}
              onClick={() => onWindowChange(days)}
            >
              {days} days
            </button>
          ))}
        </div>
      </div>
      <div className="market-segment" aria-label="Chart measure">
        {METRICS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={metric === key}
            onClick={() => {
              setMetric(key);
              setHoverDay(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {valid.length === 0 ? (
        <div className="market-chart-empty">
          <p>No {metric === 'price' ? 'price' : 'market'} history recorded yet.</p>
          <p className="profile-muted">Daily records appear as time passes in the village.</p>
        </div>
      ) : (
        <>
          <svg
            viewBox="0 0 600 195"
            className="market-chart-svg"
            role="img"
            aria-label={`${goodType} ${METRICS.find((entry) => entry.key === metric)?.label} history over ${windowDays} days`}
          >
            <title>
              {goodType} daily {metric} history
            </title>
            {[0, 0.5, 1].map((fraction) => {
              const value = low + (high - low) * fraction;
              return (
                <g key={fraction}>
                  <line x1="48" x2="560" y1={y(value)} y2={y(value)} className="market-chart-grid" />
                  <text x="40" y={y(value) + 4} textAnchor="end">
                    {Math.round(value)}
                  </text>
                </g>
              );
            })}
            <path d={paths.join(' ')} className="market-chart-line" />
            {valid.map((point) => (
              <circle
                key={point.day}
                cx={x(point.day)}
                cy={y(point[metric] ?? 0)}
                r={hovered?.day === point.day ? 5 : 3}
                tabIndex={0}
                className="market-chart-point"
                onMouseEnter={() => setHoverDay(point.day)}
                onFocus={() => setHoverDay(point.day)}
                aria-label={`${formatDate(calendarAt, point.day * MINUTES_PER_DAY)}: ${point[metric]} ${metric === 'price' ? 'coin' : 'units'}`}
              >
                <title>
                  {formatDate(calendarAt, point.day * MINUTES_PER_DAY)}: {point[metric]}
                </title>
              </circle>
            ))}
            <text x="48" y="184">
              {formatDate(calendarAt, start * MINUTES_PER_DAY)}
            </text>
            <text x="560" y="184" textAnchor="end">
              {formatDate(calendarAt, end * MINUTES_PER_DAY)}
            </text>
          </svg>
          <p className="market-chart-caption" aria-live="polite">
            {hovered &&
              `${formatDate(calendarAt, hovered.day * MINUTES_PER_DAY)} · ${hovered[metric]} ${metric === 'price' ? 'coin per unit' : 'units'}`}
          </p>
        </>
      )}
      <dl className="market-history-stats">
        <div>
          <dt>Average recorded price</dt>
          <dd>{avg === null ? '—' : `${avg.toFixed(1)} coin`}</dd>
        </div>
        <div>
          <dt>Units traded</dt>
          <dd>{total('sold')}</dd>
        </div>
        <div>
          <dt>Imported / exported</dt>
          <dd>
            {total('imported')} / {total('exported')}
          </dd>
        </div>
      </dl>
      <p className="market-fine-print">
        Daily prices and stock are recorded after price changes, before household shopping. Traded volume
        includes direct business trades. Missing records are left empty.
      </p>
      {points.length > 0 && (
        <details className="market-history-table">
          <summary>View recorded values</summary>
          <div className="market-table-scroll">
            <table className="market-table">
              <caption className="sr-only">Daily {goodType} market history</caption>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Traded</th>
                  <th>Imports</th>
                  <th>Exports</th>
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.day}>
                    <th scope="row">{formatDate(calendarAt, point.day * MINUTES_PER_DAY)}</th>
                    <td>{point.price ?? '—'}</td>
                    <td>{point.quantity ?? '—'}</td>
                    <td>{point.sold}</td>
                    <td>{point.imported}</td>
                    <td>{point.exported}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
