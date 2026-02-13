import json
import os
from dataclasses import dataclass
from collections import deque
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from psycopg import connect


DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://plc:plc@localhost:5432/plc_emulator")
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8001"))
MODEL_VERSION = "hybrid-rule-zscore-v1.1"


class TelemetryPayload(BaseModel):
    timestamp: str | None = None
    production_count: int = 0
    production_rate: float = 0
    reject_rate: float = 0
    conveyor_running: bool = False
    bottle_at_filler: bool = False
    bottle_at_capper: bool = False
    bottle_at_quality: bool = False
    in_flight_bottles: int = 0
    output_alarm_horn: bool = False
    output_reject_gate: bool = False
    network_packet_rate: float = 0
    network_burst_ratio: float = Field(default=0, ge=0)
    network_unauthorized_attempts: int = Field(default=0, ge=0)


@dataclass
class AnalysisResult:
    process_score: float
    network_score: float
    process_anomaly: bool
    network_alert: bool
    model_confidence: float
    reasons: list[str]
    process_components: dict[str, float]
    network_components: dict[str, float]
    risk_level: str
    recommended_action: str
    model_version: str


class OnlineAnomalyModel:
    """Tiny online baseline model for MVP anomaly scoring.

    This is intentionally lightweight and dependency-free (no closed tooling).
    """

    def __init__(self, window_size: int = 120) -> None:
        self.production_rate_history: deque[float] = deque(maxlen=window_size)
        self.reject_rate_history: deque[float] = deque(maxlen=window_size)
        self.inflight_history: deque[float] = deque(maxlen=window_size)

    @staticmethod
    def _zscore(value: float, history: deque[float]) -> float:
        if len(history) < 20:
            return 0.0

        mean = sum(history) / len(history)
        variance = sum((item - mean) ** 2 for item in history) / len(history)
        std = max(variance ** 0.5, 1e-6)
        return abs((value - mean) / std)

    def evaluate(self, payload: "TelemetryPayload") -> tuple[float, list[str]]:
        reasons: list[str] = []

        rate_z = self._zscore(payload.production_rate, self.production_rate_history)
        reject_z = self._zscore(payload.reject_rate, self.reject_rate_history)
        inflight_z = self._zscore(float(payload.in_flight_bottles), self.inflight_history)

        if rate_z > 2.6:
            reasons.append("ML baseline drift on production rate")
        if reject_z > 2.4:
            reasons.append("ML baseline drift on reject rate")
        if inflight_z > 2.8:
            reasons.append("ML baseline drift on in-flight bottles")

        ml_score = clamp(((rate_z * 0.35) + (reject_z * 0.4) + (inflight_z * 0.25)) * 22)

        self.production_rate_history.append(payload.production_rate)
        self.reject_rate_history.append(payload.reject_rate)
        self.inflight_history.append(float(payload.in_flight_bottles))

        return ml_score, reasons


app = FastAPI(title="Bottle Factory Analyzer API", version="1.0.0")
MODEL = OnlineAnomalyModel()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def clamp(value: float, minimum: float = 0, maximum: float = 100) -> float:
    return max(minimum, min(maximum, value))


def get_connection():
    return connect(DATABASE_URL, autocommit=True)


