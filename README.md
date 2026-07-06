# AI-Based Crop Management System

A monorepo for an AI-assisted crop management platform. It combines deep-learning
plant-disease detection, machine-learning yield and irrigation models, IoT sensor
ingestion, and web + mobile frontends behind a single FastAPI backend.

> New here? See [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) for a condensed setup walkthrough.

---

## Features

| Capability | Endpoint | Model |
|---|---|---|
| Plant disease detection from a leaf image | `POST /predict` | TensorFlow CNN (`.h5`) |
| Crop yield prediction from NPK + weather | `POST /yield` | XGBoost (`.pkl`) |
| Smart irrigation recommendation | `POST /irrigation/recommend` | RandomForest (`.pkl`) |
| Irrigation using the latest IoT reading | `POST /irrigation/recommend-from-iot` | RandomForest (`.pkl`) |
| Integrated disease + yield in one call | `POST /predict-all` | CNN + XGBoost |
| IoT sensor ingest / latest / history | `POST /iot/sensors`, `GET /iot/sensors/latest`, `GET /iot/sensors/history` | — |
| Yield prediction from sensor context | `POST /iot/yield-predict` | XGBoost (`.pkl`) |
| Health check | `GET /health` | — |

- **Web dashboard** (KrishiKriya) and **React Native (Expo) mobile app** cover all of the above.
- **Persistence** via SQLAlchemy (SQLite locally, PostgreSQL in production) with Alembic migrations.
- **API-key auth** on all prediction and IoT routes.
- **ESP8266 firmware** for real moisture/temperature/humidity sensing.

---

## Repository layout

```
ai-crop-management/
├── backend/            FastAPI service, inference code, and model artifacts
│   ├── app/
│   │   ├── core/       DB setup (db.py) and API security (security.py)
│   │   ├── routers/    Feature endpoints (disease, yield, integrated, irrigation, iot, health)
│   │   ├── services/   Inference logic (image, yield, irrigation) + model registry
│   │   └── main.py     App entrypoint, router wiring, CORS, startup
│   ├── models/         Deployed model artifacts + label/metadata sidecars
│   ├── alembic/        Database migrations
│   └── requirements.txt
├── frontend/           KrishiKriya browser dashboard (static HTML/CSS/JS)
├── mobile/             Expo (React Native) app
├── ml/                 Training scripts + datasets
├── iot/                ESP8266 firmware (esp8266_moisture_dht11.ino)
├── infra/              docker-compose + deployment helpers
└── docs/               Setup and usage notes
```

---

## Prerequisites

- **Python 3.11–3.13** (verified on 3.13). TensorFlow-CPU, XGBoost, and scikit-learn wheels are installed from `requirements.txt`.
- **Node.js 18+** for the Expo mobile app.
- *(Optional)* **Docker** for the containerized backend + PostgreSQL stack.

---

## Quick start

### 1. Backend

```bash
# from the repo root
python -m venv .venv
# Windows:  .venv\Scripts\activate      macOS/Linux:  source .venv/bin/activate
pip install -r backend/requirements.txt

uvicorn backend.app.main:app --reload --port 8000
```

The API is now at `http://127.0.0.1:8000` (interactive docs at `/docs`).
Auth defaults to **disabled** for local runs via `backend/.env` (`API_AUTH_ENABLED=false`).

Smoke-test it:

```bash
curl http://127.0.0.1:8000/health
# {"status":"ok"}

curl -X POST http://127.0.0.1:8000/yield -H "Content-Type: application/json" \
  -d '{"Nitrogen":90,"Phosphorus":42,"Potassium":43,"Temperature":26.5,"Humidity":70,"pH":6.5,"Rainfall":180}'
```

### 2. Web frontend (KrishiKriya)

```bash
python -m http.server 5500 --directory frontend
# open http://127.0.0.1:5500 and set "Backend API URL" if not http://127.0.0.1:8000
```

### 3. Mobile app (Expo)

```bash
cd mobile
npm install
npm run start
```

Set the backend URL inside the app:
- Android emulator → `http://10.0.2.2:8000`
- iOS simulator → `http://127.0.0.1:8000`
- Physical device → your machine's LAN IP (e.g. `http://192.168.1.100:8000`)

See [`mobile/README.md`](mobile/README.md) for details.

---

## API reference

All request bodies are JSON unless noted. Multipart endpoints use form-data.

### `POST /predict` — disease detection
Multipart form-data with field `file` (JPEG/PNG/WebP). Optional query params: `top_k`, `include_raw`.

```bash
curl -X POST http://127.0.0.1:8000/predict -F "file=@leaf.jpg"
```

### `POST /yield` — yield prediction
```json
{ "Nitrogen": 90, "Phosphorus": 42, "Potassium": 43,
  "Temperature": 26.5, "Humidity": 70, "pH": 6.5, "Rainfall": 180 }
```

### `POST /irrigation/recommend` — smart irrigation
```json
{ "soil_moisture": 22, "temperature": 29, "humidity": 68, "sunlight": 720,
  "soil_type": "loamy", "crop_stage": "vegetative", "rainfall": 4 }
```
`POST /irrigation/recommend-from-iot` accepts the same fields (all optional) and merges
them with the latest IoT reading.

