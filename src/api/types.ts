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
  /**
   * `[key, value]` pairs stating what the platform *cannot* do.
   *
   * Typed rather than `unknown[]` because the page now reads two of them:
   * `detector.label_space` and `detector.vocabulary`, which together say whether
   * a class name is an identification or the nearest word in a fixed list.
   */
  gaps?: Array<[string, string]>;
  /** `[adapter_id, model_id, model_version]`, as the platform reports it. */
  models_in_use?: Array<[string, string, string]>;
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

/**
 * Crops the deployment retained, indexed by the object they were taken of.
 *
 * `refused_ephemeral` and `refused_never_persist` are reported rather than
 * hidden: a viewer seeing no images has to be able to tell "none were produced"
 * from "the retention policy declined to keep them".
 */
export interface RetainedCrop {
  crop_id: string;
  object_id: string | null;
  camera_id: string;
  frame_seq: number | null;
  t_capture_ns: number;
  width: number;
  height: number;
}

/**
 * A candidate the Crop Manager considered and did not crop, with its reason.
 *
 * The other half of the crop index, and the reason a viewer can show a whole
 * frame honestly: an object with no crop is not a gap, it is a decision, and
 * `reason` is the platform's own word for which decision it was.
 */
export interface CropSkip {
  frame_seq: number | null;
  /** A `SkipReason` value — `no_demand`, `quality_insufficient`, and so on. */
  reason: string;
  detail?: string;
}

export interface CropIndex {
  available: boolean;
  reason?: string;
  written?: number;
  retained?: number;
  skipped?: number;
  refused_ephemeral?: number;
  refused_never_persist?: number;
  errors?: number;
  by_object: Record<string, RetainedCrop[]>;
  skips_by_object?: Record<string, CropSkip[]>;
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

/**
 * Compliance findings.
 *
 * Every field here is produced by the rule engine on the platform side. The demo
 * renders them and computes nothing: there is no rule in this bundle, no
 * threshold, and no comparison — `state` arrives decided, and `sentence` arrives
 * written from the rule document's own wording.
 *
 * That is not a stylistic choice. A verdict a browser computed is a verdict
 * nobody can audit six months later, because the reasoning lived in a bundle
 * that has since been redeployed.
 */

/** The three real answers, plus the one that means "this rule did not apply". */
export type ComplianceState = 'compliant' | 'violation' | 'unknown' | 'not_applicable';

/**
 * Why a condition could not be established. Rendered verbatim — the UI never
 * translates one of these into a verdict.
 */
export type UnknownReason =
  | 'attribute_absent'
  | 'attribute_stale'
  | 'evidence_unverified'
  | 'coverage_gap'
  | 'capability_gap'
  | 'subject_not_observed'
  | 'value_unparseable';

export interface ConditionOutcome {
  attribute_key: string;
  operator: string;
  expected: unknown;
  observed: unknown;
  /** `true` held · `false` failed · `null` could not be established. */
  satisfied: boolean | null;
  unknown_reason: UnknownReason | null;
  observed_at_ns: number | null;
  /** Handle for the evidence contract. Never imagery — resolving it is a
   *  separately privileged request the viewer makes under its own purpose. */
  evidence_ref: string | null;
  message: string;
}

export interface FindingSubject {
  object_id: string;
  class_id: string;
  camera_id: string;
  /** A display handle assigned by the platform side, e.g. `Person #2`.
   *  Presentation only — no evaluation reads it. */
  label: string;
}

export interface Finding {
  finding_id: string;
  rule_id: string;
  rule_version: string;
  ruleset_version: string;
  state: ComplianceState;
  severity: string;
  /** The end-user sentence, assembled from the rule document. Not generated. */
  sentence: string;
  evaluated_at_ns: number;
  /** How much of the subject's scope was observable when this was decided. A
   *  compliant verdict under partial coverage is a different claim. */
  coverage_fraction: number;
  subject: FindingSubject;
  unknown_reasons: UnknownReason[];
  evidence_refs: string[];
  conditions: ConditionOutcome[];
}

export interface ComplianceSummary {
  total: number;
  compliant: number;
  violation: number;
  unknown: number;
  not_applicable: number;
}

export interface ComplianceResult {
  available: boolean;
  reason?: string;
  evaluated_at_ns?: number;
  ruleset_version?: string;
  subjects_read?: number;
  coverage?: {
    observable_fraction: number;
    cameras_observing: number;
    cameras_blind: number;
    complete: boolean;
  };
  findings: Finding[];
  summary: ComplianceSummary;
}

export interface ComplianceStatus {
  enabled: boolean;
  reason?: string;
  ruleset_version?: string;
  rule_count: number;
  rules: string[];
  required_attributes: string[];
  /** Rules depending on an attribute no bound model can produce. Reported so a
   *  permanent UNKNOWN has a visible cause rather than looking like a bug. */
  capability_gaps: Array<{ rule_id: string; attribute: string }>;
}
