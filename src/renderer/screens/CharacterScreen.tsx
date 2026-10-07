import { useState } from 'react';
import { actionLabel } from '../../shared/gameRules';
import { capitalize, formatDate } from '../components/profileFormat';
import { useCalendarAt, useCommand, useView } from '../sim/hooks';

export function CharacterScreen({
  onHome,
  onWork,
  onBusiness,
}: {
  onHome: () => void;
  onWork: () => void;
  onBusiness: (id: string) => void;
}) {
  const [tab, setTab] = useState('Overview');
  const [notice, setNotice] = useState('');
  const calendarAt = useCalendarAt();
  const command = useCommand();
  const view = useView('view.character', undefined).data;
  if (!view) return <section className="player-panel loading-panel">Loading…</section>;
  const { profile: p, currentAction, routine, history } = view;
  const job = p.jobs.find((job) => job.endedTick === null);
  const act = (request: Promise<unknown>) => {
    request.then(
      () => setNotice(''),
      (error: unknown) => setNotice(error instanceof Error ? error.message : 'Could not change equipment.'),
    );
  };
  return (
    <section className="player-panel">
      <p className="eyebrow">Your character</p>
      <h2>{p.name}</h2>
      <nav className="player-tabs" aria-label="Character pages">
        {['Overview', 'Skills', 'Inventory', 'Equipment', 'History'].map((name) => (
          <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </nav>
      {notice && <p role="alert">{notice}</p>}
      {tab === 'Overview' && (
        <div className="character-grid">
          <article>
            <h3>Occupation</h3>
            <p>{job ? `${job.title} — ${job.companyName}` : 'Looking for your next trade'}</p>
            {job && <p>{job.wage} coin / shift</p>}
            <button onClick={onWork}>Work & jobs</button>
          </article>
          <article>
            <h3>Home</h3>
            <p>{p.householdName}</p>
            <p>
              {routine.lodging === 'rough'
                ? 'Rough sleeping in Oakford'
                : 'The Sleeping Ox · pay-per-stay bunk lodging'}
            </p>
            <button onClick={onHome}>Home & routine</button>
          </article>
          <article>
            <h3>Your purse</h3>
            <p className="large-stat">{p.inspect.purse} coin</p>
            <p>Household reserves: {p.inspect.householdCoin ?? 0} coin</p>
          </article>
          <article>
            <h3>Condition</h3>
            {p.condition && (
              <dl className="profile-facts">
                {(['hunger', 'thirst', 'energy', 'warmth'] as const).map((need) => (
                  <div key={need}>
                    <dt>{capitalize(need)}</dt>
                    <dd>{p.condition?.[need].toFixed(1)} / 100</dd>
                  </div>
                ))}
              </dl>
            )}
            <p>
              {currentAction
                ? currentAction.type.startsWith('work_shift_')
                  ? `Working a shift${job ? ` as ${job.title.toLowerCase()}` : ''}`
                  : capitalize(actionLabel(currentAction.type))
                : 'At leisure'}
            </p>
          </article>
          <article>
            <h3>Businesses</h3>
            {p.businesses.filter((b) => b.role === 'owner').length === 0 ? (
              <p>
                None yet. Learn a trade, save for land and equipment, then take the first position yourself.
              </p>
            ) : (
              p.businesses
                .filter((b) => b.role === 'owner')
                .map((b) => (
                  <button key={b.companyId} onClick={() => onBusiness(b.companyId)}>
                    {b.companyName}
                    {b.open ? '' : ' (closed)'}
                  </button>
                ))
            )}
          </article>
        </div>
      )}
      {tab === 'Skills' && (
        <table className="player-table">
          <thead>
            <tr>
              <th>Skill</th>
              <th>Level</th>
              <th>XP</th>
              <th>XP to next level</th>
            </tr>
          </thead>
          <tbody>
            {p.skills.map((s) => (
              <tr key={s.skill}>
                <td>{capitalize(s.skill)}</td>
                <td>{s.level}</td>
                <td>{s.xp}</td>
                <td>{s.xpToNextLevel ?? 'Mastered'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tab === 'Inventory' && (
        <>
          <p>
            {p.carriedWeightKg.toFixed(1)} / {p.capacityKg} kg carried
          </p>
          <table className="player-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Quantity</th>
                <th>Condition</th>
                <th>Weight</th>
              </tr>
            </thead>
            <tbody>
              {p.inspect.inventory.map((line) => (
                <tr key={line.goodType}>
                  <td>{capitalize(line.goodType)}</td>
                  <td>{line.count}</td>
                  <td>{line.conditionPercent === null ? '—' : `${line.conditionPercent}%`}</td>
                  <td>
                    {(
                      (p.items.find((i) => i.goodType === line.goodType)?.weightKg ?? 0) * line.count
                    ).toFixed(1)}{' '}
                    kg
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {p.items.length === 0 && <p>Your pack is empty.</p>}
        </>
      )}
      {tab === 'Equipment' && (
        <>
          <div className="character-grid">
            {(['feet', 'body'] as const).map((slot) => {
              const gear = p.inspect.gear.find((g) => g.slot === slot);
              const item = p.items.find((i) => i.id === gear?.itemId);
              return (
                <article key={slot}>
                  <h3>{capitalize(slot)}</h3>
                  <p>
                    {gear
                      ? `${capitalize(gear.goodType)} · ${gear.durability} / ${gear.maxDurability} durability`
                      : 'Empty slot'}
                  </p>
                  {item && <p>Warmth {item.warmth}</p>}
                  {gear && (
                    <button onClick={() => act(command('player.unequipSlot', { slot }))}>
                      Unequip {gear.goodType}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
          <h3>Available garments</h3>
          {p.items
            .filter((i) => i.slot && !p.inspect.gear.some((g) => g.itemId === i.id))
            .map((i) => (
              <div className="equipment-row" key={i.id}>
                <span>
                  {capitalize(i.goodType)} · {i.durability} / {i.maxDurability} · warmth {i.warmth}
                </span>
                <button onClick={() => act(command('player.equipItem', { itemId: i.id }))}>
                  Equip {i.goodType}
                </button>
              </div>
            ))}
        </>
      )}
      {tab === 'History' && (
        <>
          <h3>Work history</h3>
          {p.jobs.length === 0 && <p>Your working life in Oakford is still ahead of you.</p>}
          {p.jobs.map((job, i) => (
            <p key={i}>
              {job.title} at {job.companyName} · {job.wage} coin / shift ·{' '}
              {formatDate(calendarAt, job.hiredTick)} —{' '}
              {job.endedTick === null ? 'present' : formatDate(calendarAt, job.endedTick)}
            </p>
          ))}
          <h3>Business history</h3>
          {p.businesses
            .filter((b) => b.role !== 'manager')
            .map((b) => (
              <p key={`${b.companyId}-${b.role}`}>
                {capitalize(b.role)} ·{' '}
                <button onClick={() => onBusiness(b.companyId)}>{b.companyName}</button>
              </p>
            ))}
          <h3>Personal history</h3>
          {history.map((event, i) => (
            <p key={i}>
              {formatDate(calendarAt, event.tick)} · {event.message}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
