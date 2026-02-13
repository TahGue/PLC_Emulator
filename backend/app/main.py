from __future__ import annotations

import asyncio
import json
import os
import threading
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .ml import load_artifact_metadata


DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://plc:plc@localhost:5432/plc_emulator")
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8001"))

MODEL_ARTIFACT_PATH = os.getenv("MODEL_ARTIFACT_PATH", "/app/models/mvtec_feature_model.pkl")
USE_FALLBACK_DRIFT_MODEL = os.getenv("USE_FALLBACK_DRIFT_MODEL", "true").lower() == "true"
PROCESS_ANOMALY_THRESHOLD = float(os.getenv("PROCESS_ANOMALY_THRESHOLD", "60"))
NETWORK_ALERT_THRESHOLD = float(os.getenv("NETWORK_ALERT_THRESHOLD", "55"))

EXPECTED_PACKET_RATE = float(os.getenv("EXPECTED_PACKET_RATE", "130"))
VISION_SIGNAL_STALE_SECONDS = float(os.getenv("VISION_SIGNAL_STALE_SECONDS", "8"))
SECURITY_SIGNAL_STALE_SECONDS = float(os.getenv("SECURITY_SIGNAL_STALE_SECONDS", "8"))

ENABLE_CSV_LOGGING = os.getenv("ENABLE_CSV_LOGGING", "true").lower() == "true"
CSV_LOG_PATH = os.getenv("CSV_LOG_PATH", "/app/logs/analysis_events.csv")

MODEL_ARTIFACT_METADATA = load_artifact_metadata(MODEL_ARTIFACT_PATH)
MODEL_VERSION = (
    str(MODEL_ARTIFACT_METADATA.get("model_version"))
    if MODEL_ARTIFACT_METADATA
    else "hybrid-vision-signal-v2"
)


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
    scan_time_ms: float = Field(default=0, ge=0)

    vision_anomaly_score: float | None = Field(default=None, ge=0, le=100)
    vision_defect_flag: bool | None = None
    vision_model_version: str | None = None
    vision_inference_ms: float = Field(default=0, ge=0)

    security_flag: bool | None = None


class VisionSignalPayload(BaseModel):
    timestamp: str | None = None
    anomaly_score: float = Field(default=0, ge=0, le=100)
    defect_flag: bool = False
    model_version: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=100)
    inference_ms: float = Field(default=0, ge=0)
    source: str = "camera-simulator"
    image_path: str | None = None


class SecuritySignalPayload(BaseModel):
    timestamp: str | None = None
    packet_rate: float = Field(default=0, ge=0)
    burst_ratio: float = Field(default=0, ge=0)
    unauthorized_attempts: int = Field(default=0, ge=0)
    security_flag: bool = False
    source: str = "network-monitor"
    sample_window_seconds: float = Field(default=1, gt=0)


@dataclass
class VisionSignalState:
    captured_at: datetime
    anomaly_score: float
    defect_flag: bool
    model_version: str
    confidence: float | None
    inference_ms: float
    source: str
    image_path: str | None


@dataclass
class SecuritySignalState:
    captured_at: datetime
    packet_rate: float
    burst_ratio: float
    unauthorized_attempts: int
    security_flag: bool
    source: str
    sample_window_seconds: float


@dataclass
class ProcessLaneResult:
    score: float
    source: str
    reasons: list[str]
    component_label: str
    vision_anomaly_score: float
    vision_defect_flag: bool
    vision_inference_ms: float
    model_version: str


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
    vision_anomaly_score: float
    vision_defect_flag: bool
    vision_inference_ms: float
    security_flag: bool
    scan_time_ms: float
    process_source: str
    network_source: str


