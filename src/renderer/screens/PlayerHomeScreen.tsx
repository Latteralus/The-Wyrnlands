import { useState } from 'react';
import { InventoryList } from '../components/ProfileParts';
import { useCommand, useView } from '../sim/hooks';
import type { RoutinePreferences } from '../../shared/protocol';

export function PlayerHomeScreen({ onBusiness }: { onBusiness: (id: string) => void }) {
  const [notice, setNotice] = useState('');
  const command = useCommand();
  const { data: view } = useView('view.home', undefined);
  // The reserve field is edited locally and sent as the player types; the
  // simulation's copy comes back on the next refresh.
  const [reserveDraft, setReserveDraft] = useState<number | null>(null);
  // The settings last sent, so two quick changes build on each other (and
  // show at once) instead of the second undoing the first while the view
  // catches up. Only the player changes these, so once sent they are what
  // the simulation holds.
  const [sent, setSent] = useState<RoutinePreferences | null>(null);
  if (view === undefined) return <section className="player-panel loading-panel">Loading…</section>;
  const home = view?.home ?? null;
  const prefs: RoutinePreferences = view?.routine ?? {
    attendWork: true,
    eatDrink: true,
    maintainProvisions: true,
    sleep: true,
    lodging: 'tavern',
    reserveCoin: 0,
  };
  const update = (changes: Partial<RoutinePreferences>) => {
    const next = { ...(sent ?? prefs), ...changes };
    setSent(next);
    command('player.setRoutinePreferences', next).then(
      () => setNotice(''),
      (e: unknown) => {
        setSent(null);
        setNotice(e instanceof Error ? e.message : 'Could not update your routine.');
      },
    );
  };
  const shown = sent ?? prefs;
  return (
    <section className="player-panel">
      <p className="eyebrow">Home & household</p>
      <h2>{home?.household.name ?? 'Your household'}</h2>
      <div className="character-grid">
        <article>
          <h3>Current lodging</h3>
          <p>{shown.lodging === 'rough' ? 'Rough sleeping' : view?.lodgingName}</p>
          <p>
            {shown.lodging === 'rough'
              ? 'An outdoor resting place; little shelter from winter.'
              : 'Common-room / bunk lodging, paid per stay when affordable.'}
          </p>
          <p>
            No property owned. Your lodging preference guides automatic sleep; it does not reserve a room.
          </p>
        </article>
        <article>
          <h3>Members</h3>
          {home?.profile?.members.map((member) => (
            <p key={member.id}>
              {member.name} · {member.jobTitle ?? 'No current job'}
            </p>
          ))}
        </article>
        <article>
          <h3>Household stores</h3>
          <InventoryList lines={home?.profile?.inspect.inventory ?? []} empty="No shared stores yet." />
          <p>{home?.profile?.inspect.coin ?? 0} coin in household reserves</p>
          <p>Your {view?.purse ?? 0} coin purse pays for your daily routine and business investments.</p>
        </article>
        <article>
          <h3>Household businesses</h3>
          {home?.profile?.businesses
            .filter((b) => b.role === 'owner')
            .map((b) => (
              <button key={b.companyId} onClick={() => onBusiness(b.companyId)}>
                {b.companyName}
              </button>
            ))}
          {!home?.profile?.businesses.length && <p>None yet.</p>}
        </article>
      </div>
      <h3>Your daily routine</h3>
      <p>
        Choose your life; your character handles the everyday tasks. Queued actions take priority. Changes
        apply when the current action finishes.
      </p>
      <div className="routine-form">
        {(
          [
            { key: 'attendWork', label: 'Automatically attend work' },
            { key: 'eatDrink', label: 'Automatically eat and drink' },
            { key: 'maintainProvisions', label: 'Maintain provisions' },
            { key: 'sleep', label: 'Sleep automatically' },
          ] as const
        ).map((option) => (
          <label key={option.key}>
            <input
              type="checkbox"
              checked={shown[option.key]}
              onChange={(e) => update({ [option.key]: e.target.checked })}
            />
            {option.label}
          </label>
        ))}
        <label>
          Preferred lodging
          <select
            value={shown.lodging}
            onChange={(e) => update({ lodging: e.target.value as RoutinePreferences['lodging'] })}
          >
            <option value="rough">Rough sleeping</option>
            <option value="tavern">Tavern bunk when affordable</option>
          </select>
        </label>
        <label>
          Keep at least this much coin before routine purchases
          <input
            aria-label="Routine coin reserve"
            type="number"
            min={0}
            max={1000000}
            step={1}
            value={reserveDraft ?? shown.reserveCoin}
            onChange={(e) => {
              setReserveDraft(e.target.valueAsNumber);
              update({ reserveCoin: e.target.valueAsNumber });
            }}
            onBlur={() => setReserveDraft(null)}
          />
        </label>
      </div>
      {notice && <p role="alert">{notice}</p>}
    </section>
  );
}
