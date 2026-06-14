const API_STORAGE_KEY = "krishikriya-api-base";
const API_KEY_STORAGE_KEY = "krishikriya-api-key";
const MAX_HISTORY_POINTS = 10;
const ANALYTICS_STORAGE_KEY = "krishikriya-analytics-v1";

const ui = {
  apiBase: document.getElementById("apiBase"),
  apiKey: document.getElementById("apiKey"),
  apiStatus: document.getElementById("apiStatus"),
  diseaseOut: document.getElementById("diseaseOut"),
  yieldOut: document.getElementById("yieldOut"),
  integratedOut: document.getElementById("integratedOut"),
  iotIngestOut: document.getElementById("iotIngestOut"),
  latestSensorOut: document.getElementById("latestSensorOut"),
  iotYieldOut: document.getElementById("iotYieldOut"),
  irrigationOut: document.getElementById("irrigationOut")
};

const chartState = {
  labels: [],
  temperature: [],
  humidity: [],
  moisture: [],
  yieldLabels: [],
  yieldValues: []
};

const analyticsStore = {
  sensorRecords: [],
  yieldRecords: []
};

let sensorTrendChart;
let yieldTrendChart;
let latestSensorReading = null;

function normalizeApiBase(raw) {
  return (raw || "http://127.0.0.1:8000").trim().replace(/\/$/, "");
}

function getApiBase() {
  const fromStorage = localStorage.getItem(API_STORAGE_KEY);
  return normalizeApiBase(fromStorage || ui.apiBase.value);
}

