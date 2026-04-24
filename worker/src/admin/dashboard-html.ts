// Embedded dashboard HTML (rendered by dashboard-route.ts).
// Template-literal approach avoids needing a ?raw esbuild import. Size is small
// enough (~6 KB) that bundle overhead is negligible.
export const dashboardHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>YouCoded Admin · Analytics</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: #0b0d10; color: #e6e8eb; margin: 0; padding: 24px; }
  h1 { font-weight: 500; font-size: 20px; margin: 0 0 16px; }
  .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
             gap: 12px; margin-bottom: 24px; }
  .kpi { background: #13171c; border: 1px solid #23272d; border-radius: 8px;
         padding: 16px; }
  .kpi .label { font-size: 11px; text-transform: uppercase; color: #8a8f98; letter-spacing: 0.5px; }
  .kpi .value { font-size: 28px; font-weight: 600; margin-top: 6px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .card { background: #13171c; border: 1px solid #23272d; border-radius: 8px; padding: 16px; }
  .card h2 { font-size: 13px; font-weight: 500; color: #8a8f98; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td, th { padding: 6px 8px; border-bottom: 1px solid #23272d; text-align: left; }
  th { color: #8a8f98; font-weight: 500; }
  @media (max-width: 720px) { .grid-2 { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<h1>YouCoded · Analytics</h1>
<div class="kpi-row">
  <div class="kpi"><div class="label">DAU (today)</div><div class="value" id="kpi-dau">—</div></div>
  <div class="kpi"><div class="label">MAU (30-day)</div><div class="value" id="kpi-mau">—</div></div>
  <div class="kpi"><div class="label">Installs (7d)</div><div class="value" id="kpi-installs7">—</div></div>
</div>

<div class="grid-2">
  <div class="card"><h2>DAU — last 30 days</h2><canvas id="chart-dau"></canvas></div>
  <div class="card"><h2>New installs — last 90 days</h2><canvas id="chart-installs"></canvas></div>
</div>

<div class="grid-2">
  <div class="card"><h2>Versions (active users)</h2>
    <table><thead><tr><th>Version</th><th>Users</th></tr></thead><tbody id="tbl-versions"></tbody></table>
  </div>
  <div class="card"><h2>Platforms</h2>
    <table><thead><tr><th>Platform</th><th>Users</th></tr></thead><tbody id="tbl-platforms"></tbody></table>
  </div>
</div>

<div class="grid-2">
  <div class="card" style="grid-column: 1 / -1;"><h2>Top countries</h2>
    <table><thead><tr><th>Country</th><th>Users</th></tr></thead><tbody id="tbl-countries"></tbody></table>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script>
// The dashboard is served by the same origin as the JSON routes, so the browser's
// session cookie (set by the OAuth flow) authenticates these requests automatically.
async function getJSON(url) {
  const r = await fetch(url, { credentials: "same-origin" });
  if (!r.ok) throw new Error(url + " -> " + r.status);
  return r.json();
}

function renderTable(id, rows, keys) {
  const tbody = document.getElementById(id);
  tbody.innerHTML = rows.map(function (r) {
    return "<tr>" + keys.map(function (k) { return "<td>" + (r[k] == null ? "" : r[k]) + "</td>"; }).join("") + "</tr>";
  }).join("") || '<tr><td colspan="2" style="color:#6a6f78">No data yet</td></tr>';
}

function renderLineChart(canvasId, rows, xKey, yKey, label) {
  const ctx = document.getElementById(canvasId).getContext("2d");
  new Chart(ctx, {
    type: "line",
    data: {
      labels: rows.map(function (r) { return r[xKey]; }),
      datasets: [{ label: label, data: rows.map(function (r) { return r[yKey]; }),
                   borderColor: "#5b9dff", backgroundColor: "rgba(91,157,255,0.1)",
                   tension: 0.25, fill: true, pointRadius: 2 }]
    },
    options: { plugins: { legend: { display: false } },
               scales: { x: { ticks: { color: "#8a8f98" }, grid: { color: "#23272d" } },
                         y: { ticks: { color: "#8a8f98" }, grid: { color: "#23272d" }, beginAtZero: true } } }
  });
}

(async function main() {
  try {
    const [dau, mau, installs, versions, platforms, countries] = await Promise.all([
      getJSON("/admin/analytics/dau?days=30"),
      getJSON("/admin/analytics/mau"),
      getJSON("/admin/analytics/installs?days=90"),
      getJSON("/admin/analytics/versions"),
      getJSON("/admin/analytics/platforms"),
      getJSON("/admin/analytics/countries")
    ]);
    var latestDau = dau.length ? dau[dau.length - 1].dau : 0;
    document.getElementById("kpi-dau").textContent = latestDau;
    document.getElementById("kpi-mau").textContent = mau.mau == null ? 0 : mau.mau;
    var last7 = installs.slice(-7).reduce(function (s, r) { return s + (r.installs || 0); }, 0);
    document.getElementById("kpi-installs7").textContent = last7;
    renderLineChart("chart-dau", dau, "day", "dau", "DAU");
    renderLineChart("chart-installs", installs, "day", "installs", "Installs");
    renderTable("tbl-versions", versions, ["version", "users"]);
    renderTable("tbl-platforms", platforms, ["platform", "users"]);
    renderTable("tbl-countries", countries, ["country", "users"]);
  } catch (e) {
    document.body.insertAdjacentHTML("afterbegin",
      '<pre style="color:#ff6b6b">' + String(e) + "</pre>");
  }
})();
</script>
</body>
</html>`;
