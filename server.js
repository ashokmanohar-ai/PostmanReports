const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const publicDir = path.join(__dirname, 'public');

const connectors = [
  { id: 'crm', name: 'Customer CRM', type: 'REST API', auth: 'OAuth 2.0', health: 99.98, latency: 142, status: 'Healthy' },
  { id: 'tickets', name: 'Service Desk', type: 'REST + Webhook', auth: 'Bearer Token', health: 99.91, latency: 184, status: 'Healthy' },
  { id: 'knowledge', name: 'Knowledge / RAG', type: 'Vector + REST', auth: 'Service Identity', health: 99.95, latency: 227, status: 'Healthy' },
  { id: 'browser', name: 'Browser Automation', type: 'Tool Gateway', auth: 'Scoped Session', health: 99.87, latency: 315, status: 'Healthy' },
  { id: 'cicd', name: 'CI/CD Platform', type: 'REST + Events', auth: 'OIDC', health: 99.97, latency: 168, status: 'Healthy' },
  { id: 'analytics', name: 'Analytics Store', type: 'SQL / API', auth: 'Workload Identity', health: 99.93, latency: 119, status: 'Healthy' }
];

const tools = [
  { name: 'customer.lookup', connector: 'Customer CRM', scope: 'read:customer', risk: 'Low', input: ['customerId'], output: ['name', 'segment', 'region'], p95: 210 },
  { name: 'ticket.create', connector: 'Service Desk', scope: 'write:ticket', risk: 'Medium', input: ['title', 'priority', 'summary'], output: ['ticketId', 'status'], p95: 340 },
  { name: 'knowledge.search', connector: 'Knowledge / RAG', scope: 'read:knowledge', risk: 'Low', input: ['query', 'topK'], output: ['chunks', 'citations', 'scores'], p95: 420 },
  { name: 'browser.verify', connector: 'Browser Automation', scope: 'run:browser', risk: 'Medium', input: ['url', 'assertion'], output: ['passed', 'evidence'], p95: 820 },
  { name: 'deployment.check', connector: 'CI/CD Platform', scope: 'read:deploy', risk: 'Low', input: ['service', 'environment'], output: ['status', 'version', 'health'], p95: 260 },
  { name: 'release.promote', connector: 'CI/CD Platform', scope: 'write:release', risk: 'High', input: ['service', 'version', 'target'], output: ['deploymentId', 'status'], p95: 760 }
];

const workflows = [
  {
    id: 'support-triage',
    name: 'AI Support Triage',
    description: 'Identify a customer, retrieve grounded context, create a support ticket and capture an auditable trace.',
    steps: ['customer.lookup', 'knowledge.search', 'ticket.create']
  },
  {
    id: 'release-readiness',
    name: 'Release Readiness Gate',
    description: 'Check deployment state, verify the customer-facing flow and approve or block promotion.',
    steps: ['deployment.check', 'browser.verify', 'release.promote']
  },
  {
    id: 'customer-360',
    name: 'Customer 360 Investigation',
    description: 'Combine CRM context with enterprise knowledge for a governed AI-assisted investigation.',
    steps: ['customer.lookup', 'knowledge.search']
  }
];

const recentTraces = [
  { id: 'trc-1842', workflow: 'AI Support Triage', duration: 781, tools: 3, status: 'PASS', policy: 'Allowed' },
  { id: 'trc-1841', workflow: 'Release Readiness Gate', duration: 1518, tools: 3, status: 'WARN', policy: 'Approval required' },
  { id: 'trc-1840', workflow: 'Customer 360 Investigation', duration: 492, tools: 2, status: 'PASS', policy: 'Allowed' },
  { id: 'trc-1839', workflow: 'AI Support Triage', duration: 864, tools: 3, status: 'PASS', policy: 'Allowed' }
];

function sendJson(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(JSON.stringify(body, null, 2));
}

function sendText(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'public, max-age=300' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8'
  }[ext] || 'application/octet-stream';
}

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) return sendText(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': mime(file), 'Cache-Control': 'public, max-age=120' });
    res.end(data);
  });
}

function policyDecision(payload) {
  const role = String(payload.role || 'Developer');
  const environment = String(payload.environment || 'staging').toLowerCase();
  const tool = tools.find(t => t.name === payload.tool) || tools[0];
  const sensitive = Boolean(payload.containsSensitive);
  const reasons = [];
  let decision = 'ALLOW';
  let approval = false;

  if (sensitive) reasons.push('Sensitive-data handling controls enabled');
  if (tool.risk === 'High' && environment === 'production') {
    decision = 'REVIEW'; approval = true; reasons.push('High-risk production write requires human approval');
  }
  if (role === 'Viewer' && tool.scope.startsWith('write:')) {
    decision = 'DENY'; reasons.push('Viewer role cannot execute write-scoped tools');
  }
  if (role === 'Developer' && tool.name === 'release.promote' && environment === 'production') {
    decision = 'REVIEW'; approval = true; reasons.push('Production promotion is separated from developer role');
  }
  if (!reasons.length) reasons.push('Role, scope and environment policy checks passed');

  return {
    decision,
    approvalRequired: approval,
    tool: tool.name,
    evaluatedScope: tool.scope,
    controls: ['RBAC', 'least privilege', 'audit trace', sensitive ? 'data minimization' : 'standard data policy'],
    reasons,
    policyVersion: 'gateway-policy-1.4'
  };
}

