/**
 * The demonstration insight layer must stay a *presentation* layer.
 *
 * These tests exist because this is the file most likely to drift into real
 * business logic over time — it is the one an enthusiastic demo request would
 * push toward "just add a rule that flags…". Each test names the boundary it
 * defends.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveInsights, trackedSeconds, VERTICALS } from '../src/insights/insights';
import type { ObjectView } from '../src/api/types';

const SOURCE = readFileSync(join(__dirname, '..', 'src', 'insights', 'insights.ts'), 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function object(overrides: Partial<ObjectView> = {}): ObjectView {
  return {
    object_id: 'obj-0001',
    class_id: 'person',
    class_confidence: { value: 0.92, calibrated: true },
    lifecycle: 'active',
    camera_id: 'cam-1',
    first_seen_ns: 0,
    last_seen_ns: 10_000_000_000,
    last_confirmed_ns: 10_000_000_000,
    is_stale: false,
    attributes: {},
    observation_count: 5,
    ...overrides,
  };
}

function withAttribute(key: string, value: string): ObjectView {
  return object({
    attributes: {
      [key]: {
        key,
        value,
        confidence: { value: 0.8, calibrated: false },
        observed_at_ns: 1_000_000,
        evidence_ref: 'ev-1',
      },
    },
  });
}

describe('insights derive only from Vision OS fields', () => {
  it('cites at least one platform field for every insight', () => {
    const insights = deriveInsights([withAttribute('posture', 'standing')], 'retail');
    expect(insights.length).toBeGreaterThan(0);
    for (const insight of insights) {
      expect(insight.basis.length).toBeGreaterThan(0);
      expect(insight.objectId).toBe('obj-0001');
    }
  });

  it('measures duration from platform timestamps, not a local clock', () => {
    expect(trackedSeconds(object({ first_seen_ns: 0, last_seen_ns: 42_000_000_000 }))).toBe(42);
    // A local clock would make the same record produce a different number on
    // every render, and an insight that drifts is not evidence.
    expect(CODE).not.toMatch(/Date\.now|performance\.now|new Date\(/);
  });

  it('never asserts an attribute the platform did not report', () => {
    const insights = deriveInsights([object()], 'restaurant');
    const text = insights.map((i) => i.headline).join(' ');
    expect(text).not.toMatch(/standing|sitting|carrying a/);
  });

  it('reports a carried object only when one was reported', () => {
    const withBag = deriveInsights([withAttribute('carrying_object', 'bag')], 'retail');
    expect(withBag.some((i) => i.headline.includes('carrying a bag'))).toBe(true);

    const withNone = deriveInsights([withAttribute('carrying_object', 'none')], 'retail');
    expect(withNone.some((i) => i.id.endsWith(':carrying'))).toBe(false);
  });
});

describe('thresholds stay on the consumer side', () => {
  it('labels the dwell threshold as the vertical’s, not the platform’s', () => {
    const long = object({ first_seen_ns: 0, last_seen_ns: 200_000_000_000 });
    const insights = deriveInsights([long], 'retail');
    const dwell = insights.find((i) => i.id.endsWith(':dwell'));

    expect(dwell).toBeDefined();
    const cited = dwell!.basis.map((b) => b.field).join(' ');
    expect(cited).toContain('demo threshold (consumer-side)');
    expect(dwell!.basis.some((b) => b.value.includes('not by Vision OS'))).toBe(true);
  });

  it('does not fire a dwell insight below the vertical’s threshold', () => {
    const brief = object({ first_seen_ns: 0, last_seen_ns: 5_000_000_000 });
    const insights = deriveInsights([brief], 'restaurant');
    expect(insights.some((i) => i.id.endsWith(':dwell'))).toBe(false);
  });

  it('uses a different threshold per vertical, proving it is not a platform constant', () => {
    expect(VERTICALS.retail.dwellSeconds).not.toBe(VERTICALS.restaurant.dwellSeconds);
  });
});

describe('the layer contains no judgement vocabulary', () => {
  it('emits no verdict, recommendation or alarm word', () => {
    const banned =
      /\b(suspicious|violation|unauthori[sz]ed|illegal|theft|steal|lazy|should|must|alert|alarm|risk|danger|breach)\b/i;
    const literals = CODE.match(/'[^']*'|`[^`]*`/g) ?? [];
    expect(literals.filter((literal) => banned.test(literal))).toEqual([]);
  });

  it('produces headlines that restate rather than conclude', () => {
    const insights = deriveInsights(
      [object({ first_seen_ns: 0, last_seen_ns: 300_000_000_000 })],
      'warehouse',
    );
    const text = insights.map((i) => i.headline).join(' ');
    expect(text).toMatch(/has remained in the zone for \d+ seconds/);
    // "too long" would be the judgment the platform refuses to make.
    expect(text).not.toMatch(/too long|excessive|abnormal/);
  });
});

describe('insights are deterministic', () => {
  it('produces identical output for identical input', () => {
    const objects = [withAttribute('posture', 'standing'), object({ object_id: 'obj-0002' })];
    expect(JSON.stringify(deriveInsights(objects, 'retail'))).toBe(
      JSON.stringify(deriveInsights(objects, 'retail')),
    );
  });

  it('does not depend on the order objects arrive in', () => {
    const a = object({ object_id: 'obj-000a' });
    const b = object({ object_id: 'obj-000b' });
    // A list that reshuffled between renders would look like new events.
    expect(JSON.stringify(deriveInsights([a, b], 'retail'))).toBe(
      JSON.stringify(deriveInsights([b, a], 'retail')),
    );
  });
});
