import { rulesDevelopment, type DevelopmentModel } from './players';
import { HOCKEY_DEVELOPMENT } from './sports';
import {
  surplusValuator,
  rulesContractDemand,
  type ContractDemandModel,
  type PlayerValuator,
} from './value';

/**
 * Swappable "brains" shared by every sport. The rules-based defaults are the shipping engine
 * (ADR 0005); /ml calibrates their numbers. An optional trained table (docs/MODEL_CONTRACTS.md)
 * implements the same interface and is injected here by the app.
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
  valuation: surplusValuator,
  contractDemand: rulesContractDemand,
};
