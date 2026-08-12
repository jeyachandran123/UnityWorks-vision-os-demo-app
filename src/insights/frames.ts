/**
 * Frames, assembled from observations. **Presentation only.**
 *
 * Every function here is a pure transform of records the platform already
 * produced: group them by frame, count them, and put the counts into a sentence.
 * Nothing infers, nothing calls a model, nothing reaches the network. The page
 * that uses this cannot cause an inference because there is no code path from
 * here to one.
 *
 * That constraint is what makes the output trustworthy rather than merely
 * fluent. "18 people, 2 bicycles and 1 traffic light were detected" is arrived
 * at by counting distinct `object_id`s per `class_id` — a reader who doubts it
 * can open the raw JSON on the same card and count them by hand.
 *
 * The rules, each enforced by a test:
 *
 * 1. **Counts come from observations.** Never from a model, never estimated.
 * 2. **No object is invented.** An object appears only if a record names it.
 * 3. **Absent understanding stays absent.** An object the model was never asked
 *    about shows its detection facts and nothing else.
 * 4. **Deterministic.** Same records in, same words out, independent of arrival
 *    order.
 */

import type { BoundingBox, Confidence, Observation } from '../api/types';

export interface FrameAttribute {
  key: string;
  value: unknown;
  confidence?: Confidence | null;
  evidenceRef?: string | null;
  observedAtNs?: number;
}

export interface FrameObject {
  objectId: string | null;
  classId: string;
  bbox?: BoundingBox;
  confidence?: Confidence | null;
  attributes: FrameAttribute[];
  observationIds: string[];
  /** Stable per-class ordinal, so "Person #3" means the same object all frame. */
  label: string;
}

export interface FrameGroup {
  key: string;
  frameIndex: number | null;
  captureNs: number;
  cameraId: string;
  objects: FrameObject[];
  observations: Observation[];
}

export interface Highlight {
  frameKey: string;
  captureNs: number;
  kind: 'appeared' | 'left' | 'count_changed' | 'attribute_changed';
  text: string;
  objectId?: string;
}

// --- naming ----------------------------------------------------------------- //

/** `traffic_light` → `traffic light`. Class ids are snake_case; English is not. */
export function humanClass(classId: string): string {
  return classId.replace(/[._]/g, ' ').trim();
}

/** Enough for a COCO-shaped class list. `person` is the only true irregular. */
export function plural(word: string): string {
  if (word === 'person') return 'people';
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

export function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** `upper_body_colour` → `Upper body colour`. */
export function humanAttribute(key: string): string {
  return titleCase(key.replace(/[._]/g, ' '));
}

/** `true` → `Yes`. A boolean rendered as `true` reads as debug output. */
export function humanValue(value: unknown): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (value === null || value === undefined) return '—';
  return String(value).replace(/[._]/g, ' ');
}

export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// --- frame identity ---------------------------------------------------------- //

export function frameIndexOf(frameRef: unknown): number | null {
  if (!frameRef || typeof frameRef !== 'object') return null;
  const record = frameRef as Record<string, unknown>;
  for (const field of ['frame_seq', 'frame_sequence', 'sequence', 'frame_index']) {
    const value = record[field];
    if (typeof value === 'number') return value;
  }
  return null;
}

export function describeFrameRef(frameRef: unknown): string {
  if (!frameRef) return '';
  if (typeof frameRef !== 'object') return String(frameRef);
  const record = frameRef as Record<string, unknown>;
  const index = frameIndexOf(frameRef);
  return [
    record.camera_id ? String(record.camera_id) : '',
    index !== null ? `frame ${index}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

// --- grouping ---------------------------------------------------------------- //

/**
 * One group per frame, in capture order.
 *
 * Keyed on the frame reference, falling back to capture time when a record
 * arrives without one. Dropping such a record would be the easy choice and the
 * wrong one: a missing field is a finding, and hiding it makes the account of
 * the video look complete when it is not.
 */
export function groupObservationsByFrame(observations: Observation[]): FrameGroup[] {
  const groups = new Map<string, FrameGroup>();

  for (const observation of observations) {
    const key = describeFrameRef(observation.frame_ref) || `t${observation.t_capture_ns}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        frameIndex: frameIndexOf(observation.frame_ref),
        captureNs: observation.t_capture_ns,
        cameraId: String(observation.camera_id ?? ''),
        objects: [],
        observations: [],
      };
      groups.set(key, group);
    }
    group.observations.push(observation);
    group.captureNs = Math.min(group.captureNs, observation.t_capture_ns);
  }

  for (const group of groups.values()) {
    group.objects = collectObjects(group.observations);
  }

  return [...groups.values()].sort((a, b) => a.captureNs - b.captureNs);
}

/**
 * Fold a frame's records into one entry per object.
 *
 * Several observations describe the same object in one frame — a presence, a
 * spatial, one per attribute. Rendering them separately would make a single
 * person look like four things, so they are merged on `object_id` and the
 * evidence for each is kept.
 */