function getApiKey() {
  const fromStorage = localStorage.getItem(API_KEY_STORAGE_KEY);
  return (fromStorage || ui.apiKey?.value || "").trim();
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const KNOWN_CROP_TOKENS = [
  "apple",
  "blueberry",
  "cherry",
  "corn",
  "grape",
  "orange",
  "peach",
  "pepper",
  "potato",
  "raspberry",
  "soybean",
  "squash",
  "strawberry",
  "tomato"
];

function getCropFromLabel(label) {
  if (!label || typeof label !== "string") {
    return null;
  }
  return label.split(" - ")[0].trim().toLowerCase() || null;
}

function getCropFromFilename(filename) {
  if (!filename || typeof filename !== "string") {
    return null;
  }
  const lower = filename.toLowerCase();
  const hit = KNOWN_CROP_TOKENS.find((token) => lower.includes(token));
  return hit || null;
}

function isLikelyOutOfScope(filename, predictedLabel) {
  const predictedCrop = getCropFromLabel(predictedLabel);
  const fileCrop = getCropFromFilename(filename);
  if (!predictedCrop) {
    return false;
  }
  if (fileCrop && fileCrop !== predictedCrop) {
    return true;
  }
  if (!fileCrop && filename) {
    return true;
  }
  return false;
}

function showOutput(target, data, isError = false) {
  target.innerHTML = "";
  target.textContent =
    typeof data === "string" ? data : JSON.stringify(data, null, 2);
  target.style.borderColor = isError
    ? "rgba(196, 53, 53, 0.45)"
    : "rgba(16, 35, 33, 0.14)";
}

function renderDiseaseResult(target, data) {
  if (!data || !Array.isArray(data.results)) { showOutput(target, data); return; }
  const top = data.results[0];
  const outOfScope = isLikelyOutOfScope(data.filename, top?.label);
  const topPct = (top.confidence * 100).toFixed(2);
  const isHealthy = top.label.toLowerCase().includes("healthy");
  const accent = isHealthy ? "var(--leaf)" : "var(--soil)";
  const botLine = outOfScope
    ? `Prediction bot: I can only classify PlantVillage crops. I guessed ${top.label} for this image, so treat this as low-trust.`
    : `Prediction bot: Most likely disease is ${top.label}.`;
  const rows = data.results.map(r => {
    const pct = r.confidence * 100;
    const pctStr = pct < 0.01 ? "< 0.01" : pct.toFixed(2);
    const barW = Math.max(pct, 0.5).toFixed(2);
    return `<div class="pred-row">
      <span class="pred-label">${escHtml(r.label)}</span>
      <div class="pred-bar-wrap"><div class="pred-bar" style="width:${barW}%;background:${accent}"></div></div>
      <span class="pred-pct">${pctStr}%</span>
    </div>`;
  }).join("");
  target.innerHTML = `
    <div class="bot-summary">${escHtml(botLine)}</div>
    <div class="pred-top" style="border-left:4px solid ${accent}">
      <span class="pred-top-label">${escHtml(top.label)}</span>
      <span class="pred-top-conf" style="color:${accent}">${outOfScope ? "Hidden (unsupported crop)" : `${topPct}%`}</span>
    </div>
    <div class="pred-rows">${rows}</div>
    <div class="pred-meta">${escHtml(data.filename || "—")} &nbsp;·&nbsp; ${escHtml(String(data.input_size?.width ?? 224))}×${escHtml(String(data.input_size?.height ?? 224))}px</div>`;
  target.style.borderColor = "rgba(16, 35, 33, 0.14)";
}

function renderYieldResult(target, data) {
  const inner = data?.yield_prediction ?? data;
  const yieldVal = inner?.predicted_yield;
  const yieldLabel = inner?.predicted_yield_label ?? (yieldVal != null ? `${Number(yieldVal).toFixed(2)} T/ha` : null);
  if (yieldVal == null) { showOutput(target, data); return; }
  const inputs = Object.entries(inner.input_summary || {})
    .map(([k, v]) => `<div class="yield-input-row"><span>${escHtml(k)}</span><strong>${escHtml(String(v))}</strong></div>`)
    .join("");
  target.innerHTML = `
    <div class="yield-hero">
      <span class="yield-hero-label">Predicted Yield</span>
      <span class="yield-hero-value">${escHtml(yieldLabel)}</span>
    </div>
    ${inputs ? `<div class="yield-inputs">${inputs}</div>` : ""}`;
  target.style.borderColor = "rgba(16, 35, 33, 0.14)";
}

function renderIntegratedResult(target, data) {
  const disease = data?.disease_prediction || {};
  const diseaseTop = Array.isArray(disease.results) ? disease.results[0] : null;
  const diseaseLabel = diseaseTop?.label || "No disease prediction";
  const filename = data?.filename || "Unknown image";
  const outOfScope = isLikelyOutOfScope(filename, diseaseLabel);
  const diseaseConfidence =
    typeof diseaseTop?.confidence === "number"
      ? outOfScope
        ? "Hidden (unsupported crop)"
        : `${(diseaseTop.confidence * 100).toFixed(2)}%`
      : "—";

  const yieldPrediction = data?.yield_prediction || {};
  const yieldVal = yieldPrediction?.predicted_yield;
  const yieldLabel =
    yieldPrediction?.predicted_yield_label ||
    (yieldVal != null ? `${Number(yieldVal).toFixed(2)} T/ha` : "No yield prediction");

  const status = data?.status || "success";
  const botLine = outOfScope
    ? `Prediction bot: I can estimate yield, but disease confidence is hidden because this image appears outside supported PlantVillage crops.`
    : `Prediction bot: Detected ${diseaseLabel} and estimated yield ${yieldLabel}.`;

  target.innerHTML = `
    <div class="integrated-card">
      <div class="bot-summary">${escHtml(botLine)}</div>
      <div class="integrated-head">
        <span class="integrated-status">Status: ${escHtml(status)}</span>
        <span class="integrated-file">${escHtml(filename)}</span>
      </div>
      <div class="integrated-grid">
        <div class="integrated-item">
          <div class="integrated-title">Disease Prediction</div>
          <div class="integrated-main">${escHtml(diseaseLabel)}</div>
          <div class="integrated-sub">Confidence: ${escHtml(diseaseConfidence)}</div>
        </div>
        <div class="integrated-item">
          <div class="integrated-title">Yield Prediction</div>
          <div class="integrated-main">${escHtml(yieldLabel)}</div>
          <div class="integrated-sub">Model output ready</div>
        </div>
      </div>
    </div>`;

  target.style.borderColor = "rgba(16, 35, 33, 0.14)";
}

function renderIrrigationResult(target, data) {
  const action = data?.irrigation_action || "UNKNOWN";
  const recommended = Boolean(data?.recommended);
  const explanation = data?.explanation || "No explanation available.";
  const accent = recommended ? "var(--leaf)" : "var(--soil)";
  const crop = data?.crop ? ` for ${data.crop}` : "";
  const source = data?.sensor_context ? "Connected to latest IoT reading." : "Using submitted field values.";

  target.innerHTML = `
    <div class="irrigation-card">
      <div class="bot-summary">Prediction bot: ${escHtml(explanation)}</div>
      <div class="irrigation-head" style="border-left:4px solid ${accent}">
        <span class="irrigation-action">${escHtml(action)}${escHtml(crop)}</span>
        <span class="irrigation-chip" style="color:${accent}">${recommended ? "Irrigate now" : "Hold irrigation"}</span>
      </div>
      <div class="irrigation-sub">${escHtml(source)}</div>
    </div>`;

  target.style.borderColor = "rgba(16, 35, 33, 0.14)";
}

function fillIrrigationFormFromSensor(reading) {
  const form = document.getElementById("irrigationForm");
  if (!form || !reading) {
    return;
  }

  const moisture = reading.soil_moisture_pct;
  const temperature = reading.temperature_c;
  const humidity = reading.humidity_pct;
  const sunlight = reading.light_lux ?? Number(form.elements.sunlight.value || 600);
  const rainfall = reading.rainfall_mm ?? Number(form.elements.rainfall.value || 0);

  if (moisture != null) {
    form.elements.soil_moisture.value = String(moisture);
  }
  if (temperature != null) {
    form.elements.temperature.value = String(temperature);
  }
  if (humidity != null) {
    form.elements.humidity.value = String(humidity);
  }
  form.elements.sunlight.value = String(sunlight);
  form.elements.rainfall.value = String(rainfall);
}

async function requestJson(path, options = {}) {
  const url = `${getApiBase()}${path}`;
  const headers = new Headers(options.headers || {});
  const apiKey = getApiKey();
  if (apiKey) {
    headers.set("x-api-key", apiKey);
  }

  const response = await fetch(url, {
    ...options,
    headers
  });
  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const detail = data?.detail || data?.message || JSON.stringify(data);
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }

  return data;
}

