/**
 * The frame presentation layer must count, never conclude.
 *
 * This is the file that would be easiest to "improve" into a lie: a sentence
 * generator sitting next to real records is one refactor away from asserting
 * something no record supports. Every test here pins a claim to the data that
 * has to back it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  countByClass,
  describeDetections,
  describeUnderstanding,
  deriveHighlights,
  formatClock,
  frameIndexOf,
  groupObservationsByFrame,
  humanValue,
  plural,
} from '../src/insights/frames';
import type { Observation } from '../src/api/types';

const SOURCE = readFileSync(join(__dirname, '..', 'src', 'insights', 'frames.ts'), 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Shaped exactly like the records the platform returned in a live run. */
function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    observation_id: `obs-${Math.random().toString(36).slice(2, 8)}`,
    observation_type: 'presence',
    camera_id: 'cam-validation',
    frame_ref: { camera_id: 'cam-validation', stream_epoch: 0, frame_seq: 0 },
    t_capture_ns: 1_000_000_000,
    class_id: 'person',
    object_id: 'obj-a',
    ...overrides,
  } as Observation;
}

function spatial(objectId: string, classId: string, seq: number, box = [0.1, 0.2, 0.3, 0.4]) {
  return observation({
    observation_type: 'spatial',
    object_id: objectId,
    class_id: classId,
    frame_ref: { camera_id: 'cam-validation', stream_epoch: 0, frame_seq: seq },
    t_capture_ns: (seq + 1) * 1_000_000_000,
    spatial: { frame_of_reference: 'normalized', bbox: { x1: box[0]!, y1: box[1]!, x2: box[2]!, y2: box[3]! } },
    confidence: { value: 0.87, calibrated: false },
  });
}

// --- grouping ----------------------------------------------------------------- //

