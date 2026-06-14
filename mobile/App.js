import React, { useMemo, useRef, useState, useEffect } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { useFonts, SpaceGrotesk_400Regular, SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk";
import AsyncStorage from "@react-native-async-storage/async-storage";

const API_BASE_URL_KEY = "@ai-crop/apiBaseUrl";
const API_KEY_STORAGE_KEY = "@ai-crop/apiKey";

const TABS = [
  { key: "disease", label: "Disease" },
  { key: "yield", label: "Yield" },
  { key: "integrated", label: "Integrated" },
  { key: "irrigation", label: "Irrigation" },
  { key: "iot", label: "IoT" },
];

const initialYieldInput = {
  Nitrogen: "90",
  Phosphorus: "42",
  Potassium: "43",
  Temperature: "26.5",
  Humidity: "70",
  pH: "6.5",
  Rainfall: "180",
};

const initialIrrigationInput = {
  soil_moisture: "",
  temperature: "",
  humidity: "",
  sunlight: "",
  rainfall: "",
  soil_type: "loamy",
  crop_stage: "vegetative",
  crop: "rice",
};

function toFloatObject(input) {
  return Object.fromEntries(
    Object.entries(input).map(([k, v]) => [k, Number.parseFloat(v)])
  );
}

function toOptionalFloatObject(input) {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => String(value).trim() !== "")
      .map(([key, value]) => [key, Number.parseFloat(value)])
  );
}

function prettifyLabel(label) {
  return String(label || "Unknown")
    .replace(/___/g, " - ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPercent(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value, digits = 2) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return value.toFixed(digits);
}

function buildOutput(title, status, lines) {
  return [title, `HTTP ${status}`, "", ...lines.filter(Boolean)].join("\n");
}

function extractErrorMessage(payload, fallbackText) {
  const detail = payload?.detail;

  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        const path = Array.isArray(item?.loc) ? item.loc.join(".") : "field";
        return `${path}: ${item?.msg || "invalid value"}`;
      })
      .join("\n");
  }

  if (typeof fallbackText === "string" && fallbackText.trim()) {
    return fallbackText.trim();
  }

  return "Request failed.";
}

function summarizeSensor(reading) {
  if (!reading) {
    return [];
  }

  return [
    `Device: ${reading.device_id || "unknown"}`,
    `Temperature: ${formatNumber(reading.temperature_c, 1)} C`,
    `Humidity: ${formatNumber(reading.humidity_pct, 1)}%`,
    `Soil moisture: ${formatNumber(reading.soil_moisture_pct, 1)}%`,
    `Rainfall: ${formatNumber(reading.rainfall_mm ?? 0, 1)} mm`,
    `Light: ${formatNumber(reading.light_lux ?? 0, 0)} lux`,
    reading.ingested_at_utc ? `Captured: ${reading.ingested_at_utc}` : null,
  ].filter(Boolean);
}

function formatDiseaseResponse(status, data) {
  const top = data?.results?.[0];
  const alternatives = Array.isArray(data?.results)
    ? data.results
        .slice(1)
        .map((item) => `${prettifyLabel(item.label)} (${formatPercent(item.confidence)})`)
        .join(", ")
    : "";

  return buildOutput("Disease Prediction", status, [
    top
      ? `Prediction bot: The leaf most likely shows ${prettifyLabel(top.label)} with ${formatPercent(top.confidence)} confidence.`
      : "Prediction bot: No disease label was returned.",
    data?.filename ? `Image: ${data.filename}` : null,
    top ? `Top class: ${prettifyLabel(top.label)}` : null,
    top ? `Confidence: ${formatPercent(top.confidence)}` : null,
    alternatives ? `Other likely matches: ${alternatives}` : null,
  ]);
}

function formatYieldResponse(status, data) {
  const prediction = data?.predicted_yield_label || "Yield prediction unavailable.";
  return buildOutput("Yield Prediction", status, [
    `Prediction bot: Expected output is ${prediction}.`,
    `Predicted yield: ${prediction}`,
    data?.input_summary
      ? `Conditions: N ${formatNumber(data.input_summary.Nitrogen, 1)}, P ${formatNumber(data.input_summary.Phosphorus, 1)}, K ${formatNumber(data.input_summary.Potassium, 1)}, Temp ${formatNumber(data.input_summary.Temperature, 1)} C, Humidity ${formatNumber(data.input_summary.Humidity, 1)}%, pH ${formatNumber(data.input_summary.pH, 1)}, Rainfall ${formatNumber(data.input_summary.Rainfall, 1)} mm.`
      : null,
  ]);
}

