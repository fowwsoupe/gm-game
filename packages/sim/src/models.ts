import { rulesDevelopment, type DevelopmentModel } from './players';
import { HOCKEY_DEVELOPMENT } from './sports';
import {
  naiveValuator,
  rulesContractDemand,
  type ContractDemandModel,
  type PlayerValuator,
} from './value';

/**
 * Swappable "brains" shared by every sport. Rules-based defaults today; ML models trained
 * in /ml ship as data tables (docs/MODEL_CONTRACTS.md), implement the same interfaces and are
 * injected here by the app.
 * Sport-specific models (e.g. hockey's GoalModel) are passed to the sport module instead.
 * Compare a new model against the default with a fixed seed in the balance lab before switching.
 */
export interface Models {
  development: DevelopmentModel;
  valuation: PlayerValuator;
  contractDemand: ContractDemandModel;
}

export const defaultModels: Models = {
  // TODO(nba/nfl): pick the development config by sport when those sports exist.
  development: rulesDevelopment(HOCKEY_DEVELOPMENT),
  valuation: naiveValuator,
  contractDemand: rulesContractDemand,
};