describe('frames are assembled from records, never invented', () => {
  it('groups by frame reference and orders by capture time', () => {
    const groups = groupObservationsByFrame([
      spatial('a', 'person', 2),
      spatial('b', 'person', 0),
      spatial('c', 'person', 1),
    ]);
    expect(groups.map((g) => g.frameIndex)).toEqual([0, 1, 2]);
  });

  it('merges every record about one object into one entry', () => {
    // A presence, a spatial and an attribute for the same object in one frame
    // must render as one object, not three.
    const groups = groupObservationsByFrame([
      observation({ object_id: 'obj-a' }),
      spatial('obj-a', 'person', 0),
      observation({
        observation_type: 'attribute',
        object_id: 'obj-a',
        attributes: [{ key: 'posture', value: 'walking', evidence_ref: 'ev-1' }],
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.objects).toHaveLength(1);
    expect(groups[0]!.objects[0]!.attributes.map((a) => a.key)).toEqual(['posture']);
  });

  it('keeps a record whose frame reference is missing rather than dropping it', () => {
    const groups = groupObservationsByFrame([
      observation({ frame_ref: undefined, t_capture_ns: 5_000_000_000 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.frameIndex).toBeNull();
  });

  it('reads the real frame sequence, never a count', () => {
    expect(frameIndexOf({ camera_id: 'c', stream_epoch: 0, frame_seq: 382 })).toBe(382);
    expect(frameIndexOf(undefined)).toBeNull();
  });

  it('numbers objects deterministically, whatever order records arrive in', () => {
    const records = [spatial('obj-b', 'person', 0), spatial('obj-a', 'person', 0)];
    const forward = groupObservationsByFrame(records)[0]!.objects.map((o) => o.label);
    const reversed = groupObservationsByFrame([...records].reverse())[0]!.objects.map((o) => o.label);
    expect(forward).toEqual(reversed);
  });
});

// --- counting ------------------------------------------------------------------ //

describe('counts come from the records', () => {
  it('counts distinct objects per class', () => {
    const groups = groupObservationsByFrame([
      spatial('p1', 'person', 0),
      spatial('p2', 'person', 0),
      spatial('b1', 'bicycle', 0),
      // The same object seen twice in one frame is still one object.
      spatial('p1', 'person', 0),
    ]);
    expect(countByClass(groups[0]!)).toEqual([
      { classId: 'person', count: 2 },
      { classId: 'bicycle', count: 1 },
    ]);
  });

  it('writes the sentence the counts support', () => {
    const records = [
      ...Array.from({ length: 18 }, (_, i) => spatial(`p${i}`, 'person', 0)),
      spatial('b1', 'bicycle', 0),
      spatial('b2', 'bicycle', 0),
      spatial('t1', 'traffic_light', 0),
    ];
    const summary = describeDetections(groupObservationsByFrame(records)[0]!);
    expect(summary).toBe('18 people, 2 bicycles and 1 traffic light were detected.');
  });

  it('says nothing was detected rather than nothing was there', () => {
    const groups = groupObservationsByFrame([observation({ class_id: undefined })]);
    expect(describeDetections(groups[0]!)).toMatch(/Nothing the camera recognises was detected/);
    expect(describeDetections(groups[0]!)).not.toMatch(/empty|nobody|no one/i);
  });

  it('agrees with itself singular and plural', () => {
    expect(plural('person')).toBe('people');
    expect(plural('bus')).toBe('buses');
    expect(plural('bicycle')).toBe('bicycles');
    const one = groupObservationsByFrame([spatial('p1', 'person', 0)])[0]!;
    expect(describeDetections(one)).toBe('1 person was detected.');
  });
});

// --- understanding -------------------------------------------------------------- //

describe('understanding is shown only where it exists', () => {
  it('renders reported attributes in readable form', () => {
    const groups = groupObservationsByFrame([
      observation({
        observation_type: 'attribute',
        object_id: 'obj-a',
        attributes: [
          { key: 'posture', value: 'walking' },
          { key: 'upper_body_colour', value: 'blue' },
        ],
      }),
    ]);
    expect(describeUnderstanding(groups[0]!.objects[0]!)).toEqual([
      'Posture: walking',
      'Upper body colour: blue',
    ]);
  });

  it('produces nothing for an object the model was never asked about', () => {
    const groups = groupObservationsByFrame([spatial('obj-a', 'person', 0)]);
    expect(describeUnderstanding(groups[0]!.objects[0]!)).toEqual([]);
  });

  it('renders booleans as words rather than debug output', () => {
    expect(humanValue(true)).toBe('Yes');
    expect(humanValue(false)).toBe('No');
    expect(humanValue(null)).toBe('—');
  });
});

// --- highlights ------------------------------------------------------------------ //

describe('highlights are differences, not judgements', () => {
  it('reports an object appearing and leaving', () => {
    const groups = groupObservationsByFrame([
      spatial('a', 'person', 0),
      spatial('a', 'person', 1),
      spatial('b', 'person', 1),
      spatial('b', 'person', 2),
    ]);
    const texts = deriveHighlights(groups).map((h) => h.text);
    expect(texts.some((t) => /first detected/.test(t))).toBe(true);
    expect(texts.some((t) => /no longer detected/.test(t))).toBe(true);
  });

  it('reports an attribute changing, with both values', () => {
    const attr = (seq: number, value: string) =>
      observation({
        observation_type: 'attribute',
        object_id: 'obj-a',
        frame_ref: { camera_id: 'c', stream_epoch: 0, frame_seq: seq },
        t_capture_ns: (seq + 1) * 1_000_000_000,
        attributes: [{ key: 'posture', value }],
      });
    const highlights = deriveHighlights(groupObservationsByFrame([attr(0, 'standing'), attr(1, 'walking')]));
    expect(highlights.some((h) => h.text.includes('standing to walking'))).toBe(true);
  });

  it('never ranks a change as important', () => {
    const banned = /\b(important|critical|urgent|suspicious|alert|violation|risk|breach)\b/i;
    const literals = CODE.match(/'[^']*'|`[^`]*`/g) ?? [];
    expect(literals.filter((literal) => banned.test(literal))).toEqual([]);
  });
});

// --- the layer performs no inference ---------------------------------------------- //

describe('the presentation layer cannot infer', () => {
  it('reaches no network and no model', () => {
    expect(CODE).not.toMatch(/\bfetch\s*\(/);
    expect(CODE).not.toMatch(/new\s+WebSocket/);
    expect(CODE).not.toMatch(/11434|ollama|nvidia|openai|anthropic/i);
  });

  it('uses no clock, locale or randomness', () => {
    expect(CODE).not.toMatch(/Date\.now|performance\.now|new Date\(/);
    expect(CODE).not.toMatch(/Math\.random/);
    expect(CODE).not.toMatch(/toLocaleString|Intl\./);
  });

  it('is deterministic for identical input', () => {
    const records = [spatial('a', 'person', 0), spatial('b', 'bicycle', 0)];
    expect(JSON.stringify(groupObservationsByFrame(records))).toBe(
      JSON.stringify(groupObservationsByFrame(records)),
    );
  });

  it('formats timestamps as clock time', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(75)).toBe('1:15');
  });
});
