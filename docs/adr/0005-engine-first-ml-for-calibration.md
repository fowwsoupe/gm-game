# 0005: Engine first; machine learning calibrates it

Status: accepted (2026-11). Narrows the model part of [0003](0003-rules-and-models-as-plugins.md).

## Context

The first plan had trained models replacing most of the rules-based "brains": player value,
pick value, contract demands, development, clustered builds, and AI GM decisions. The
rules-based versions were written as stand-ins until those models arrived.

In practice the engine versions carry the game. They are readable, they explain every AI
decision in plain words, they are tuned against real NHL targets in the balance lab, and
they are already tested over 20 simulated seasons. A trained model would add a training
pipeline, data rights for commercial use and a harder-to-explain AI, in exchange for small
gains in realism that the lab can mostly reach by tuning numbers.

## Decision

- **The rules-based engines are the shipping game**, not stand-ins. Value, pick value,
  contract demands, development, builds and AI GM behaviour are written and tuned as engine
  code in `packages/sim`.
- **Machine learning is a calibration tool.** Python in `ml/` measures real NHL data (what
  drives winning, aging curves, upset rates, pick value, contract levels) and turns it into
  _targets_ for the balance lab and _numbers_ for the engine (tuning knobs, ruleset values,
  curves). The faceoff study, the goalie-form fit and `pnpm ratings:fit` are the model for this.
- **Plug-in model tables stay possible but optional.** The interfaces in `Models`
  (`GoalModel`, `DevelopmentModel`, `PlayerValuator`, `ContractDemandModel`) and the table
  formats in [MODEL_CONTRACTS.md](../MODEL_CONTRACTS.md) stay. A trained table replaces an
  engine default only if it beats it in the lab with fixed seeds _and_ the AI can still
  explain its decisions. No feature waits on a model.

## Consequences

- The roadmap and plan no longer list "Azmi's model" as the finish line for any engine. An
  engine is done when its lab checks pass and it plays well.
- The ML track's output is mostly lab ranges, tuning values and short study reports in
  `docs/research/`, each linked from the number it changed.
- Data rights matter less for shipping: derived numbers (an average peak age, a save %
  range) are a smaller licensing question than shipped model weights. Still check each
  source's terms before using it.
- Realism gaps (for example long-run flattening) must be solved in engine code and tuning;
  no trained model is planned to fix them later.