function formatIntegratedResponse(status, data) {
  const diseaseTop = data?.disease_prediction?.results?.[0];
  const yieldLabel = data?.yield_prediction?.predicted_yield_label || "Yield prediction unavailable.";

  return buildOutput("Integrated Prediction", status, [
    diseaseTop
      ? `Prediction bot: The crop image points to ${prettifyLabel(diseaseTop.label)}, and the field profile projects ${yieldLabel}.`
      : `Prediction bot: Yield projects ${yieldLabel}, but no disease class was returned.`,
    data?.filename ? `Image: ${data.filename}` : null,
    diseaseTop ? `Disease: ${prettifyLabel(diseaseTop.label)} (${formatPercent(diseaseTop.confidence)})` : null,
    `Predicted yield: ${yieldLabel}`,
  ]);
}

function formatIotLatestResponse(status, data) {
  return buildOutput("Latest IoT Reading", status, summarizeSensor(data?.reading));
}

function formatIotYieldResponse(status, data) {
  const yieldLabel = data?.yield_prediction?.predicted_yield_label || "Yield prediction unavailable.";
  return buildOutput("IoT Yield Prediction", status, [
    `Prediction bot: Using the latest sensor context, expected yield is ${yieldLabel}.`,
    `Predicted yield: ${yieldLabel}`,
    data?.source ? `Source mode: ${data.source}` : null,
    ...summarizeSensor(data?.sensor_context),
  ]);
}

function formatIrrigationResponse(status, data) {
  const action = data?.irrigation_action || (data?.recommended ? "START" : "NO NEED");
  const crop = data?.crop ? prettifyLabel(data.crop) : null;
  const input = data?.input_summary || {};

  return buildOutput("Smart Irrigation", status, [
    `Prediction bot: ${data?.explanation || "Irrigation analysis complete."}`,
    crop ? `Crop: ${crop}` : null,
    `Recommendation: ${action}`,
    input.soil_moisture !== undefined ? `Soil moisture used: ${formatNumber(input.soil_moisture, 1)}%` : null,
    input.rainfall !== undefined ? `Rainfall used: ${formatNumber(input.rainfall, 1)} mm` : null,
    data?.sensor_context ? "" : null,
    ...(data?.sensor_context ? summarizeSensor(data.sensor_context) : []),
  ]);
}

