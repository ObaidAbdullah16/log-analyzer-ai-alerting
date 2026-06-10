const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8090);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "logs.json");
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const ALERT_THRESHOLD_COUNT = Number(process.env.ALERT_THRESHOLD_COUNT || 6);
const ALERT_GROWTH_PERCENT = Number(process.env.ALERT_GROWTH_PERCENT || 250);
const ALERT_COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS || 180000);
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || "";
const LLM_API_URL = process.env.LLM_API_URL || "https://api.openai.com/v1/chat/completions";
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "gpt-4o-mini";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function now() {
  return new Date().toISOString();
}

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString("hex")}`;
}

function hash(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultStore(), null, 2));
  }
}

function defaultStore() {
  return {
    meta: {
      createdAt: now(),
      name: "TraceLens Logs"
    },
    logs: [],
    groups: {},
    alerts: [],
    events: [
      {
        id: uid("evt"),
        type: "system",
        message: "Log analyzer initialized",
        createdAt: now()
      }
    ]
  };
}

function loadStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function saveStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function addEvent(store, type, message, details = {}) {
  store.events.unshift({
    id: uid("evt"),
    type,
    message,
    details,
    createdAt: now()
  });
  store.events = store.events.slice(0, 100);
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  json(res, 404, { error: "Not found" });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function normalizeMessage(message) {
  return String(message || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "<ip>")
    .replace(/\b[0-9a-f]{8,}\b/g, "<hex>")
    .replace(/\b\d+(?:ms|s|m|kb|mb|gb|%)?\b/g, "<num>")
    .replace(/"[^"]*"/g, "\"<text>\"")
    .replace(/'[^']*'/g, "'<text>'")
    .replace(/[a-z]:\\[^\s]+/gi, "<path>")
    .replace(/\/[^\s]+/g, "<path>")
    .replace(/\s+/g, " ")
    .trim();
}

function isErrorLog(log) {
  const level = String(log.level || "").toLowerCase();
  const statusCode = Number(log.statusCode || log.metadata?.statusCode || 0);
  return ["error", "fatal", "critical"].includes(level) || statusCode >= 500;
}

function bucketTrend(logs) {
  const buckets = Array.from({ length: 12 }, (_, index) => ({
    label: `${55 - index * 5}m`,
    count: 0
  })).reverse();
  const current = Date.now();
  for (const log of logs) {
    const ageMs = current - new Date(log.timestamp).getTime();
    if (ageMs < 0 || ageMs > 60 * 60 * 1000) continue;
    const bucketIndex = Math.min(11, Math.floor(ageMs / (5 * 60 * 1000)));
    buckets[11 - bucketIndex].count += 1;
  }
  return buckets;
}

function buildFallbackSummary(group, growthPercent) {
  const sample = `${group.exampleMessage || ""} ${group.lastMessage || ""}`.toLowerCase();
  const service = group.service || "the service";
  let cause = "The issue is likely related to a recent code path or dependency failure shared by these similar errors.";
  let action = "Check the latest deployment, dependency health, and the service logs around the first spike.";

  if (sample.includes("pool") || sample.includes("too many clients") || sample.includes("connection exhausted")) {
    cause = "Database connection pool exhausted.";
    action = "Increase pool limits carefully, close leaked connections, and check slow queries.";
  } else if (sample.includes("econnrefused") || sample.includes("connection refused")) {
    cause = "A downstream service is refusing connections.";
    action = "Verify the dependency is running, reachable from the container network, and has healthy target registrations.";
  } else if (sample.includes("timeout") || sample.includes("timed out")) {
    cause = "A dependency is responding too slowly or timing out.";
    action = "Check latency, retry settings, and recent traffic growth for the affected dependency.";
  } else if (sample.includes("memory") || sample.includes("heap")) {
    cause = "The service may be under memory pressure.";
    action = "Inspect memory metrics, container limits, and recent payload size changes.";
  } else if (sample.includes("auth") || sample.includes("token") || sample.includes("unauthorized")) {
    cause = "Authentication or token validation is failing.";
    action = "Check secret rotation, token expiry, and auth service availability.";
  }

  return {
    provider: "fallback",
    text: `${group.statusCode || 500} errors increased by ${growthPercent}%. Likely cause: ${cause} Recommended action: ${action}`,
    likelyCause: cause,
    recommendedAction: action,
    generatedAt: now()
  };
}

async function generateLlmSummary(group, growthPercent) {
  const fallback = buildFallbackSummary(group, growthPercent);
  if (!LLM_API_KEY) return fallback;

  const prompt = [
    "You are an SRE assistant. Summarize the likely root cause of this error spike in two short sentences.",
    "Avoid making up facts. Use the evidence only.",
    "",
    `Service: ${group.service}`,
    `HTTP status: ${group.statusCode || "unknown"}`,
    `Similar error count: ${group.count}`,
    `Growth: ${growthPercent}%`,
    `Normalized error: ${group.normalizedMessage}`,
    `Example: ${group.exampleMessage}`
  ].join("\n");

  try {
    const response = await fetch(LLM_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${LLM_API_KEY}`
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          {
            role: "system",
            content: "You generate concise operational root-cause summaries for cloud-native incidents."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.2,
        max_tokens: 120
      })
    });

    if (!response.ok) return fallback;
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return fallback;
    return {
      provider: "llm",
      text,
      likelyCause: text,
      recommendedAction: fallback.recommendedAction,
      generatedAt: now()
    };
  } catch {
    return fallback;
  }
}

