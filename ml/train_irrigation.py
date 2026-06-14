from __future__ import annotations

import argparse
import json
import pickle
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from sklearn.ensemble import RandomForestClassifier


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train smart irrigation recommendation model")
    parser.add_argument("--csv", required=True, help="Path to irrigation training CSV")
    parser.add_argument(
        "--output-model",
        default="backend/models/irrigation_model.pkl",
        help="Path to write trained irrigation model",
    )
    parser.add_argument(
        "--output-metadata",
        default="backend/models/irrigation_model_metadata.json",
        help="Path to write irrigation model metadata JSON",
    )
    parser.add_argument("--target", default="irrigation", help="Target column name in CSV")
    parser.add_argument("--n-estimators", type=int, default=200, help="Random forest tree count")
    parser.add_argument("--max-depth", type=int, default=8, help="Max tree depth")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    csv_path = Path(args.csv).resolve()
    if not csv_path.exists():
      raise FileNotFoundError(f"Dataset CSV not found at {csv_path}")

    data = pd.read_csv(csv_path)
    if args.target not in data.columns:
      raise ValueError(f"Target column '{args.target}' not found in dataset")

    features = data.drop(columns=[args.target])
    target = data[args.target]
    encoded_features = pd.get_dummies(features)

    model = RandomForestClassifier(
        n_estimators=args.n_estimators,
        max_depth=args.max_depth,
        random_state=args.seed,
    )
    model.fit(encoded_features, target)

    model_path = Path(args.output_model).resolve()
    model_path.parent.mkdir(parents=True, exist_ok=True)
    with model_path.open("wb") as handle:
        pickle.dump(model, handle)

    metadata = {
        "model_type": "RandomForestClassifier",
        "trained_at_utc": datetime.now(timezone.utc).isoformat(),
        "dataset_csv": str(csv_path),
        "target_column": args.target,
        "feature_columns": list(features.columns),
        "encoded_feature_columns": list(encoded_features.columns),
        "row_count": int(len(data)),
        "class_labels": sorted({int(value) for value in target.tolist()}),
        "hyperparameters": {
            "n_estimators": args.n_estimators,
            "max_depth": args.max_depth,
            "random_state": args.seed,
        },
    }

    metadata_path = Path(args.output_metadata).resolve()
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print(f"Saved irrigation model to {model_path}")
    print(f"Saved irrigation metadata to {metadata_path}")


if __name__ == "__main__":
    main()
