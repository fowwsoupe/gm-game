# ml/

Python is used for **training only**. The shipped game never runs Python.

```
ml/
  data/raw/         # downloaded historical data (git-ignored)
  data/processed/   # cleaned features (git-ignored)
  notebooks/        # exploration
  src/              # training scripts
../models/          # exported .onnx files the game loads (committed, keep them small)
```

## Workflow

1. Pull historical NHL data into `data/raw/`.
2. Build features in `src/` from the same fields the game has (the ratings in
   `packages/shared/src/domain.ts`). If a model needs something the game doesn't track,
   it can't be used in-game.
3. Train (scikit-learn / XGBoost / PyTorch), then export to ONNX into `../models/`.
4. In the game, load the model with `onnxruntime-node` in the main process and implement
   the `GoalModel` interface (or a new one) from `@gm/sim`.

## Good first models

- Expected goals per shot (shot quality)
- Player development / aging curves
- Player value for AI trade and contract logic

Keep the rules-based sim as the fallback, and compare every model against it with a
fixed seed before switching.

## Setup

```bash
cd ml
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
```
