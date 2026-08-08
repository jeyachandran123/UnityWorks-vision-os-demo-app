/**
 * The demonstration insight layer.
 *
 * **This is not business logic and it must never become business logic.** It is
 * a presentation device that shows an audience how a domain application *would*
 * consume Vision OS observations — and it lives here, in the demo frontend,
 * precisely because the platform refuses to host it.
 *
 * Vision OS reports what is visible. *"A person is standing in the kitchen"* is
 * an observation. *"An employee has remained in the kitchen too long"* is a
 * judgment, and the Semantic Ceiling (V1) keeps it out of the platform. The
 * boundary is the product, so this file is deliberately explicit about which
 * side of it every line sits on.
 *
 * Four rules hold, each enforced by a test:
 *
 * 1. **Every insight cites the observations it was derived from.** An insight
 *    with no citation cannot be constructed.
 * 2. **No thresholds are invented here.** A duration comes from Vision OS
 *    timestamps; the *significance* of that duration is a vertical's decision
 *    and is shown as a configurable demo parameter, never as a platform fact.
 * 3. **Nothing is asserted the platform did not report.** If an attribute is
 *    absent, the insight says so rather than assuming a default.
 * 4. **Deterministic.** Same observations in, same insights out — no clock, no
 *    randomness, no ordering surprises.
 */

import type { ObjectView } from '../api/types';

export type Vertical = 'restaurant' | 'warehouse' | 'retail';

export interface DemoInsight {
  id: string;
  vertical: Vertical;
  /** Plain-language restatement. Never a verdict, never a recommendation. */
  headline: string;
  /** The Vision OS facts this was built from. Never empty. */
  basis: Array<{ field: string; value: string }>;
  objectId: string;
  /** The demo-side rule that fired, named so the audience sees it is not the platform's. */
  rule: string;
  severity: 'info' | 'notice';
}

export interface VerticalProfile {
  id: Vertical;
  label: string;
  description: string;
  /**
   * Demonstration thresholds. **Consumer-side, not platform-side.**
   *
   * These are exactly the numbers V1 keeps out of Vision OS. Surfacing them as
   * editable demo parameters is the clearest way to show an audience where the
   * boundary runs: the platform supplied the seconds, a vertical supplied the
   * opinion about how many seconds matter.
   */
  dwellSeconds: number;
}

export const VERTICALS: Record<Vertical, VerticalProfile> = {
  restaurant: {
    id: 'restaurant',
    label: 'Restaurant',
    description: 'Staff presence and service-area occupancy',
    dwellSeconds: 120,
  },
  warehouse: {
    id: 'warehouse',
    label: 'Warehouse',
    description: 'Loading-zone activity and equipment dwell',
    dwellSeconds: 60,
  },
  retail: {
    id: 'retail',
    label: 'Retail',
    description: 'Entrance flow and browsing presence',
    dwellSeconds: 30,
  },
};

/** Seconds an object has been tracked, from platform timestamps only. */
export function trackedSeconds(object: ObjectView): number {
  const span = object.last_seen_ns - object.first_seen_ns;
  return span > 0 ? span / 1_000_000_000 : 0;
}

function attributeOf(object: ObjectView, key: string): string | null {
  const held = object.attributes?.[key];
  if (!held || held.value === null || held.value === undefined) return null;
  return String(held.value);
}

/**
 * Derive demonstration insights for one vertical.
 *
 * Reads only `ObjectView` fields. Performs no vision reasoning: the platform
 * already decided there is a person, that they are standing, and how long they
 * have been tracked. This function rearranges those facts into a sentence a
 * non-engineer recognises, and cites each one.
 */
export function deriveInsights(
  objects: ObjectView[],
  vertical: Vertical,
  profile: VerticalProfile = VERTICALS[vertical],
): DemoInsight[] {
  const insights: DemoInsight[] = [];

  // Sorted by object id so the same input always yields the same order. An
  // insight list that reshuffled between renders would look like new events.
  const ordered = [...objects].sort((a, b) => a.object_id.localeCompare(b.object_id));

  for (const object of ordered) {
    const seconds = trackedSeconds(object);
    const posture = attributeOf(object, 'posture');
    const carrying = attributeOf(object, 'carrying_object');
    const upper = attributeOf(object, 'upper_body_colour');

    const basis: Array<{ field: string; value: string }> = [
      { field: 'class_id', value: object.class_id },
      { field: 'lifecycle', value: object.lifecycle },
      { field: 'first_seen_ns → last_seen_ns', value: `${seconds.toFixed(1)} s tracked` },
    ];
    if (posture) basis.push({ field: 'attributes.posture', value: posture });
    if (carrying) basis.push({ field: 'attributes.carrying_object', value: carrying });
    if (upper) basis.push({ field: 'attributes.upper_body_colour', value: upper });

    // --- appearance ------------------------------------------------------- //
    insights.push({
      id: `${object.object_id}:present`,
      vertical,
      headline: appearanceHeadline(vertical, object.class_id, posture, carrying),
      basis,
      objectId: object.object_id,
      rule: 'demo: object entered the observed scene',
      severity: 'info',
    });

    // --- dwell -------------------------------------------------------------- //
    //
    // The platform supplied the seconds. The *threshold* is the vertical's, and
    // is named as such so nobody mistakes it for something Vision OS decided.
    if (seconds >= profile.dwellSeconds) {
      insights.push({
        id: `${object.object_id}:dwell`,
        vertical,
        headline: dwellHeadline(vertical, object.class_id, seconds),
        basis: [
          ...basis,
          {
            field: 'demo threshold (consumer-side)',
            value: `${profile.dwellSeconds} s — set by the vertical, not by Vision OS`,
          },
        ],
        objectId: object.object_id,
        rule: `demo: tracked duration reached the ${profile.label} threshold`,
        severity: 'notice',
      });
    }

    // --- carrying ----------------------------------------------------------- //
    if (carrying && carrying !== 'none') {
      insights.push({
        id: `${object.object_id}:carrying`,
        vertical,
        headline: `${label(object.class_id)} is visibly carrying a ${carrying}.`,
        basis,
        objectId: object.object_id,
        rule: 'demo: a carried object was reported',
        severity: 'info',
      });
    }
  }

  return insights;
}

function label(classId: string): string {
  return classId.charAt(0).toUpperCase() + classId.slice(1).replace(/[._]/g, ' ');
}

function appearanceHeadline(
  vertical: Vertical,
  classId: string,
  posture: string | null,
  carrying: string | null,
): string {
  const who = label(classId);
  const how = posture ? ` and is ${posture}` : '';
  const what = carrying && carrying !== 'none' ? `, carrying a ${carrying}` : '';

  switch (vertical) {
    case 'retail':
      return `${who} entered the monitored area${how}${what}.`;
    case 'warehouse':
      return `${who} is present in the monitored zone${how}${what}.`;
    default:
      return `${who} is present in the service area${how}${what}.`;
  }
}

function dwellHeadline(vertical: Vertical, classId: string, seconds: number): string {
  const who = label(classId);
  const duration = `${seconds.toFixed(0)} seconds`;
  switch (vertical) {
    case 'retail':
      return `${who} has been in view for ${duration}.`;
    case 'warehouse':
      return `${who} has remained in the zone for ${duration}.`;
    default:
      return `${who} has remained in the service area for ${duration}.`;
  }
}