function collectObjects(observations: Observation[]): FrameObject[] {
  const byObject = new Map<string, FrameObject>();
  const anonymous: FrameObject[] = [];

  for (const observation of observations) {
    const classId = String(observation.class_id ?? '');
    if (!classId) continue;

    const objectId = observation.object_id ? String(observation.object_id) : null;
    const target = objectId ? byObject.get(objectId) : undefined;

    const entry: FrameObject = target ?? {
      objectId,
      classId,
      attributes: [],
      observationIds: [],
      label: '',
    };

    // First box wins. A later record predicting the same object should not
    // silently replace a measured position.
    if (!entry.bbox && observation.spatial?.bbox) entry.bbox = observation.spatial.bbox;
    if (!entry.confidence && observation.confidence) entry.confidence = observation.confidence;
    if (observation.observation_id) entry.observationIds.push(String(observation.observation_id));

    for (const raw of observation.attributes ?? []) {
      const attribute = raw as Record<string, unknown>;
      const key = attribute.key === undefined ? '' : String(attribute.key);
      if (!key) continue;
      if (entry.attributes.some((held) => held.key === key)) continue;
      entry.attributes.push({
        key,
        value: attribute.value,
        confidence: (attribute.confidence ?? null) as Confidence | null,
        evidenceRef: (attribute.evidence_ref ?? observation.evidence_ref ?? null) as string | null,
        observedAtNs: typeof attribute.observed_at_ns === 'number' ? attribute.observed_at_ns : undefined,
      });
    }

    if (objectId) byObject.set(objectId, entry);
    else if (!target) anonymous.push(entry);
  }

  const all = [...byObject.values(), ...anonymous];

  // Sorted by id so the same frame always numbers its objects the same way; a
  // "Person #3" that changed identity between renders would be worse than no
  // number at all.
  all.sort((a, b) => (a.objectId ?? '').localeCompare(b.objectId ?? ''));

  const ordinals = new Map<string, number>();
  for (const object of all) {
    const next = (ordinals.get(object.classId) ?? 0) + 1;
    ordinals.set(object.classId, next);
    object.label = `${titleCase(humanClass(object.classId))} #${next}`;
  }
  return all;
}

// --- counting and describing --------------------------------------------------- //

export function countByClass(group: FrameGroup): Array<{ classId: string; count: number }> {
  const counts = new Map<string, number>();
  for (const object of group.objects) {
    counts.set(object.classId, (counts.get(object.classId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([classId, count]) => ({ classId, count }))
    .sort((a, b) => b.count - a.count || a.classId.localeCompare(b.classId));
}

/**
 * The frame in one sentence, arrived at by counting.
 *
 * "18 people, 2 bicycles and 1 traffic light were detected."
 *
 * No model produced this and none could: it is the counts, in English. The
 * wording says *detected* rather than *present*, because that is the claim the
 * records support — the camera detected them.
 */
export function describeDetections(group: FrameGroup): string {
  const counts = countByClass(group);
  if (counts.length === 0) {
    return 'Nothing the camera recognises was detected in this frame.';
  }

  const parts = counts.map(({ classId, count }) => {
    const name = humanClass(classId);
    return `${count} ${count === 1 ? name : plural(name)}`;
  });

  const listed =
    parts.length === 1
      ? parts[0]!
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${titleCase(listed)} ${counts.length === 1 && counts[0]!.count === 1 ? 'was' : 'were'} detected.`;
}

/**
 * What the understanding layer reported about one object, in readable lines.
 *
 * Empty when nothing was reported — which is the common case and must stay
 * visibly empty. An object the model was never asked about has no attributes,
 * and inventing a line for it would be the one thing this layer must not do.
 */
export function describeUnderstanding(object: FrameObject): string[] {
  return object.attributes.map(
    (attribute) => `${humanAttribute(attribute.key)}: ${humanValue(attribute.value)}`,
  );
}

// --- highlights ---------------------------------------------------------------- //

/**
 * What changed between consecutive frames.
 *
 * Derived by comparing the object sets and attribute values of adjacent groups —
 * arithmetic over records, not a judgment about importance. Nothing here decides
 * whether a change *matters*; that is a consumer's call, and the platform
 * refuses to make it.
 */
export function deriveHighlights(groups: FrameGroup[]): Highlight[] {
  const highlights: Highlight[] = [];

  for (let index = 1; index < groups.length; index += 1) {
    const previous = groups[index - 1]!;
    const current = groups[index]!;

    const before = new Map(previous.objects.map((o) => [o.objectId ?? '', o]));
    const after = new Map(current.objects.map((o) => [o.objectId ?? '', o]));

    for (const [objectId, object] of after) {
      if (objectId && !before.has(objectId)) {
        highlights.push({
          frameKey: current.key,
          captureNs: current.captureNs,
          kind: 'appeared',
          objectId,
          text: `${object.label} first detected.`,
        });
      }
    }

    for (const [objectId, object] of before) {
      if (objectId && !after.has(objectId)) {
        highlights.push({
          frameKey: current.key,
          captureNs: current.captureNs,
          kind: 'left',
          objectId,
          text: `${object.label} no longer detected.`,
        });
      }
    }

    if (previous.objects.length !== current.objects.length) {
      highlights.push({
        frameKey: current.key,
        captureNs: current.captureNs,
        kind: 'count_changed',
        text: `Objects detected changed from ${previous.objects.length} to ${current.objects.length}.`,
      });
    }

    for (const [objectId, object] of after) {
      const was = before.get(objectId);
      if (!was) continue;
      for (const attribute of object.attributes) {
        const previousValue = was.attributes.find((held) => held.key === attribute.key);
        if (previousValue && String(previousValue.value) !== String(attribute.value)) {
          highlights.push({
            frameKey: current.key,
            captureNs: current.captureNs,
            kind: 'attribute_changed',
            objectId,
            text:
              `${object.label} — ${humanAttribute(attribute.key)} changed from ` +
              `${humanValue(previousValue.value)} to ${humanValue(attribute.value)}.`,
          });
        }
      }
    }
  }

  return highlights;
}
