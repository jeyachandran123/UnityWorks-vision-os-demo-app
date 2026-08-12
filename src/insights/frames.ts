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

import type {
  BoundingBox,
  Confidence,
  CropIndex,
  Observation,
  RetainedCrop,
} from '../api/types';

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

/**
 * `2` → `two`. Small numbers spelled out, because the story is prose.
 *
 * Only the story uses this. `describeDetections` keeps digits, which is right
 * for a line whose job is to be counted against the raw records.
 */
const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five',
  'six', 'seven', 'eight', 'nine', 'ten',
];

export function spellCount(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
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

// --- the frame story ------------------------------------------------------------ //

/**
 * A frame in a sentence a manager can read, built only from what was recorded.
 *
 * ### Where the words come from
 *
 * Two places, and nowhere else: the **counts** of objects the platform detected,
 * and the **values** of attributes the understanding layer recorded about them.
 * The template around them is fixed. There is no model call here — this file
 * cannot make one — so the story is a rendering of the same records the raw JSON
 * on the card shows, and a reader who doubts a clause can go and check it.
 *
 * ### What it refuses to say
 *
 * *An action nobody recorded.* Two people with no attributes produce "Two people
 * are visible in this frame", never "two people are talking". The verb only ever
 * arrives as a recorded value.
 *
 * *A relationship.* "Together", "with each other", "next to" — none of these are
 * written, because the platform's observation set is closed at seven types
 * (presence, spatial, attribute, identity, lifecycle, quality, coverage) and
 * none of them relates one object to another. Two people each recorded as
 * dancing is two facts, and rendering it as "dancing together" would add a third
 * that no record supports.
 *
 * *A context.* No scene, no venue, no occasion. Where the footage is and what it
 * is for is the viewer's knowledge, not the platform's.
 *
 * *An arbitrary attribute as a predicate.* Only keys naming an activity or an
 * action become a verb phrase. That restriction is grammatical rather than
 * squeamish: `posture` renders as "standing" and reads correctly, while
 * `upper_body_colour` would render as "Two people are blue". Every other
 * recorded attribute stays in "What the model was asked about", where it is
 * shown with its key and cannot be misread.
 *
 * ### Vocabulary
 *
 * None. This function knows no class, no attribute key and no value — it matches
 * key *shapes* (`activity`, `action`) and copies values through. A policy that
 * introduces a new attribute needs no change here, and there is no scene this
 * file could be taught to recognise.
 */
export interface FrameStory {
  /** The sentence, ready to render. Never empty. */
  text: string;
  /**
   * Which kind of record the sentence rests on:
   * `activity` — at least one clause carries a recorded activity value;
   * `presence` — counts only;
   * `none` — nothing was detected.
   */
  basis: 'activity' | 'presence' | 'none';
  /** One line per clause, naming the records behind it. Shown in traceability. */
  grounds: string[];
}

/**
 * Keys whose value can be read as something an object is *doing*.
 *
 * A shape, not a list of words. `activity`, `visible_hand_activity` and
 * `action` all match; nothing about kitchens, streets or parties is encoded, and
 * a policy inventing `crowd_action` tomorrow matches without a change here.
 */
const ACTIVITY_KEY = /(^|[._])(activity|action)([._]|$)/i;

/**
 * Values that assert nothing.
 *
 * Every shipped policy uses these to mean "there is nothing to report on this
 * axis", so rendering one as a verb produces "Two people are none". They are
 * absence markers rather than domain terms — no scene, class or use case is
 * named here.
 */
const NO_CLAIM = new Set(['', 'none', 'other', 'unknown', 'not_visible', 'not visible', 'n/a']);

function carriesClaim(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  return !NO_CLAIM.has(String(value).trim().toLowerCase());
}

/** `a, b and c`. Oxford-free, because the sentence is short by construction. */
function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function nounFor(classId: string, count: number): string {
  const name = humanClass(classId);
  return count === 1 ? name : plural(name);
}

export function describeFrameStory(group: FrameGroup): FrameStory {
  if (group.objects.length === 0) {
    return {
      text: 'Nothing the camera recognises appears in this frame.',
      basis: 'none',
      grounds: [],
    };
  }

  // Objects carrying a recorded activity, grouped by class *and* value — three
  // people dancing and one standing is two clauses, not a majority verdict.
  const doing = new Map<string, { classId: string; key: string; value: string; count: number }>();
  // Everything else, counted by class. An object whose activity was never
  // recorded belongs here, and saying so is the whole point.
  const present = new Map<string, number>();

  for (const object of group.objects) {
    const activity = object.attributes.find(
      (attribute) => ACTIVITY_KEY.test(attribute.key) && carriesClaim(attribute.value),
    );
    if (!activity) {
      present.set(object.classId, (present.get(object.classId) ?? 0) + 1);
      continue;
    }
    const value = humanValue(activity.value);
    const id = `${object.classId} ${value}`;
    const held = doing.get(id);
    if (held) held.count += 1;
    else doing.set(id, { classId: object.classId, key: activity.key, value, count: 1 });
  }

  const grounds: string[] = [];

  const acting = [...doing.values()].sort(
    (a, b) => b.count - a.count || a.classId.localeCompare(b.classId) || a.value.localeCompare(b.value),
  );
  const actingClauses = acting.map((entry) => {
    grounds.push(
      `${entry.count} × ${entry.classId} — ${entry.key} recorded as “${entry.value}”`,
    );
    return `${spellCount(entry.count)} ${nounFor(entry.classId, entry.count)} ${
      entry.count === 1 ? 'is' : 'are'
    } ${entry.value}`;
  });

  const standing = [...present.entries()]
    .map(([classId, count]) => ({ classId, count }))
    .sort((a, b) => b.count - a.count || a.classId.localeCompare(b.classId));
  const presentClauses = standing.map((entry) => {
    grounds.push(`${entry.count} × ${entry.classId} — detected, no activity recorded`);
    return `${spellCount(entry.count)} ${nounFor(entry.classId, entry.count)}`;
  });

  const sentences: string[] = [];
  if (actingClauses.length) sentences.push(`${titleCase(joinClauses(actingClauses))}.`);

  if (presentClauses.length) {
    const total = standing.reduce((sum, entry) => sum + entry.count, 0);
    const verb = total === 1 ? 'is' : 'are';
    // "also visible" only once something else has already been said, or the
    // sentence claims a comparison it is not making.
    const tail = actingClauses.length ? `${verb} also visible` : `${verb} visible`;
    sentences.push(`${titleCase(joinClauses(presentClauses))} ${tail} in this frame.`);
  }

  return {
    text: sentences.join(' '),
    basis: actingClauses.length ? 'activity' : 'presence',
    grounds,
  };
}

// --- evidence ------------------------------------------------------------------- //

/**
 * How a frame's objects line up against the images the deployment kept.
 *
 * `crop` and `crop_from_other_frame` are held apart deliberately. An object is
 * examined once per freshness window, so the picture a model was shown is often
 * an earlier frame's, and captioning it as this frame's would be a small lie
 * about when the evidence was taken.
 */
export type EvidenceKind = 'crop' | 'crop_from_other_frame' | 'no_crop';

export interface FrameEvidence {
  object: FrameObject;
  kind: EvidenceKind;
  /** The retained crop to fetch, when one exists. */
  cropId: string | null;
  /** The frame that crop was taken on. Differs from the group's when reused. */
  cropFrameSeq: number | null;
  /** Why there is no image, in the viewer's language. Empty when there is one. */
  note: string;
  /** The platform's own `SkipReason`, when it recorded one. For traceability. */
  skipReason: string | null;
}

/**
 * `SkipReason` in plain English.
 *
 * Each key is a value of the platform's closed `SkipReason` enum and each line
 * says the same thing the enum's own documentation says. Nothing is decided
 * here — an unrecognised reason falls through to being shown verbatim rather
 * than being guessed at or hidden.
 */
const SKIP_NOTES: Record<string, string> = {
  no_demand: 'Nothing asked about this object, so no image was taken of it.',
  budget_exhausted: 'The examination budget for this period was already spent.',
  quality_insufficient:
    'The view of this object was too small or too unclear to support a claim.',
  fresh_enough: 'What was already recorded about this object was still current.',
  deduplicated: 'An identical request for this object was already in progress.',
  priority_preempted: 'Another object was examined ahead of this one.',
  frame_unavailable: 'The frame was no longer held in memory when the image was to be taken.',
};

/**
 * One entry per object in the frame — **every** object, always.
 *
 * This is the function that makes the Evidence section complete. It returns the
 * frame's objects unfiltered and in their existing order, so an object cannot
 * fall out of the listing by having no picture; it appears with the reason
 * instead. Building it the other way round — starting from the crops and
 * showing what they cover — is what let detection-only objects disappear.
 *
 * It creates no image. `cropId` names a crop the Flow 5 sink already wrote, and
 * an object with none gets `null` and a sentence.
 */
export function collectFrameEvidence(
  group: FrameGroup,
  index: CropIndex | null | undefined,
): FrameEvidence[] {
  const retentionRefused =
    (index?.refused_ephemeral ?? 0) > 0 || (index?.refused_never_persist ?? 0) > 0;

  return group.objects.map((object) => {
    const base = { object, cropId: null, cropFrameSeq: null, skipReason: null };

    if (!object.objectId) {
      return {
        ...base,
        kind: 'no_crop' as const,
        note: 'This detection was recorded without an object identity, so no image can be matched to it.',
      };
    }

    const held: RetainedCrop[] = index?.by_object?.[object.objectId] ?? [];
    const onThisFrame = held.find((crop) => crop.frame_seq === group.frameIndex);
    if (onThisFrame) {
      return {
        ...base,
        kind: 'crop' as const,
        cropId: onThisFrame.crop_id,
        cropFrameSeq: onThisFrame.frame_seq,
        note: '',
      };
    }

    const mostRecent = held.length ? held[held.length - 1]! : null;
    if (mostRecent) {
      return {
        ...base,
        kind: 'crop_from_other_frame' as const,
        cropId: mostRecent.crop_id,
        cropFrameSeq: mostRecent.frame_seq,
        note:
          mostRecent.frame_seq === null
            ? 'This image was kept for this object on another frame.'
            : `This image was kept for this object on frame ${mostRecent.frame_seq}, not this one.`,
      };
    }

    // No image at all. The platform recorded why, per frame — prefer its answer
    // over anything this layer could infer.
    const skips = index?.skips_by_object?.[object.objectId] ?? [];
    const skip = skips.find((entry) => entry.frame_seq === group.frameIndex) ?? skips[0] ?? null;
    if (skip) {
      return {
        ...base,
        kind: 'no_crop' as const,
        skipReason: skip.reason,
        note: SKIP_NOTES[skip.reason] ?? `The platform recorded: ${humanValue(skip.reason)}.`,
      };
    }

    return {
      ...base,
      kind: 'no_crop' as const,
      note: retentionRefused
        ? 'No image was kept for this object: this deployment’s retention policy discards crops once they have been analysed.'
        : 'No image was kept for this object in this frame.',
    };
  });
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
