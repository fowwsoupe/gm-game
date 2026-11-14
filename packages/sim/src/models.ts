import { rulesGoalModel, type GoalModel } from './game';
import { noDevelopment, type DevelopmentModel } from './players';
import { naiveValuator, type PlayerValuator } from './value';

/**
 * Every swappable "brain" in one place. Rules-based defaults today; ML models trained in
 * /ml (ONNX) implement the same interfaces and are injected here by the app.
 * Compare a new model against the default with a fixed seed in the balance lab before switching.
 */
export interface Models {
  goal: GoalModel;
  development: DevelopmentModel;
  valuation: PlayerValuator;
}

export const defaultModels: Models = {
  goal: rulesGoalModel,
  development: noDevelopment,
  valuation: naiveValuator,
};
