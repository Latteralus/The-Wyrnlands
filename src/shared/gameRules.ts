// Pure game data and formulas the interface needs to display the world —
// calendar arithmetic, skill levels, the goods catalog, action labels. Each
// comes from a leaf engine module with no database or simulation code, so
// the renderer bundle carries none (src/shared/boundary.test.ts checks).
export { deriveCalendar, MINUTES_PER_DAY, type Calendar, type Season } from '../engine/time/clock';
export { IMPLEMENTED_SKILLS, MAX_SKILL_LEVEL, getXpForSkillLevel } from '../engine/skills/skillLevels';
export { listGoodDefinitions, type GearSlot } from '../engine/goods/catalog';
export { actionLabel, type MarketTradeKind, type MarketTradeRequest } from '../engine/market/tradeTypes';
