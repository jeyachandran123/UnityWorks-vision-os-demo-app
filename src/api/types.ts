/**
 * Wire types — a projection of the Vision OS Observation API.
 *
 * Every type here mirrors a shape the platform already produces. The demo adds
 * no field of its own to any of them: if a value is on screen, it arrived from
 * Vision OS, and these declarations are how that stays checkable.
 */

export type Nanos = number;
export type Millis = number;

export interface Confidence {
  value: number;
  /** Uncalibrated scores are not comparable across models. Always shown. */
  calibrated: boolean;
  semantics?: string;
  raw_score?: number;
}

export type LifecycleState =
  | 'provisional'
  | 'active'
  | 'occluded'
  | 'lost'
  | 'expired'
  | 'merged_into';

export interface AttributeView {
  key: string;
  value: unknown;
  confidence: Confidence;
  observed_at_ns: Nanos;
  valid_until_ns?: Nanos | null;
  evidence_ref?: string | null;
}

export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SpatialView {
  frame_of_reference?: string;
  bbox?: BoundingBox;
  ground_point?: unknown;
}

export interface ObjectView {
  object_id: string;
  class_id: string;
  class_confidence: Confidence;
  lifecycle: LifecycleState;
  camera_id: string;
  first_seen_ns: Nanos;
  last_seen_ns: Nanos;
  last_confirmed_ns: Nanos;
  /** Derived by the platform. Never recomputed here. */
  is_stale: boolean;
  attributes: Record<string, AttributeView>;
  spatial?: SpatialView | null;
  trajectory?: Array<Record<string, unknown>>;
  provenance?: unknown | null;
  observation_count: number;
}

export interface CoverageSummary {
  observable_fraction: number;
  cameras_observing: number;
  cameras_blind: number;
  cameras_degraded: number;
  unavailable: Array<[string, string]>;
  fully_observable?: boolean;
}

/**
 * What this deployment is able to report at all.
 *
 * The honest answer to "why is there no bus in the summary?" — a class outside
 * `producible_classes` is one the platform was never configured to recognise,
 * and its absence from a result says nothing about whether it was there.
 */
export interface CapabilitySummary {
  taxonomy_version?: string;
  producible_classes: string[];
  producible_attributes: string[];
  gaps?: unknown[];
  models_in_use?: unknown[];
}

export interface StateResult {
  objects: ObjectView[];
  snapshot: {
    partitions: string[];
    consistency: string;
    max_lag_ms: Millis;
    incomplete: Array<[string, string]>;
    taken_at_ns?: Nanos | null;
  };
  /** Required. Accompanies every state answer, unconditionally. */
  coverage: CoverageSummary;
  capabilities?: CapabilitySummary;
  complete?: boolean;
}

export interface Observation {
  observation_id: string;
  observation_type: string;
  camera_id?: string;
  object_id?: string | null;
  class_id?: string | null;
  t_capture_ns: Nanos;
  t_capture_unc_ms?: Millis;
  confidence?: Confidence | null;
  attributes?: Array<Record<string, unknown>>;
  spatial?: SpatialView | null;
  lifecycle_state?: string;
  lifecycle_transition?: { previous: string; current: string; trigger?: string } | null;
  measurement_basis?: string;
  provenance?: Record<string, unknown> | null;
  evidence_ref?: string | null;
  supersedes?: string | null;
  frame_ref?: unknown;
  [key: string]: unknown;
}

// --- session and media --------------------------------------------------- //

export interface MediaProbe {
  frame_count: number;
  width: number;
  height: number;
  fps: number;
  duration_ms: Millis;
  backend: string;
  seekable: boolean;
}

export interface MediaAsset {
  media_id: string;
  name: string;
  kind: 'video_file' | 'frame_folder' | 'synthetic' | 'rtsp_replay';
  usable: boolean;
  decoded?: boolean;
  error?: string | null;
  probe?: MediaProbe | null;
}

export type SessionState =
  | 'created'
  | 'booting'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'failed';

export interface SessionDescription {
  session_id: string;
  state: SessionState;
  error?: string | null;
  media_id: string;
  media_name: string;
  camera_id: string;
  tenant_id: string;
  semantics: 'archival' | 'realtime';
  target_fps: number;
  frame_count: number;
  frame_index: number;
  /** Set by the platform when the session was opened. Orders "newest first". */
  created_at_ns?: Nanos;
  playing: boolean;
  speed: number;
  exhausted: boolean;
  events_attached: boolean;
  taps: { sequence: number; dropped: number; by_channel: Record<string, number> };
}

