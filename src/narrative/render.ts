/**
 * Deterministic narrative rendering.
 *
 * Carried into the demo unchanged in spirit from the Validation Console: every
 * word is either a fixed template or a value copied verbatim from the
 * observation. It infers nothing, merges nothing, and reaches no conclusion.
 *
 * Prose is more persuasive than JSON, which is exactly why it is dangerous in a
 * customer-facing product. So the same five rules hold, and the same tests
 * enforce them:
 *
 * 1. One record, one narrative — never merge observations.
 * 2. Every clause names its source field.
 * 3. No thresholds: `0.80` renders as `0.800`, never "high confidence".
 * 4. Unknown values render verbatim rather than being guessed or dropped.
 * 5. Deterministic — no clock, no locale, no randomness.
 */

import type { Observation } from '../api/types';

export interface Clause {
  text: string;
  fields: string[];
}

export interface Narrative {
  sentence: string;
  clauses: Clause[];
  caveats: string[];
  unrenderedFields: string[];
}

const TYPE_LEAD: Record<string, string> = {
  presence: 'reported an object present',
  spatial: 'reported a spatial change',
  attribute: 'reported an attribute',
  identity: 'reported an identity assertion',
  lifecycle: 'reported a lifecycle change',
  quality: 'reported an input-quality change',
  coverage: 'reported its own observability',
};

const CAVEAT = {
  uncalibrated:
    'This confidence is self-reported by the model and uncalibrated — it is not a probability and must not be compared against another model’s score.',
  predicted: 'This position was predicted, not measured; the object was not directly observed in this frame.',
  coverage:
    'This describes what the platform could see, not what was there. An absence of observations across this window is not an observation of absence.',
  noEvidence: 'No evidence reference is attached to this record.',
} as const;

const NEVER_RENDERED = new Set([
  'schema_version',
  'taxonomy_version',
  'tenant_id',
  'site_id',
  'labels',
  'demand_ids',
  'lineage',
  't_published_ns',
  'timing',
  'clock_quality',
]);

export function formatOffset(ns: number, anchorNs = 0): string {
  const delta = ns - anchorNs;
  const sign = delta < 0 ? '-' : '+';
  const abs = Math.abs(delta);
  if (abs < 1_000_000) return `${sign}${(abs / 1000).toFixed(1)} µs`;
  if (abs < 1_000_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)} ms`;
  return `${sign}${(abs / 1_000_000_000).toFixed(3)} s`;
}

function confidenceText(confidence: Record<string, unknown> | null | undefined): string | null {
  if (!confidence || typeof confidence.value !== 'number') return null;
  const semantics = typeof confidence.semantics === 'string' ? confidence.semantics : null;
  const notes = [semantics, confidence.calibrated === true ? 'calibrated' : 'uncalibrated'].filter(Boolean);
  return `${confidence.value.toFixed(3)} (${notes.join(', ')})`;
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function shortId(value: unknown, keep = 10): string {
  const text = String(value ?? '');
  return text.length <= keep ? text : `…${text.slice(-keep)}`;
}

export function renderObservation(observation: Observation, anchorNs = 0): Narrative {
  const record = observation as unknown as Record<string, unknown>;
  const clauses: Clause[] = [];
  const caveats: string[] = [];
  const used = new Set<string>();

  const add = (text: string, fields: string[]) => {
    if (!fields.length) throw new Error('a narrative clause must name its source fields');
    fields.forEach((field) => used.add(field));
    clauses.push({ text, fields });
  };

  const type = String(record.observation_type ?? '');
  const when =
    typeof record.t_capture_ns === 'number'
      ? `At ${formatOffset(record.t_capture_ns, anchorNs)}`
      : 'At an unstated capture time';
  const camera = record.camera_id ? `camera ${record.camera_id}` : 'an unstated camera';
  const lead = TYPE_LEAD[type] ?? `reported an observation of type “${type || 'unstated'}”`;

  add(`${when}, ${camera} ${lead}`, ['t_capture_ns', 'camera_id', 'observation_type']);

  if (record.class_id) {
    const cls = String(record.class_id);
    add(`the object is classified ${article(cls)} ${cls}`, ['class_id']);
  }
  if (record.object_id) add(`object ${shortId(record.object_id, 8)}`, ['object_id']);

  const attributes = record.attributes;
  if (Array.isArray(attributes)) {
    for (const raw of attributes) {
      const attribute = raw as Record<string, unknown>;
      const key = String(attribute.key ?? 'unstated');
      const parts = [`${key} = ${JSON.stringify(attribute.value)}`];
      const conf = confidenceText(attribute.confidence as Record<string, unknown>);
      if (conf) parts.push(`confidence ${conf}`);
      if (attribute.evidence_ref) parts.push(`evidence ${shortId(attribute.evidence_ref)}`);
      add(parts.join(', '), ['attributes']);
      if (conf && (attribute.confidence as Record<string, unknown>)?.calibrated !== true) {
        caveats.push(CAVEAT.uncalibrated);
      }
    }
  }

  const transition = record.lifecycle_transition as Record<string, unknown> | null | undefined;
  if (transition) {
    add(`state moved from ${transition.previous} to ${transition.current}`, ['lifecycle_transition']);
  }

  const spatial = record.spatial as Record<string, unknown> | null | undefined;
  const bbox = spatial?.bbox as Record<string, number> | undefined;
  if (bbox && ['x1', 'x2', 'y1', 'y2'].every((k) => typeof bbox[k] === 'number')) {
    add(
      `occupying x ${bbox.x1!.toFixed(3)}–${bbox.x2!.toFixed(3)}, y ${bbox.y1!.toFixed(3)}–${bbox.y2!.toFixed(3)}`,
      ['spatial'],
    );
  }

  const classConfidence = confidenceText(record.confidence as Record<string, unknown>);
  if (classConfidence) {
    add(`class confidence ${classConfidence}`, ['confidence']);
    if ((record.confidence as Record<string, unknown>)?.calibrated !== true) {
      caveats.push(CAVEAT.uncalibrated);
    }
  }

  if (record.lifecycle_state) add(`lifecycle ${record.lifecycle_state}`, ['lifecycle_state']);
  if (record.measurement_basis) {
    add(`basis ${record.measurement_basis}`, ['measurement_basis']);
    if (record.measurement_basis === 'predicted') caveats.push(CAVEAT.predicted);
  }

  const provenance = record.provenance as Record<string, unknown> | null | undefined;
  if (provenance) {
    const producer = [provenance.producer_module, provenance.adapter_id, provenance.model_id]
      .filter(Boolean)
      .join(' · ');
    add(`produced by ${producer || 'an unstated producer'}`, ['provenance']);
  }

  if (record.evidence_ref) {
    add(`evidence ${shortId(record.evidence_ref)}`, ['evidence_ref']);
  } else {
    caveats.push(CAVEAT.noEvidence);
    used.add('evidence_ref');
  }

  if (type === 'coverage') caveats.push(CAVEAT.coverage);

  const present = Object.keys(record).filter((key) => {
    const value = record[key];
    if (value === null || value === undefined) return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  });

  return {
    sentence: `${clauses.map((c) => c.text).join('; ')}.`,
    clauses,
    caveats: Array.from(new Set(caveats)),
    unrenderedFields: present.filter((key) => !used.has(key) && !NEVER_RENDERED.has(key)).sort(),
  };
}