class OnlineAnomalyModel:
    """Fallback online drift model used when external vision signals are absent."""

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
        std = max(variance**0.5, 1e-6)
        return abs((value - mean) / std)

    def evaluate(self, payload: "TelemetryPayload") -> tuple[float, list[str]]:
        reasons: list[str] = []

        rate_z = self._zscore(payload.production_rate, self.production_rate_history)
        reject_z = self._zscore(payload.reject_rate, self.reject_rate_history)
        inflight_z = self._zscore(float(payload.in_flight_bottles), self.inflight_history)

        if rate_z > 2.6:
            reasons.append("Fallback drift model detected production-rate baseline shift")
        if reject_z > 2.4:
            reasons.append("Fallback drift model detected reject-rate baseline shift")
        if inflight_z > 2.8:
            reasons.append("Fallback drift model detected in-flight accumulation shift")

        ml_score = clamp(((rate_z * 0.35) + (reject_z * 0.4) + (inflight_z * 0.25)) * 22)

        self.production_rate_history.append(payload.production_rate)
        self.reject_rate_history.append(payload.reject_rate)
        self.inflight_history.append(float(payload.in_flight_bottles))

        return ml_score, reasons


@asynccontextmanager
async def lifespan(application: FastAPI):
    init_db()
    yield


app = FastAPI(title="Bottle Factory Analyzer API", version="1.1.0", lifespan=lifespan)
FALLBACK_MODEL = OnlineAnomalyModel()

SIGNAL_LOCK = threading.Lock()
LATEST_VISION_SIGNAL: VisionSignalState | None = None
LATEST_SECURITY_SIGNAL: SecuritySignalState | None = None

METRICS_LOCK = threading.Lock()
METRICS_COUNTERS: dict[str, int | float] = {
    "analyses_total": 0,
    "process_anomalies_total": 0,
    "network_alerts_total": 0,
    "vision_signals_ingested": 0,
    "security_signals_ingested": 0,
}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def clamp(value: float, minimum: float = 0, maximum: float = 100) -> float:
    return max(minimum, min(maximum, value))


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso_timestamp(value: str | None) -> datetime:
    if not value:
        return _utc_now()

    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return _utc_now()

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)


def _signal_age_seconds(captured_at: datetime) -> float:
    return max((_utc_now() - captured_at).total_seconds(), 0.0)


def _set_vision_signal(signal: VisionSignalState) -> None:
    global LATEST_VISION_SIGNAL
    with SIGNAL_LOCK:
        LATEST_VISION_SIGNAL = signal


def _set_security_signal(signal: SecuritySignalState) -> None:
    global LATEST_SECURITY_SIGNAL
    with SIGNAL_LOCK:
        LATEST_SECURITY_SIGNAL = signal


def _get_latest_vision_signal() -> VisionSignalState | None:
    with SIGNAL_LOCK:
        return LATEST_VISION_SIGNAL


def _get_latest_security_signal() -> SecuritySignalState | None:
    with SIGNAL_LOCK:
        return LATEST_SECURITY_SIGNAL


def _get_fresh_vision_signal() -> VisionSignalState | None:
    signal = _get_latest_vision_signal()
    if not signal:
        return None
    if _signal_age_seconds(signal.captured_at) > VISION_SIGNAL_STALE_SECONDS:
        return None
    return signal


def _get_fresh_security_signal() -> SecuritySignalState | None:
    signal = _get_latest_security_signal()
    if not signal:
        return None
    if _signal_age_seconds(signal.captured_at) > SECURITY_SIGNAL_STALE_SECONDS:
        return None
    return signal


