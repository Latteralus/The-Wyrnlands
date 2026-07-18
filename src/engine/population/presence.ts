import { getCompany } from '../companies/companies';
import { getEntityName } from '../entities';
import { getActiveEmployment, getJobSlot } from '../jobs/jobs';
import { getHousehold, getHouseholdIdForMember, listAllHouseholdMemberIds } from './households';
import type { Database } from 'sql.js';

export interface PresentEntity {
  entityId: string;
  name: string;
}

// A cheap, stable per-entity "coin flip" — no seeded-RNG stream involvement.
// §4.2's determinism guarantee is about simulation *state*; this is a
// cosmetic, side-effect-free lookup that must just be stable across repeated
// calls within the same hour, not part of any reproducibility contract.
function stableCoinFlip(entityId: string): boolean {
  let h = 0;
  for (let i = 0; i < entityId.length; i++) h = (h * 31 + entityId.charCodeAt(i)) | 0;
  return (h & 1) === 0;
}

// §5.5/§Stage 4 "hourly presence rosters": a deterministic lookup of where
// an NPC plausibly is at a given hour, not a physically simulated schedule.
// This is the "regional LOD" half of Stage 4 — NPCs don't run the player's
// per-tick action-queue machinery (see cadence.ts's header comment for why
// that doesn't scale past a handful of entities), so presence is derived on
// demand from employment + household rather than tracked as literal
// moment-to-moment state.
function scheduledSiteId(db: Database, entityId: string, hourOfDay: number): string | null {
  const householdId = getHouseholdIdForMember(db, entityId);
  const household = householdId ? getHousehold(db, householdId) : null;
  const homeSiteId = household?.homeSiteId ?? null;

  if (hourOfDay >= 6 && hourOfDay < 18) {
    const employment = getActiveEmployment(db, entityId);
    const jobSlot = employment ? getJobSlot(db, employment.jobSlotId) : null;
    const company = jobSlot ? getCompany(db, jobSlot.companyId) : null;
    return company?.siteId ?? homeSiteId;
  }

  if (hourOfDay >= 18 && hourOfDay < 21) {
    return stableCoinFlip(entityId) ? 'tavern' : homeSiteId;
  }

  return homeSiteId;
}

// §14.2 location panels' "presence roster." Cheap enough to call on render
// (O(NPC count), ~40 at Stage 4 scale) — not something the per-tick cadence
// touches.
export function listPresentEntities(db: Database, siteId: string, hourOfDay: number): PresentEntity[] {
  const present: PresentEntity[] = [];
  for (const entityId of listAllHouseholdMemberIds(db)) {
    if (scheduledSiteId(db, entityId, hourOfDay) === siteId) {
      present.push({ entityId, name: getEntityName(db, entityId) });
    }
  }
  return present;
}