export interface FrameLedgerEntry {
  frame_index: number;
  pts_ms: Millis;
  width: number;
  height: number;
  bytes: number;
  is_keyframe: boolean;
  faults: string[];
  emitted_at_ns: Nanos;
}

// --- model and economy ---------------------------------------------------- //

export interface ModelPanel {
  available: boolean;
  reason?: string;
  /** The adapter that is *actually* bound. Never the one we hoped for. */
  adapter_id: string;
  binding_note: string;
  bound_understanders: string[];
  capabilities: Record<string, unknown>;
  warnings: string[];
  cold_start_ms: number;
  inference: {
    requests: number;
    succeeded: number;
    failed: number;
    refused: number;
    timed_out: number;
    unparseable: number;
    mean_latency_ms: number;
    last_latency_ms: number;
    p50_latency_ms: number;
    p95_latency_ms: number;
    prompt_tokens: number;
    eval_tokens: number;
  } | null;
  runtime: { available: boolean; model?: string; endpoint?: string; error?: string | null };
}

export interface EconomyReport {
  available: boolean;
  reason?: string;
  frames_processed: number;
  objects_tracked: number;
  naive_model_calls: number;
  actual_model_calls: number;
  /** Conformance-gate probes made at binding time. Validation, not perception. */
  binding_time_calls: number;
  calls_avoided: number;
  reduction_factor: number | null;
  measured_p50_latency_ms: number;
  naive_wall_clock_s: number;
  actual_wall_clock_s: number;
  mechanisms: Array<{ name: string; detail: string }>;
  observations_built: number;
  note: string;
}

// --- frame narration ------------------------------------------------------ //

/**
 * One frame, described by the vision model in a sentence.
 *
 * **Not an observation.** No confidence, no evidence reference, no provenance,
 * and no replay guarantee — the platform did not produce it and does not vouch
 * for it. `is_observation` is carried on every record rather than assumed from
 * context, because these get rendered next to real observations and the
 * difference has to survive the trip.
 */
export interface NarrationRecord {
  frame_index: number;
  text: string;
  available: boolean;
  reason?: string;
  latency_ms: number;
  model?: string;
  kind: 'model_narration';
  is_observation: false;
}

export interface NarrationFeed {
  available: boolean;
  running: boolean;
  started: boolean;
  stride?: number;
  records: NarrationRecord[];
  note?: string;
}

export interface NarrationStatus {
  available: boolean;
  reason?: string;
  session_id?: string;
  stride?: number;
  max_frames?: number;
  running?: boolean;
}

// --- stream --------------------------------------------------------------- //

export const CHANNELS = [
  'camera',
  'acquisition',
  'detection',
  'tracking',
  'registry',
  'cropping',
  'understanding',
  'synthesis',
  'state',
  'observation',
  'demand',
  'metrics',
  'health',
  'event',
  'transport',
] as const;

export type Channel = (typeof CHANNELS)[number];

export interface TapMessage<P = Record<string, unknown>> {
  seq: number;
  ts_ns: Nanos;
  channel: Channel;
  type: string;
  payload: P;
  frame_index?: number;
}

export interface HealthReport {
  harness: {
    status: string;
    serve_frames: boolean;
    allow_evidence: boolean;
  };
  vision_os: { available: boolean; api_version?: string; error?: string };
  media: { backends: string[]; containers: Record<string, boolean> };
  sessions: Array<{ session_id: string; state: string; vision_os?: Record<string, string> }>;
}

export interface ArchitectureReport {
  layers: Array<{ layer: string; module: string; contains: string }>;
  declared_order: string[];
  invariants: Array<{ id: string; name: string; evidence: string }>;
  runtime: {
    available: boolean;
    reason?: string;
    health?: Record<string, string>;
    started_layers?: string[];
    partitions?: string[];
    observed_order?: Array<{ channel: string; first_seq: number; out_of_order: boolean }>;
  };
}

export interface MetricsResponse {
  available: boolean;
  reason?: string;
  sample?: { source: string | null; values: Record<string, unknown>; unavailable?: string };
  names: string[];
  frames_emitted?: number;
}

export interface EvidenceView {
  observation_id: string;
  trigger_reason?: string;
  crop?: string | null;
  raw_model_output?: string | null;
  decision_path?: string[];
  provenance?: unknown;
}
