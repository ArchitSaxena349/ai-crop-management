Open infra/docker-compose.yml and run docker compose up to start db + backend.

Backend app structure:
- `backend/app/core/` contains shared database and security helpers.
- `backend/app/services/` contains disease, yield, and irrigation inference logic.
- `backend/app/routers/` contains FastAPI route modules.

Backend model artifact location:
- backend/models/plant_disease_prediction_model.h5

API endpoints:
- GET /health
- POST /predict (multipart form-data with field name `file`)
- POST /yield (JSON body with NPK + weather features)
- POST /predict-all (multipart form-data with image + NPK/weather fields)
- POST /irrigation/recommend
- POST /irrigation/recommend-from-iot
- POST /iot/sensors (JSON from ESP8266 sensors)
- GET /iot/sensors/latest
- GET /iot/sensors/history (optional query: limit, device_id)
- POST /iot/yield-predict

Database and persistence:
- IoT readings are persisted through SQLAlchemy.
- Set `DATABASE_URL` to a Postgres URL in production.
- Local fallback (without DATABASE_URL) uses SQLite at `crop_management.db`.
- Set `SENSOR_RETENTION_DAYS` (default 30) to auto-delete old sensor history rows.

Authentication:
- API auth is enabled by default.
- Provide one or both environment variables:
	- `PREDICTION_API_KEY` for prediction routes (`/predict`, `/yield`, `/predict-all`)
	- `IOT_API_KEY` for IoT routes (`/iot/*`)
- Optional shared fallback: `API_KEY`
- Send key via `x-api-key` or `Authorization: Bearer <token>`.

Alembic migrations:
- From `backend/`:
	- `alembic upgrade head`
	- `alembic revision --autogenerate -m "message"`

Training scripts:
- Disease model: `python ml/train_disease.py --dataset-dir <images_dir>`
- Yield model: `python ml/train_yield.py --csv <dataset.csv>`
- Irrigation model: `python ml/train_irrigation.py --csv ml/data/irrigation_data.csv`
- Metadata files written to:
	- `backend/models/disease_model_metadata.json`
	- `backend/models/yield_model_metadata.json`
	- `backend/models/irrigation_model_metadata.json`

Yield model artifact location:
- backend/models/yield_model.pkl

Irrigation model artifact location:
- backend/models/irrigation_model.pkl

IoT firmware:
- iot/esp8266_moisture_dht11.ino

IoT sensor payload (POST /iot/sensors):
- Required: device_id, temperature_c, humidity_pct, soil_moisture_raw
- Optional: soil_temperature_c, light_lux, pressure_hpa, rainfall_mm, rain_detected
- Optional: gas_ppm, ec_us_cm, ph_value, nitrogen_ppm, phosphorus_ppm, potassium_ppm, battery_v

IoT yield prediction:
- POST /iot/yield-predict can infer values from latest sensor payload.
- Provide missing fields manually when a sensor is not connected.

Mobile frontend:
- Expo app is available in mobile/.
- Run: npm install, then npm run start inside mobile/.
- Set backend URL in app UI:
	- Android emulator: http://10.0.2.2:8000
	- iOS simulator: http://127.0.0.1:8000
	- Physical device: use your machine LAN IP (for example http://192.168.1.100:8000)