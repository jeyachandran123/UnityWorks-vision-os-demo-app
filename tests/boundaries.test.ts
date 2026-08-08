/**
 * Architectural boundary tests.
 *
 * The brief's hardest constraint is that the demonstration application performs
 * no vision reasoning and infers nothing. These read the source and fail the
 * build when that stops being true — a claim nobody has to take on trust.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx)$/.test(path)) out.push(path);
  }
  return out;
}

const files = walk(SRC).map((path) => ({
  rel: relative(ROOT, path).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}));

function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the demo never reaches past the Observation API', () => {
  it('imports no Vision OS or backend module', () => {
    // Import *specifiers* only. The shell prints `python -m vosvc_harness` as
    // help text when the platform is down, and matching raw text would fail the
    // build for telling the operator how to start it.
    const offenders: string[] = [];
    for (const file of files) {
      const pattern = /(?:from|import)\s+['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(code(file.text)))) {
        const specifier = match[1]!;
        if (/app\.vision_os|app\/vision_os|vosvc_harness/.test(specifier) || specifier.includes('../../../')) {
          offenders.push(`${file.rel}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reaches the network only through the API client', () => {
    const offenders: string[] = [];
    for (const file of files) {
      // The API layer is where network access lives. `invoiceClient.ts` is a
      // second client for a second service (Atlas document extraction) — kept
      // apart from the Observation API client, and still inside the layer.
      if (
        file.rel === 'src/api/client.ts' ||
        file.rel === 'src/api/provider.tsx' ||
        file.rel === 'src/api/invoiceClient.ts'
      )
        continue;
      const body = code(file.text);
      if (/\bfetch\s*\(/.test(body)) offenders.push(`${file.rel}: fetch()`);
      if (/new\s+WebSocket\s*\(/.test(body)) offenders.push(`${file.rel}: WebSocket`);
    }
    expect(offenders).toEqual([]);
  });

  it('never contacts a model directly', () => {
    // The demo must not be able to call Ollama, or any inference endpoint, even
    // by accident. Understanding belongs to Vision OS.
    const offenders = files
      .filter((file) => /11434|\/api\/generate|ollama|openai|anthropic/i.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('exposes no method that could write a fact', () => {
    const client = readFileSync(join(SRC, 'api', 'client.ts'), 'utf8');
    for (const forbidden of [
      'updateObject',
      'setAttribute',
      'deleteObservation',
      'createObject',
      'updateState',
    ]) {
      expect(client).not.toMatch(new RegExp(`\\b${forbidden}\\s*\\(`));
    }
    expect(client).not.toMatch(/method:\s*'(PUT|PATCH)'/);
  });
});

describe('the demo performs no vision reasoning', () => {
  it('never classifies, detects or tracks locally', () => {
    const banned = /\b(classify|detectObjects|runInference|predict|embedding|cosineSimilarity|iou|nms)\s*\(/;
    const offenders = files.filter((file) => banned.test(code(file.text))).map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('never constructs an observation', () => {
    const offenders = files
      .filter((file) => !file.rel.startsWith('tests/'))
      .filter((file) => /observation_id\s*:\s*['"`]/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('does not recompute values the platform derives', () => {
    // `is_stale` and `calibrated` arrive as fields. Deriving either locally
    // would reintroduce exactly the staleness bug the platform avoids.
    const offenders = files
      .filter((file) => /is_stale\s*=\s*(?!object\.|row\.|held\.)/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });
});

describe('absence stays unambiguous', () => {
  it('ships distinct components for "nothing there" and "could not look"', () => {
    const primitives = readFileSync(join(SRC, 'components', 'primitives.tsx'), 'utf8');
    expect(primitives).toMatch(/export function Unavailable/);
    expect(primitives).toMatch(/export function EmptyState/);
    // The distinction has to be visible to a reader, not just to the type system.
    expect(primitives).toMatch(/nothing may be concluded/i);
  });

  it('renders coverage on the state views', () => {
    for (const page of ['VisionState.tsx', 'Objects.tsx']) {
      const text = readFileSync(join(SRC, 'pages', page), 'utf8');
      expect(text).toMatch(/CoverageBadge/);
    }
  });
});

describe('the narrative renderer stays deterministic', () => {
  it('uses no clock, locale or randomness', () => {
    const body = code(readFileSync(join(SRC, 'narrative', 'render.ts'), 'utf8'));
    expect(body).not.toMatch(/Date\.now|performance\.now|new Date\(/);
    expect(body).not.toMatch(/Math\.random/);
    expect(body).not.toMatch(/toLocaleString|Intl\./);
  });

  it('emits no judgement vocabulary', () => {
    const body = code(readFileSync(join(SRC, 'narrative', 'render.ts'), 'utf8'));
    const literals = body.match(/'[^']*'|`[^`]*`/g) ?? [];
    const banned = /\b(suspicious|loiter|violation|exceeds?|likely|probably|appears? to|dangerous)\b/i;
    expect(literals.filter((literal) => banned.test(literal))).toEqual([]);
  });
});
