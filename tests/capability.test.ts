/**
 * A closed-set detector must not sound like an open-vocabulary one.
 *
 * ### The failure being pinned
 *
 * A pen was shown as `Toothbrush #1`. Nothing upstream was broken: YOLOv8n on
 * COCO has no `pen`, a closed-set classification head has no index meaning "none
 * of these", and the nearest of its eighty words to a thin hand-held object is
 * `toothbrush` — which scored 0.454, above any threshold that still admits real
 * detections. The detector reported the best answer available to it. The page
 * rendered that answer as a fact.
 *
 * So the tests here are about the *presentation of a class claim*, and the
 * property they defend is narrow and absolute: the page may repeat the
 * detector's word, and may never present it as an identification unless the
 * platform has declared a label space where that is warranted.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  UNKNOWN_LABEL_SPACE,
  canBeProduced,
  describeLabelSpace,
  qualifyClassClaim,
  readLabelSpace,
} from '../src/insights/capability';
import type { CapabilitySummary } from '../src/api/types';

/** Shaped exactly as the harness publishes it from the detector binding. */
function closedSet(size = 80, words = ['person', 'toothbrush', 'tennis racket']): CapabilitySummary {
  return {
    producible_classes: [],
    producible_attributes: [],
    gaps: [
      ['detector.label_space', `closed_set:coco:${size}`],
      ['detector.vocabulary', words.join(',')],
    ],
  };
}

// --- reading what the platform declared ------------------------------------ //

describe('the label space is read, never assumed', () => {
  it('reads the kind, the space, the size and the words', () => {
    const space = readLabelSpace(closedSet());
    expect(space.kind).toBe('closed_set');
    expect(space.space).toBe('coco');
    expect(space.size).toBe(80);
    expect(space.vocabulary).toEqual(['person', 'toothbrush', 'tennis racket']);
  });

  it('stays unknown when the platform declared nothing', () => {
    expect(readLabelSpace(undefined)).toEqual(UNKNOWN_LABEL_SPACE);
    expect(readLabelSpace({ producible_classes: [], producible_attributes: [] }).kind).toBe(
      'unknown',
    );
  });

  it('does not coerce an unrecognised kind into one it knows', () => {
    const summary: CapabilitySummary = {
      producible_classes: [],
      producible_attributes: [],
      gaps: [['detector.label_space', 'something_new:custom:12']],
    };
    expect(readLabelSpace(summary).kind).toBe('unknown');
  });
});

// --- the qualification ------------------------------------------------------ //

describe('a closed-set class claim is qualified', () => {
  it('warns that names come from a fixed list, naming its size', () => {
    const note = describeLabelSpace(readLabelSpace(closedSet(80)));
    expect(note).toMatch(/80/);
    expect(note).toMatch(/closest/i);
    expect(note).toMatch(/not an identification/i);
  });

  it('marks every class claim as a closest match rather than an identity', () => {
    expect(qualifyClassClaim(readLabelSpace(closedSet()))).toBe('closest match');
  });

  it('says nothing for an open-vocabulary detector', () => {
    // There, absence from an answer carries information, so a name means what it
    // appears to mean and a warning would be noise.
    const open: CapabilitySummary = {
      producible_classes: [],
      producible_attributes: [],
      gaps: [['detector.label_space', 'open_vocabulary:query:0']],
    };
    expect(describeLabelSpace(readLabelSpace(open))).toBe('');
    expect(qualifyClassClaim(readLabelSpace(open))).toBe('');
  });

  it('says nothing when the platform declared nothing, rather than inventing a warning', () => {
    expect(describeLabelSpace(UNKNOWN_LABEL_SPACE)).toBe('');
    expect(qualifyClassClaim(UNKNOWN_LABEL_SPACE)).toBe('');
  });
});

// --- the label itself is preserved ------------------------------------------ //

describe('the detector’s word survives', () => {
  it('is not rewritten to "unknown" or to a guess', () => {
    // Replacing `toothbrush` with `unknown` discards the one thing the detector
    // actually produced; replacing it with `pen` repeats the original error in
    // the other direction. The word stays; its status changes.
    const source = readFileSync(join(__dirname, '..', 'src', 'insights', 'capability.ts'), 'utf8');
    // Comments first: the module explains the toothbrush failure at length, and
    // documenting a bug is not committing it. What must stay clean is the code.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const literals = code.match(/'[^']*'|`[^`]*`/g) ?? [];
    expect(literals.filter((l) => /\b(pen|toothbrush|tennis|baseball)\b/i.test(l))).toEqual([]);
  });

  it('recognises a class the bound model can actually emit', () => {
    const space = readLabelSpace(closedSet(80, ['person', 'tennis racket']));
    expect(canBeProduced('person', space)).toBe(true);
    // Platform class ids use underscores where COCO uses spaces.
    expect(canBeProduced('tennis_racket', space)).toBe(true);
    expect(canBeProduced('pen', space)).toBe(false);
  });

  it('checks nothing when no vocabulary was declared', () => {
    expect(canBeProduced('anything', UNKNOWN_LABEL_SPACE)).toBe(true);
  });
});

// --- the taxonomy lives in the model, not in the app ------------------------ //

describe('no object vocabulary is duplicated in the UI', () => {
  const SRC = join(__dirname, '..', 'src');

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) out.push(...walk(path));
      else if (/\.(ts|tsx)$/.test(path)) out.push(path);
    }
    return out;
  }

  it('ships no COCO class list anywhere in the application', () => {
    // The taxonomy is read from the ONNX graph's own metadata. A copy here would
    // silently mislabel everything the day a different model is bound — the same
    // failure, one layer further out.
    const cocoish = [
      'fire_hydrant',
      'parking_meter',
      'baseball_glove',
      'hair_drier',
      'potted_plant',
      'wine_glass',
    ];
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8');
      const hits = cocoish.filter((word) => text.includes(word));
      // Two or more of these together is a class list, not a coincidence.
      if (hits.length >= 2) offenders.push(`${relative(SRC, file)}: ${hits.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the icon map decorative and clearly smaller than any taxonomy', () => {
    // `ICONS` in FrameByFrame maps a handful of classes to emoji. That is
    // iconography, not a vocabulary: it adds no name and decides nothing, and a
    // class missing from it renders with a bullet.
    const page = readFileSync(join(SRC, 'pages', 'FrameByFrame.tsx'), 'utf8');
    const block = page.slice(page.indexOf('const ICONS'), page.indexOf('const PURPOSE_HINT'));
    const entries = block.match(/^\s+\w+:/gm) ?? [];
    expect(entries.length).toBeLessThan(30);
    expect(page).toMatch(/ICONS\[[^\]]+\] \?\? '•'/);
  });
});