def get_connection():
    from psycopg import connect

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
                    process_components JSONB NOT NULL DEFAULT '{}'::jsonb,
                    network_components JSONB NOT NULL DEFAULT '{}'::jsonb,
                    risk_level TEXT NOT NULL DEFAULT 'low',
                    recommended_action TEXT NOT NULL DEFAULT '',
                    model_version TEXT NOT NULL DEFAULT '',
                    reasons JSONB NOT NULL,
                    vision_anomaly_score DOUBLE PRECISION,
                    vision_defect_flag BOOLEAN,
                    vision_inference_ms DOUBLE PRECISION,
                    security_flag BOOLEAN NOT NULL DEFAULT FALSE,
                    scan_time_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
                    process_source TEXT NOT NULL DEFAULT 'telemetry',
                    network_source TEXT NOT NULL DEFAULT 'telemetry'
                );
                """
            )

            migration_statements = [
                "ALTER TABLE analysis_events ADD COLUMN IF NOT EXISTS process_components JSONB NOT NULL DEFAULT '{}'::jsonb",
                "ALTER TABLE analysis_events ADD COLUMN IF NOT EXISTS network_components JSONB NOT NULL DEFAULT '{}'::jsonb",
                "ALTER TABLE analysis_events ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'low'",
                "ALTER TABLE analysis_events ADD COLUMN IF NOT EXISTS recommended_action TEXT NOT NULL DEFAULT ''",
                "ALTER TABLE analysis_events ADD COLUMN IF NOT EXISTS model_version TEXT NOT NULL DEFAULT ''",
                "ALTER TABLE analysis_events ADD COLUMN IF NOT EXISTS vision_anomaly_score DOUBLE PRECISION",
                "ALTER TABLE analysis_events ADD COLUMN IF NOT EXISTS vision_defect_flag BOOLEAN",
                "ALTER TABLE analysis_events ADD COLUMN IF NOT EXISTS vision_inference_ms DOUBLE PRECISION",
                "ALTER TABLE analysis_events ADD COLUMN IF NOT EXISTS security_flag BOOLEAN NOT NULL DEFAULT FALSE",
                "ALTER TABLE analysis_events ADD COLUMN IF NOT EXISTS scan_time_ms DOUBLE PRECISION NOT NULL DEFAULT 0",
                "ALTER TABLE analysis_events ADD COLUMN IF NOT EXISTS process_source TEXT NOT NULL DEFAULT 'telemetry'",
                "ALTER TABLE analysis_events ADD COLUMN IF NOT EXISTS network_source TEXT NOT NULL DEFAULT 'telemetry'",
            ]

            for statement in migration_statements:
                cur.execute(statement)


def _resolve_process_lane(payload: TelemetryPayload) -> ProcessLaneResult:
    payload_score = payload.vision_anomaly_score
    payload_flag = payload.vision_defect_flag
    payload_version = payload.vision_model_version

    if payload_score is not None or payload_flag is not None:
        resolved_score = clamp(
            payload_score if payload_score is not None else (100.0 if bool(payload_flag) else 0.0)
        )
        resolved_flag = bool(payload_flag) if payload_flag is not None else resolved_score >= PROCESS_ANOMALY_THRESHOLD
        reasons = ["Vision signal in telemetry payload indicates a defect candidate"] if resolved_flag else []
        return ProcessLaneResult(
            score=resolved_score,
            source="payload-vision-signal",
            reasons=reasons,
            component_label="Vision model signal",
            vision_anomaly_score=resolved_score,
            vision_defect_flag=resolved_flag,
            vision_inference_ms=payload.vision_inference_ms,
            model_version=payload_version or MODEL_VERSION,
        )

    signal = _get_fresh_vision_signal()
    if signal:
        reasons = ["External vision lane detected an anomaly candidate"] if signal.defect_flag else []
        return ProcessLaneResult(
            score=clamp(signal.anomaly_score),
            source="external-vision-signal",
            reasons=reasons,
            component_label="Vision model signal",
            vision_anomaly_score=clamp(signal.anomaly_score),
            vision_defect_flag=signal.defect_flag,
            vision_inference_ms=signal.inference_ms,
            model_version=signal.model_version or MODEL_VERSION,
        )

    if USE_FALLBACK_DRIFT_MODEL:
        score, reasons = FALLBACK_MODEL.evaluate(payload)
        return ProcessLaneResult(
            score=score,
            source="fallback-telemetry-drift",
            reasons=reasons,
            component_label="Telemetry drift fallback model",
            vision_anomaly_score=score,
            vision_defect_flag=score >= PROCESS_ANOMALY_THRESHOLD,
            vision_inference_ms=0.0,
            model_version="hybrid-rule-zscore-v1.1",
        )

    return ProcessLaneResult(
        score=0.0,
        source="no-vision-signal",
        reasons=[],
        component_label="Vision model signal",
        vision_anomaly_score=0.0,
        vision_defect_flag=False,
        vision_inference_ms=0.0,
        model_version=MODEL_VERSION,
    )


def _resolve_network_inputs(payload: TelemetryPayload) -> tuple[float, float, int, bool, str]:
    packet_rate = payload.network_packet_rate
    burst_ratio = payload.network_burst_ratio
    unauthorized_attempts = payload.network_unauthorized_attempts
    security_flag = bool(payload.security_flag) if payload.security_flag is not None else False
    source = "telemetry"

    if payload.security_flag is not None:
        source = "payload-security-signal"

    external_signal = _get_fresh_security_signal()
    if external_signal:
        packet_rate = external_signal.packet_rate
        burst_ratio = external_signal.burst_ratio
        unauthorized_attempts = external_signal.unauthorized_attempts
        security_flag = security_flag or external_signal.security_flag
        source = "external-security-signal"

    return packet_rate, burst_ratio, unauthorized_attempts, security_flag, source


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

    process_lane = _resolve_process_lane(payload)
    process_components[process_lane.component_label] = round(process_lane.score, 2)
    reasons.extend(process_lane.reasons)

    packet_rate, burst_ratio, unauthorized_attempts, security_flag, network_source = _resolve_network_inputs(payload)

    packet_delta = abs(packet_rate - EXPECTED_PACKET_RATE)
    packet_rate_component = min(35.0, packet_delta * 1.1)
    network_score += packet_rate_component
    network_components["Packet-rate deviation"] = round(packet_rate_component, 2)
    if packet_delta > 18:
        reasons.append("Network packet rate drift detected")

    if burst_ratio > 0.72:
        burst_component = (burst_ratio - 0.72) * 90
        network_score += burst_component
        network_components["Burst traffic anomaly"] = round(burst_component, 2)
        reasons.append("Burst traffic pattern suggests malformed polling")

    if unauthorized_attempts > 0:
        unauthorized_component = 35 + unauthorized_attempts * 10
        network_score += unauthorized_component
        network_components["Unauthorized write attempts"] = round(unauthorized_component, 2)
        reasons.append("Unauthorized network write attempt detected")

    if security_flag:
        security_component = 42
        network_score += security_component
        network_components["Security flag lane"] = security_component
        reasons.append("Security monitor flagged suspicious control-network activity")

    process_score = clamp(max(rule_process_score, process_lane.score))
    network_score = clamp(network_score)

    process_anomaly = process_score >= PROCESS_ANOMALY_THRESHOLD
    network_alert = network_score >= NETWORK_ALERT_THRESHOLD or security_flag

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
        recommended_action = "Segment PLC network, review suspicious traffic, and keep the line under close watch"
    elif process_anomaly:
        recommended_action = "Run quality/mechanical inspection and verify camera model threshold calibration"
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
        model_version=process_lane.model_version,
        vision_anomaly_score=process_lane.vision_anomaly_score,
        vision_defect_flag=process_lane.vision_defect_flag,
        vision_inference_ms=process_lane.vision_inference_ms,
        security_flag=security_flag,
        scan_time_ms=payload.scan_time_ms,
        process_source=process_lane.source,
        network_source=network_source,
    )


def _append_csv_log(payload: TelemetryPayload, result: AnalysisResult) -> None:
    if not ENABLE_CSV_LOGGING:
        return

    try:
        import pandas as pd
    except Exception:
        return

    output_path = Path(CSV_LOG_PATH)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    file_exists = output_path.exists()

    row = {
        "created_at": _utc_now().isoformat(),
        "process_score": result.process_score,
        "network_score": result.network_score,
        "process_anomaly": result.process_anomaly,
        "network_alert": result.network_alert,
        "model_confidence": result.model_confidence,
        "model_version": result.model_version,
        "risk_level": result.risk_level,
        "vision_anomaly_score": result.vision_anomaly_score,
        "vision_defect_flag": result.vision_defect_flag,
        "vision_inference_ms": result.vision_inference_ms,
        "security_flag": result.security_flag,
        "scan_time_ms": result.scan_time_ms,
        "process_source": result.process_source,
        "network_source": result.network_source,
        "reasons_json": json.dumps(result.reasons),
        "payload_json": json.dumps(payload.model_dump()),
    }

    pd.DataFrame([row]).to_csv(output_path, mode="a", header=not file_exists, index=False)


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
                    process_components,
                    network_components,
                    risk_level,
                    recommended_action,
                    model_version,
                    reasons,
                    vision_anomaly_score,
                    vision_defect_flag,
                    vision_inference_ms,
                    security_flag,
                    scan_time_ms,
                    process_source,
                    network_source
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    json.dumps(payload.model_dump()),
                    result.process_score,
                    result.network_score,
                    result.process_anomaly,
                    result.network_alert,
                    result.model_confidence,
                    json.dumps(result.process_components),
                    json.dumps(result.network_components),
                    result.risk_level,
                    result.recommended_action,
                    result.model_version,
                    json.dumps(result.reasons),
                    result.vision_anomaly_score,
                    result.vision_defect_flag,
                    result.vision_inference_ms,
                    result.security_flag,
                    result.scan_time_ms,
                    result.process_source,
                    result.network_source,
                ),
            )

    _append_csv_log(payload, result)


def _serialize_jsonb(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if value is None:
        return None
    return json.loads(value)


EVENT_SELECT_COLUMNS = """
    id,
    created_at,
    process_score,
    network_score,
    process_anomaly,
    network_alert,
    model_confidence,
    process_components,
    network_components,
    risk_level,
    recommended_action,
    model_version,
    reasons,
    vision_anomaly_score,
    vision_defect_flag,
    vision_inference_ms,
    security_flag,
    scan_time_ms,
    process_source,
    network_source
