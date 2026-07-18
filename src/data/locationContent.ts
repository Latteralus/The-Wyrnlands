// Placeholder location content (§14.1 "placeholder illustrations... wired").
// Real illustrations/atmospheric-writing passes are budgeted deliverables
// (§14.1, §18 "Writing workload") — this is the wiring, not the final prose.

export interface LocationAction {
  type: string;
  label: string;
}

export interface LocationContent {
  icon: string;
  description: string;
  actions: LocationAction[];
}

const DEFAULT_CONTENT: LocationContent = {
  icon: '📍',
  description: 'A place like any other, waiting for its story.',
  actions: [],
};

// Available everywhere, not tied to a specific site kind (§6 shelter ladder's
// free bottom rung; eating doesn't require a location either).
const UNIVERSAL_ACTIONS: LocationAction[] = [
  { type: 'eat', label: 'Eat (from your pack)' },
  { type: 'rest_rough', label: 'Rest here (rough)' },
];

const LOCATION_CONTENT: Record<string, Omit<LocationContent, 'actions'> & { actions: LocationAction[] }> = {
  well: {
    icon: '💧',
    description: 'A stone well ringed with mossy cobbles; the bucket-rope creaks in the wind.',
    actions: [{ type: 'draw_water', label: 'Draw water' }],
  },
  tavern: {
    icon: '🍺',
    description: 'Low beams, a smoky hearth, and the murmur of the few patrons who can afford a drink.',
    actions: [{ type: 'rest_bunk', label: 'Pay for a bunk' }],
  },
  notice_board: {
    icon: '📋',
    description: 'A weathered board nailed to a post, pinned with notices old and new.',
    actions: [{ type: 'read_notices', label: 'Read the notices' }],
  },
  // §Stage 4: the logging camp's work_shift action lives here too — it
  // works out of this same forest site rather than a separate location.
  forest: {
    icon: '🌲',
    description: 'The tree line presses close, dense with timber and shadow.',
    actions: [
      { type: 'chop_wood', label: 'Chop wood' },
      { type: 'work_shift_hollows_edge_logging_woodcutter', label: 'Work a shift (logging camp)' },
    ],
  },
  market: {
    icon: '🧺',
    description: 'A stall of baskets and bolts, the seller calling prices over the crowd.',
    actions: [
      { type: 'buy_bread', label: 'Buy bread' },
      { type: 'buy_shoes', label: 'Buy shoes' },
      { type: 'buy_cloak', label: 'Buy a cloak' },
      { type: 'sell_firewood', label: 'Sell firewood' },
    ],
  },
  // §Stage 3: the action type is tied to the specific job slot the demo
  // world seeds (oster_farm_farmhand) — same precedent as market's
  // buy_<good>/sell_<good> actions being tied to the specific seeded stall.
  farm: {
    icon: '🌾',
    description:
      'Rows of tilled earth stretch toward the tree line; the farmhouse smoke curls into a grey sky.',
    actions: [{ type: 'work_shift_oster_farm_farmhand', label: 'Work a shift' }],
  },
};

export function getLocationContent(kind: string): LocationContent {
  const base = LOCATION_CONTENT[kind] ?? DEFAULT_CONTENT;
  return { ...base, actions: [...base.actions, ...UNIVERSAL_ACTIONS] };
}
