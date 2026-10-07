import { useState } from 'react';
import { MINUTES_PER_DAY } from '../../shared/gameRules';
import { SceneHeader } from '../components/SceneHeader';
import { useCommand, useCalendar, useView } from '../sim/hooks';

interface JobsScreenProps {
  onBack: () => void;
}

const TICKS_PER_HOUR = MINUTES_PER_DAY / 24;

// §14.2 Jobs screen: "openings (wage band, hours, skill ask, employer,
// equipment quality), application and haggling flow" — reached from the
// notice board (§14.4: "Read the notice board... Haggle (weakly) for a
// logging job").
export function JobsScreen({ onBack }: JobsScreenProps) {
  const calendar = useCalendar();
  const view = useView('view.jobs', undefined).data;
  const command = useCommand();
  const [notice, setNotice] = useState('');
  const openings = view?.openings ?? [];
  const employment = view?.employment ?? null;

  const apply = (jobSlotId: string, haggle: boolean) => {
    command('player.applyForJob', { jobSlotId, haggle }).then(
      (result) => setNotice(result.message),
      (error: unknown) =>
        setNotice(error instanceof Error ? error.message : 'This job is no longer available.'),
    );
  };

  const quit = () => {
    command('player.quitJob').catch((error: unknown) =>
      setNotice(error instanceof Error ? error.message : 'You could not quit right now.'),
    );
  };

  return (
    <section>
      {calendar && <SceneHeader icon="📋" title="Job Openings" calendar={calendar} />}

      <button type="button" className="back-button" onClick={onBack}>
        ← Back to settlement
      </button>

      <div className="jobs-list">
        {notice && <p role="alert">{notice}</p>}
        {openings.map((job) => {
          const isCurrentJob = employment?.jobSlotId === job.id;
          const blockedByOtherJob = employment !== null && !isCurrentJob;
          const hours = Math.round(job.shiftDurationTicks / TICKS_PER_HOUR);
          const vacancies = job.vacancies;
          return (
            <div key={job.id} className="job-card">
              <h4>
                {job.title} — {job.companyName}
              </h4>
              <p>
                Wage: {job.wageMin}–{job.wageMax} coin per {hours}-hour shift
              </p>
              <p>Skill asked: {job.skill}</p>
              <p>
                {vacancies} open position{vacancies === 1 ? '' : 's'}
              </p>
              {job.toolGoodType && <p>Tools provided: company {job.toolGoodType}</p>}

              {isCurrentJob && employment && (
                <p className="jobs-current">You work here — {employment.wage} coin/shift.</p>
              )}
              {blockedByOtherJob && <p className="jobs-blocked">You already have a job.</p>}

              {!employment && (
                <div className="job-actions">
                  <button type="button" disabled={vacancies === 0} onClick={() => apply(job.id, false)}>
                    Accept posted wage ({job.wageMin} coin)
                  </button>
                  <button type="button" disabled={vacancies === 0} onClick={() => apply(job.id, true)}>
                    Haggle for a better wage
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {employment && (
        <button type="button" onClick={quit}>
          Quit your job
        </button>
      )}
    </section>
  );
}