"""


def _parse_event_row(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "id": row[0],
        "created_at": row[1].isoformat(),
        "process_score": row[2],
        "network_score": row[3],
        "process_anomaly": row[4],
        "network_alert": row[5],
        "model_confidence": row[6],
        "process_components": _serialize_jsonb(row[7]) or {},
        "network_components": _serialize_jsonb(row[8]) or {},
        "risk_level": row[9],
        "recommended_action": row[10],
        "model_version": row[11],
        "reasons": _serialize_jsonb(row[12]) or [],
        "vision_anomaly_score": row[13],
        "vision_defect_flag": row[14],
        "vision_inference_ms": row[15],
        "security_flag": row[16],
        "scan_time_ms": row[17],
        "process_source": row[18],
        "network_source": row[19],
    }


def _fetch_events(limit: int, *, ascending: bool = False, after_id: int | None = None) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 200))
    order_direction = "ASC" if ascending else "DESC"

    where_clause = ""
    params: list[Any]
    if after_id is not None:
        where_clause = "WHERE id > %s"
        params = [max(after_id, 0), safe_limit]
    else:
        params = [safe_limit]

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    {EVENT_SELECT_COLUMNS}
                FROM analysis_events
                {where_clause}
                ORDER BY id {order_direction}
                LIMIT %s
                """,
                tuple(params),
            )
            rows = cur.fetchall()

    return [_parse_event_row(row) for row in rows]


