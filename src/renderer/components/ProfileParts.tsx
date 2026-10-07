import { capitalize } from './profileFormat';
import type { InventoryLine, Relation, SkillRecord } from '../../shared/protocol';
import type { ReactNode } from 'react';

// Shared pieces of the person / household / business profiles.

export interface ProfileNavigation {
  onSelectNpc: (entityId: string) => void;
  onSelectHousehold: (householdId: string) => void;
  onSelectBusiness: (companyId: string) => void;
}

// Inspect mode: shows what a townsperson couldn't plausibly know (exact
// coin, belongings, traits, a business's books). The setting lives in
// App.tsx so it survives moving between screens.
export function InspectToggle({ inspect, onToggle }: { inspect: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`inspect-toggle${inspect ? ' is-on' : ''}`}
      aria-pressed={inspect}
      onClick={onToggle}
      title="Show everything the simulation knows, not just what a townsperson would"
    >
      {inspect ? '🔍 Inspect: on' : '🔍 Inspect'}
    </button>
  );
}

export function InspectPanel({
  title,
  children,
  privateKnowledge = true,
}: {
  title: string;
  children: ReactNode;
  privateKnowledge?: boolean;
}) {
  return (
    <section className="inspect-panel">
      <h3>
        {title} {privateKnowledge && <span className="inspect-panel-note">— not public knowledge</span>}
      </h3>
      {children}
    </section>
  );
}

export function InventoryList({ lines, empty }: { lines: InventoryLine[]; empty: string }) {
  if (lines.length === 0) return <p className="profile-empty">{empty}</p>;
  return (
    <ul className="profile-list">
      {lines.map((line) => (
        <li key={line.goodType}>
          {line.count} × {line.goodType}
          {line.conditionPercent !== null && (
            <span className="profile-muted"> ({line.conditionPercent}% condition)</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function SkillsList({ skills, showXp }: { skills: SkillRecord[]; showXp: boolean }) {
  if (skills.length === 0) return <p className="profile-empty">No trained skills to speak of.</p>;
  return (
    <ul className="profile-list profile-skills">
      {skills.map((s) => (
        <li key={s.skill}>
          {capitalize(s.skill)} <strong>{s.level}</strong>
          {showXp && (
            <span className="profile-muted">
              {' '}
              ({s.xp} XP{s.xpToNextLevel !== null ? `, ${s.xpToNextLevel} to next` : ', mastered'})
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function RelationsList({ relations, nav }: { relations: Relation[]; nav: ProfileNavigation }) {
  if (relations.length === 0) return <p className="profile-empty">No ties on record.</p>;
  const open = (r: Relation) => {
    if (r.target === 'npc') nav.onSelectNpc(r.id);
    else if (r.target === 'household') nav.onSelectHousehold(r.id);
    else nav.onSelectBusiness(r.id);
  };
  return (
    <ul className="profile-list profile-relations">
      {relations.map((r) => (
        <li key={`${r.relation}-${r.target}-${r.id}`}>
          <span className="profile-muted">{r.relation}:</span>{' '}
          <button type="button" className="link-button" onClick={() => open(r)}>
            {r.name}
          </button>
        </li>
      ))}
    </ul>
  );
}