function collectJson(form, parseNumber = true) {
  const formData = new FormData(form);
  const payload = {};

  for (const [key, value] of formData.entries()) {
    if (value === "") {
      continue;
    }
    payload[key] = parseNumber && !Number.isNaN(Number(value)) ? Number(value) : value;
  }

  return payload;
}

function pushBounded(list, value, max = MAX_HISTORY_POINTS) {
  list.push(value);
  if (list.length > max) {
    list.shift();
  }
}

function saveAnalyticsStore() {
  localStorage.setItem(ANALYTICS_STORAGE_KEY, JSON.stringify(analyticsStore));
}

function loadAnalyticsStore() {
  const saved = localStorage.getItem(ANALYTICS_STORAGE_KEY);
  if (!saved) {
    return;
  }

  try {
    const parsed = JSON.parse(saved);
    analyticsStore.sensorRecords = Array.isArray(parsed.sensorRecords)
      ? parsed.sensorRecords
      : [];
    analyticsStore.yieldRecords = Array.isArray(parsed.yieldRecords)
      ? parsed.yieldRecords
      : [];
  } catch {
    analyticsStore.sensorRecords = [];
    analyticsStore.yieldRecords = [];
  }
}

function escapeCsvField(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\n") || text.includes('"')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function getFilterRange() {
  const startRaw = document.getElementById("analyticsStart")?.value;
  const endRaw = document.getElementById("analyticsEnd")?.value;
  const start = startRaw ? new Date(startRaw).getTime() : null;
  const end = endRaw ? new Date(endRaw).getTime() : null;
  return { start, end };
}