async function sendAlert(alert) {
  if (!ALERT_WEBHOOK_URL) return;
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(alert)
    });
  } catch {
    // Alert persistence is more important than blocking ingestion on webhook failures.
  }
}

function windowStats(logs, fingerprint) {
  const current = Date.now();
  const currentWindowStart = current - 5 * 60 * 1000;
  const previousWindowStart = current - 10 * 60 * 1000;
  let currentCount = 0;
  let previousCount = 0;

  for (const log of logs) {
    if (log.fingerprint !== fingerprint) continue;
    const timestamp = new Date(log.timestamp).getTime();
    if (timestamp >= currentWindowStart) currentCount += 1;
    if (timestamp >= previousWindowStart && timestamp < currentWindowStart) previousCount += 1;
  }

  const growthPercent = previousCount === 0
    ? currentCount >= ALERT_THRESHOLD_COUNT ? 300 : 0
    : Math.round(((currentCount - previousCount) / previousCount) * 100);

  return { currentCount, previousCount, growthPercent };
}

async function evaluateAlert(store, group) {
  const stats = windowStats(store.logs, group.fingerprint);
  const lastAlertAt = group.lastAlertAt ? new Date(group.lastAlertAt).getTime() : 0;
  const cooldownPassed = Date.now() - lastAlertAt > ALERT_COOLDOWN_MS;
  const shouldAlert =
    stats.currentCount >= ALERT_THRESHOLD_COUNT &&
    stats.growthPercent >= ALERT_GROWTH_PERCENT &&
    cooldownPassed;

  if (!shouldAlert) return null;

  const summary = await generateLlmSummary(group, stats.growthPercent);
  const alert = {
    id: uid("alert"),
    groupId: group.fingerprint,
    service: group.service,
    statusCode: group.statusCode || 500,
    severity: stats.currentCount >= ALERT_THRESHOLD_COUNT * 2 ? "critical" : "warning",
    title: `${group.service} error spike detected`,
    message: `${group.statusCode || 500} errors increased by ${stats.growthPercent}%`,
    currentWindowCount: stats.currentCount,
    previousWindowCount: stats.previousCount,
    growthPercent: stats.growthPercent,
    summary,
    createdAt: now()
  };

  group.lastAlertAt = alert.createdAt;
  group.summary = summary;
  store.alerts.unshift(alert);
  store.alerts = store.alerts.slice(0, 50);
  addEvent(store, "alert", alert.title, { alertId: alert.id, groupId: group.fingerprint });
  await sendAlert(alert);
  return alert;
}

