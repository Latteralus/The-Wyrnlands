import type { Migration } from './types';

export const migration_0012_company_closure: Migration = {
  id: '0012_company_closure',
  up: `
    -- §9.6 "permanent failure -> auction": the tick a company closed for
    -- good, or null while still operating. Set by companies/decisions.ts's
    -- tryCloseCompany once a company has stayed insolvent past its
    -- Management-weighted grace period.
    ALTER TABLE companies ADD COLUMN closed_at_tick INTEGER;
  `,
};
