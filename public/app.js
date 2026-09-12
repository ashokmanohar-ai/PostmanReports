const $ = id => document.getElementById(id);
const api = async (url, options = {}) => {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
};

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function loadOverview() {
  const data = await api('/api/overview');
  const m = data.metrics;
  $('metricConnectors').textContent = m.connectors;
  $('metricTools').textContent = m.tools;
  $('metricSuccess').textContent = `${m.successRate}%`;
  $('metricLatency').textContent = `${m.p95GatewayLatency}ms`;
  $('metricPolicy').textContent = `${m.policyCoverage}%`;
}

async function loadConnectors() {
  const { connectors } = await api('/api/connectors');
  $('systemGrid').innerHTML = connectors.map(c => `<div class="system-node"><strong>${escapeHtml(c.name)}</strong><small>● ${escapeHtml(c.status)}</small></div>`).join('');
}

async function loadTools() {
  const { tools } = await api('/api/tools');
  $('toolRows').innerHTML = tools.map(t => `<tr><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.connector)}</td><td><code>${escapeHtml(t.scope)}</code></td><td><span class="risk ${escapeHtml(t.risk)}">${escapeHtml(t.risk)}</span></td><td>${t.p95} ms</td></tr>`).join('');
  $('policyTool').innerHTML = tools.map(t => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join('');
}

async function loadWorkflows() {
  const { workflows } = await api('/api/workflows');
  $('workflowSelect').innerHTML = workflows.map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)}</option>`).join('');
}

async function loadTraces() {
  const { traces } = await api('/api/traces');
  $('traceCards').innerHTML = traces.map(t => `<article class="trace-card"><div class="trace-top"><span>${escapeHtml(t.id)}</span><span class="trace-badge ${t.status === 'WARN' ? 'warn' : ''}">${escapeHtml(t.status)}</span></div><strong>${escapeHtml(t.workflow)}</strong><div class="trace-meta"><span>${t.duration} ms</span><span>${t.tools} tools</span><span>${escapeHtml(t.policy)}</span></div></article>`).join('');
}

function renderWorkflow(result) {
  $('traceTitle').textContent = `${result.workflow} · ${result.traceId}`;
  $('traceStatus').textContent = result.status;
  $('traceStatus').className = `status ${result.status === 'PASS' ? 'pass' : 'fail'}`;
  $('traceSteps').innerHTML = result.steps.map(s => `<div class="trace-step ${s.status.toLowerCase()}"><span class="step-index">${s.sequence}</span><div><strong>${escapeHtml(s.tool)}</strong><small>${escapeHtml(s.connector)} · ${escapeHtml(s.evidence)}</small></div><span class="step-state">${escapeHtml(s.status)} · ${s.latencyMs}ms</span></div>`).join('');
  const decision = result.qualityGate.releaseDecision;
  $('gateBox').innerHTML = `<strong>Release gate · ${result.durationMs} ms</strong><span style="color:${decision === 'PROCEED' ? '#0f9d70' : '#d54a5d'}">${escapeHtml(decision)}</span>`;
}

$('runWorkflow').addEventListener('click', async () => {
  const button = $('runWorkflow');
  button.disabled = true; button.textContent = 'Executing…';
  try {
    renderWorkflow(await api('/api/workflows/run', { method: 'POST', body: JSON.stringify({ workflow: $('workflowSelect').value, failure: $('failureSelect').value }) }));
  } catch (e) {
    $('traceTitle').textContent = 'Execution error';
    $('traceSteps').innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
  } finally { button.disabled = false; button.textContent = 'Execute workflow'; }
});

$('evaluatePolicy').addEventListener('click', async () => {
  const payload = { tool: $('policyTool').value, role: $('policyRole').value, environment: $('policyEnvironment').value, containsSensitive: $('policySensitive').checked };
  const result = await api('/api/policy/evaluate', { method: 'POST', body: JSON.stringify(payload) });
  const cls = result.decision.toLowerCase();
  $('policyResult').innerHTML = `<span class="eyebrow">POLICY DECISION</span><div class="decision ${cls}">${escapeHtml(result.decision)}</div><p><strong>${escapeHtml(result.tool)}</strong> · scope <code>${escapeHtml(result.evaluatedScope)}</code>${result.approvalRequired ? ' · human approval required' : ''}</p><div class="policy-reasons">${result.reasons.map(r => `<span>${escapeHtml(r)}</span>`).join('')}</div>`;
});

$('validateContract').addEventListener('click', async () => {
  const requiredFields = $('contractFields').value.split(',').map(v => v.trim()).filter(Boolean);
  const result = await api('/api/contracts/validate', { method: 'POST', body: JSON.stringify({ tool: $('contractTool').value.trim(), requiredFields, timeoutMs: Number($('contractTimeout').value) }) });
  $('contractResult').innerHTML = `<span class="eyebrow">GATEWAY READINESS</span><div class="score-ring" style="border-color:${result.valid ? '#ccefe2' : '#f1d7dc'}"><strong>${result.score}</strong><small>/100</small></div><p>${escapeHtml(result.recommendation)}</p>${result.issues.length ? `<div class="policy-reasons">${result.issues.map(i => `<span>${escapeHtml(i)}</span>`).join('')}</div>` : '<span class="status pass">CONTRACT PASS</span>'}`;
});

const sections = [...document.querySelectorAll('main section[id]')];
const links = [...document.querySelectorAll('.nav-link')];
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    links.forEach(l => l.classList.toggle('active', l.getAttribute('href') === `#${entry.target.id}`));
  });
}, { rootMargin: '-25% 0px -65% 0px' });
sections.forEach(s => observer.observe(s));

Promise.all([loadOverview(), loadConnectors(), loadTools(), loadWorkflows(), loadTraces()]).catch(err => console.error(err));
