from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import tensorflow as tf


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(description="Train plant disease classifier from image folders")
	parser.add_argument("--dataset-dir", required=True, help="Directory with class subfolders of images")
	parser.add_argument("--output-model", default="backend/models/plant_disease_prediction_model.h5")
	parser.add_argument("--output-labels", default="backend/models/class_labels.json")
	parser.add_argument("--output-metadata", default="backend/models/disease_model_metadata.json")
	parser.add_argument("--img-size", type=int, default=224)
	parser.add_argument("--batch-size", type=int, default=32)
	parser.add_argument("--epochs", type=int, default=10)
	parser.add_argument("--validation-split", type=float, default=0.2)
	parser.add_argument("--seed", type=int, default=42)
	return parser.parse_args()


def build_model(img_size: int, num_classes: int) -> tf.keras.Model:
	model = tf.keras.Sequential(
		[
			tf.keras.layers.Input(shape=(img_size, img_size, 3)),
			tf.keras.layers.Rescaling(1.0 / 255.0),
			tf.keras.layers.Conv2D(32, 3, activation="relu"),
			tf.keras.layers.MaxPooling2D(),
			tf.keras.layers.Conv2D(64, 3, activation="relu"),
			tf.keras.layers.MaxPooling2D(),
			tf.keras.layers.Conv2D(128, 3, activation="relu"),
			tf.keras.layers.MaxPooling2D(),
			tf.keras.layers.Flatten(),
			tf.keras.layers.Dense(256, activation="relu"),
			tf.keras.layers.Dropout(0.3),
			tf.keras.layers.Dense(num_classes, activation="softmax"),
		]
	)
	model.compile(
		optimizer="adam",
		loss="sparse_categorical_crossentropy",
		metrics=["accuracy"],
	)
	return model


def main() -> None:
	args = parse_args()

	dataset_dir = Path(args.dataset_dir)
	if not dataset_dir.exists():
		raise FileNotFoundError(f"Dataset directory not found: {dataset_dir}")

	train_ds = tf.keras.utils.image_dataset_from_directory(
		dataset_dir,
		validation_split=args.validation_split,
		subset="training",
		seed=args.seed,
		image_size=(args.img_size, args.img_size),
		batch_size=args.batch_size,
	)
	val_ds = tf.keras.utils.image_dataset_from_directory(
		dataset_dir,
		validation_split=args.validation_split,
		subset="validation",
		seed=args.seed,
		image_size=(args.img_size, args.img_size),
		batch_size=args.batch_size,
	)

	class_names = list(train_ds.class_names)
	model = build_model(args.img_size, len(class_names))

	history = model.fit(train_ds, validation_data=val_ds, epochs=args.epochs, verbose=1)
	val_loss, val_accuracy = model.evaluate(val_ds, verbose=0)

	output_model = Path(args.output_model)
	output_labels = Path(args.output_labels)
	output_metadata = Path(args.output_metadata)
	output_model.parent.mkdir(parents=True, exist_ok=True)

	model.save(output_model)
	output_labels.write_text(json.dumps(class_names, indent=2), encoding="utf-8")

	metadata = {
		"model_type": "tensorflow_cnn_disease_classifier",
		"trained_at_utc": datetime.now(timezone.utc).isoformat(),
		"dataset_dir": str(dataset_dir),
		"class_count": len(class_names),
		"class_labels_path": str(output_labels),
		"image_size": args.img_size,
		"batch_size": args.batch_size,
		"epochs": args.epochs,
		"validation_split": args.validation_split,
		"metrics": {
			"val_loss": float(val_loss),
			"val_accuracy": float(val_accuracy),
		},
		"history": {
			"loss": [float(v) for v in history.history.get("loss", [])],
			"accuracy": [float(v) for v in history.history.get("accuracy", [])],
			"val_loss": [float(v) for v in history.history.get("val_loss", [])],
			"val_accuracy": [float(v) for v in history.history.get("val_accuracy", [])],
		},
	}
	output_metadata.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

	print(f"Saved disease model: {output_model}")
	print(f"Saved labels: {output_labels}")
	print(f"Saved metadata: {output_metadata}")


if __name__ == "__main__":
	main()