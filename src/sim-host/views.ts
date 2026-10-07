import { createUiApi, type UiApi } from '../engine/ui-api';
import type { Engine } from '../engine/engine';
import type {
  BusinessTypeInfo,
  BusinessView,
  CharacterView,
  FoundingView,
  HomeView,
  HudView,
  JobsView,
  LocationView,
  MarketView,
  ParamsOf,
  ResultOf,
  SettlementView,
  ViewName,
} from '../shared/protocol';

// Builds the renderer's view snapshots from the running Engine, inside the
// simulation process. Each view gathers everything one screen shows in a
// single pass over the database — the replacement for screens calling
// dozens of synchronous UiApi getters while rendering. Read-only: no view
// writes to the database or draws from the RNG.

type ViewBuilders = { [V in ViewName]: (params: ParamsOf<V>) => ResultOf<V> };

export function createViewBuilders(engine: Engine): ViewBuilders {
  const api: UiApi = createUiApi(engine);
  const player = () => api.getPlayerEntityId();

  const hud = (): HudView => {
    const id = player();
    return {
      calendar: api.getCalendar(),
      tick: api.getTick(),
      balance: api.getBalance(id),
      needs: api.getNeeds(id),
      wornGear: api.getWornGear(id),
      activeActions: api.getActiveActions(id),
    };
  };

  const character = (): CharacterView => {
    const profile = api.getPlayerProfile();
    return {
      profile,
      currentAction: api.getCurrentAction(profile.id),
      routine: api.getPlayerRoutinePreferences(),
      history: api.queryActorLog(profile.id, 40),
    };
  };

  const home = (): HomeView | null => {
    const playerHome = api.getPlayerHome();
    if (!playerHome) return null;
    return {
      home: playerHome,
      routine: api.getPlayerRoutinePreferences(),
      purse: api.getBalance(player()),
      lodgingName: api.getSite(playerHome.household.homeSiteId ?? 'tavern')?.name ?? null,
    };
  };

  const settlement = (): SettlementView => ({
    sites: api.listSites(),
    households: api.listHouseholds(),
    companies: api.listCompanies(),
  });

  const location = ({ siteId }: { siteId: string }): LocationView | null => {
    const site = api.getSite(siteId);
    if (!site) return null;
    return {
      site,
      listings: api.listMarketListings(site.id),
      present: api.listPresentEntities(site.id),
      holder: site.landValue ? api.getSiteHolder(site.id) : null,
    };
  };

  const jobs = (): JobsView => ({
    openings: api.listJobOpenings().map((slot) => ({
      ...slot,
      vacancies: Math.max(0, slot.capacity - api.countActiveEmploymentsForSlot(slot.id)),
    })),
    employment: api.getEmployment(player()),
  });

  const business = ({ companyId }: { companyId: string }): BusinessView | null => {
    const profile = api.getBusinessProfile(companyId);
    const company = api.getCompany(companyId);
    if (!profile || !company) return null;
    const id = player();
    const playerJob = api.getEmployment(id);
    return {
      profile,
      company,
      slots: api
        .listJobSlotsForCompany(companyId)
        .map((slot) => ({ ...slot, filled: api.countActiveEmploymentsForSlot(slot.id) })),
      // §14.3 "Business logs (the ledger as narrative)".
      log: api.queryActorLog(companyId, 40),
      playerJob,
      playerJobCompanyName: playerJob ? (api.getCompany(playerJob.companyId)?.name ?? null) : null,
      ownBooks: company.ownerId === id || company.managerId === id,
    };
  };

  const market = ({ siteId }: { siteId: string }): MarketView => ({
    overview: api.getMarketOverview(siteId, player()),
    balance: api.getBalance(player()),
  });

  const founding = ({ typeId, siteId, tenure, inputs }: ParamsOf<'view.founding'>): FoundingView => {
    const types: BusinessTypeInfo[] = api.listBusinessTypes().map((t) => ({
      id: t.id,
      siteKind: t.siteKind,
      skill: t.skill,
      jobTitle: t.jobTitle,
      toolGoodType: t.toolGoodType,
      wageMin: t.wageMin,
      wageMax: t.wageMax,
      startingMaxPositions: t.startingMaxPositions,
      inputGood: t.inputGood,
      minimumInputUnits: t.minimumInputUnits,
    }));
    const type = types.find((t) => t.id === typeId) ?? types[0];
    const sites = api
      .listSites()
      .filter(
        (site) => site.kind === type?.siteKind && site.landValue !== null && !api.getSiteHolder(site.id),
      );
    const chosen = sites.find((site) => site.id === siteId) ?? sites[0];
    const outlay =
      chosen && type
        ? api.estimatePlayerBusinessStartup(type.id, chosen.id, tenure, type.inputGood ? inputs : 0)
        : null;
    return {
      types,
      typeId: type?.id ?? null,
      sites,
      chosenSiteId: chosen?.id ?? null,
      outlay,
      balance: api.getBalance(player()),
      owned: api
        .getPlayerProfile()
        .businesses.filter((b) => b.role === 'owner')
        .map((b) => ({ companyId: b.companyId, companyName: b.companyName, open: b.open })),
      inputAvailable: type?.inputGood
        ? (api.listMarketListings('market').find((l) => l.goodType === type.inputGood)?.quantity ?? 0)
        : 0,
    };
  };

  return {
    'view.hud': hud,
    'view.log': ({ scope, limit }) => api.queryLog(scope, limit),
    'view.character': character,
    'view.home': home,
    'view.settlement': settlement,
    'view.location': location,
    'view.jobs': jobs,
    'view.person': ({ entityId }) => (api.getEntity(entityId) ? api.getPersonProfile(entityId) : null),
    'view.household': ({ householdId }) => api.getHouseholdProfile(householdId),
    'view.business': business,
    'view.market': market,
    'view.marketHistory': ({ siteId, goodType, windowDays }) =>
      api.getMarketHistory(siteId, goodType, windowDays),
    'view.marketActivity': ({ siteId, filter }) => api.queryMarketActivity(siteId, filter),
    'view.founding': founding,
  };
}