def init_db() -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS analysis_events (
                    id BIGSERIAL PRIMARY KEY,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    payload JSONB NOT NULL,
                    process_score DOUBLE PRECISION NOT NULL,
                    network_score DOUBLE PRECISION NOT NULL,
                    process_anomaly BOOLEAN NOT NULL,
                    network_alert BOOLEAN NOT NULL,
                    model_confidence DOUBLE PRECISION NOT NULL,
                    reasons JSONB NOT NULL
                );
                """
            )


@app.on_event("startup")
def startup() -> None:
    init_db()


def analyze_payload(payload: TelemetryPayload) -> AnalysisResult:
    rule_process_score = 0.0
    network_score = 0.0
    reasons: list[str] = []
    process_components: dict[str, float] = {}
    network_components: dict[str, float] = {}

    if payload.reject_rate > 12:
        reject_component = min(40, (payload.reject_rate - 12) * 2)
        rule_process_score += reject_component
        process_components["Reject rate deviation"] = round(reject_component, 2)
        reasons.append("Reject rate above expected baseline")

    if payload.production_rate < 4 and payload.conveyor_running:
        throughput_component = 22
        rule_process_score += throughput_component
        process_components["Throughput collapse while conveyor running"] = throughput_component
        reasons.append("Conveyor running with low throughput")

    if payload.in_flight_bottles > 6:
        accumulation_component = 25
        rule_process_score += accumulation_component
        process_components["In-flight bottle accumulation"] = accumulation_component
        reasons.append("Bottle accumulation indicates possible jam")

    if payload.output_alarm_horn:
        alarm_component = 12
        rule_process_score += alarm_component
        process_components["PLC alarm horn active"] = alarm_component
        reasons.append("PLC alarm horn is active")

    if payload.output_reject_gate and payload.reject_rate > 8:
        reject_gate_component = 10
        rule_process_score += reject_gate_component
        process_components["Reject gate with elevated rejects"] = reject_gate_component
        reasons.append("Reject gate active with elevated rejects")

    ml_process_score, ml_reasons = MODEL.evaluate(payload)
    process_components["Online baseline drift model"] = round(ml_process_score, 2)
    reasons.extend(ml_reasons)

    expected_packet_rate = 130.0
    packet_delta = abs(payload.network_packet_rate - expected_packet_rate)
    packet_rate_component = min(35.0, packet_delta * 1.1)
    network_score += packet_rate_component
    network_components["Packet-rate deviation"] = round(packet_rate_component, 2)
    if packet_delta > 18:
        reasons.append("Network packet rate drift detected")

    if payload.network_burst_ratio > 0.72:
        burst_component = (payload.network_burst_ratio - 0.72) * 90
        network_score += burst_component
        network_components["Burst traffic anomaly"] = round(burst_component, 2)
        reasons.append("Burst traffic pattern suggests malformed polling")

    if payload.network_unauthorized_attempts > 0:
        unauthorized_component = 35 + payload.network_unauthorized_attempts * 10
        network_score += unauthorized_component
        network_components["Unauthorized write attempts"] = round(unauthorized_component, 2)
        reasons.append("Unauthorized network write attempt detected")

    process_score = clamp(rule_process_score * 0.65 + ml_process_score * 0.35)
    network_score = clamp(network_score)

    process_anomaly = process_score >= 60
    network_alert = network_score >= 55

    model_confidence = clamp(100 - max(process_score, network_score) * 0.7, 5, 100)

    max_risk = max(process_score, network_score)
    if max_risk >= 80:
        risk_level = "critical"
    elif max_risk >= 60:
        risk_level = "high"
    elif max_risk >= 35:
        risk_level = "medium"
    else:
        risk_level = "low"

    if network_alert and process_anomaly:
        recommended_action = "Trigger safety lockout, isolate control network, inspect line for jam/reject spikes"
    elif network_alert:
        recommended_action = "Segment PLC network, review unauthorized traffic, and keep line under close observation"
    elif process_anomaly:
        recommended_action = "Run quality + mechanical inspection on filler/capper and verify sensor calibration"
    else:
        recommended_action = "Continue baseline monitoring and keep collecting telemetry for drift tracking"

    if not reasons:
        reasons.append("System within baseline profile")

    return AnalysisResult(
        process_score=process_score,
        network_score=network_score,
        process_anomaly=process_anomaly,
        network_alert=network_alert,
        model_confidence=model_confidence,
        reasons=reasons,
        process_components=process_components,
        network_components=network_components,
        risk_level=risk_level,
        recommended_action=recommended_action,
        model_version=MODEL_VERSION,
    )


def persist_analysis(payload: TelemetryPayload, result: AnalysisResult) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO analysis_events (
                    payload,
                    process_score,
                    network_score,
                    process_anomaly,
                    network_alert,
                    model_confidence,
                    reasons
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    json.dumps(payload.model_dump()),
                    result.process_score,
                    result.network_score,
                    result.process_anomaly,
                    result.network_alert,
                    result.model_confidence,
                    json.dumps(result.reasons),
                ),
            )


@app.get("/health")
def health() -> dict[str, Any]:
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
    except Exception as error:  # pragma: no cover - runtime path
        return {"ok": False, "db": False, "error": str(error)}

    return {"ok": True, "db": True, "host": API_HOST, "port": API_PORT}


@app.post("/analyze")
def analyze(payload: TelemetryPayload) -> dict[str, Any]:
    result = analyze_payload(payload)
    persist_analysis(payload, result)

    return {
        "process_anomaly": result.process_anomaly,
        "network_alert": result.network_alert,
        "process_score": round(result.process_score, 2),
        "network_score": round(result.network_score, 2),
        "model_confidence": round(result.model_confidence, 2),
        "process_components": result.process_components,
        "network_components": result.network_components,
        "risk_level": result.risk_level,
        "recommended_action": result.recommended_action,
        "model_version": result.model_version,
        "reasons": result.reasons,
    }


@app.get("/events")
def events(limit: int = 20) -> dict[str, Any]:
    safe_limit = max(1, min(limit, 200))

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, created_at, process_score, network_score, process_anomaly, network_alert, model_confidence, reasons
                FROM analysis_events
                ORDER BY id DESC
                LIMIT %s
                """,
                (safe_limit,),
            )
            rows = cur.fetchall()

    parsed_rows = [
        {
            "id": row[0],
            "created_at": row[1].isoformat(),
            "process_score": row[2],
            "network_score": row[3],
            "process_anomaly": row[4],
            "network_alert": row[5],
            "model_confidence": row[6],
            "reasons": row[7] if isinstance(row[7], list) else json.loads(row[7]),
        }
        for row in rows
    ]

    return {"count": len(parsed_rows), "events": parsed_rows}