function isWithinRange(timestamp, range) {
  const time = new Date(timestamp).getTime();
  if (Number.isNaN(time)) {
    return false;
  }
  if (range.start != null && time < range.start) {
    return false;
  }
  if (range.end != null && time > range.end) {
    return false;
  }
  return true;
}

function applyChartsFromStore() {
  const range = getFilterRange();
  const filteredSensors = analyticsStore.sensorRecords
    .filter((item) => isWithinRange(item.timestamp, range))
    .slice(-MAX_HISTORY_POINTS);

  chartState.labels.length = 0;
  chartState.temperature.length = 0;
  chartState.humidity.length = 0;
  chartState.moisture.length = 0;

  filteredSensors.forEach((item) => {
    pushBounded(chartState.labels, new Date(item.timestamp).toLocaleTimeString());
    pushBounded(chartState.temperature, Number(item.temperature ?? 0));
    pushBounded(chartState.humidity, Number(item.humidity ?? 0));
    pushBounded(chartState.moisture, Number(item.moisture ?? 0));
  });

  const filteredYield = analyticsStore.yieldRecords
    .filter((item) => isWithinRange(item.timestamp, range))
    .slice(-MAX_HISTORY_POINTS);

  chartState.yieldLabels.length = 0;
  chartState.yieldValues.length = 0;

  filteredYield.forEach((item) => {
    pushBounded(chartState.yieldLabels, item.source || "Yield");
    pushBounded(chartState.yieldValues, Number(item.value ?? 0));
  });

  if (sensorTrendChart) {
    sensorTrendChart.update();
  }
  if (yieldTrendChart) {
    yieldTrendChart.update();
  }

  updateStatsView();
}

