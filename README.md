Starter monorepo for AI-Based Crop Management System. See docs/GETTING_STARTED.md

### Plant disease inference
- Preferred model path: backend/models/plant_disease_prediction_model.h5.
- Run the FastAPI backend and call POST /predict with a JPEG/PNG/WebP image to receive top predictions.
- Override MODEL_PATH or CLASS_LABELS_PATH env vars if you store the model or labels elsewhere.

### Yield prediction inference
- Preferred model path: backend/models/yield_model.pkl.
- POST /yield with JSON body:
	{"Nitrogen": 90, "Phosphorus": 42, "Potassium": 43, "Temperature": 26.5, "Humidity": 70, "pH": 6.5, "Rainfall": 180}
- Override YIELD_MODEL_PATH if you store the model elsewhere.

### Smart irrigation inference
- Preferred model path: backend/models/irrigation_model.pkl.
- POST /irrigation/recommend with JSON body:
	{"soil_moisture": 22, "temperature": 29, "humidity": 68, "sunlight": 720, "soil_type": "loamy", "crop_stage": "vegetative", "rainfall": 4}
- POST /irrigation/recommend-from-iot to combine manual overrides with the latest IoT reading.
- Override IRRIGATION_MODEL_PATH if you store the irrigation model elsewhere.

### Integrated prediction (both models)
- POST /predict-all with multipart form-data including:
	- file: image file (JPEG/PNG/WebP)
	- Nitrogen, Phosphorus, Potassium, Temperature, Humidity, pH, Rainfall
- Optional query params: top_k, include_raw
- Returns both disease and yield predictions in one response.

### IoT sensor integration
- ESP8266 sketch is in iot/esp8266_moisture_dht11.ino.
- POST /iot/sensors accepts required fields:
	- device_id, temperature_c, humidity_pct, soil_moisture_raw
- POST /iot/sensors also accepts optional fields for additional sensors:
	- soil_temperature_c, light_lux, pressure_hpa, rainfall_mm, rain_detected
	- gas_ppm, ec_us_cm, ph_value, nitrogen_ppm, phosphorus_ppm, potassium_ppm, battery_v
- GET /iot/sensors/latest returns the latest ingested sensor payload.
- GET /iot/sensors/history returns persisted sensor history (query params: limit, device_id).
- POST /iot/yield-predict runs yield model using latest sensor values when available.
- You can send any missing values in the request body; backend merges request + latest sensor context.

### IoT persistence
- Sensor payloads are persisted using SQLAlchemy.
- Set DATABASE_URL to your database connection string.
- Default for local non-docker runs is SQLite: sqlite:///./crop_management.db.
- docker-compose config uses PostgreSQL and sets DATABASE_URL automatically for backend.
- Set SENSOR_RETENTION_DAYS (default 30) to auto-prune old IoT sensor rows.

### API authentication
- API auth is enabled by default (API_AUTH_ENABLED=true).
- Provide one or both keys:
	- PREDICTION_API_KEY for /predict, /yield, /predict-all
	- IOT_API_KEY for /iot/*
- Optional shared fallback: API_KEY
- Send token as either:
	- Header x-api-key: <token>
	- Header Authorization: Bearer <token>

### Database migrations (Alembic)
- Alembic config is under backend/alembic.ini and backend/alembic/.
- Run from backend/:
	1. alembic upgrade head
	2. alembic revision --autogenerate -m "your message"

### Training and model metadata
- Disease model training:
	- python ml/train_disease.py --dataset-dir <path/to/images>
- Yield model training:
	- python ml/train_yield.py --csv <path/to/yield.csv>
- Irrigation model training:
	- python ml/train_irrigation.py --csv ml/data/irrigation_data.csv
- Training scripts write metadata sidecars:
	- backend/models/disease_model_metadata.json
	- backend/models/yield_model_metadata.json
	- backend/models/irrigation_model_metadata.json
- Inference responses include model_metadata when these files exist.

### Mobile frontend
- React Native (Expo) app is in mobile/.
- Supports disease prediction, yield prediction, integrated prediction, and IoT routes.
- See mobile/README.md for run instructions and backend URL setup.

### Web frontend (KrishiKriya)
- Browser app is in frontend/.
- Features:
	- Disease prediction form (POST /predict)
	- Yield prediction form (POST /yield)
	- Integrated prediction form (POST /predict-all)
	- Smart irrigation recommendation panel (POST /irrigation/recommend, POST /irrigation/recommend-from-iot)
	- IoT sensor ingest and latest reading (POST /iot/sensors, GET /iot/sensors/latest)
	- IoT-based yield prediction (POST /iot/yield-predict)
- Run steps:
	1. Start backend: uvicorn backend.app.main:app --reload --port 8000
	2. Serve frontend: python -m http.server 5500 --directory frontend
	3. Open: http://127.0.0.1:5500
	4. In the UI, set Backend API URL if your backend is not at http://127.0.0.1:8000

### Project structure (clean)
- backend/: API service, inference code, and all deployed model artifacts.
- backend/app/core/: shared runtime infrastructure such as database setup and API security.
- backend/app/services/: disease, yield, and irrigation inference services.
- backend/app/routers/: feature endpoints exposed by FastAPI.
- docs/: setup and usage notes.
- frontend/: KrishiKriya web dashboard.
- infra/: docker-compose and deployment helpers.
- iot/: ESP8266 firmware.
- ml/: model training scripts and datasets.
- mobile/: Expo-based mobile frontend.