async function ingestLog(payload) {
  const store = loadStore();
  const timestamp = payload.timestamp || now();
  const level = String(payload.level || "info").toLowerCase();
  const message = String(payload.message || "").trim();
  const metadata = typeof payload.metadata === "object" && payload.metadata !== null ? payload.metadata : {};
  const normalizedMessage = normalizeMessage(message);
  const service = String(payload.service || "unknown-service").trim() || "unknown-service";
  const fingerprint = hash(`${service}:${normalizedMessage}`);
  const statusCode = Number(payload.statusCode || metadata.statusCode || 0) || null;

  const log = {
    id: uid("log"),
    timestamp,
    service,
    level,
    message,
    normalizedMessage,
    fingerprint,
    statusCode,
    metadata
  };

  store.logs.unshift(log);
  store.logs = store.logs.slice(0, 1000);

  let alert = null;
  if (isErrorLog(log)) {
    const existing = store.groups[fingerprint];
    const group = existing || {
      fingerprint,
      service,
      level,
      statusCode,
      normalizedMessage,
      exampleMessage: message,
      lastMessage: message,
      count: 0,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      summary: null,
      lastAlertAt: null
    };

    group.count += 1;
    group.level = level;
    group.statusCode = statusCode || group.statusCode;
    group.lastMessage = message;
    group.lastSeenAt = timestamp;
    store.groups[fingerprint] = group;
    alert = await evaluateAlert(store, group);
  }

  if (level === "fatal" || level === "critical") {
    addEvent(store, "log", `High severity log received from ${service}`, { logId: log.id });
  }

  saveStore(store);
  return { log, alert };
}

function dashboard(store) {
  const logs = store.logs;
  const errors = logs.filter(isErrorLog);
  const services = [...new Set(logs.map(log => log.service))];
  const lastHour = logs.filter(log => Date.now() - new Date(log.timestamp).getTime() <= 60 * 60 * 1000);
  const groups = Object.values(store.groups).sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));

  return {
    totals: {
      logs: logs.length,
      errors: errors.length,
      services: services.length,
      activeGroups: groups.length,
      alerts: store.alerts.length
    },
    trend: bucketTrend(lastHour),
    recentLogs: logs.slice(0, 80),
    groups: groups.slice(0, 30),
    alerts: store.alerts.slice(0, 20),
    events: store.events.slice(0, 20),
    llmEnabled: Boolean(LLM_API_KEY)
  };
}

function serveStatic(req, res) {
  const rawPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const safePath = path.normalize(rawPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    notFound(res);
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      notFound(res);
      return;
    }
    res.writeHead(200, { "content-type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  });
}

function sampleSpikeMessages() {
  return [
    "HTTP 500: database connection pool exhausted after waiting 3000ms for tenant 9182",
    "HTTP 500: database connection pool exhausted after waiting 3200ms for tenant 4421",
    "HTTP 500: database connection pool exhausted after waiting 2800ms for tenant 1990",
    "HTTP 500: database connection pool exhausted after waiting 3500ms for tenant 7211",
    "HTTP 500: database connection pool exhausted after waiting 3300ms for tenant 6732",
    "HTTP 500: database connection pool exhausted after waiting 3700ms for tenant 1022",
    "HTTP 500: database connection pool exhausted after waiting 3100ms for tenant 5821",
    "HTTP 500: database connection pool exhausted after waiting 3900ms for tenant 7582"
  ];
}

async function seedDemoSpike() {
  const messages = sampleSpikeMessages();
  const results = [];
  for (const message of messages) {
    results.push(await ingestLog({
      service: "orders-api",
      level: "error",
      statusCode: 500,
      message,
      metadata: {
        route: "/orders",
        region: "ap-south-1",
        container: `orders-${Math.floor(Math.random() * 9) + 1}`
      }
    }));
  }
  return results;
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const store = loadStore();

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, service: "log-analyzer", checkedAt: now() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    json(res, 200, dashboard(store));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/logs") {
    const level = url.searchParams.get("level");
    const service = url.searchParams.get("service");
    const logs = store.logs.filter(log => {
      if (level && log.level !== level) return false;
      if (service && log.service !== service) return false;
      return true;
    });
    json(res, 200, { logs: logs.slice(0, 200) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/groups") {
    json(res, 200, { groups: Object.values(store.groups) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/alerts") {
    json(res, 200, { alerts: store.alerts });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logs") {
    const body = await readBody(req);
    if (!body.message) {
      json(res, 400, { error: "Log message is required" });
      return;
    }
    const result = await ingestLog(body);
    json(res, 201, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/demo/spike") {
    const results = await seedDemoSpike();
    json(res, 201, { inserted: results.length, latestAlert: results.find(item => item.alert)?.alert || null });
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/logs") {
    saveStore(defaultStore());
    json(res, 200, { ok: true });
    return;
  }

  notFound(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/") || req.url === "/health") {
      await handleApi(req, res);
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  ensureStore();
  console.log(`Log analyzer listening on ${PORT}`);
});
