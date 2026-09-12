# AI Integration & MCP Gateway Studio — Railway Edition

A recruiter-facing enterprise AI integration lab by **Ashok Kumar Manohar** demonstrating how AI agents can safely interact with enterprise systems through governed tools and workflows.

## What it demonstrates

- Enterprise connector registry
- MCP-style tool registry and manifest
- Explicit tool scopes and risk classification
- Deterministic multi-tool workflow orchestration
- Authentication/schema/timeout failure injection
- RBAC and production approval policies
- Tool contract quality validation
- Audit traces and release gates
- Production health endpoint and Railway deployment

## Architecture

`AI Assistant / Agent → MCP/API Gateway → Identity → RBAC → Contract Validation → Policy → Audit Trace → Enterprise Connectors`

## Local run

```bash
npm start
```

The service listens on `PORT` when supplied by the platform and defaults to `3000` locally.

## APIs

- `GET /health`
- `GET /api/overview`
- `GET /api/connectors`
- `GET /api/tools`
- `GET /api/workflows`
- `GET /api/traces`
- `GET /api/mcp/manifest`
- `POST /api/contracts/validate`
- `POST /api/policy/evaluate`
- `POST /api/workflows/run`

The demo intentionally uses no external LLM keys or secrets so recruiters can explore it immediately.
