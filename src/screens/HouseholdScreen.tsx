import { SceneHeader } from '../components/SceneHeader';
import type { UiApi } from '../engine/ui-api';

interface HouseholdScreenProps {
  uiApi: UiApi;
  householdId: string;
  onBack: () => void;
  onSelectNpc: (entityId: string) => void;
}

// §14.2 Household screen: "members, budget, reserves, obligations." No
// rent/housing-ladder module exists yet (§12 is a later stage), so
// "obligations" isn't rendered as its own section rather than showing an
// empty placeholder for a mechanic that doesn't exist yet.
export function HouseholdScreen({ uiApi, householdId, onBack, onSelectNpc }: HouseholdScreenProps) {
  const calendar = uiApi.getCalendar();
  const household = uiApi.getHousehold(householdId);
  const members = uiApi.listHouseholdMembers(householdId);
  const balance = uiApi.getBalance(householdId);

  return (
    <section>
      <SceneHeader icon="🏠" title={household?.name ?? 'Unknown Household'} calendar={calendar} />

      <button type="button" className="back-button" onClick={onBack}>
        ← Back
      </button>

      <p className="household-reserve">Reserves: {balance} coin</p>

      <h3>Members</h3>
      <ul className="household-members">
        {members.map((entityId) => {
          const entity = uiApi.getEntity(entityId);
          const employment = uiApi.getEmployment(entityId);
          return (
            <li key={entityId}>
              <button type="button" onClick={() => onSelectNpc(entityId)}>
                {entity?.name ?? entityId}
              </button>
              <span className="household-member-status">{employment ? ' employed' : ' unemployed'}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
