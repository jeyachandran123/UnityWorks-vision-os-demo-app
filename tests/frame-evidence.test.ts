/**
 * A frame's evidence listing must be complete, and honest about what is missing.
 *
 * The failure this file exists to prevent is silent: build the listing from the
 * retained crops and a frame holding two people, two ties and one car renders as
 * however many of them the model happened to be asked about. Nothing looks
 * broken — the objects simply are not there.
 *
 * So the tests below assert the inverse property. Every object in the frame gets
 * an entry, whatever the model did, and an entry with no picture carries the
 * platform's own recorded reason rather than a blank.
 */

import { describe, expect, it } from 'vitest';
import { collectFrameEvidence, groupObservationsByFrame } from '../src/insights/frames';
import type { CropIndex, Observation } from '../src/api/types';

function detection(objectId: string, classId: string, seq = 0): Observation {
  return {
    observation_id: `obs-${objectId}-${seq}`,
    observation_type: 'presence',
    camera_id: 'cam-validation',
    frame_ref: { camera_id: 'cam-validation', stream_epoch: 0, frame_seq: seq },
    t_capture_ns: (seq + 1) * 1_000_000_000,
    class_id: classId,
    object_id: objectId,
    spatial: { frame_of_reference: 'normalized', bbox: { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.5 } },
  } as Observation;
}

function crop(objectId: string, cropId: string, frameSeq: number | null) {
  return {
    crop_id: cropId,
    object_id: objectId,
    camera_id: 'cam-validation',
    frame_seq: frameSeq,
    t_capture_ns: 1_000_000_000,
    width: 224,
    height: 224,
  };
}

function index(overrides: Partial<CropIndex> = {}): CropIndex {
  return { available: true, by_object: {}, ...overrides };
}

/** A frame shaped like the one in the brief: two people, two ties. */
const FRAME_83 = [
  detection('p1', 'person', 83),
  detection('p2', 'person', 83),
  detection('t1', 'tie', 83),
  detection('t2', 'tie', 83),
];

const groupOf = (records: Observation[]) => groupObservationsByFrame(records)[0]!;

// --- completeness ---------------------------------------------------------------- //

describe('every object in the frame is listed', () => {
  it('returns one entry per object even when no crop was retained at all', () => {
    const evidence = collectFrameEvidence(groupOf(FRAME_83), index());
    expect(evidence).toHaveLength(4);
    expect(evidence.map((entry) => entry.object.label)).toEqual([
      'Person #1',
      'Person #2',
      'Tie #1',
      'Tie #2',
    ]);
  });

  it('lists objects the model was never asked about beside the ones it was', () => {
    // The policy asked about people only. The ties are detection-only, and they
    // are exactly what used to vanish from this section.
    const evidence = collectFrameEvidence(
      groupOf(FRAME_83),
      index({
        by_object: {
          p1: [crop('p1', 'crop-p1', 83)],
          p2: [crop('p2', 'crop-p2', 83)],
        },
        skips_by_object: {
          t1: [{ frame_seq: 83, reason: 'no_demand' }],
          t2: [{ frame_seq: 83, reason: 'no_demand' }],
        },
      }),
    );
    expect(evidence).toHaveLength(4);
    expect(evidence.filter((entry) => entry.kind === 'crop')).toHaveLength(2);
    const ties = evidence.filter((entry) => entry.object.classId === 'tie');
    expect(ties.map((entry) => entry.kind)).toEqual(['no_crop', 'no_crop']);
    expect(ties.every((entry) => entry.note.length > 0)).toBe(true);
  });

  it('keeps this frame’s own objects and no others', () => {
    const evidence = collectFrameEvidence(
      groupOf([...FRAME_83, detection('p9', 'person', 84)]),
      index(),
    );
    expect(evidence.map((entry) => entry.object.objectId)).toEqual(['p1', 'p2', 't1', 't2']);
  });

  it('lists an object that has no identity rather than dropping it', () => {
    const anonymous = { ...detection('x', 'person', 83), object_id: null } as Observation;
    const evidence = collectFrameEvidence(groupOf([anonymous]), index());
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.kind).toBe('no_crop');
    expect(evidence[0]!.note).toMatch(/object identity/i);
  });
});

// --- scoping to the frame --------------------------------------------------------- //

describe('evidence is scoped to this frame, and says when it is not', () => {
  it('prefers the crop taken on this frame', () => {
    const evidence = collectFrameEvidence(
      groupOf([detection('p1', 'person', 83)]),
      index({ by_object: { p1: [crop('p1', 'older', 40), crop('p1', 'exact', 83)] } }),
    );
    expect(evidence[0]!.kind).toBe('crop');
    expect(evidence[0]!.cropId).toBe('exact');
    expect(evidence[0]!.cropFrameSeq).toBe(83);
  });

  it('labels a reused crop with the frame it actually came from', () => {
    // An object is examined once per freshness window, so the picture behind its
    // attributes is usually an earlier frame's. Showing it unlabelled would
    // misdate the evidence.
    const evidence = collectFrameEvidence(
      groupOf([detection('p1', 'person', 83)]),
      index({ by_object: { p1: [crop('p1', 'from-40', 40)] } }),
    );
    expect(evidence[0]!.kind).toBe('crop_from_other_frame');
    expect(evidence[0]!.cropFrameSeq).toBe(40);
    expect(evidence[0]!.note).toMatch(/frame 40/);
  });
});

// --- evidence does not depend on the model ----------------------------------------- //

describe('a missing picture is a recorded decision, not a gap', () => {
  it('carries the platform’s reason through for each skip', () => {
    const reasons: Array<[string, RegExp]> = [
      ['no_demand', /nothing asked/i],
      ['budget_exhausted', /budget/i],
      ['quality_insufficient', /too small or too unclear/i],
      ['fresh_enough', /already recorded/i],
      ['frame_unavailable', /no longer held in memory/i],
    ];
    for (const [reason, expected] of reasons) {
      const evidence = collectFrameEvidence(
        groupOf([detection('p1', 'person', 83)]),
        index({ skips_by_object: { p1: [{ frame_seq: 83, reason }] } }),
      );
      expect(evidence[0]!.skipReason).toBe(reason);
      expect(evidence[0]!.note).toMatch(expected);
    }
  });

  it('shows an unrecognised reason verbatim rather than guessing', () => {
    const evidence = collectFrameEvidence(
      groupOf([detection('p1', 'person', 83)]),
      index({ skips_by_object: { p1: [{ frame_seq: 83, reason: 'some_future_reason' }] } }),
    );
    expect(evidence[0]!.skipReason).toBe('some_future_reason');
    expect(evidence[0]!.note).toMatch(/some future reason/);
  });

  it('distinguishes a retention refusal from nothing having been asked', () => {
    const withRetention = collectFrameEvidence(
      groupOf([detection('p1', 'person', 83)]),
      index({ refused_ephemeral: 12 }),
    );
    expect(withRetention[0]!.note).toMatch(/retention policy/i);

    const withoutAnything = collectFrameEvidence(groupOf([detection('p1', 'person', 83)]), index());
    expect(withoutAnything[0]!.note).not.toMatch(/retention policy/i);
  });

  it('never produces an image reference the platform did not write', () => {
    const evidence = collectFrameEvidence(groupOf(FRAME_83), index());
    expect(evidence.every((entry) => entry.cropId === null)).toBe(true);
  });

  it('survives an unavailable crop index without losing an object', () => {
    for (const missing of [null, undefined, index({ available: false })]) {
      const evidence = collectFrameEvidence(groupOf(FRAME_83), missing);
      expect(evidence).toHaveLength(4);
    }
  });
});
