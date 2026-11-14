import { noDevelopment, type DevelopmentModel } from './players';
import { naiveValuator, type PlayerValuator } from './value';

/**
 * Swappable "brains" shared by every sport. Rules-based defaults today; ML models trained
 * in /ml (ONNX) implement the same interfaces and are injected here by the app.
 * Sport-specific models (e.g. hockey's GoalModel) are passed to the sport module instead.
 * Compare a new model against the default with a fixed seed in the balance lab before switching.
 */
export interface Models {
  development: DevelopmentModel;
  valuation: PlayerValuator;
}

export const defaultModels: Models = {
  development: noDevelopment,
  valuation: naiveValuator,
};
