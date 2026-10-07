import { useState } from 'react';
import { InventoryList } from '../components/ProfileParts';
import type { RoutinePreferences, UiApi } from '../engine/ui-api';

export function PlayerHomeScreen({
  uiApi,
  onAction,
  onBusiness,
}: {
  uiApi: UiApi;
  onAction: () => void;
  onBusiness: (id: string) => void;
}) {
  const home = uiApi.getPlayerHome();
  const [notice, setNotice] = useState('');
  const prefs = uiApi.getPlayerRoutinePreferences();
  const update = (changes: Partial<RoutinePreferences>) => {
    try {
      uiApi.setPlayerRoutinePreferences({ ...prefs, ...changes });
      setNotice('');
      onAction();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not update your routine.');
    }
  };
  return (
    <section className="player-panel">
      <p className="eyebrow">Home & household</p>
      <h2>{home?.household.name ?? 'Your household'}</h2>
      <div className="character-grid">
        <article>
          <h3>Current lodging</h3>
          <p>
            {prefs.lodging === 'rough'
              ? 'Rough sleeping'
              : uiApi.getSite(home?.household.homeSiteId ?? 'tavern')?.name}
          </p>
          <p>
            {prefs.lodging === 'rough'
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
          <p>
            Your {uiApi.getPlayerProfile().inspect.purse} coin purse pays for your daily routine and business
            investments.
          </p>
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
              checked={prefs[option.key]}
              onChange={(e) => update({ [option.key]: e.target.checked })}
            />
            {option.label}
          </label>
        ))}
        <label>
          Preferred lodging
          <select
            value={prefs.lodging}
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
            value={prefs.reserveCoin}
            onChange={(e) => update({ reserveCoin: e.target.valueAsNumber })}
          />
        </label>
      </div>
      {notice && <p role="alert">{notice}</p>}
    </section>
  );
}
