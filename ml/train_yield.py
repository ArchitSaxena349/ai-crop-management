from __future__ import annotations

import argparse
import json
import pickle
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from xgboost import XGBRegressor


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(description="Train crop yield regressor")
	parser.add_argument("--csv", required=True, help="Path to CSV dataset")
	parser.add_argument("--target", default="Yield", help="Target column name")
	parser.add_argument("--output-model", default="backend/models/yield_model.pkl")
	parser.add_argument("--output-metadata", default="backend/models/yield_model_metadata.json")
	parser.add_argument("--test-size", type=float, default=0.2)
	parser.add_argument("--seed", type=int, default=42)
	parser.add_argument("--n-estimators", type=int, default=300)
	parser.add_argument("--max-depth", type=int, default=6)
	parser.add_argument("--learning-rate", type=float, default=0.05)
	return parser.parse_args()


def rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
	return float(np.sqrt(np.mean(np.square(y_true - y_pred))))


def mae(y_true: np.ndarray, y_pred: np.ndarray) -> float:
	return float(np.mean(np.abs(y_true - y_pred)))


def r2_score(y_true: np.ndarray, y_pred: np.ndarray) -> float:
	ss_res = float(np.sum(np.square(y_true - y_pred)))
	ss_tot = float(np.sum(np.square(y_true - np.mean(y_true))))
	if ss_tot == 0:
		return 0.0
	return 1.0 - (ss_res / ss_tot)


def train_test_split_indices(size: int, test_size: float, seed: int) -> tuple[np.ndarray, np.ndarray]:
	rng = np.random.default_rng(seed)
	indices = np.arange(size)
	rng.shuffle(indices)
	test_count = max(1, int(round(size * test_size)))
	test_idx = indices[:test_count]
	train_idx = indices[test_count:]
	return train_idx, test_idx


def main() -> None:
	args = parse_args()

	frame = pd.read_csv(args.csv)
	if args.target not in frame.columns:
		raise ValueError(f"Target column '{args.target}' not found in {args.csv}")

	numeric_frame = frame.select_dtypes(include=["number"]).copy()
	if args.target not in numeric_frame.columns:
		raise ValueError(f"Target column '{args.target}' must be numeric")

	feature_cols = [col for col in numeric_frame.columns if col != args.target]
	if not feature_cols:
		raise ValueError("No numeric feature columns available for training")

	cleaned = numeric_frame[feature_cols + [args.target]].dropna().reset_index(drop=True)
	if len(cleaned) < 10:
		raise ValueError("Dataset is too small after dropping missing rows")

	X = cleaned[feature_cols]
	y = cleaned[args.target].to_numpy(dtype=float)

	train_idx, test_idx = train_test_split_indices(len(cleaned), args.test_size, args.seed)
	X_train = X.iloc[train_idx]
	y_train = y[train_idx]
	X_test = X.iloc[test_idx]
	y_test = y[test_idx]

	model = XGBRegressor(
		n_estimators=args.n_estimators,
		max_depth=args.max_depth,
		learning_rate=args.learning_rate,
		objective="reg:squarederror",
		random_state=args.seed,
		n_jobs=1,
	)
	model.fit(X_train, y_train)
	preds = model.predict(X_test)

	output_model = Path(args.output_model)
	output_metadata = Path(args.output_metadata)
	output_model.parent.mkdir(parents=True, exist_ok=True)

	with output_model.open("wb") as handle:
		pickle.dump(model, handle)

	metadata = {
		"model_type": "xgboost_regressor_yield",
		"trained_at_utc": datetime.now(timezone.utc).isoformat(),
		"dataset_csv": str(Path(args.csv).resolve()),
		"target_column": args.target,
		"feature_columns": feature_cols,
		"rows_total": int(len(cleaned)),
		"rows_train": int(len(train_idx)),
		"rows_test": int(len(test_idx)),
		"params": {
			"n_estimators": args.n_estimators,
			"max_depth": args.max_depth,
			"learning_rate": args.learning_rate,
			"seed": args.seed,
		},
		"metrics": {
			"rmse": rmse(y_test, preds),
			"mae": mae(y_test, preds),
			"r2": r2_score(y_test, preds),
		},
	}
	output_metadata.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

	print(f"Saved yield model: {output_model}")
	print(f"Saved metadata: {output_metadata}")


if __name__ == "__main__":
	main()