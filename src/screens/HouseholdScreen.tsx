import {
  InspectPanel,
  InspectToggle,
  InventoryList,
  type ProfileNavigation,
} from '../components/ProfileParts';
import { SceneHeader } from '../components/SceneHeader';
import { formatDate } from '../components/profileFormat';
import type { UiApi } from '../engine/ui-api';

interface HouseholdScreenProps extends ProfileNavigation {
  uiApi: UiApi;
  householdId: string;
  inspect: boolean;
  onToggleInspect: () => void;
  onBack: () => void;
}

// §14.2 Household screen: "members, budget, reserves, obligations." By
// default what the neighbours would know — who lives there and works where,
// roughly how they're getting on, any business they run; Inspect mode adds
// the exact purse, how many weeks of bread it buys, the hunger and
// destitution counters the simulation acts on, and what they keep at home.
// No rent/housing-ladder module exists yet (§12 is a later stage), so
// "obligations" isn't shown.
export function HouseholdScreen({
  uiApi,
  householdId,
  inspect,
  onToggleInspect,
  onBack,
  ...nav
}: HouseholdScreenProps) {
  const calendar = uiApi.getCalendar();
  const profile = uiApi.getHouseholdProfile(householdId);

  return (
    <section>
      <SceneHeader icon="🏠" title={profile?.name ?? 'Unknown Household'} calendar={calendar} />

      <div className="profile-toolbar">
        <button type="button" className="back-button" onClick={onBack}>
          ← Back
        </button>
        <InspectToggle inspect={inspect} onToggle={onToggleInspect} />
      </div>

      {profile && (
        <>
          <p className="household-reserve">They are {profile.wealth}.</p>
          {profile.situation.map((line) => (
            <p key={line} className="profile-muted">
              {line}
            </p>
          ))}

          <h3>Members</h3>
          <ul className="household-members">
            {profile.members.map((member) => (
              <li key={member.id}>
                <button type="button" onClick={() => nav.onSelectNpc(member.id)}>
                  {member.name}
                </button>
                {member.companyId ? (
                  <span className="household-member-status is-employed">
                    {' '}
                    {member.jobTitle} at{' '}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => nav.onSelectBusiness(member.companyId ?? '')}
                    >
                      {member.companyName}
                    </button>
                  </span>
                ) : (
                  <span className="household-member-status"> unemployed</span>
                )}
              </li>
            ))}
          </ul>

          {profile.businesses.length > 0 && (
            <>
              <h3>Businesses</h3>
              <ul className="profile-list">
                {profile.businesses.map((b) => (
                  <li key={`${b.companyId}-${b.role}`}>
                    <span className="profile-muted">
                      {b.role === 'owner' ? 'Own' : b.role === 'manager' ? 'Manage' : 'Founded'}:
                    </span>{' '}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => nav.onSelectBusiness(b.companyId)}
                    >
                      {b.companyName}
                    </button>
                    {!b.open && <span className="profile-muted"> (closed)</span>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {inspect && (
            <InspectPanel title="Inspect">
              <dl className="profile-facts">
                <dt>Purse</dt>
                <dd>{profile.inspect.coin} coin</dd>
                {profile.inspect.weeksOfFood !== null && (
                  <>
                    <dt>Bread it buys</dt>
                    <dd>{profile.inspect.weeksOfFood} weeks for the household at today&apos;s price</dd>
                  </>
                )}
                <dt>Hunger tally</dt>
                <dd>
                  {profile.inspect.hungerDays} (they leave at {profile.inspect.hungerDaysToLeave})
                </dd>
                <dt>Destitute since</dt>
                <dd>
                  {profile.inspect.destituteSinceTick === null
                    ? '—'
                    : `${formatDate(uiApi, profile.inspect.destituteSinceTick)} (they leave after ${profile.inspect.destituteDaysToLeave} days)`}
                </dd>
                {profile.inspect.departedAtTick !== null && (
                  <>
                    <dt>Left</dt>
                    <dd>{formatDate(uiApi, profile.inspect.departedAtTick)}</dd>
                  </>
                )}
              </dl>
              <h4>Kept at home</h4>
              <InventoryList lines={profile.inspect.inventory} empty="Nothing put by." />
            </InspectPanel>
          )}
        </>
      )}
    </section>
  );
}
