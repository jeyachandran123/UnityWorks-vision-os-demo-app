/**
 * What the bound detector can and cannot name. **Read, never assumed.**
 *
 * ### Why this file exists
 *
 * A pen was reported as `Toothbrush #1`. Nothing was broken: the detector is
 * YOLOv8n on COCO, a pen is not one of its eighty classes, and a closed-set
 * classification head has no index meaning "none of these" — it must spread
 * probability across the words it knows and return the best. The nearest word to
 * a thin hand-held object is `toothbrush`, and it scored 0.454, comfortably
 * above any threshold that still admits real detections.
 *
 * So the detector was right about what it is, and the page was wrong about what
 * that means. A class name from a closed-set model is *the nearest match within
 * a fixed vocabulary*, not an identification, and rendering it as a bare noun
 * turns a nearest-neighbour result into a confident claim about the world.
 *
 * ### Where the facts come from
 *
 * The platform already declares this. `CapabilitySummary.gaps` is its existing
 * typed channel for "here is something I cannot do", and the detector binding
 * publishes two entries into it — the kind of label space, and the exact
 * vocabulary. Both are read here verbatim.
 *
 * **This module contains no class names.** It cannot: it would be the same
 * mistake one layer further out, and the day someone binds a model trained on
 * something else the UI would confidently mislabel everything. If the platform
 * declares nothing, `kind` is `'unknown'` and the page qualifies nothing rather
 * than inventing a qualification.
 */

import type { CapabilitySummary } from '../api/types';

export type LabelSpaceKind = 'closed_set' | 'open_vocabulary' | 'unknown';

export interface LabelSpace {
  kind: LabelSpaceKind;
  /** `coco`, `custom`, `scripted` — the detector's own name for its labels. */
  space: string;
  /** How many things the detector can name. 0 when undeclared. */
  size: number;
  /** The words themselves, in the model's order. Empty when undeclared. */
  vocabulary: string[];
}

export const UNKNOWN_LABEL_SPACE: LabelSpace = {
  kind: 'unknown',
  space: '',
  size: 0,
  vocabulary: [],
};

function gapsOf(capabilities: CapabilitySummary | null | undefined): Array<[string, string]> {
  const raw = capabilities?.gaps;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is [string, string] =>
      Array.isArray(entry) && entry.length >= 2 && typeof entry[0] === 'string',
  );
}

/**
 * Read the detector's declared label space out of a state result.
 *
 * `detector.label_space` is `kind:space:size` and `detector.vocabulary` is a
 * comma-separated list. Both are the platform's strings; nothing is normalised
 * beyond trimming, so an unrecognised kind stays unrecognised rather than being
 * coerced into one this file happens to know.
 */
export function readLabelSpace(
  capabilities: CapabilitySummary | null | undefined,
): LabelSpace {
  const gaps = gapsOf(capabilities);
  const declaration = gaps.find(([key]) => key === 'detector.label_space')?.[1];
  if (!declaration) return UNKNOWN_LABEL_SPACE;

  const [kind = '', space = '', size = ''] = declaration.split(':');
  const vocabulary = (gaps.find(([key]) => key === 'detector.vocabulary')?.[1] ?? '')
    .split(',')
    .map((word) => word.trim())
    .filter(Boolean);

  return {
    kind: kind === 'closed_set' || kind === 'open_vocabulary' ? kind : 'unknown',
    space,
    size: Number.parseInt(size, 10) || vocabulary.length,
    vocabulary,
  };
}

/**
 * The one sentence a reader needs before believing any class name on the page.
 *
 * Empty when the platform declared nothing, and empty for an open-vocabulary
 * detector — there the absence of a label carries information, so a class name
 * means what it appears to mean and a warning would be noise.
 */
export function describeLabelSpace(space: LabelSpace): string {
  if (space.kind !== 'closed_set' || space.size <= 0) return '';
  return (
    `This camera can name ${space.size} kinds of thing and nothing else. ` +
    `Anything outside that list is reported as whichever of the ${space.size} ` +
    `looks closest — so a name here is the nearest match, not an identification.`
  );
}

/**
 * How a single class claim should be captioned.
 *
 * Deliberately not a rewrite of the label. Replacing `toothbrush` with
 * `unknown` would discard the one piece of information the detector actually
 * produced, and replacing it with a guess would repeat the original error in the
 * other direction. The word stays; what changes is that it stops being presented
 * as a fact about the world.
 */
export function qualifyClassClaim(space: LabelSpace): string {
  return space.kind === 'closed_set' ? 'closest match' : '';
}

/**
 * Whether a class name is one the detector could possibly have produced.
 *
 * A guard against the other failure mode: a label appearing on screen that the
 * bound model cannot emit means something between the two invented it, and that
 * is worth catching in a test rather than discovering in a demo.
 */
export function canBeProduced(classId: string, space: LabelSpace): boolean {
  if (!space.vocabulary.length) return true; // nothing declared, nothing to check
  const normalised = classId.replace(/_/g, ' ').toLowerCase();
  return space.vocabulary.some((word) => word.toLowerCase() === normalised);
}