export default function App() {
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_700Bold,
  });

  const [apiBaseUrl, setApiBaseUrl] = useState("http://192.168.29.133:8000");
  const [apiKey, setApiKey] = useState("");
  const [activeTab, setActiveTab] = useState("disease");
  const [selectedImage, setSelectedImage] = useState(null);
  const [yieldInput, setYieldInput] = useState(initialYieldInput);
  const [iotOverride, setIotOverride] = useState(initialYieldInput);
  const [irrigationInput, setIrrigationInput] = useState(initialIrrigationInput);
  const [latestSensor, setLatestSensor] = useState(null);
  const [responseText, setResponseText] = useState("No request yet.");
  const [loading, setLoading] = useState(false);

  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(12)).current;
  const settingsHydratedRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    const loadStoredSettings = async () => {
      try {
        const [storedBaseUrl, storedApiKey] = await Promise.all([
          AsyncStorage.getItem(API_BASE_URL_KEY),
          AsyncStorage.getItem(API_KEY_STORAGE_KEY),
        ]);

        if (!isMounted) {
          return;
        }

        // Discard stale emulator-only URLs so the LAN IP default is used.
        const isStaleEmulatorUrl =
          storedBaseUrl === "http://10.0.2.2:8000" ||
          storedBaseUrl === "http://127.0.0.1:8000";
        if (storedBaseUrl && !isStaleEmulatorUrl) {
          setApiBaseUrl(storedBaseUrl);
        }

        if (storedApiKey) {
          setApiKey(storedApiKey);
        }
      } catch (_error) {
        // Ignore storage read errors and continue with defaults.
      } finally {
        if (isMounted) {
          settingsHydratedRef.current = true;
        }
      }
    };

    loadStoredSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!settingsHydratedRef.current) {
      return;
    }

    AsyncStorage.multiSet([
      [API_BASE_URL_KEY, apiBaseUrl],
      [API_KEY_STORAGE_KEY, apiKey],
    ]).catch(() => {
      // Ignore storage write errors to avoid breaking prediction actions.
    });
  }, [apiBaseUrl, apiKey]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(rise, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  }, [activeTab, fade, rise]);

  const cardAnimationStyle = useMemo(
    () => ({
      opacity: fade,
      transform: [{ translateY: rise }],
    }),
    [fade, rise]
  );

  const testConnection = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/health`, { headers: getHeaders() });
      const { payload, text } = await readResponse(res);
      if (res.ok) {
        setResponseText(`Connection OK  (HTTP ${res.status})\nBackend: ${apiBaseUrl}\n${text}`);
      } else {
        showErrorResponse(res.status, payload, text);
      }
    } catch (e) {
      setResponseText(
        `Cannot reach backend.\n\nURL tried: ${apiBaseUrl}\n\nTip: if testing on a physical device use your PC's LAN IP (e.g. http://192.168.x.x:8000) instead of 127.0.0.1 or 10.0.2.2.\n\nError: ${String(e)}`
      );
    } finally {
      setLoading(false);
    }
  };

  const setField = (key, value) => {
    setYieldInput((prev) => ({ ...prev, [key]: value }));
  };

  const setIotField = (key, value) => {
    setIotOverride((prev) => ({ ...prev, [key]: value }));
  };

  const setIrrigationField = (key, value) => {
    setIrrigationInput((prev) => ({ ...prev, [key]: value }));
  };

  const getHeaders = (extraHeaders = {}) => {
    const trimmedKey = apiKey.trim();
    return trimmedKey
      ? { ...extraHeaders, "x-api-key": trimmedKey }
      : extraHeaders;
  };

  const readResponse = async (res) => {
    const text = await res.text();

    if (!text) {
      return { payload: null, text: "" };
    }

    try {
      return { payload: JSON.parse(text), text };
    } catch (_error) {
      return { payload: null, text };
    }
  };

  const showErrorResponse = (status, payload, text) => {
    setResponseText(buildOutput("Request Failed", status, [extractErrorMessage(payload, text)]));
  };

  const chooseImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.85,
    });

    if (!result.canceled && result.assets?.length) {
      setSelectedImage(result.assets[0]);
    }
  };

  const callDisease = async () => {
    if (!selectedImage) {
      setResponseText("Select an image first.");
      return;
    }

    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", {
        uri: selectedImage.uri,
        name: selectedImage.fileName || "leaf.jpg",
        type: selectedImage.mimeType || "image/jpeg",
      });

      const res = await fetch(`${apiBaseUrl}/predict`, {
        method: "POST",
        headers: getHeaders(),
        body: form,
      });

      const { payload, text } = await readResponse(res);
      if (!res.ok) {
        showErrorResponse(res.status, payload, text);
        return;
      }

      setResponseText(formatDiseaseResponse(res.status, payload));
    } catch (e) {
      setResponseText(`Request failed: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const callYield = async () => {
    setLoading(true);
    try {
      const payload = toFloatObject(yieldInput);
      const res = await fetch(`${apiBaseUrl}/yield`, {
        method: "POST",
        headers: getHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });

      const { payload: data, text } = await readResponse(res);
      if (!res.ok) {
        showErrorResponse(res.status, data, text);
        return;
      }

      setResponseText(formatYieldResponse(res.status, data));
    } catch (e) {
      setResponseText(`Request failed: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const callIntegrated = async () => {
    if (!selectedImage) {
      setResponseText("Select an image first.");
      return;
    }

    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", {
        uri: selectedImage.uri,
        name: selectedImage.fileName || "leaf.jpg",
        type: selectedImage.mimeType || "image/jpeg",
      });

      Object.entries(yieldInput).forEach(([k, v]) => form.append(k, v));

      const res = await fetch(`${apiBaseUrl}/predict-all?top_k=3`, {
        method: "POST",
        headers: getHeaders(),
        body: form,
      });

      const { payload, text } = await readResponse(res);
      if (!res.ok) {
        showErrorResponse(res.status, payload, text);
        return;
      }

      setResponseText(formatIntegratedResponse(res.status, payload));
    } catch (e) {
      setResponseText(`Request failed: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const callIotLatest = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/iot/sensors/latest`, {
        headers: getHeaders(),
      });
      const { payload, text } = await readResponse(res);
      if (!res.ok) {
        showErrorResponse(res.status, payload, text);
        return;
      }

      setLatestSensor(payload?.reading || null);
      setResponseText(formatIotLatestResponse(res.status, payload));
    } catch (e) {
      setResponseText(`Request failed: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const callIotYield = async () => {
    setLoading(true);
    try {
      const payload = toFloatObject(iotOverride);
      const res = await fetch(`${apiBaseUrl}/iot/yield-predict`, {
        method: "POST",
        headers: getHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });

      const { payload: data, text } = await readResponse(res);
      if (!res.ok) {
        showErrorResponse(res.status, data, text);
        return;
      }

      setLatestSensor(data?.sensor_context || latestSensor);
      setResponseText(formatIotYieldResponse(res.status, data));
    } catch (e) {
      setResponseText(`Request failed: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const callIrrigationManual = async () => {
    const requiredNumeric = ["soil_moisture", "temperature", "humidity", "sunlight", "rainfall"];
    const missing = requiredNumeric.filter((key) => String(irrigationInput[key]).trim() === "");

    if (missing.length) {
      setResponseText(`Fill these irrigation fields first: ${missing.join(", ")}`);
      return;
    }

    setLoading(true);
    try {
      const payload = {
        ...toOptionalFloatObject({
          soil_moisture: irrigationInput.soil_moisture,
          temperature: irrigationInput.temperature,
          humidity: irrigationInput.humidity,
          sunlight: irrigationInput.sunlight,
          rainfall: irrigationInput.rainfall,
        }),
        soil_type: irrigationInput.soil_type.trim(),
        crop_stage: irrigationInput.crop_stage.trim(),
        crop: irrigationInput.crop.trim() || undefined,
      };

      const res = await fetch(`${apiBaseUrl}/irrigation/recommend`, {
        method: "POST",
        headers: getHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });

      const { payload: data, text } = await readResponse(res);
      if (!res.ok) {
        showErrorResponse(res.status, data, text);
        return;
      }

      setResponseText(formatIrrigationResponse(res.status, data));
    } catch (e) {
      setResponseText(`Request failed: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const callIrrigationFromIot = async () => {
    setLoading(true);
    try {
      const payload = {
        ...toOptionalFloatObject({
          soil_moisture: irrigationInput.soil_moisture,
          temperature: irrigationInput.temperature,
          humidity: irrigationInput.humidity,
          sunlight: irrigationInput.sunlight,
          rainfall: irrigationInput.rainfall,
        }),
        soil_type: irrigationInput.soil_type.trim(),
        crop_stage: irrigationInput.crop_stage.trim(),
        crop: irrigationInput.crop.trim() || undefined,
      };

      const res = await fetch(`${apiBaseUrl}/irrigation/recommend-from-iot`, {
        method: "POST",
        headers: getHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });

      const { payload: data, text } = await readResponse(res);
      if (!res.ok) {
        showErrorResponse(res.status, data, text);
        return;
      }

      setLatestSensor(data?.sensor_context || latestSensor);
      setResponseText(formatIrrigationResponse(res.status, data));
    } catch (e) {
      setResponseText(`Request failed: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  if (!fontsLoaded) {
    return (
      <View style={[styles.centered, { flex: 1, backgroundColor: "#f7f2e8" }]}>
        <ActivityIndicator size="large" color="#1f5c42" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <LinearGradient
        colors={["#f6f4ee", "#efe7d2", "#dbefd7"]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.backgroundOrbA} />
      <View style={styles.backgroundOrbB} />

      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>AI Crop Management</Text>
        <Text style={styles.subtitle}>Mobile control room for disease, yield, irrigation, and live IoT decisions.</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Backend URL</Text>
          <TextInput
            style={styles.input}
            value={apiBaseUrl}
            onChangeText={setApiBaseUrl}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.label}>API Key</Text>
          <TextInput
            style={styles.input}
            value={apiKey}
            onChangeText={setApiKey}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Enter x-api-key when auth is enabled"
            placeholderTextColor="#7f8b82"
          />
          <Text style={styles.hint}>Use LAN IP when testing on a physical device.</Text>
          <Pressable style={styles.ctaSecondary} onPress={testConnection}>
            <Text style={styles.ctaSecondaryText}>Test Connection</Text>
          </Pressable>
        </View>

        <View style={styles.tabsRow}>
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setActiveTab(t.key)}
              style={[styles.tabBtn, activeTab === t.key ? styles.tabBtnActive : null]}
            >
              <Text style={[styles.tabTxt, activeTab === t.key ? styles.tabTxtActive : null]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        <Animated.View style={[styles.card, cardAnimationStyle]}>
          <Text style={styles.sectionTitle}>{TABS.find((t) => t.key === activeTab)?.label}</Text>

          {(activeTab === "disease" || activeTab === "integrated") && (
            <View>
              <Pressable style={styles.ctaSecondary} onPress={chooseImage}>
                <Text style={styles.ctaSecondaryText}>Pick Leaf Image</Text>
              </Pressable>

              {selectedImage ? (
                <Image source={{ uri: selectedImage.uri }} style={styles.preview} />
              ) : (
                <Text style={styles.hint}>No image selected yet.</Text>
              )}
            </View>
          )}

          {(activeTab === "yield" || activeTab === "integrated") && (
            <View>
              {Object.keys(initialYieldInput).map((key) => (
                <View key={key} style={styles.fieldRow}>
                  <Text style={styles.label}>{key}</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="decimal-pad"
                    value={yieldInput[key]}
                    onChangeText={(v) => setField(key, v)}
                  />
                </View>
              ))}
            </View>
          )}

          {activeTab === "iot" && (
            <View>
              <Text style={styles.hint}>Optional overrides for /iot/yield-predict:</Text>
              {Object.keys(initialYieldInput).map((key) => (
                <View key={key} style={styles.fieldRow}>
                  <Text style={styles.label}>{key}</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="decimal-pad"
                    value={iotOverride[key]}
                    onChangeText={(v) => setIotField(key, v)}
                  />
                </View>
              ))}
            </View>
          )}

          {activeTab === "irrigation" && (
            <View>
              <Text style={styles.hint}>Leave numeric fields blank to reuse the latest IoT reading. Soil type and crop stage are always required.</Text>

              {[
                ["soil_moisture", "Soil moisture (%)"],
                ["temperature", "Temperature (C)"],
                ["humidity", "Humidity (%)"],
                ["sunlight", "Sunlight (lux)"],
                ["rainfall", "Rainfall (mm)"],
                ["soil_type", "Soil type"],
                ["crop_stage", "Crop stage"],
                ["crop", "Crop (optional label)"],
              ].map(([key, label]) => (
                <View key={key} style={styles.fieldRow}>
                  <Text style={styles.label}>{label}</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType={key === "soil_type" || key === "crop_stage" || key === "crop" ? "default" : "decimal-pad"}
                    value={irrigationInput[key]}
                    onChangeText={(value) => setIrrigationField(key, value)}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              ))}

              {latestSensor ? (
                <View style={styles.sensorMiniCard}>
                  <Text style={styles.sensorMiniTitle}>Latest sensor context ready</Text>
                  <Text style={styles.sensorMiniText}>{summarizeSensor(latestSensor).join("\n")}</Text>
                </View>
              ) : null}
            </View>
          )}

          {activeTab === "disease" && (
            <Pressable style={styles.ctaPrimary} onPress={callDisease}>
              <Text style={styles.ctaPrimaryText}>Run Disease Prediction</Text>
            </Pressable>
          )}

          {activeTab === "yield" && (
            <Pressable style={styles.ctaPrimary} onPress={callYield}>
              <Text style={styles.ctaPrimaryText}>Run Yield Prediction</Text>
            </Pressable>
          )}

          {activeTab === "integrated" && (
            <Pressable style={styles.ctaPrimary} onPress={callIntegrated}>
              <Text style={styles.ctaPrimaryText}>Run Integrated Prediction</Text>
            </Pressable>
          )}

          {activeTab === "iot" && (
            <View>
              <Pressable style={styles.ctaSecondary} onPress={callIotLatest}>
                <Text style={styles.ctaSecondaryText}>Fetch Latest Sensor Reading</Text>
              </Pressable>
              <View style={{ height: 10 }} />
              <Pressable style={styles.ctaPrimary} onPress={callIotYield}>
                <Text style={styles.ctaPrimaryText}>Run IoT Yield Prediction</Text>
              </Pressable>
            </View>
          )}

          {activeTab === "irrigation" && (
            <View>
              <Pressable style={styles.ctaSecondary} onPress={callIotLatest}>
                <Text style={styles.ctaSecondaryText}>Fetch Latest Sensor Reading</Text>
              </Pressable>
              <View style={{ height: 10 }} />
              <Pressable style={styles.ctaSecondary} onPress={callIrrigationFromIot}>
                <Text style={styles.ctaSecondaryText}>Recommend From Latest IoT</Text>
              </Pressable>
              <View style={{ height: 10 }} />
              <Pressable style={styles.ctaPrimary} onPress={callIrrigationManual}>
                <Text style={styles.ctaPrimaryText}>Run Manual Irrigation Check</Text>
              </Pressable>
            </View>
          )}
        </Animated.View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Prediction Summary</Text>
          {loading ? <ActivityIndicator color="#1f5c42" /> : <Text style={styles.response}>{responseText}</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f6f4ee",
  },
  container: {
    padding: 18,
    paddingBottom: 40,
    gap: 14,
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontFamily: "SpaceGrotesk_700Bold",
    fontSize: 30,
    color: "#123a2a",
  },
  subtitle: {
    fontFamily: "SpaceGrotesk_400Regular",
    color: "#2b5a46",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.8)",
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: "#d4d2c7",
    shadowColor: "#1b4d38",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  tabsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tabBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#e9e2cf",
  },
  tabBtnActive: {
    backgroundColor: "#174f38",
  },
  tabTxt: {
    fontFamily: "SpaceGrotesk_700Bold",
    color: "#2b5a46",
  },
  tabTxtActive: {
    color: "#f6f4ee",
  },
  sectionTitle: {
    fontFamily: "SpaceGrotesk_700Bold",
    fontSize: 18,
    color: "#123a2a",
    marginBottom: 10,
  },
  label: {
    fontFamily: "SpaceGrotesk_700Bold",
    color: "#234c3b",
    marginBottom: 4,
  },
  hint: {
    fontFamily: "SpaceGrotesk_400Regular",
    color: "#466b5b",
    marginTop: 4,
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: "#c5c6b8",
    backgroundColor: "#f9f7f0",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: "SpaceGrotesk_400Regular",
    color: "#1a3f2f",
  },
  fieldRow: {
    marginBottom: 8,
  },
  ctaPrimary: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#15553b",
  },
  ctaPrimaryText: {
    fontFamily: "SpaceGrotesk_700Bold",
    color: "#f6f4ee",
  },
  ctaSecondary: {
    marginTop: 4,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#e2f0e6",
    borderWidth: 1,
    borderColor: "#bed7c6",
  },
  ctaSecondaryText: {
    fontFamily: "SpaceGrotesk_700Bold",
    color: "#1e5c41",
  },
  preview: {
    marginTop: 10,
    width: "100%",
    height: 190,
    borderRadius: 12,
    backgroundColor: "#e2e2e2",
  },
  response: {
    fontFamily: "SpaceGrotesk_400Regular",
    color: "#153a2b",
    lineHeight: 20,
  },
  sensorMiniCard: {
    marginTop: 8,
    borderRadius: 14,
    backgroundColor: "#edf6ef",
    borderWidth: 1,
    borderColor: "#c5dccb",
    padding: 12,
  },
  sensorMiniTitle: {
    fontFamily: "SpaceGrotesk_700Bold",
    color: "#1c4c37",
    marginBottom: 6,
  },
  sensorMiniText: {
    fontFamily: "SpaceGrotesk_400Regular",
    color: "#2c5e49",
    lineHeight: 19,
  },
  backgroundOrbA: {
    position: "absolute",
    right: -60,
    top: -40,
    width: 200,
    height: 200,
    borderRadius: 120,
    backgroundColor: "rgba(24, 95, 66, 0.14)",
  },
  backgroundOrbB: {
    position: "absolute",
    left: -70,
    bottom: 40,
    width: 220,
    height: 220,
    borderRadius: 130,
    backgroundColor: "rgba(240, 176, 91, 0.14)",
  },
});
