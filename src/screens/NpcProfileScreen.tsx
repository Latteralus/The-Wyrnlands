import {
  InspectPanel,
  InspectToggle,
  InventoryList,
  RelationsList,
  SkillsList,
  type ProfileNavigation,
} from '../components/ProfileParts';
import { SceneHeader } from '../components/SceneHeader';
import { capitalize, describeTrait, formatDate } from '../components/profileFormat';
import type { Needs, UiApi } from '../engine/ui-api';

interface NpcProfileScreenProps extends ProfileNavigation {
  uiApi: UiApi;
  entityId: string;
  inspect: boolean;
  onToggleInspect: () => void;
  onBack: () => void;
}

function describeCondition(needs: Needs | null): string {
  if (!needs) return 'No word on their condition.';
  const worst = Math.min(needs.hunger, needs.thirst, needs.energy, needs.warmth);
  if (worst >= 70) return 'They look well and in good spirits.';
  if (worst >= 40) return 'They look a little worn, but managing.';
  return 'They look gaunt and worn down.';
}

// §11.2 NPC Profile Screen: "Portrait, occupation and employer, household,
// visible condition, public job history... reputation (later)." What a
// townsperson would know by default — trade and skill, where they've
// worked, who they live with and roughly how the household is doing;
// Inspect mode (reports/profiles.ts's `inspect`) adds exact coin,
// belongings, worn gear and personality traits. The portrait is still a
// placeholder icon (§14.1's budgeted art pass).
export function NpcProfileScreen({
  uiApi,
  entityId,
  inspect,
  onToggleInspect,
  onBack,
  ...nav
}: NpcProfileScreenProps) {
  const calendar = uiApi.getCalendar();
  const profile = uiApi.getPersonProfile(entityId);
  const current = profile.jobs.find((j) => j.endedTick === null);
  const past = profile.jobs.filter((j) => j.endedTick !== null);
  const needs = profile.condition;

  return (
    <section>
      <SceneHeader icon="🧑" title={profile.name} calendar={calendar} />

      <div className="profile-toolbar">
        <button type="button" className="back-button" onClick={onBack}>
          ← Back
        </button>
        <InspectToggle inspect={inspect} onToggle={onToggleInspect} />
      </div>

      <p className="npc-condition">{describeCondition(needs)}</p>

      <h3>Occupation</h3>
      {current ? (
        <p>
          {current.title} at{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => nav.onSelectBusiness(current.companyId)}
          >
            {current.companyName}
          </button>{' '}
          since {formatDate(uiApi, current.hiredTick)}
          {inspect && <span className="profile-muted"> — {current.wage} coin a shift</span>}
        </p>
      ) : (
        <p className="npc-unemployed">Unemployed.</p>
      )}
      {profile.householdWealth && (
        <p className="profile-muted">Their household is {profile.householdWealth}.</p>
      )}

      <h3>Skills</h3>
      <SkillsList skills={profile.skills} showXp={inspect} />

      <h3>Ties</h3>
      <RelationsList relations={profile.relations} nav={nav} />

      <h3>Work history</h3>
      {past.length === 0 ? (
        <p className="profile-empty">
          {current ? 'No earlier work on record.' : 'Has never held a job here.'}
        </p>
      ) : (
        <ul className="profile-list">
          {past.map((job, i) => (
            <li key={`${job.companyId}-${job.hiredTick}-${i}`}>
              {job.title} at {job.companyName}, {formatDate(uiApi, job.hiredTick)} –{' '}
              {formatDate(uiApi, job.endedTick ?? job.hiredTick)}
            </li>
          ))}
        </ul>
      )}

      {inspect && (
        <InspectPanel title="Inspect">
          <dl className="profile-facts">
            <dt>Own purse</dt>
            <dd>{profile.inspect.purse} coin</dd>
            {profile.inspect.householdCoin !== null && (
              <>
                <dt>Household purse</dt>
                <dd>{profile.inspect.householdCoin} coin</dd>
              </>
            )}
            <dt>Ambition</dt>
            <dd>{describeTrait(profile.inspect.traits.ambition)}</dd>
            <dt>Risk tolerance</dt>
            <dd>{describeTrait(profile.inspect.traits.riskTolerance)}</dd>
            {needs && (
              <>
                <dt>Needs</dt>
                <dd>
                  hunger {Math.round(needs.hunger)} · thirst {Math.round(needs.thirst)} · energy{' '}
                  {Math.round(needs.energy)} · warmth {Math.round(needs.warmth)}
                </dd>
              </>
            )}
          </dl>
          <h4>Wearing</h4>
          {profile.inspect.gear.length === 0 ? (
            <p className="profile-empty">Nothing worn of note.</p>
          ) : (
            <ul className="profile-list">
              {profile.inspect.gear.map((g) => (
                <li key={g.itemId}>
                  {capitalize(g.goodType)} on {g.slot}{' '}
                  <span className="profile-muted">
                    ({Math.round((g.durability / Math.max(1, g.maxDurability)) * 100)}% condition)
                  </span>
                </li>
              ))}
            </ul>
          )}
          <h4>Carrying</h4>
          <InventoryList lines={profile.inspect.inventory} empty="Carrying nothing of their own." />
        </InspectPanel>
      )}
    </section>
  );
}