function computeStats(values) {
  if (!values.length) {
    return null;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
  return { min, max, avg };
}

function formatStat(stats, digits = 2) {
  if (!stats) {
    return "No data yet";
  }
  return `min ${stats.min.toFixed(digits)} | max ${stats.max.toFixed(digits)} | avg ${stats.avg.toFixed(digits)}`;
}

function updateStatsView() {
  const sensorStatsEl = document.getElementById("sensorStats");
  const yieldStatsEl = document.getElementById("yieldStats");
  if (!sensorStatsEl || !yieldStatsEl) {
    return;
  }

  const tempStats = computeStats(chartState.temperature);
  const humidityStats = computeStats(chartState.humidity);
  const moistureStats = computeStats(chartState.moisture);
  const yieldStats = computeStats(chartState.yieldValues);

  sensorStatsEl.textContent = [
    `Temp: ${formatStat(tempStats)}`,
    `Humidity: ${formatStat(humidityStats)}`,
    `Moisture: ${formatStat(moistureStats)}`
  ].join(" | ");

  yieldStatsEl.textContent = `Yield: ${formatStat(yieldStats)}`;
}

function initCharts() {
  if (typeof Chart === "undefined") {
    return;
  }

  const sensorCtx = document.getElementById("sensorTrendChart");
  const yieldCtx = document.getElementById("yieldTrendChart");
  if (!sensorCtx || !yieldCtx) {
    return;
  }

  sensorTrendChart = new Chart(sensorCtx, {
    type: "line",
    data: {
      labels: chartState.labels,
      datasets: [
        {
          label: "Temp (C)",
          data: chartState.temperature,
          borderColor: "#0f7f5f",
          backgroundColor: "rgba(15, 127, 95, 0.15)",
          tension: 0.3
        },
        {
          label: "Humidity (%)",
          data: chartState.humidity,
          borderColor: "#2f5f9f",
          backgroundColor: "rgba(47, 95, 159, 0.12)",
          tension: 0.3
        },
        {
          label: "Soil Moisture (%)",
          data: chartState.moisture,
          borderColor: "#c46f3c",
          backgroundColor: "rgba(196, 111, 60, 0.12)",
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { boxWidth: 10 } } },
      scales: { y: { beginAtZero: true } }
    }
  });

  yieldTrendChart = new Chart(yieldCtx, {
    type: "bar",
    data: {
      labels: chartState.yieldLabels,
      datasets: [
        {
          label: "Predicted Yield",
          data: chartState.yieldValues,
          borderColor: "#0f7f5f",
          backgroundColor: "rgba(116, 211, 174, 0.8)",
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true } }
    }
  });
}

function updateSensorChart(reading) {
  if (!reading) {
    return;
  }

  const moisturePct =
    typeof reading.soil_moisture_pct === "number"
      ? reading.soil_moisture_pct
      : typeof reading.soil_moisture_raw === "number"
      ? Math.max(0, Math.min(100, Math.round((reading.soil_moisture_raw / 1023) * 100)))
      : 0;

  analyticsStore.sensorRecords.push({
    timestamp: new Date().toISOString(),
    temperature: Number(reading.temperature_c ?? 0),
    humidity: Number(reading.humidity_pct ?? 0),
    moisture: Number(moisturePct)
  });

  if (analyticsStore.sensorRecords.length > 200) {
    analyticsStore.sensorRecords = analyticsStore.sensorRecords.slice(-200);
  }

  saveAnalyticsStore();
  applyChartsFromStore();
}

function findYieldValue(payload) {
  if (payload == null) {
    return null;
  }

  if (typeof payload === "number") {
    return payload;
  }

  if (typeof payload === "string") {
    const parsed = Number(payload);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof payload === "object") {
    const preferredKeys = [
      "predicted_yield",
      "yield_prediction",
      "prediction",
      "yield",
      "result"
    ];

    for (const key of preferredKeys) {
      if (key in payload) {
        const nested = findYieldValue(payload[key]);
        if (nested != null) {
          return nested;
        }
      }
    }

    for (const value of Object.values(payload)) {
      const nested = findYieldValue(value);
      if (nested != null) {
        return nested;
      }
    }
  }

  return null;
}

function updateYieldChart(sourceLabel, payload) {
  const numericYield = findYieldValue(payload);
  if (numericYield == null) {
    return;
  }

  analyticsStore.yieldRecords.push({
    timestamp: new Date().toISOString(),
    source: sourceLabel,
    value: Number(numericYield)
  });

  if (analyticsStore.yieldRecords.length > 200) {
    analyticsStore.yieldRecords = analyticsStore.yieldRecords.slice(-200);
  }

  saveAnalyticsStore();
  applyChartsFromStore();
}

function initAnalyticsControls() {
  const applyBtn = document.getElementById("applyAnalyticsFilter");
  const resetBtn = document.getElementById("resetAnalyticsFilter");
  const exportSensorPngBtn = document.getElementById("exportSensorPng");
  const exportYieldPngBtn = document.getElementById("exportYieldPng");
  const exportCsvBtn = document.getElementById("exportAnalyticsCsv");
  const clearHistoryBtn = document.getElementById("clearAnalyticsHistory");

  applyBtn?.addEventListener("click", () => {
    applyChartsFromStore();
  });

  resetBtn?.addEventListener("click", () => {
    const startInput = document.getElementById("analyticsStart");
    const endInput = document.getElementById("analyticsEnd");
    if (startInput) {
      startInput.value = "";
    }
    if (endInput) {
      endInput.value = "";
    }
    applyChartsFromStore();
  });

  exportSensorPngBtn?.addEventListener("click", () => {
    if (!sensorTrendChart) {
      return;
    }
    const imageUrl = sensorTrendChart.toBase64Image("image/png", 1);
    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = "krishikriya-sensor-trend.png";
    document.body.appendChild(link);
    link.click();
    link.remove();
  });

  exportYieldPngBtn?.addEventListener("click", () => {
    if (!yieldTrendChart) {
      return;
    }
    const imageUrl = yieldTrendChart.toBase64Image("image/png", 1);
    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = "krishikriya-yield-trend.png";
    document.body.appendChild(link);
    link.click();
    link.remove();
  });

  exportCsvBtn?.addEventListener("click", () => {
    const rows = ["section,timestamp,source,temperature,humidity,moisture,yield"];

    analyticsStore.sensorRecords.forEach((item) => {
      rows.push(
        [
          "sensor",
          escapeCsvField(item.timestamp),
          "",
          escapeCsvField(item.temperature),
          escapeCsvField(item.humidity),
          escapeCsvField(item.moisture),
          ""
        ].join(",")
      );
    });

    analyticsStore.yieldRecords.forEach((item) => {
      rows.push(
        [
          "yield",
          escapeCsvField(item.timestamp),
          escapeCsvField(item.source),
          "",
          "",
          "",
          escapeCsvField(item.value)
        ].join(",")
      );
    });

    downloadFile("krishikriya-analytics.csv", rows.join("\n"), "text/csv;charset=utf-8");
  });

  clearHistoryBtn?.addEventListener("click", () => {
    analyticsStore.sensorRecords = [];
    analyticsStore.yieldRecords = [];
    saveAnalyticsStore();
    applyChartsFromStore();
  });
}

function initApiBaseControls() {
  const savedBase = localStorage.getItem(API_STORAGE_KEY);
  if (savedBase) {
    ui.apiBase.value = savedBase;
  }

  const savedApiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
  if (savedApiKey && ui.apiKey) {
    ui.apiKey.value = savedApiKey;
  }

  const updateStatus = () => {
    const activeBase = getApiBase();
    const hasKey = Boolean(getApiKey());
    ui.apiStatus.textContent = `Endpoint: ${activeBase} | API key: ${hasKey ? "set" : "not set"}`;
  };

  document.getElementById("saveApiBase").addEventListener("click", () => {
    const value = normalizeApiBase(ui.apiBase.value);
    localStorage.setItem(API_STORAGE_KEY, value);
    ui.apiBase.value = value;
    updateStatus();
  });

  document.getElementById("saveApiKey")?.addEventListener("click", () => {
    const key = (ui.apiKey?.value || "").trim();
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
    if (ui.apiKey) {
      ui.apiKey.value = key;
    }
    updateStatus();
  });

  updateStatus();
}

function initDiseaseForm() {
  const form = document.getElementById("diseaseForm");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showOutput(ui.diseaseOut, "Running...");

    const data = new FormData(form);
    const file = data.get("file");
    const topK = Number(data.get("top_k") || 3);
    const includeRaw = data.get("include_raw") === "on";

    const params = new URLSearchParams({ top_k: String(topK), include_raw: String(includeRaw) });

    try {
      const result = await requestJson(`/predict?${params.toString()}`, {
        method: "POST",
        body: new FormData(form)
      });
      renderDiseaseResult(ui.diseaseOut, result);
    } catch (error) {
      if (!file || !file.name) {
        showOutput(ui.diseaseOut, "Please select an image file first.", true);
        return;
      }
      showOutput(ui.diseaseOut, error.message, true);
    }
  });
}

