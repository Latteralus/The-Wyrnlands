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

const LOCATION_CONTENT: Record<string, LocationContent> = {
  well: {
    icon: '💧',
    description: 'A stone well ringed with mossy cobbles; the bucket-rope creaks in the wind.',
    actions: [{ type: 'draw_water', label: 'Draw water' }],
  },
  tavern: {
    icon: '🍺',
    description: 'Low beams, a smoky hearth, and the murmur of the few patrons who can afford a drink.',
    actions: [{ type: 'rest', label: 'Rest awhile' }],
  },
  notice_board: {
    icon: '📋',
    description: 'A weathered board nailed to a post, pinned with notices old and new.',
    actions: [{ type: 'read_notices', label: 'Read the notices' }],
  },
  forest: {
    icon: '🌲',
    description: 'The tree line presses close, dense with timber and shadow.',
    actions: [{ type: 'chop_wood', label: 'Chop wood' }],
  },
};

export function getLocationContent(kind: string): LocationContent {
  return LOCATION_CONTENT[kind] ?? DEFAULT_CONTENT;
}
