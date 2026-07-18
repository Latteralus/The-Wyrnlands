import { SceneHeader } from '../components/SceneHeader';
import type { Needs, UiApi } from '../engine/ui-api';

interface NpcProfileScreenProps {
  uiApi: UiApi;
  entityId: string;
  onBack: () => void;
  onSelectHousehold: (householdId: string) => void;
}

function describeCondition(needs: Needs | null): string {
  if (!needs) return 'No word on their condition.';
  const worst = Math.min(needs.hunger, needs.thirst, needs.energy, needs.warmth);
  if (worst >= 70) return 'They look well and in good spirits.';
  if (worst >= 40) return 'They look a little worn, but managing.';
  return 'They look gaunt and worn down.';
}

// §11.2 NPC Profile Screen: "Portrait, occupation and employer, household,
// visible condition, public job history... reputation (later)." Portrait is
// a placeholder icon (§14.1 — real portraits are a budgeted art pass, not
// this stage's job); job history is just the current position — permanent
// history and reputation are Stage 8's "later."
export function NpcProfileScreen({ uiApi, entityId, onBack, onSelectHousehold }: NpcProfileScreenProps) {
  const calendar = uiApi.getCalendar();
  const entity = uiApi.getEntity(entityId);
  const needs = uiApi.getNeeds(entityId);
  const employment = uiApi.getEmployment(entityId);
  const jobSlot = employment ? uiApi.listJobOpenings().find((j) => j.id === employment.jobSlotId) : undefined;
  const householdId = uiApi.getHouseholdIdForMember(entityId);
  const household = householdId ? uiApi.getHousehold(householdId) : null;

  return (
    <section>
      <SceneHeader icon="🧑" title={entity?.name ?? entityId} calendar={calendar} />

      <button type="button" className="back-button" onClick={onBack}>
        ← Back
      </button>

      <p className="npc-condition">{describeCondition(needs)}</p>

      <h3>Occupation</h3>
      {jobSlot && employment ? (
        <p>
          {jobSlot.title} at {jobSlot.companyName} — {employment.wage} coin/shift, level{' '}
          {uiApi.getSkillLevel(entityId, jobSlot.skill)} {jobSlot.skill}
        </p>
      ) : (
        <p className="npc-unemployed">Unemployed.</p>
      )}

      <h3>Household</h3>
      {household ? (
        <button type="button" onClick={() => onSelectHousehold(household.id)}>
          {household.name} →
        </button>
      ) : (
        <p>No household on record.</p>
      )}
    </section>
  );
}
