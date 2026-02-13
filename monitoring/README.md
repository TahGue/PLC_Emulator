# Monitoring Stack (Optional)

Grafana + Prometheus overlay for the Bottle Factory Analyzer.

## Quick Start

```bash
docker compose -f docker-compose.yml -f docker-compose.grafana.yml up --build
```

## Access

| Service    | URL                        | Credentials   |
|------------|----------------------------|---------------|
| Grafana    | http://localhost:3000      | admin / admin |
| Prometheus | http://localhost:9090      | —             |
| Analyzer   | http://localhost:8001      | —             |

## What's Included

- **Prometheus** scrapes the analyzer `/health` endpoint every 5 seconds
- **Grafana** is pre-provisioned with Prometheus as the default datasource
- SSE live dashboard is available at `backend/dashboard/live_events_dashboard.html` (no Grafana required)

## Custom Dashboards

1. Open Grafana → Dashboards → New Dashboard
2. Add a panel using the Prometheus datasource
3. For richer event data, use the SSE stream endpoint: `GET /events/stream`

## Node-RED Integration

To consume the SSE stream in Node-RED:

1. Use an **http-request** node pointed at `http://localhost:8001/events/stream`
2. Set method to GET and enable streaming
3. Parse each `data:` line as JSON
4. Route to dashboard nodes or MQTT outputs as needed
