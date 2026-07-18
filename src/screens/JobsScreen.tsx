import { SceneHeader } from '../components/SceneHeader';
import { MINUTES_PER_DAY } from '../engine/ui-api';
import type { UiApi } from '../engine/ui-api';

interface JobsScreenProps {
  uiApi: UiApi;
  playerId: string;
  onBack: () => void;
  onAction: () => void;
}

const TICKS_PER_HOUR = MINUTES_PER_DAY / 24;

// §14.2 Jobs screen: "openings (wage band, hours, skill ask, employer,
// equipment quality), application and haggling flow" — reached from the
// notice board (§14.4: "Read the notice board... Haggle (weakly) for a
// logging job").
export function JobsScreen({ uiApi, playerId, onBack, onAction }: JobsScreenProps) {
  const calendar = uiApi.getCalendar();
  const openings = uiApi.listJobOpenings();
  const employment = uiApi.getEmployment(playerId);

  const apply = (jobSlotId: string, haggle: boolean) => {
    uiApi.applyForJob(playerId, jobSlotId, haggle);
    onAction();
  };

  const quit = () => {
    uiApi.quitJob(playerId);
    onAction();
  };

  return (
    <section>
      <SceneHeader icon="📋" title="Job Openings" calendar={calendar} />

      <button type="button" className="back-button" onClick={onBack}>
        ← Back to settlement
      </button>

      <div className="jobs-list">
        {openings.map((job) => {
          const isCurrentJob = employment?.jobSlotId === job.id;
          const blockedByOtherJob = employment !== null && !isCurrentJob;
          const hours = Math.round(job.shiftDurationTicks / TICKS_PER_HOUR);
          return (
            <div key={job.id} className="job-card">
              <h4>
                {job.title} — {job.companyName}
              </h4>
              <p>
                Wage: {job.wageMin}–{job.wageMax} coin per {hours}-hour shift
              </p>
              <p>Skill asked: {job.skill}</p>
              {job.toolGoodType && <p>Tools provided: company {job.toolGoodType}</p>}

              {isCurrentJob && employment && (
                <p className="jobs-current">You work here — {employment.wage} coin/shift.</p>
              )}
              {blockedByOtherJob && <p className="jobs-blocked">You already have a job.</p>}

              {!employment && (
                <div className="job-actions">
                  <button type="button" onClick={() => apply(job.id, false)}>
                    Accept posted wage ({job.wageMin} coin)
                  </button>
                  <button type="button" onClick={() => apply(job.id, true)}>
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
