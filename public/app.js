const metricsEl = document.querySelector("#metrics");
const chartEl = document.querySelector("#chart");
const groupsEl = document.querySelector("#groups");
const alertsEl = document.querySelector("#alerts");
const logsEl = document.querySelector("#logs");
const llmStatusEl = document.querySelector("#llmStatus");
const refreshButton = document.querySelector("#refreshButton");
const spikeButton = document.querySelector("#spikeButton");
const resetButton = document.querySelector("#resetButton");
const logForm = document.querySelector("#logForm");

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function formatTime(value) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "short"
  }).format(new Date(value));
}

function metric(label, value) {
  return `
    <article class="metric">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `;
}

function levelPill(level) {
  return `<span class="level-pill level-${level}">${level}</span>`;
}

function renderMetrics(data) {
  metricsEl.innerHTML = [
    metric("Logs", data.totals.logs),
    metric("Errors", data.totals.errors),
    metric("Services", data.totals.services),
    metric("Groups", data.totals.activeGroups),
    metric("Alerts", data.totals.alerts)
  ].join("");

  llmStatusEl.textContent = data.llmEnabled ? "LLM enabled" : "Fallback summary";
  llmStatusEl.className = `mode-pill ${data.llmEnabled ? "enabled" : ""}`;
}

function renderChart(trend) {
  const max = Math.max(1, ...trend.map(item => item.count));
  chartEl.innerHTML = trend.map(item => {
    const height = Math.max(8, Math.round((item.count / max) * 230));
    return `
      <div class="bar-wrap">
        <div class="bar" title="${item.count} logs" style="height: ${height}px"></div>
        <div class="bar-label">${item.count}</div>
      </div>
    `;
  }).join("");
}

function renderGroups(groups) {
  if (!groups.length) {
    groupsEl.innerHTML = `<div class="empty">No grouped errors yet</div>`;
    return;
  }

  groupsEl.innerHTML = groups.map(group => `
    <article class="card">
      <div class="group-head">
        <div>
          <h3>${group.service}</h3>
          <span class="fingerprint">${group.fingerprint}</span>
        </div>
        ${levelPill(group.level || "error")}
      </div>
      <p>${group.normalizedMessage}</p>
      <p>Count: <strong>${group.count}</strong> • Last seen: ${formatTime(group.lastSeenAt)}</p>
      ${group.summary ? `<p><strong>Summary:</strong> ${group.summary.text}</p>` : ""}
    </article>
  `).join("");
}

function renderAlerts(alerts) {
  if (!alerts.length) {
    alertsEl.innerHTML = `<div class="empty">No alerts yet</div>`;
    return;
  }

  alertsEl.innerHTML = alerts.map(alert => `
    <article class="card">
      <div class="group-head">
        <div>
          <h3>${alert.title}</h3>
          <span class="fingerprint">${formatTime(alert.createdAt)}</span>
        </div>
        ${levelPill(alert.severity)}
      </div>
      <p>${alert.message}</p>
      <p>${alert.summary?.text || "Summary pending"}</p>
      <p>Current window: <strong>${alert.currentWindowCount}</strong> • Previous window: <strong>${alert.previousWindowCount}</strong></p>
    </article>
  `).join("");
}

function renderLogs(logs) {
  if (!logs.length) {
    logsEl.innerHTML = `<div class="empty">No logs ingested yet</div>`;
    return;
  }

  logsEl.innerHTML = logs.map(log => `
    <article class="log-line">
      ${levelPill(log.level)}
      <span>${formatTime(log.timestamp)}</span>
      <span>${log.service}</span>
      <div class="log-message">${log.message}</div>
    </article>
  `).join("");
}

async function load() {
  const data = await api("/api/dashboard");
  renderMetrics(data);
  renderChart(data.trend);
  renderGroups(data.groups);
  renderAlerts(data.alerts);
  renderLogs(data.recentLogs);
}

logForm.addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(logForm);
  const payload = {
    service: form.get("service"),
    level: form.get("level"),
    message: form.get("message"),
    statusCode: Number(form.get("statusCode") || 0),
    metadata: {
      region: form.get("region")
    }
  };
  await api("/api/logs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  await load();
});

spikeButton.addEventListener("click", async () => {
  spikeButton.disabled = true;
  try {
    await api("/api/demo/spike", { method: "POST" });
    await load();
  } finally {
    spikeButton.disabled = false;
  }
});

resetButton.addEventListener("click", async () => {
  resetButton.disabled = true;
  try {
    await api("/api/logs", { method: "DELETE" });
    await load();
  } finally {
    resetButton.disabled = false;
  }
});

refreshButton.addEventListener("click", load);

load();
setInterval(load, 8000);
