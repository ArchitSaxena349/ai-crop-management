#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

// ===== Wi-Fi Config =====
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Use your backend host reachable from ESP8266 (not localhost)
const char* API_BASE_URL = "http://192.168.1.100:8000";
const char* DEVICE_ID = "esp8266-field-01";

// ===== Sensor Pins =====
#define DHT_PIN D4
#define DHT_TYPE DHT11
#define SOIL_MOISTURE_PIN A0

// Optional sensors: set to true only when you wire them and implement read logic.
const bool HAS_LIGHT_SENSOR = false;
const bool HAS_PRESSURE_SENSOR = false;
const bool HAS_RAIN_SENSOR = false;
const bool HAS_GAS_SENSOR = false;
const bool HAS_EC_SENSOR = false;
const bool HAS_PH_SENSOR = false;
const bool HAS_NPK_SENSOR = false;
const bool HAS_BATTERY_MONITOR = false;

DHT dht(DHT_PIN, DHT_TYPE);

unsigned long lastSendMs = 0;
const unsigned long sendIntervalMs = 15000;

float readLightLux() {
	// Replace with BH1750/TSL2561 read call when connected.
	return 0.0;
}

float readPressureHpa() {
	// Replace with BMP280/BME280 read call when connected.
	return 0.0;
}

float readRainfallMm() {
	// Replace with tipping-bucket accumulation logic when connected.
	return 0.0;
}

bool readRainDetected() {
	// Replace with digital rain sensor signal when connected.
	return false;
}

float readGasPpm() {
	// Replace with MQ-series gas sensor conversion logic.
	return 0.0;
}

float readEcUsCm() {
	// Replace with EC probe conversion logic.
	return 0.0;
}

float readPhValue() {
	// Replace with pH probe conversion logic.
	return 0.0;
}

float readNitrogenPpm() {
	// Replace with NPK sensor/N channel read logic.
	return 0.0;
}

float readPhosphorusPpm() {
	// Replace with NPK sensor/P channel read logic.
	return 0.0;
}

float readPotassiumPpm() {
	// Replace with NPK sensor/K channel read logic.
	return 0.0;
}

float readBatteryVoltage() {
	// Replace with ADC-based voltage divider read.
	return 0.0;
}

void connectWifi() {
	WiFi.mode(WIFI_STA);
	WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

	Serial.print("Connecting to WiFi");
	while (WiFi.status() != WL_CONNECTED) {
		delay(500);
		Serial.print(".");
	}
	Serial.println("\nWiFi connected");
	Serial.print("IP: ");
	Serial.println(WiFi.localIP());
}

bool postSensorData(float temperatureC, float humidityPct, int moistureRaw) {
	if (WiFi.status() != WL_CONNECTED) {
		connectWifi();
	}

	WiFiClient client;
	HTTPClient http;

	String endpoint = String(API_BASE_URL) + "/iot/sensors";
	if (!http.begin(client, endpoint)) {
		Serial.println("HTTP begin failed");
		return false;
	}

	http.addHeader("Content-Type", "application/json");

	JsonDocument doc;
	doc["device_id"] = DEVICE_ID;
	doc["temperature_c"] = temperatureC;
	doc["humidity_pct"] = humidityPct;
	doc["soil_moisture_raw"] = moistureRaw;

	// Optional sensor fields (sent only when enabled)
	if (HAS_LIGHT_SENSOR) {
		doc["light_lux"] = readLightLux();
	}
	if (HAS_PRESSURE_SENSOR) {
		doc["pressure_hpa"] = readPressureHpa();
	}
	if (HAS_RAIN_SENSOR) {
		doc["rainfall_mm"] = readRainfallMm();
		doc["rain_detected"] = readRainDetected();
	}
	if (HAS_GAS_SENSOR) {
		doc["gas_ppm"] = readGasPpm();
	}
	if (HAS_EC_SENSOR) {
		doc["ec_us_cm"] = readEcUsCm();
	}
	if (HAS_PH_SENSOR) {
		doc["ph_value"] = readPhValue();
	}
	if (HAS_NPK_SENSOR) {
		doc["nitrogen_ppm"] = readNitrogenPpm();
		doc["phosphorus_ppm"] = readPhosphorusPpm();
		doc["potassium_ppm"] = readPotassiumPpm();
	}
	if (HAS_BATTERY_MONITOR) {
		doc["battery_v"] = readBatteryVoltage();
	}

	String body;
	serializeJson(doc, body);

	int statusCode = http.POST(body);
	String response = http.getString();

	http.end();

	Serial.print("POST /iot/sensors status: ");
	Serial.println(statusCode);
	Serial.print("Response: ");
	Serial.println(response);

	return statusCode >= 200 && statusCode < 300;
}

void setup() {
	Serial.begin(115200);
	delay(1000);

	dht.begin();
	connectWifi();
}

void loop() {
	unsigned long now = millis();
	if (now - lastSendMs < sendIntervalMs) {
		delay(50);
		return;
	}

	lastSendMs = now;

	float humidity = dht.readHumidity();
	float temperature = dht.readTemperature();
	int moistureRaw = analogRead(SOIL_MOISTURE_PIN);

	if (isnan(humidity) || isnan(temperature)) {
		Serial.println("Failed to read DHT11 sensor values");
		return;
	}

	Serial.print("Temp C: ");
	Serial.println(temperature);
	Serial.print("Humidity %: ");
	Serial.println(humidity);
	Serial.print("Soil moisture raw: ");
	Serial.println(moistureRaw);

	postSensorData(temperature, humidity, moistureRaw);
}