/**
 * The frame story must read like English and claim nothing extra.
 *
 * A sentence is more persuasive than a table, which is exactly why this one is
 * dangerous: "Two people are dancing" is a pleasure to read and a lie whenever
 * the records only say two people were detected. Every test here pins a word in
 * the output to the record that has to be present for it to appear.
 *
 * The companion file, `frame-evidence.test.ts`, does the same for the pictures.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeFrameStory, groupObservationsByFrame, spellCount } from '../src/insights/frames';
import type { Observation } from '../src/api/types';

const SOURCE = readFileSync(join(__dirname, '..', 'src', 'insights', 'frames.ts'), 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

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

function attribute(objectId: string, classId: string, key: string, value: unknown, seq = 0): Observation {
  return {
    observation_id: `obs-${objectId}-${key}-${seq}`,
    observation_type: 'attribute',
    camera_id: 'cam-validation',
    frame_ref: { camera_id: 'cam-validation', stream_epoch: 0, frame_seq: seq },
    t_capture_ns: (seq + 1) * 1_000_000_000,
    class_id: classId,
    object_id: objectId,
    attributes: [{ key, value, evidence_ref: `ev-${objectId}` }],
  } as Observation;
}

const storyFor = (records: Observation[]) =>
  describeFrameStory(groupObservationsByFrame(records)[0]!);

// --- the story uses recorded activity when there is one ------------------------ //

describe('a recorded activity becomes the verb', () => {
  it('reads two people recorded as dancing as a sentence', () => {
    const story = storyFor([
      detection('p1', 'person'),
      detection('p2', 'person'),
      attribute('p1', 'person', 'activity', 'dancing'),
      attribute('p2', 'person', 'activity', 'dancing'),
    ]);
    expect(story.text).toBe('Two people are dancing.');
    expect(story.basis).toBe('activity');
  });

  it('never claims the activity was shared', () => {
    // Two objects each recorded as dancing is two facts. "Together", "with each
    // other" and "as a group" would be a third, and no observation type in the
    // platform relates one object to another.
    const story = storyFor([
      detection('p1', 'person'),
      detection('p2', 'person'),
      attribute('p1', 'person', 'activity', 'dancing'),
      attribute('p2', 'person', 'activity', 'dancing'),
    ]);
    expect(story.text).not.toMatch(/together|with each other|as a group|alongside|next to/i);
  });

  it('splits a class whose objects were recorded doing different things', () => {
    const story = storyFor([
      detection('p1', 'person'),
      detection('p2', 'person'),
      detection('p3', 'person'),
      attribute('p1', 'person', 'activity', 'dancing'),
      attribute('p2', 'person', 'activity', 'dancing'),
      attribute('p3', 'person', 'activity', 'standing'),
    ]);
    // A majority verdict — "three people are dancing" — would misreport p3.
    expect(story.text).toBe('Two people are dancing and one person is standing.');
  });

  it('reads any key shaped like an activity, naming none of them', () => {
    const story = storyFor([
      detection('p1', 'person'),
      attribute('p1', 'person', 'visible_hand_activity', 'handling_food'),
    ]);
    expect(story.text).toBe('One person is handling food.');
  });

  it('mentions objects with no recorded activity in the same story', () => {
    const story = storyFor([
      detection('p1', 'person'),
      attribute('p1', 'person', 'activity', 'dancing'),
      detection('b1', 'bicycle'),
    ]);
    expect(story.text).toBe('One person is dancing. One bicycle is also visible in this frame.');
  });
});

// --- the story refuses to invent ------------------------------------------------ //

describe('the story invents nothing', () => {
  it('falls back to presence when no activity was recorded', () => {
    const story = storyFor([detection('p1', 'person'), detection('p2', 'person')]);
    expect(story.text).toBe('Two people are visible in this frame.');
    expect(story.basis).toBe('presence');
  });

  it('does not turn detections into actions', () => {
    const story = storyFor([detection('p1', 'person'), detection('p2', 'person')]);
    expect(story.text).not.toMatch(/danc|walk|run|talk|work|wait|stand|sit/i);
  });

  it('lists several classes factually', () => {
    const story = storyFor([
      detection('p1', 'person'),
      detection('p2', 'person'),
      detection('b1', 'bicycle'),
    ]);
    expect(story.text).toBe('Two people and one bicycle are visible in this frame.');
  });

  it('reports ties without asserting who is wearing them', () => {
    const story = storyFor([
      detection('p1', 'person'),
      detection('p2', 'person'),
      detection('t1', 'tie'),
      detection('t2', 'tie'),
    ]);
    expect(story.text).toBe('Two people and two ties are visible in this frame.');
    expect(story.text).not.toMatch(/wearing|on them|belong|their/i);
  });

  it('ignores an attribute value that asserts nothing', () => {
    // `none` and `not_visible` are how every shipped policy says "nothing to
    // report". Rendering one would produce "One person is none".
    for (const value of ['none', 'not_visible', 'other', 'unknown', '']) {
      const story = storyFor([
        detection('p1', 'person'),
        attribute('p1', 'person', 'activity', value),
      ]);
      expect(story.text).toBe('One person is visible in this frame.');
    }
  });

  it('does not read a non-activity attribute as a predicate', () => {
    // "Two people are blue" is the failure this guards. Colour, posture-like
    // detail and every other attribute stay in the understanding section.
    const story = storyFor([
      detection('p1', 'person'),
      detection('p2', 'person'),
      attribute('p1', 'person', 'upper_body_colour', 'blue'),
      attribute('p2', 'person', 'upper_body_colour', 'blue'),
    ]);
    expect(story.text).toBe('Two people are visible in this frame.');
    expect(story.text).not.toMatch(/blue/i);
  });

  it('says nothing was recognised rather than nothing was there', () => {
    const story = storyFor([
      { ...detection('x', 'person'), class_id: undefined } as unknown as Observation,
    ]);
    expect(story.basis).toBe('none');
    expect(story.text).toMatch(/Nothing the camera recognises/);
    expect(story.text).not.toMatch(/\b(empty|nobody|no one|deserted)\b/i);
  });

  it('claims no gender, emotion, intent or setting', () => {
    const banned =
      /\b(man|woman|men|women|boy|girl|male|female|happy|sad|angry|calm|excited|wants?|trying|intends?|about to|party|office|kitchen|restaurant|celebration|meeting)\b/i;
    const literals = CODE.match(/'[^']*'|`[^`]*`/g) ?? [];
    expect(literals.filter((literal) => banned.test(literal))).toEqual([]);
  });
});

// --- shape and determinism ------------------------------------------------------ //

describe('the story stays short, checkable and deterministic', () => {
  it('is at most two sentences', () => {
    const story = storyFor([
      detection('p1', 'person'),
      detection('p2', 'person'),
      attribute('p1', 'person', 'activity', 'dancing'),
      detection('b1', 'bicycle'),
      detection('c1', 'car'),
    ]);
    expect(story.text.split('.').filter((part) => part.trim()).length).toBeLessThanOrEqual(2);
  });

  it('names the records behind every clause', () => {
    const story = storyFor([
      detection('p1', 'person'),
      attribute('p1', 'person', 'activity', 'dancing'),
      detection('b1', 'bicycle'),
    ]);
    expect(story.grounds).toEqual([
      '1 × person — activity recorded as “dancing”',
      '1 × bicycle — detected, no activity recorded',
    ]);
  });

  it('produces the same words whatever order records arrive in', () => {
    const records = [
      detection('p1', 'person'),
      detection('b1', 'bicycle'),
      attribute('p1', 'person', 'activity', 'dancing'),
    ];
    expect(storyFor(records).text).toBe(storyFor([...records].reverse()).text);
  });

  it('spells small counts and leaves large ones as digits', () => {
    expect(spellCount(1)).toBe('one');
    expect(spellCount(10)).toBe('ten');
    expect(spellCount(18)).toBe('18');
  });

  it('reaches no model to write the sentence', () => {
    expect(CODE).not.toMatch(/\bfetch\s*\(/);
    expect(CODE).not.toMatch(/11434|ollama|nvidia|openai|anthropic/i);
  });
});
