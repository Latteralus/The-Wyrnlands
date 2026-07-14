import type { Engine } from '../engine';

// Stage 1 (Interface Shell) has no jobs/production/needs yet — this seeds just
// enough world for every screen to have real data and a dummy timed action to
// run end-to-end (MASTERPLAN.md §Stage 1 exit test). Replaced by real rolled
// starting conditions in Stage 5 (§5.4).
export const PLAYER_ID = 'player';

export function seedDemoWorld(engine: Engine): void {
  if (engine.getSite('well')) return; // already seeded (e.g. a reloaded save)

  engine.createEntity(PLAYER_ID, 'You');
  engine.ensureWallet(PLAYER_ID);
  engine.faucetCoin(PLAYER_ID, 20, 'Started with 20 coin scraped together before leaving home.');

  engine.createSite({ id: 'well', name: 'The Village Well', kind: 'well', x: 0, y: 0 });
  engine.createSite({ id: 'tavern', name: 'The Sleeping Ox', kind: 'tavern', x: 2, y: 1 });
  engine.createSite({ id: 'notice_board', name: 'The Notice Board', kind: 'notice_board', x: 1, y: -1 });
  engine.createSite({ id: 'forest', name: "Hollow's Edge Forest", kind: 'forest', x: 5, y: 3 });

  engine.registerActionType({
    type: 'draw_water',
    durationTicks: 10,
    resolve: () => ({ success: true, message: 'You draw a bucket of cold, clean water.' }),
  });

  engine.registerActionType({
    type: 'rest',
    durationTicks: 60,
    resolve: () => ({ success: true, message: 'You rest awhile by the tavern hearth.' }),
  });

  engine.registerActionType({
    type: 'read_notices',
    durationTicks: 5,
    resolve: () => ({ success: true, message: 'You read the notices pinned to the board.' }),
  });

  engine.registerActionType({
    type: 'chop_wood',
    durationTicks: 30,
    // Unskilled labor fails outright sometimes (§4.3, §13.2) — no Woodcutting
    // skill exists yet, so this is a flat placeholder rate until Stage 2/5.
    resolve: (rng) =>
      rng() < 0.75
        ? { success: true, message: 'You fell a length of good timber.' }
        : { success: false, message: 'You misjudge the swing and ruin the cut. The timber splits wrong.' },
  });
}