@app.get("/health")
def health() -> dict[str, Any]:
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
    except Exception as error:  # pragma: no cover - runtime path
        return {"ok": False, "db": False, "error": str(error)}

    return {
        "ok": True,
        "db": True,
        "host": API_HOST,
        "port": API_PORT,
        "model_version": MODEL_VERSION,
        "artifact_loaded": MODEL_ARTIFACT_METADATA is not None,
        "vision_signal_fresh": _get_fresh_vision_signal() is not None,
        "security_signal_fresh": _get_fresh_security_signal() is not None,
    }


@app.post("/signals/vision")
def ingest_vision_signal(payload: VisionSignalPayload) -> dict[str, Any]:
    signal = VisionSignalState(
        captured_at=_parse_iso_timestamp(payload.timestamp),
        anomaly_score=payload.anomaly_score,
        defect_flag=payload.defect_flag,
        model_version=payload.model_version or MODEL_VERSION,
        confidence=payload.confidence,
        inference_ms=payload.inference_ms,
        source=payload.source,
        image_path=payload.image_path,
    )
    _set_vision_signal(signal)

    with METRICS_LOCK:
        METRICS_COUNTERS["vision_signals_ingested"] += 1

    return {
        "ok": True,
        "vision_signal": {
            "timestamp": signal.captured_at.isoformat(),
            "anomaly_score": signal.anomaly_score,
            "defect_flag": signal.defect_flag,
            "model_version": signal.model_version,
            "source": signal.source,
            "age_seconds": _signal_age_seconds(signal.captured_at),
        },
    }