### `POST /predict-all` — integrated
Multipart form-data: `file` (image) **plus** `Nitrogen, Phosphorus, Potassium,
Temperature, Humidity, pH, Rainfall`. Optional query params: `top_k`, `include_raw`.
Returns both disease and yield predictions.

### IoT
- `POST /iot/sensors` — ingest a reading.
  - Required: `device_id, temperature_c, humidity_pct, soil_moisture_raw`
  - Optional: `soil_temperature_c, light_lux, pressure_hpa, rainfall_mm, rain_detected,
    gas_ppm, ec_us_cm, ph_value, nitrogen_ppm, phosphorus_ppm, potassium_ppm, battery_v`
- `GET /iot/sensors/latest` — most recent reading.
- `GET /iot/sensors/history?limit=&device_id=` — persisted history.
- `POST /iot/yield-predict` — runs the yield model against the latest sensor values;
  any fields you pass in the body override sensor context.

---

## Models & training

Artifacts live in `backend/models/`. Training scripts write a metadata sidecar
(`*_model_metadata.json`) that the API surfaces as `model_metadata` in responses.

| Model | Artifact | Trainer |
|---|---|---|
| Disease (CNN) | `plant_disease_prediction_model.h5` | `ml/train_disease.py` |
| Yield (XGBoost) | `yield_model.pkl` | `ml/train_yield.py` |
| Irrigation (RandomForest) | `irrigation_model.pkl` | `ml/train_irrigation.py` |

```bash
python ml/train_disease.py    --dataset-dir <path/to/images>   # class subfolders of images
python ml/train_yield.py      --csv <path/to/yield.csv>
python ml/train_irrigation.py --csv ml/data/irrigation_data.csv
```

### Notes on the disease model
- The `.h5` artifact is **not committed** (it is in `.gitignore`) — train it or drop your own into `backend/models/`.
- `ml/train_disease.py` builds a CNN whose **first layer is `Rescaling(1/255)`**, so the model
  expects **raw `[0, 255]` pixel values**; the inference service feeds them accordingly (do not
  pre-divide by 255).
- The model output must line up with `backend/models/class_labels.json`. The trainer rewrites that
  file from the dataset's class-folder names, so labels and model always match.
- Reference training run: a 23-class PlantVillage subset (~35k images) reached ~92% validation
  accuracy in a few CPU epochs at 128×128.
- Override `MODEL_PATH` / `CLASS_LABELS_PATH` to load artifacts from a custom location.

---

## Configuration (environment variables)

Set these in `backend/.env` or the process environment.

| Variable | Default | Purpose |
|---|---|---|
| `API_AUTH_ENABLED` | `true` | Toggle API-key auth (set `false` for local dev). |
| `PREDICTION_API_KEY` | — | Key for `/predict`, `/yield`, `/predict-all`, `/irrigation/*`. |
| `IOT_API_KEY` | — | Key for `/iot/*`. |
| `API_KEY` | — | Shared fallback for either scope. |
| `DATABASE_URL` | `sqlite:///./crop_management.db` | SQLAlchemy connection string. |
| `SENSOR_RETENTION_DAYS` | `30` | Auto-prune IoT rows older than this. |
| `MODEL_PATH` / `CLASS_LABELS_PATH` | `backend/models/...` | Override disease model / labels. |
| `YIELD_MODEL_PATH` / `IRRIGATION_MODEL_PATH` | `backend/models/...` | Override those artifacts. |

### Authentication
When auth is enabled, send the key as either header:

```
x-api-key: <token>
Authorization: Bearer <token>
```

Behavior: missing/incorrect key → `401`; a scope whose key is not configured → `503`;
`/health` is always open.

---

## Database & migrations

- IoT readings are persisted through SQLAlchemy.
- Local default is SQLite (`crop_management.db`); set `DATABASE_URL` to a PostgreSQL URL for production.
  `postgres://` and bare `postgresql://` URLs are auto-normalized to the `psycopg` driver.

Alembic (run from `backend/`):

```bash
alembic upgrade head
alembic revision --autogenerate -m "your message"
```

---

## Docker

```bash
cd infra
docker compose up --build
```

Starts PostgreSQL 15 + the backend on port 8000 with `DATABASE_URL` wired automatically.
The compose file enables auth with `API_KEY=change-me` — override it before any real deployment.

---

## IoT hardware

- Firmware: [`iot/esp8266_moisture_dht11.ino`](iot/esp8266_moisture_dht11.ino).
- The sketch posts readings to `POST /iot/sensors`. Bind the backend to `0.0.0.0` and allow the
  device through your firewall so hardware on the LAN can reach it.

---

## Troubleshooting

- **`/predict` returns 500 "Model file not found"** — the disease `.h5` isn't present; train it or
  provide one (see [Models & training](#models--training)).
- **Disease predictions collapse to one class** — inputs are being normalized twice. The model
  rescales internally; feed raw `[0, 255]` pixels.
- **`python` opens the Microsoft Store (Windows)** — the `python` alias points to the Store stub.
  Install Python from python.org and use the `.venv` interpreter directly.
