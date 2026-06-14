# Mobile Frontend (Expo)

This app is a React Native frontend for your FastAPI backend in this repository.

## Features

- Disease prediction from leaf image (`POST /predict`)
- Yield prediction from field values (`POST /yield`)
- Integrated prediction (image + field values) (`POST /predict-all`)
- Smart irrigation recommendation:
   - Manual field analysis (`POST /irrigation/recommend`)
   - IoT-assisted recommendation using the latest sensor snapshot (`POST /irrigation/recommend-from-iot`)
- IoT actions:
  - Fetch latest sensor payload (`GET /iot/sensors/latest`)
  - Yield prediction with sensor context (`POST /iot/yield-predict`)

The app now renders concise prediction summaries instead of raw JSON responses.

## Run

1. Start your backend on port 8000.
2. From this folder, install dependencies:

   npm install

3. Start Expo:

   npm run start

4. Open on Android, iOS, or web.

## Backend URL Notes

- Android emulator: `http://10.0.2.2:8000`
- iOS simulator: `http://127.0.0.1:8000`
- Physical phone: use your machine LAN IP (example `http://192.168.1.100:8000`)

## Authentication

If backend auth is enabled, enter the same API key in the mobile app that you use for the web frontend or curl requests. The app sends it as the `x-api-key` header for disease, yield, irrigation, and IoT requests.
The app stores both Backend URL and API key locally, so they are restored automatically on next launch.

If your backend is in Docker, ensure it is bound to `0.0.0.0` and firewall rules allow your device.
