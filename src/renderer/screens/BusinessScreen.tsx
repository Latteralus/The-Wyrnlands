import { useState } from 'react';
import {
  InspectPanel,
  InspectToggle,
  InventoryList,
  type ProfileNavigation,
} from '../components/ProfileParts';
import { SceneHeader } from '../components/SceneHeader';
import { capitalize, formatDate, formatTimestamp } from '../components/profileFormat';
import { useCalendarAt, useCommand, useCalendar, useView } from '../sim/hooks';
import type { BusinessProfile, LedgerSummary } from '../../shared/protocol';

interface BusinessScreenProps extends ProfileNavigation {
  companyId: string;
  inspect: boolean;
  onToggleInspect: () => void;
  onBack: () => void;
}

const STATUS_TEXT: Record<BusinessProfile['status'], string> = {
  open: 'Open for business.',
  struggling: 'Struggling to make ends meet.',
  closed: 'Closed.',
};

// "salesPerDay" → "sales per day"
function humanize(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').toLowerCase();
}

function formatValue(value: unknown): string {
  if (typeof value === 'number') return String(Math.round(value * 10) / 10);
  if (value && typeof value === 'object')
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${humanize(k)} ${formatValue(v)}`)
      .join(' · ');
  return String(value);
}

function LedgerColumn({ label, ledger }: { label: string; ledger: LedgerSummary }) {
  return (
    <div className="ledger-column">
      <h4>{label}</h4>
      <dl className="profile-facts">
        <dt>Revenue</dt>
        <dd>{ledger.revenue}</dd>
        <dt>Materials</dt>
        <dd>{ledger.materialCost}</dd>
        <dt>Wages</dt>
        <dd>{ledger.wages}</dd>
        <dt>Rent</dt>
        <dd>{ledger.rent}</dd>
        <dt>Net</dt>
        <dd className={ledger.net < 0 ? 'is-negative' : ''}>{ledger.net}</dd>
        <dt>Paid to owner</dt>
        <dd>{ledger.ownerDraws}</dd>
        <dt>Put in by owner</dt>
        <dd>{ledger.ownerContributions}</dd>
        <dt>Spent on assets</dt>
        <dd>{ledger.capital}</dd>
      </dl>
    </div>
  );
}

// §14.2 "NPC business view: the observable subset (prices, staffing,
// visible stock, reputation later)". By default, what a passerby could see
// or hear in town — who runs it, the land it works, who works there, what's
// on the premises, why it was founded (§9.3: "NPC businesses expose what an
// observer would plausibly know"). Inspect mode adds what only its owner
// knows: cash, its books (last four weeks and lifetime), each hand's wage,
// and the founder's private reckoning when they started it.
export function BusinessScreen({
  companyId,
  inspect: requestedInspect,
  onToggleInspect,
  onBack,
  ...nav
}: BusinessScreenProps) {
  const calendar = useCalendar();
  const calendarAt = useCalendarAt();
  const command = useCommand();
  const [notice, setNotice] = useState('');
  const { data: view } = useView('view.business', { companyId });
  if (!view || !calendar)
    return (
      <section className="loading-panel">
        {view === null ? (
          <>
            <p>No such business is known here.</p>
            <button type="button" className="back-button" onClick={onBack}>
              ← Back
            </button>
          </>
        ) : (
          'Loading…'
        )}
      </section>
    );
  const { profile, slots, log, playerJob, ownBooks } = view;
  const inspect = ownBooks || requestedInspect;
  const playerSlot = playerJob ? slots.find((slot) => slot.id === playerJob.jobSlotId) : undefined;
  const openSlots = slots.filter((slot) => slot.filled < slot.capacity);
  const report = (error: unknown) =>
    setNotice(error instanceof Error ? error.message : 'That could not be done right now.');
  const apply = (jobSlotId: string, haggle: boolean) => {
    command('player.applyForJob', { jobSlotId, haggle }).then((result) => setNotice(result.message), report);
  };
  const quit = () => {
    command('player.quitJob').then(() => setNotice(''), report);
  };

  return (
    <section>
      <SceneHeader icon="🏛️" title={profile.name} calendar={calendar} />

      <div className="profile-toolbar">
        <button type="button" className="back-button" onClick={onBack}>
          ← Back
        </button>
        {!ownBooks && <InspectToggle inspect={inspect} onToggle={onToggleInspect} />}
      </div>

      {profile && (
        <>
          <p className={`business-status business-status--${profile.status}`}>
            {capitalize(profile.kind)} · tier {profile.tier} · {STATUS_TEXT[profile.status]}
          </p>
          {profile.status !== 'closed' && (
            <p>
              {profile.workersPresent} of {profile.staff.length} staff on site.
            </p>
          )}
          {profile.activity && (
            <p>
              {profile.activity.label} · until {formatTimestamp(calendarAt, profile.activity.endsAtTick)}
            </p>
          )}
          {profile.inTransit.length > 0 && (
            <p>
              On the way to market:{' '}
              {profile.inTransit.map((line) => `${line.count} ${line.goodType}`).join(', ')}.
            </p>
          )}
          {profile.ownerId && (
            <p className="business-owner">
              {profile.managerId ? 'Owned by ' : 'Run by '}
              <button
                type="button"
                className="link-button"
                onClick={() => nav.onSelectNpc(profile.ownerId ?? '')}
              >
                {profile.ownerName}
              </button>
              {profile.managerId && (
                <>
                  , managed by{' '}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => nav.onSelectNpc(profile.managerId ?? '')}
                  >
                    {profile.managerName}
                  </button>
                </>
              )}
              .
            </p>
          )}
          <p className="business-history">
            {profile.foundedTick !== null ? (
              <>
                Founded by{' '}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => nav.onSelectNpc(profile.founderId ?? '')}
                >
                  {profile.founderName}
                </button>{' '}
                in {formatDate(calendarAt, profile.foundedTick)}
                {profile.foundingReasons.length > 0 ? ` — ${profile.foundingReasons.join('; ')}.` : '.'}
              </>
            ) : (
              'An old village business, here before you came.'
            )}
            {profile.closedTick !== null && ` Closed in ${formatDate(calendarAt, profile.closedTick)}.`}
          </p>
          <p className="profile-muted">
            Works {profile.siteName}
            {profile.tenure
              ? profile.tenure.kind === 'lease'
                ? ` on a lease (${profile.tenure.weeklyRent} coin a week).`
                : ', which it owns outright.'
              : '.'}
          </p>

          <h3>Staffing</h3>
          <ul className="business-jobslots">
            {slots.map((slot) => (
              <li key={slot.id}>
                {slot.title}: {slot.filled}/{slot.capacity} filled — {slot.wageMin}
                {slot.wageMin !== slot.wageMax ? `-${slot.wageMax}` : ''} coin/shift
              </li>
            ))}
          </ul>
          {profile.staff.length > 0 && (
            <ul className="profile-list">
              {profile.staff.map((s) => (
                <li key={s.id}>
                  <button type="button" className="link-button" onClick={() => nav.onSelectNpc(s.id)}>
                    {s.name}
                  </button>{' '}
                  <span className="profile-muted">
                    {s.title}, since {formatDate(calendarAt, s.hiredTick)}
                    {inspect && ` — ${s.wage} coin a shift`}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h3>Work</h3>
          {notice && <p role="alert">{notice}</p>}
          {profile.status === 'closed' ? (
            <p className="profile-empty">It has closed; nobody works here now.</p>
          ) : playerSlot && playerJob ? (
            <div className="job-actions">
              <p className="jobs-current">
                You work here as {playerSlot.title.toLowerCase()} at {playerJob.wage} coin a shift. You go to
                your shift on your own each workday.
              </p>
              <button type="button" onClick={quit}>
                Quit this job
              </button>
            </div>
          ) : playerJob ? (
            <p className="profile-muted">
              You already work at {view.playerJobCompanyName ?? 'another business'}.
            </p>
          ) : openSlots.length === 0 ? (
            <p className="profile-empty">No positions open right now.</p>
          ) : (
            openSlots.map((slot) => (
              <div key={slot.id} className="job-actions">
                <span>
                  {slot.title}, {slot.wageMin}–{slot.wageMax} coin a shift
                  {slot.toolGoodType ? ` (the ${slot.toolGoodType} is provided)` : ''}
                </span>
                <button type="button" onClick={() => apply(slot.id, false)}>
                  Apply at the posted {slot.wageMin} coin
                </button>
                <button type="button" onClick={() => apply(slot.id, true)}>
                  Apply and haggle
                </button>
              </div>
            ))
          )}

          <h3>On the premises</h3>
          <InventoryList lines={profile.stock} empty="Nothing on hand." />

          {inspect && (
            <InspectPanel title="The books" privateKnowledge={!ownBooks}>
              <dl className="profile-facts">
                <dt>Cash</dt>
                <dd>{profile.inspect.cash} coin</dd>
              </dl>
              <div className="ledger-columns">
                <LedgerColumn label="Last four weeks" ledger={profile.inspect.lastFourWeeks} />
                <LedgerColumn label="Since it opened" ledger={profile.inspect.lifetime} />
              </div>
              {profile.inspect.investment !== null && (
                <>
                  <h4>The founder&apos;s reckoning</h4>
                  <dl className="profile-facts">
                    <div className="profile-fact-row">
                      <dt>Put in</dt>
                      <dd>
                        {profile.inspect.investment} coin, of {profile.inspect.founderPurseBefore} the
                        household had
                      </dd>
                    </div>
                    {Object.entries(profile.inspect.founderEstimate ?? {}).map(([key, value]) => (
                      <div key={key} className="profile-fact-row">
                        <dt>{capitalize(humanize(key))}</dt>
                        <dd>{formatValue(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
            </InspectPanel>
          )}

          <h3>Business Log</h3>
          <ul className="log-list">
            {log.length === 0 && <li className="log-empty">Nothing notable on record.</li>}
            {log.map((event, i) => (
              <li key={i}>
                <span className="log-tick">{formatTimestamp(calendarAt, event.tick)}</span> {event.message}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