function initYieldForm() {
  const form = document.getElementById("yieldForm");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showOutput(ui.yieldOut, "Running...");

    try {
      const payload = collectJson(form);
      const result = await requestJson("/yield", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      renderYieldResult(ui.yieldOut, result);
      updateYieldChart("Yield API", result);
    } catch (error) {
      showOutput(ui.yieldOut, error.message, true);
    }
  });
}

function initIntegratedForm() {
  const form = document.getElementById("integratedForm");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showOutput(ui.integratedOut, "Running...");

    const data = new FormData(form);
    const topK = Number(data.get("top_k") || 3);
    const includeRaw = data.get("include_raw") === "on";

    data.delete("top_k");
    data.delete("include_raw");

    const params = new URLSearchParams({ top_k: String(topK), include_raw: String(includeRaw) });

    try {
      const result = await requestJson(`/predict-all?${params.toString()}`, {
        method: "POST",
        body: data
      });
      renderIntegratedResult(ui.integratedOut, result);
      updateYieldChart("Integrated", result?.yield_prediction ?? result);
    } catch (error) {
      showOutput(ui.integratedOut, error.message, true);
    }
  });
}

function initIotIngestForm() {
  const form = document.getElementById("iotIngestForm");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showOutput(ui.iotIngestOut, "Sending packet...");

    try {
      const payload = collectJson(form);
      const result = await requestJson("/iot/sensors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      showOutput(ui.iotIngestOut, result);
      latestSensorReading = result?.reading || null;
      fillIrrigationFormFromSensor(latestSensorReading);
      updateSensorChart(result?.reading);
    } catch (error) {
      showOutput(ui.iotIngestOut, error.message, true);
    }
  });
}

