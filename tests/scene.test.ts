/**
 * The plain-language layer is the most dangerous file in the product.
 *
 * Prose is persuasive, and a sentence is far easier to over-claim in than a
 * JSON field: "a person is sitting" and "a person is sitting at a table eating"
 * read alike to a viewer and are worlds apart in what the platform actually
 * said. These tests hold the summary to the same rules the insight layer keeps.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeScene, spokenDuration } from '../src/insights/scene';
import type { ObjectView } from '../src/api/types';

const SOURCE = readFileSync(join(__dirname, '..', 'src', 'insights', 'scene.ts'), 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function object(overrides: Partial<ObjectView> = {}): ObjectView {
  return {
    object_id: 'obj-0001',
    class_id: 'person',
    class_confidence: { value: 0.92, calibrated: true },
    lifecycle: 'active',
    camera_id: 'cam-1',
    first_seen_ns: 0,
    last_seen_ns: 42_000_000_000,
    last_confirmed_ns: 42_000_000_000,
    is_stale: false,
    attributes: {},
    observation_count: 5,
    ...overrides,
  };
}

function withAttributes(values: Record<string, string>, overrides: Partial<ObjectView> = {}): ObjectView {
  const attributes: ObjectView['attributes'] = {};
  for (const [key, value] of Object.entries(values)) {
    attributes[key] = {
      key,
      value,
      confidence: { value: 0.8, calibrated: false },
      observed_at_ns: 1_000_000,
      evidence_ref: 'ev-1',
    };
  }
  return object({ attributes, ...overrides });
}

const text = (objects: ObjectView[]) =>
  describeScene(objects)
    .lines.map((l) => l.text)
    .join(' ');

describe('the summary says only what the platform reported', () => {
  it('reads as a plain sentence when every attribute is present', () => {
    const summary = describeScene([
      withAttributes({
        posture: 'sitting',
        upper_body_colour: 'blue',
        lower_body_colour: 'black',
        carrying_object: 'phone',
      }),
    ]);
    expect(summary.headline).toBe('One person in view.');
    expect(summary.lines[0]!.text).toBe(
      'Person 1 is sitting, wearing a blue top and black trousers, and carrying a phone.',
    );
    expect(summary.lines[1]!.text).toBe('Person 1 has been in view for 42 seconds.');
  });

  it('merges posture, furniture and activity into one readable clause', () => {
    const summary = describeScene([
      withAttributes({
        posture: 'sitting',
        nearby_furniture: 'table',
        visible_activity: 'eating',
        upper_body_colour: 'blue',
        lower_body_colour: 'black',
      }),
    ]);
    expect(summary.lines[0]!.text).toBe(
      'Person 1 is sitting at a table, wearing a blue top and black trousers, and eating.',
    );
    // Each half of "sitting at a table" stays separately attributable.
    const cited = summary.lines[0]!.cites.map((c) => c.field);
    expect(cited).toContain('attributes.posture');
    expect(cited).toContain('attributes.nearby_furniture');
    expect(cited).toContain('attributes.visible_activity');
  });

  it('stays quiet when furniture or activity was reported as absent', () => {
    const quiet = text([withAttributes({ posture: 'standing', nearby_furniture: 'none', visible_activity: 'none' })]);
    expect(quiet).toMatch(/Person 1 is standing\./);
    expect(quiet).not.toMatch(/at a|on a|eating|drinking/);
  });

  it('says nothing rather than padding when furniture could not be named', () => {
    // "other" means the platform saw furniture it could not name. "beside some
    // furniture" would be true and useless.
    const vague = text([withAttributes({ posture: 'sitting', nearby_furniture: 'other' })]);
    expect(vague).toBe('Person 1 is sitting. Person 1 has been in view for 42 seconds.');
  });

  it('never invents an attribute that was not reported', () => {
    const bare = text([object()]);
    expect(bare).not.toMatch(/sitting|standing|wearing|carrying/);
    expect(bare).toMatch(/has not reported anything else about them yet/);
  });

  it('omits a carried object when the platform said there is none', () => {
    expect(text([withAttributes({ carrying_object: 'none' })])).not.toMatch(/carrying/);
    expect(text([withAttributes({ carrying_object: 'bag' })])).toMatch(/carrying a bag/);
  });

  it('cites platform fields for every sentence it produces', () => {
    const summary = describeScene([withAttributes({ posture: 'standing' })]);
    expect(summary.lines.length).toBeGreaterThan(0);
    for (const line of summary.lines) {
      expect(line.cites.length).toBeGreaterThan(0);
    }
  });

  it('says a remembered position is remembered', () => {
    // The single most misreadable state on a page written for non-engineers:
    // a predicted position rendered as a live one.
    const stale = text([object({ is_stale: true })]);
    expect(stale).toMatch(/cannot see/);
    expect(stale).toMatch(/last measured, not where they are now/);
  });

  it('describes an empty scene without claiming the area was empty', () => {
    const summary = describeScene([]);
    expect(summary.headline).toBe('Nothing the camera recognises is in view right now.');
    // "nothing is there" would be the conclusion the platform refuses to draw.
    expect(summary.headline).not.toMatch(/nothing is there|area is empty|no one is present/i);
  });
});

describe('the summary widens with the platform, not ahead of it', () => {
  it('counts and names whatever classes the platform reported', () => {
    const summary = describeScene([
      object({ object_id: 'a', class_id: 'bus' }),
      object({ object_id: 'b', class_id: 'car' }),
      object({ object_id: 'c', class_id: 'car' }),
    ]);
    expect(summary.headline).toBe('One bus and two cars in view.');
  });

  it('numbers each class separately so the labels stay stable', () => {
    const summary = describeScene([
      object({ object_id: 'a', class_id: 'car' }),
      object({ object_id: 'b', class_id: 'car' }),
    ]);
    expect(summary.lines.map((l) => l.text).join(' ')).toMatch(/Car 1.*Car 2/s);
  });
});

describe('the summary is deterministic', () => {
  it('produces identical output for identical input', () => {
    const objects = [withAttributes({ posture: 'standing' }), object({ object_id: 'obj-0002' })];
    expect(JSON.stringify(describeScene(objects))).toBe(JSON.stringify(describeScene(objects)));
  });

  it('does not depend on the order objects arrive in', () => {
    const a = object({ object_id: 'obj-000a' });
    const b = object({ object_id: 'obj-000b' });
    expect(JSON.stringify(describeScene([a, b]))).toBe(JSON.stringify(describeScene([b, a])));
  });

  it('uses no clock, locale or randomness', () => {
    expect(CODE).not.toMatch(/Date\.now|performance\.now|new Date\(/);
    expect(CODE).not.toMatch(/Math\.random/);
    expect(CODE).not.toMatch(/toLocaleString|Intl\./);
  });

  it('speaks durations the way a person would', () => {
    expect(spokenDuration(1)).toBe('1 second');
    expect(spokenDuration(42)).toBe('42 seconds');
    expect(spokenDuration(60)).toBe('1 minute');
    expect(spokenDuration(125)).toBe('2 minutes 5 seconds');
  });
});

describe('the summary contains no judgement vocabulary', () => {
  it('emits no verdict, recommendation or alarm word', () => {
    const banned =
      /\b(suspicious|violation|unauthori[sz]ed|illegal|theft|steal|lazy|should|must|alert|alarm|risk|danger|breach|loiter)\b/i;
    const literals = CODE.match(/'[^']*'|`[^`]*`/g) ?? [];
    expect(literals.filter((literal) => banned.test(literal))).toEqual([]);
  });

  it('restates rather than concludes, however long someone stays', () => {
    const long = text([object({ first_seen_ns: 0, last_seen_ns: 3_600_000_000_000 })]);
    expect(long).toMatch(/has been in view for 60 minutes/);
    expect(long).not.toMatch(/too long|excessive|abnormal|unusual/i);
  });
});
