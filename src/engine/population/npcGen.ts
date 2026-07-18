import { getGoodDefinition } from '../goods/catalog';
import { withOptional } from '../optional';
import type { Engine } from '../engine';

// §5.3 "First Playable: one town (~40-80 persistent NPCs)." Placeholder name
// pools (§14.1's "placeholder... wired" precedent) — a real writing pass is
// a budgeted deliverable, not this stage's job.
const FIRST_NAMES = [
  'Alda',
  'Bram',
  'Cedric',
  'Della',
  'Edda',
  'Finn',
  'Greta',
  'Hob',
  'Ida',
  'Jorik',
  'Katla',
  'Leof',
  'Mira',
  'Nils',
  'Osla',
  'Perrin',
  'Quenna',
  'Rurik',
  'Sela',
  'Tomas',
];
const SURNAMES = [
  'Ashford',
  'Brackwater',
  'Cotter',
  'Dunmoor',
  'Elderby',
  'Fenwick',
  'Greaves',
  'Hollow',
  'Ives',
  'Kestrel',
  'Longmarsh',
  'Miller',
  'Norrow',
  'Oster',
  'Pryce',
  'Redmoor',
  'Stonebridge',
  'Thistledown',
  'Underhill',
  'Wren',
];

const STARTING_RESERVE = 80; // placeholder "modest family savings" — real rolled starting conditions are Stage 5 (§5.4)
const SPARE_CLOAK_CHANCE = 0.4; // gives the adaptation ladder's "sell belongings" rung something real to bite on

function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('pick() called with an empty list');
  return item;
}

export interface GenerateNpcPopulationOptions {
  householdCount: number;
  minMembersPerHousehold: number;
  maxMembersPerHousehold: number;
  // Stage 4 has exactly one settlement (§5.3) — every household's home site
  // is the same until Stage 7 introduces a second one.
  homeSiteId: string;
  // Job slot ids to fill, one entry per opening (e.g. a capacity-2 slot
  // appears twice). Filled greedily in generation order — deliberately not
  // every NPC gets one (§14.4's "crowded labor market" is a feature).
  jobSlotIdsToFill: string[];
}

// §Stage 4: "~40 NPCs in households." Deterministic for a given engine seed
// (uses engine.nextRandom(), the same seeded RNG stream as everything else
// — §4.2's "same DB + same seed = same result").
export function generateNpcPopulation(engine: Engine, options: GenerateNpcPopulationOptions): void {
  const rng = () => engine.nextRandom();
  let personIndex = 0;
  let jobIndex = 0;

  for (let h = 0; h < options.householdCount; h++) {
    const householdId = `household-${h}`;
    const surname = pick(rng, SURNAMES);
    const size =
      options.minMembersPerHousehold +
      Math.floor(rng() * (options.maxMembersPerHousehold - options.minMembersPerHousehold + 1));

    engine.createHousehold({
      id: householdId,
      name: `The ${surname} Household`,
      homeSiteId: options.homeSiteId,
    });
    engine.faucetCoin(householdId, STARTING_RESERVE, 'Modest family savings.', 'business');

    if (rng() < SPARE_CLOAK_CHANCE) {
      engine.produceItem(
        withOptional(
          {
            id: `${householdId}-spare-cloak`,
            type: 'cloak',
            containerId: householdId,
            note: 'A spare cloak, kept against harder times.',
            scope: 'business' as const,
          },
          { durability: getGoodDefinition('cloak').maxDurability },
        ),
      );
    }

    for (let m = 0; m < size; m++) {
      const entityId = `npc-${personIndex++}`;
      const name = `${pick(rng, FIRST_NAMES)} ${surname}`;
      engine.createEntity(entityId, name);
      engine.ensureNeeds(entityId);
      engine.addHouseholdMember(householdId, entityId);

      if (jobIndex < options.jobSlotIdsToFill.length) {
        const jobSlotId = options.jobSlotIdsToFill[jobIndex++];
        if (jobSlotId) {
          engine.applyForJob(entityId, jobSlotId, { haggle: rng() < 0.5, scope: 'settlement' });
        }
      }
    }
  }
}
