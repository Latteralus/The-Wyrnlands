import { useState } from 'react';
import { capitalize } from '../components/profileFormat';
import { useCommand, useView } from '../sim/hooks';
import type { TenureKind } from '../../shared/protocol';

export function PlayerBusinessesScreen({ onSelectBusiness }: { onSelectBusiness: (id: string) => void }) {
  const [typeId, setTypeId] = useState('logging');
  const [siteId, setSiteId] = useState('');
  const [tenure, setTenure] = useState<TenureKind>('lease');
  const [name, setName] = useState('');
  const [investment, setInvestment] = useState(250);
  const [positions, setPositions] = useState(1);
  const [founderWorks, setFounderWorks] = useState(true);
  const [inputs, setInputs] = useState(1);
  const [notice, setNotice] = useState('');
  const command = useCommand();
  // Everything the form needs — trades, vacant parcels, today's startup
  // costs for this choice, the purse — in one snapshot, recomputed in the
  // simulation as the choices change.
  const { data: view } = useView(
    'view.founding',
    {
      typeId,
      siteId: siteId || null,
      tenure,
      inputs: Number.isSafeInteger(inputs) && inputs > 0 ? Math.min(inputs, 1_000_000) : 0,
    },
    { keepPrevious: true },
  );
  if (!view) return <section className="player-panel loading-panel">Loading…</section>;
  const { types, sites, outlay, balance, owned } = view;
  const type = types.find((t) => t.id === view.typeId);
  const chosenSite = sites.find((site) => site.id === view.chosenSiteId);
  const inputUnits = type?.inputGood ? inputs : 0;
  const missing = !chosenSite
    ? 'No matching parcel is available. A mill needs a vacated mill race.'
    : !outlay
      ? 'The required equipment is unavailable.'
      : type?.inputGood && (inputs < type.minimumInputUnits || view.inputAvailable < inputs)
        ? `Choose opening stock of at least ${type.minimumInputUnits} ${type.inputGood}; ${view.inputAvailable} available.`
        : investment > balance
          ? `You need ${investment - balance} more coin for this investment.`
          : investment < outlay.total
            ? `Your investment must cover ${outlay.total} coin of startup costs.`
            : null;
  return (
    <section className="player-panel">
      <p className="eyebrow">Your enterprises</p>
      <h2>Businesses</h2>
      {owned.length ? (
        owned.map((b) => (
          <p key={b.companyId}>
            <button onClick={() => onSelectBusiness(b.companyId)}>
              {b.companyName}
              {b.open ? '' : ' (closed)'}
            </button>
          </p>
        ))
      ) : (
        <p>No business of your own yet. Land, tools, and a reserve must all come from your savings.</p>
      )}
      <h3>Start a business</h3>
      <p>
        Daily supplies, sales, and rent remain automatic. You decide the opening staff and investment.
        Expansion, staffing changes, and owner draws await the next management features.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!type || !chosenSite) return;
          command('player.foundCompany', {
            businessTypeId: type.id,
            siteId: chosenSite.id,
            tenureKind: tenure,
            companyName: name.trim(),
            positions,
            postedWage: type.wageMin,
            investment,
            initialInputUnits: inputUnits,
            founderWorks,
          }).then(
            (result) => {
              if (result.ok) onSelectBusiness(result.companyId);
              else setNotice(result.reason);
            },
            (error: unknown) =>
              setNotice(error instanceof Error ? error.message : 'The business could not be founded.'),
          );
        }}
      >
        <div className="form-grid">
          <label>
            Trade
            <select
              value={typeId}
              onChange={(e) => {
                setTypeId(e.target.value);
                setSiteId('');
                setPositions(1);
              }}
            >
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {capitalize(t.id)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Parcel
            <select value={chosenSite?.id ?? ''} onChange={(e) => setSiteId(e.target.value)}>
              {!sites.length && <option value="">No available parcel</option>}
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Land tenure
            <select value={tenure} onChange={(e) => setTenure(e.target.value as TenureKind)}>
              <option value="lease">Lease</option>
              <option value="freehold">Freehold</option>
            </select>
          </label>
          <label>
            Company name
            <input
              required
              maxLength={100}
              value={name}
              placeholder="Your family trade"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Total investment (including startup costs)
            <input
              type="number"
              min={0}
              max={1000000}
              step={1}
              required
              value={Number.isNaN(investment) ? '' : investment}
              onChange={(e) => setInvestment(e.target.valueAsNumber)}
            />
          </label>
          <label>
            Initial positions
            <input
              type="number"
              min={1}
              max={type?.startingMaxPositions ?? 1}
              step={1}
              required
              value={Number.isNaN(positions) ? '' : positions}
              onChange={(e) => setPositions(e.target.valueAsNumber)}
            />
          </label>
          {type?.inputGood && (
            <label>
              Opening {type.inputGood} stock
              <input
                type="number"
                min={type.minimumInputUnits}
                step={1}
                required
                value={Number.isNaN(inputs) ? '' : inputs}
                onChange={(e) => setInputs(e.target.valueAsNumber)}
              />
            </label>
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={founderWorks}
              onChange={(e) => setFounderWorks(e.target.checked)}
            />
            Work the first position yourself (leave your current job)
          </label>
        </div>
        {outlay && (
          <dl className="startup-summary">
            <dt>{tenure === 'lease' ? 'Land entry fine' : 'Land purchase'}</dt>
            <dd>{outlay.land} coin</dd>
            <dt>Weekly rent</dt>
            <dd>{outlay.weeklyRent} coin</dd>
            <dt>Required tool {type?.toolGoodType ?? '(none)'}</dt>
            <dd>{outlay.tool} coin</dd>
            <dt>Opening input stock</dt>
            <dd>{outlay.inputs} coin</dd>
            <dt>Startup outlay</dt>
            <dd>{outlay.total} coin</dd>
            <dt>Working reserve after startup</dt>
            <dd>{Math.max(0, investment - outlay.total)} coin</dd>
            <dt>Total investment</dt>
            <dd>{investment} coin</dd>
            <dt>Posted wage</dt>
            <dd>{type?.wageMin} coin / shift</dd>
          </dl>
        )}
        {missing && <p role="status">{missing}</p>}
        {notice && <p role="alert">{notice}</p>}
        <button className="primary-button" type="submit" disabled={Boolean(missing)}>
          Found company
        </button>
      </form>
    </section>
  );
}
