'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Write per-monitor HTML capability reports.
 */

function statusCell(works) {
    if (works === true) return { cls: 'ok', text: 'Works' };
    if (works === false) return { cls: 'fail', text: 'Does not work' };
    return { cls: 'skip', text: 'Skipped / unknown' };
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderRows(probes) {
    return probes
        .map((p) => {
            const st = statusCell(p.works);
            return `<tr>
  <td>${escapeHtml(p.category)}</td>
  <td>${escapeHtml(p.label)}</td>
  <td class="${st.cls}">${st.text}</td>
  <td><code>${escapeHtml(p.id)}</code></td>
  <td>${escapeHtml(p.detail)}</td>
</tr>`;
        })
        .join('\n');
}

function identityBlock(monitor) {
    const id = monitor.identity || {};
    const rows = [
        ['xrandr output', monitor.xrandrName],
        ['DRM connector', monitor.drmName],
        ['Make', id.make || '—'],
        ['Model', id.model || '—'],
        ['Manufacturer ID (PNP)', id.manufacturerId || '—'],
        ['Product code', id.productCode ?? '—'],
        ['Serial (ASCII)', id.serialAscii || '—'],
        ['Manufactured', id.manufactureYear ? `week ${id.manufactureWeek}, ${id.manufactureYear}` : '—'],
        ['Current mode', id.currentMode || '—'],
        ['Geometry', id.geometry || '—'],
        ['Primary', id.primary ? 'yes' : 'no'],
        ['I2C (DDC)', monitor.i2cBus || '—'],
        ['CEC device', monitor.cecDevice || '—'],
        ['DISPLAY', monitor.display],
        [
            'Physical size (mm)',
            id.displaySizeMm ? `${id.displaySizeMm.width} × ${id.displaySizeMm.height}` : '—',
        ],
    ];
    return rows
        .map(
            ([k, v]) =>
                `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`
        )
        .join('\n');
}

function toolsBlock(tools) {
    return Object.entries(tools || {})
        .map(([name, pathOrNull]) => {
            const st = pathOrNull
                ? `<span class="ok">found</span> <code>${escapeHtml(pathOrNull)}</code>`
                : `<span class="fail">missing</span>`;
            return `<li><strong>${escapeHtml(name)}</strong>: ${st}</li>`;
        })
        .join('\n');
}

function buildHtml(report) {
    const { monitor, probes, meta } = report;
    const title = `${monitor.xrandrName} — ${monitor.identity?.make || 'Unknown'} ${monitor.identity?.model || ''}`.trim();

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)} — display control probe</title>
<style>
  :root {
    --bg: #14181c;
    --panel: #1e252c;
    --text: #e8eef4;
    --muted: #9aa7b5;
    --ok: #3d9a6a;
    --fail: #c44c4c;
    --skip: #b0892e;
    --line: #2c3640;
    --accent: #6cb2d6;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
    background: radial-gradient(1200px 600px at 10% -10%, #243040, transparent),
                radial-gradient(900px 500px at 100% 0%, #1a2830, transparent),
                var(--bg);
    color: var(--text);
    line-height: 1.45;
    padding: 2rem clamp(1rem, 4vw, 3rem) 3rem;
  }
  h1 { font-size: 1.75rem; margin: 0 0 0.25rem; font-weight: 650; }
  .sub { color: var(--muted); margin-bottom: 1.75rem; }
  .grid { display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
  section {
    background: color-mix(in srgb, var(--panel) 92%, black);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 1rem 1.15rem 1.15rem;
  }
  section.full { grid-column: 1 / -1; }
  h2 { font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); margin: 0 0 0.75rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
  th, td { text-align: left; padding: 0.45rem 0.55rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 560; width: 40%; }
  .chart th { width: auto; }
  .ok { color: #7ddea8; font-weight: 600; }
  .fail { color: #f0a0a0; font-weight: 600; }
  .skip { color: #e6c87a; font-weight: 600; }
  code { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 0.84em; color: #c9d7e3; }
  ul { margin: 0; padding-left: 1.1rem; }
  li { margin: 0.25rem 0; }
  footer { margin-top: 1.5rem; color: var(--muted); font-size: 0.85rem; }
  .legend span { margin-right: 1rem; }
</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p class="sub">PFx display-control experiment · ${escapeHtml(meta.timestamp)} · host ${escapeHtml(meta.host)}</p>
  </header>

  <div class="grid">
    <section>
      <h2>Display information</h2>
      <table>${identityBlock(monitor)}</table>
    </section>
    <section>
      <h2>Host tools</h2>
      <ul>${toolsBlock(meta.tools)}</ul>
      <p class="sub" style="margin-top:1rem">Mode: ${escapeHtml(meta.mode)}</p>
    </section>
    <section class="full">
      <h2>Sensing &amp; control capability chart</h2>
      <p class="legend sub">
        <span class="ok">Works</span>
        <span class="fail">Does not work</span>
        <span class="skip">Skipped / unknown</span>
      </p>
      <table class="chart">
        <thead>
          <tr><th>Category</th><th>Option</th><th>Result</th><th>ID</th><th>Detail</th></tr>
        </thead>
        <tbody>
          ${renderRows(probes)}
        </tbody>
      </table>
    </section>
  </div>

  <footer>
    Generated by <code>experiments/display-control/run-display-probe.js</code>
    for PR_MONITOR_CONTROL validation. JSON twin: same basename with <code>.json</code>.
  </footer>
</body>
</html>
`;
}

function safeSlug(monitor) {
    const make = (monitor.identity?.make || 'unknown').replace(/[^a-zA-Z0-9]+/g, '-');
    const model = (monitor.identity?.model || 'display').replace(/[^a-zA-Z0-9]+/g, '-');
    return `${monitor.xrandrName}_${make}_${model}`.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function writeMonitorReport(reportsDir, report) {
    fs.mkdirSync(reportsDir, { recursive: true });
    const slug = safeSlug(report.monitor);
    const stamp = report.meta.timestamp.replace(/[:.]/g, '-');
    const base = `${slug}_${stamp}`;
    const htmlPath = path.join(reportsDir, `${base}.html`);
    const jsonPath = path.join(reportsDir, `${base}.json`);
    const latestHtml = path.join(reportsDir, `${report.monitor.xrandrName}-latest.html`);
    const latestJson = path.join(reportsDir, `${report.monitor.xrandrName}-latest.json`);

    const html = buildHtml(report);
    fs.writeFileSync(htmlPath, html, 'utf8');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(latestHtml, html, 'utf8');
    fs.writeFileSync(latestJson, JSON.stringify(report, null, 2), 'utf8');

    return { htmlPath, jsonPath, latestHtml, latestJson };
}

function writeIndex(reportsDir, summaries) {
    const items = summaries
        .map((s) => {
            const st = s.probes.reduce(
                (acc, p) => {
                    if (p.works === true) acc.ok += 1;
                    else if (p.works === false) acc.fail += 1;
                    else acc.skip += 1;
                    return acc;
                },
                { ok: 0, fail: 0, skip: 0 }
            );
            return `<li>
  <a href="${escapeHtml(path.basename(s.htmlPath))}">${escapeHtml(s.title)}</a>
  — <span class="ok">${st.ok} work</span>,
  <span class="fail">${st.fail} fail</span>,
  <span class="skip">${st.skip} skip</span>
</li>`;
        })
        .join('\n');

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Display control probe index</title>
<style>
 body{font-family:system-ui,sans-serif;background:#14181c;color:#e8eef4;padding:2rem}
 a{color:#6cb2d6}.ok{color:#7ddea8}.fail{color:#f0a0a0}.skip{color:#e6c87a}
</style></head>
<body>
<h1>Display control probe reports</h1>
<ul>${items || '<li>No connected monitors reported.</li>'}</ul>
</body></html>`;
    const indexPath = path.join(reportsDir, 'index.html');
    fs.writeFileSync(indexPath, html, 'utf8');
    return indexPath;
}

module.exports = {
    buildHtml,
    writeMonitorReport,
    writeIndex,
};