@app.post("/signals/security")
def ingest_security_signal(payload: SecuritySignalPayload) -> dict[str, Any]:
    signal = SecuritySignalState(
        captured_at=_parse_iso_timestamp(payload.timestamp),
        packet_rate=payload.packet_rate,
        burst_ratio=payload.burst_ratio,
        unauthorized_attempts=payload.unauthorized_attempts,
        security_flag=payload.security_flag,
        source=payload.source,
        sample_window_seconds=payload.sample_window_seconds,
    )
    _set_security_signal(signal)

    with METRICS_LOCK:
        METRICS_COUNTERS["security_signals_ingested"] += 1

    return {
        "ok": True,
        "security_signal": {
            "timestamp": signal.captured_at.isoformat(),
            "packet_rate": signal.packet_rate,
            "burst_ratio": signal.burst_ratio,
            "unauthorized_attempts": signal.unauthorized_attempts,
            "security_flag": signal.security_flag,
            "source": signal.source,
            "age_seconds": _signal_age_seconds(signal.captured_at),
        },
    }


@app.get("/signals")
def signals() -> dict[str, Any]:
    vision = _get_latest_vision_signal()
    security = _get_latest_security_signal()

    return {
        "vision": (
            {
                "timestamp": vision.captured_at.isoformat(),
                "anomaly_score": vision.anomaly_score,
                "defect_flag": vision.defect_flag,
                "model_version": vision.model_version,
                "confidence": vision.confidence,
                "inference_ms": vision.inference_ms,
                "source": vision.source,
                "image_path": vision.image_path,
                "age_seconds": _signal_age_seconds(vision.captured_at),
                "fresh": _signal_age_seconds(vision.captured_at) <= VISION_SIGNAL_STALE_SECONDS,
            }
            if vision
            else None
        ),
        "security": (
            {
                "timestamp": security.captured_at.isoformat(),
                "packet_rate": security.packet_rate,
                "burst_ratio": security.burst_ratio,
                "unauthorized_attempts": security.unauthorized_attempts,
                "security_flag": security.security_flag,
                "source": security.source,
                "sample_window_seconds": security.sample_window_seconds,
                "age_seconds": _signal_age_seconds(security.captured_at),
                "fresh": _signal_age_seconds(security.captured_at) <= SECURITY_SIGNAL_STALE_SECONDS,
            }
            if security
            else None
        ),
    }


@app.post("/analyze")
def analyze(payload: TelemetryPayload) -> dict[str, Any]:
    result = analyze_payload(payload)
    persist_analysis(payload, result)

    with METRICS_LOCK:
        METRICS_COUNTERS["analyses_total"] += 1
        if result.process_anomaly:
            METRICS_COUNTERS["process_anomalies_total"] += 1
        if result.network_alert:
            METRICS_COUNTERS["network_alerts_total"] += 1

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
        "vision_anomaly_score": round(result.vision_anomaly_score, 2),
        "vision_defect_flag": result.vision_defect_flag,
        "vision_inference_ms": round(result.vision_inference_ms, 2),
        "security_flag": result.security_flag,
        "scan_time_ms": round(result.scan_time_ms, 2),
        "process_source": result.process_source,
        "network_source": result.network_source,
        "reasons": result.reasons,
    }