function initIotReadActions() {
  document.getElementById("latestSensorBtn").addEventListener("click", async () => {
    showOutput(ui.latestSensorOut, "Fetching latest reading...");

    try {
      const result = await requestJson("/iot/sensors/latest", { method: "GET" });
      showOutput(ui.latestSensorOut, result);
      latestSensorReading = result?.reading || null;
      fillIrrigationFormFromSensor(latestSensorReading);
      updateSensorChart(result?.reading);
    } catch (error) {
      showOutput(ui.latestSensorOut, error.message, true);
    }
  });

  const form = document.getElementById("iotYieldForm");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showOutput(ui.iotYieldOut, "Running IoT yield prediction...");

    try {
      const payload = collectJson(form);
      const result = await requestJson("/iot/yield-predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      renderYieldResult(ui.iotYieldOut, result);
      updateYieldChart("IoT Yield", result?.yield_prediction ?? result);
    } catch (error) {
      showOutput(ui.iotYieldOut, error.message, true);
    }
  });
}

function initIrrigationForm() {
  const form = document.getElementById("irrigationForm");
  const syncBtn = document.getElementById("syncIrrigationFromLatest");
  const useIotCheckbox = document.getElementById("irrigationUseIot");

  syncBtn?.addEventListener("click", async () => {
    if (!latestSensorReading) {
      try {
        const result = await requestJson("/iot/sensors/latest", { method: "GET" });
        latestSensorReading = result?.reading || null;
      } catch (error) {
        showOutput(ui.irrigationOut, error.message, true);
        return;
      }
    }

    fillIrrigationFormFromSensor(latestSensorReading);
    showOutput(ui.irrigationOut, "Smart irrigation form synced from latest IoT reading.");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showOutput(ui.irrigationOut, "Evaluating irrigation decision...");

    try {
      const payload = collectJson(form, true);
      const useIot = Boolean(useIotCheckbox?.checked);
      delete payload.use_iot;

      const path = useIot ? "/irrigation/recommend-from-iot" : "/irrigation/recommend";
      const result = await requestJson(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      renderIrrigationResult(ui.irrigationOut, result);
    } catch (error) {
      showOutput(ui.irrigationOut, error.message, true);
    }
  });
}

function init() {
  loadAnalyticsStore();
  initCharts();
  initAnalyticsControls();
  applyChartsFromStore();
  initApiBaseControls();
  initDiseaseForm();
  initYieldForm();
  initIntegratedForm();
  initIotIngestForm();
  initIotReadActions();
  initIrrigationForm();
}

function installSubmitGuards() {
  const formIds = [
    "diseaseForm",
    "yieldForm",
    "integratedForm",
    "iotIngestForm",
    "iotYieldForm",
    "irrigationForm"
  ];

  formIds.forEach((id) => {
    const form = document.getElementById(id);
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
    });
  });
}

installSubmitGuards();

try {
  init();
} catch (error) {
  console.error("Frontend initialization failed", error);
  const startupMsg = `Startup error: ${error?.message || "Unknown error"}`;
  [
    ui.diseaseOut,
    ui.yieldOut,
    ui.integratedOut,
    ui.iotIngestOut,
    ui.latestSensorOut,
    ui.iotYieldOut,
    ui.irrigationOut
  ].forEach((el) => {
    if (el) {
      showOutput(el, startupMsg, true);
    }
  });
}