function runWorkflow(payload) {
  const workflow = workflows.find(w => w.id === payload.workflow) || workflows[0];
  const failure = String(payload.failure || 'none');
  let blocked = false;
  const traceId = `trc-${Date.now().toString().slice(-6)}`;
  const steps = workflow.steps.map((toolName, i) => {
    const tool = tools.find(t => t.name === toolName);
    const failHere = !blocked && ((failure === 'timeout' && i === 1) || (failure === 'auth' && i === 0) || (failure === 'schema' && i === workflow.steps.length - 1));
    const skipped = blocked;
    if (failHere) blocked = true;
    const latency = skipped ? 0 : Math.round((tool.p95 || 300) * (0.55 + i * 0.09));
    return {
      sequence: i + 1,
      tool: toolName,
      connector: tool.connector,
      status: skipped ? 'SKIPPED' : failHere ? 'FAIL' : 'PASS',
      latencyMs: latency,
      policy: tool.risk === 'High' ? 'human-approval gate' : 'auto-allowed',
      evidence: skipped ? 'Previous step blocked execution' : failHere ? `${failure} simulation triggered` : 'Contract and response checks passed'
    };
  });

  const failed = steps.some(s => s.status === 'FAIL');
  const total = steps.reduce((a, s) => a + s.latencyMs, 0);
  return {
    traceId,
    workflow: workflow.name,
    status: failed ? 'FAIL' : 'PASS',
    durationMs: total,
    startedAt: new Date().toISOString(),
    steps,
    qualityGate: {
      contractIntegrity: failed && failure === 'schema' ? 'FAIL' : 'PASS',
      authPolicy: failed && failure === 'auth' ? 'FAIL' : 'PASS',
      toolReliability: failed && failure === 'timeout' ? 'FAIL' : 'PASS',
      auditability: 'PASS',
      releaseDecision: failed ? 'BLOCK' : 'PROCEED'
    },
    recommendation: failed ? 'Fix the failed integration step and replay from the last safe checkpoint.' : 'Workflow passed deterministic gateway controls and is safe to continue.'
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname === '/health') return sendJson(res, 200, { status: 'ok', service: 'ai-integration-mcp-gateway-studio', runtime: 'node', timestamp: new Date().toISOString() });

    if (pathname === '/api/overview') return sendJson(res, 200, {
      product: 'AI Integration & MCP Gateway Studio',
      version: '1.0.0',
      metrics: { connectors: connectors.length, tools: tools.length, workflows: workflows.length, policyCoverage: 100, traceCoverage: 100, successRate: 99.4, p95GatewayLatency: 186 },
      capabilities: ['API integration design', 'MCP-style tool registry', 'tool contract validation', 'workflow orchestration', 'RBAC policy simulation', 'traceability', 'release controls']
    });

    if (pathname === '/api/connectors') return sendJson(res, 200, { connectors });
    if (pathname === '/api/tools') return sendJson(res, 200, { tools });
    if (pathname === '/api/workflows') return sendJson(res, 200, { workflows });
    if (pathname === '/api/traces') return sendJson(res, 200, { traces: recentTraces });
    if (pathname === '/api/mcp/manifest') return sendJson(res, 200, {
      name: 'enterprise-integration-gateway',
      mode: 'MCP-style demonstration gateway',
      transport: 'HTTP demo APIs',
      tools: tools.map(t => ({ name: t.name, description: `${t.connector} capability`, requiredScope: t.scope, risk: t.risk })),
      governance: { authentication: true, authorization: true, auditTrace: true, humanApproval: true, contractValidation: true }
    });

    if (pathname === '/api/contracts/validate' && req.method === 'POST') {
      const body = await readBody(req);
      const issues = [];
      if (!body.tool) issues.push('Tool name is required');
      if (!Array.isArray(body.requiredFields) || body.requiredFields.length === 0) issues.push('At least one required input field should be declared');
      if (!body.timeoutMs || Number(body.timeoutMs) < 100) issues.push('Timeout must be at least 100 ms');
      const score = Math.max(0, 100 - issues.length * 24);
      return sendJson(res, 200, { valid: issues.length === 0, score, issues, checks: ['name', 'required inputs', 'timeout', 'output contract', 'error handling'], recommendation: issues.length ? 'Resolve contract gaps before exposing the tool to an AI agent.' : 'Contract is gateway-ready.' });
    }

    if (pathname === '/api/policy/evaluate' && req.method === 'POST') {
      return sendJson(res, 200, policyDecision(await readBody(req)));
    }

    if (pathname === '/api/workflows/run' && req.method === 'POST') {
      return sendJson(res, 200, runWorkflow(await readBody(req)));
    }

    if (pathname === '/robots.txt') return sendText(res, 200, 'User-agent: *\nAllow: /\n');
    if (pathname === '/favicon.ico') return sendText(res, 204, '');

    const safePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const resolved = path.normalize(path.join(publicDir, safePath));
    if (!resolved.startsWith(publicDir)) return sendText(res, 403, 'Forbidden');
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return serveFile(res, resolved);
    return serveFile(res, path.join(publicDir, 'index.html'));
  } catch (error) {
    return sendJson(res, 400, { error: error.message || 'Request failed' });
  }
});

server.listen(PORT, HOST, () => console.log(`AI Integration & MCP Gateway Studio listening on ${PORT}`));