@app.get("/events/stream")
async def events_stream(
    request: Request,
    since_id: int = 0,
    limit: int = 100,
    poll_interval_seconds: float = 1.0,
) -> StreamingResponse:
    cursor_id = max(since_id, 0)
    safe_limit = max(1, min(limit, 200))
    poll_interval = max(0.2, min(poll_interval_seconds, 10.0))

    async def event_generator():
        nonlocal cursor_id
        yield "retry: 1500\n\n"

        while True:
            if await request.is_disconnected():
                break

            try:
                events_payload = _fetch_events(
                    safe_limit,
                    ascending=True,
                    after_id=cursor_id,
                )
            except Exception as error:
                error_payload = json.dumps({"error": str(error)})
                yield f"event: error\\ndata: {error_payload}\\n\\n"
                await asyncio.sleep(poll_interval)
                continue

            if events_payload:
                for event in events_payload:
                    event_id = int(event.get("id", cursor_id))
                    cursor_id = max(cursor_id, event_id)
                    yield f"data: {json.dumps(event)}\\n\\n"
            else:
                yield ": keepalive\\n\\n"

            await asyncio.sleep(poll_interval)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/events")
def events(limit: int = 20) -> dict[str, Any]:
    parsed_rows = _fetch_events(limit, ascending=False)

    return {"count": len(parsed_rows), "events": parsed_rows}


@app.get("/metrics")
def metrics() -> str:
    vision = _get_latest_vision_signal()
    security = _get_latest_security_signal()

    with METRICS_LOCK:
        counters = dict(METRICS_COUNTERS)

    lines = [
        "# HELP analyzer_analyses_total Total analysis requests processed.",
        "# TYPE analyzer_analyses_total counter",
        f'analyzer_analyses_total {counters["analyses_total"]}',
        "# HELP analyzer_process_anomalies_total Total process anomaly detections.",
        "# TYPE analyzer_process_anomalies_total counter",
        f'analyzer_process_anomalies_total {counters["process_anomalies_total"]}',
        "# HELP analyzer_network_alerts_total Total network alert detections.",
        "# TYPE analyzer_network_alerts_total counter",
        f'analyzer_network_alerts_total {counters["network_alerts_total"]}',
        "# HELP analyzer_vision_signals_ingested Total vision signals received.",
        "# TYPE analyzer_vision_signals_ingested counter",
        f'analyzer_vision_signals_ingested {counters["vision_signals_ingested"]}',
        "# HELP analyzer_security_signals_ingested Total security signals received.",
        "# TYPE analyzer_security_signals_ingested counter",
        f'analyzer_security_signals_ingested {counters["security_signals_ingested"]}',
        "# HELP analyzer_vision_signal_fresh Whether a fresh vision signal is available.",
        "# TYPE analyzer_vision_signal_fresh gauge",
        f"analyzer_vision_signal_fresh {1 if vision and _signal_age_seconds(vision.captured_at) <= VISION_SIGNAL_STALE_SECONDS else 0}",
        "# HELP analyzer_security_signal_fresh Whether a fresh security signal is available.",
        "# TYPE analyzer_security_signal_fresh gauge",
        f"analyzer_security_signal_fresh {1 if security and _signal_age_seconds(security.captured_at) <= SECURITY_SIGNAL_STALE_SECONDS else 0}",
    ]

    if vision:
        lines.extend([
            "# HELP analyzer_vision_anomaly_score Latest vision anomaly score.",
            "# TYPE analyzer_vision_anomaly_score gauge",
            f"analyzer_vision_anomaly_score {vision.anomaly_score:.2f}",
        ])

    if security:
        lines.extend([
            "# HELP analyzer_security_packet_rate Latest security packet rate.",
            "# TYPE analyzer_security_packet_rate gauge",
            f"analyzer_security_packet_rate {security.packet_rate:.2f}",
        ])

    from fastapi.responses import PlainTextResponse
    return PlainTextResponse("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4; charset=utf-8")


def reset_runtime_state_for_tests() -> None:
    global LATEST_VISION_SIGNAL
    global LATEST_SECURITY_SIGNAL

    with SIGNAL_LOCK:
        LATEST_VISION_SIGNAL = None
        LATEST_SECURITY_SIGNAL = None

    with METRICS_LOCK:
        for key in METRICS_COUNTERS:
            METRICS_COUNTERS[key] = 0

    FALLBACK_MODEL.production_rate_history.clear()
    FALLBACK_MODEL.reject_rate_history.clear()
    FALLBACK_MODEL.inflight_history.clear()
