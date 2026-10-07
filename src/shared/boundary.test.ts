import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The process boundary, checked statically (MigrationPlan.md Phase 27): the
// renderer may reach the simulation only through the typed protocol, so its
// import graph must never contain the Engine, the database, sql.js, the
// simulation host, Electron or Node.

const root = path.resolve(import.meta.dirname, '..', '..');
const src = path.join(root, 'src');

// Engine modules the renderer may load at runtime (through src/shared):
// pure data and formulas with no database or simulation code.
const PURE_ENGINE_MODULES = [
  'engine/time/clock.ts',
  'engine/skills/skillLevels.ts',
  'engine/goods/catalog.ts',
  'engine/market/tradeTypes.ts',
];

// Runtime (non-type) imports of a TypeScript source file.
function runtimeImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  for (const match of text.matchAll(
    /^\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/gm,
  )) {
    if (match[2]) continue; // `import type` / `export type`
    specifiers.push(match[4] ?? '');
  }
  for (const match of text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) specifiers.push(match[1] ?? '');
  return specifiers;
}

function resolveLocal(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep) && /\.(tsx?|css)$/.test(candidate))
      return candidate;
  }
  return null;
}

// Every file the renderer loads at runtime, and every package it imports.
function rendererGraph(): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [path.join(src, 'renderer', 'main.tsx')];
  while (queue.length) {
    const file = queue.pop() ?? '';
    if (files.has(file) || file.endsWith('.css')) continue;
    files.add(file);
    for (const specifier of runtimeImports(file)) {
      const local = resolveLocal(file, specifier);
      if (local) queue.push(local);
      else if (!specifier.startsWith('.')) packages.add(specifier);
    }
  }
  return { files, packages };
}

const relative = (file: string) => path.relative(src, file).split(path.sep).join('/');

describe('renderer ↔ simulation boundary', () => {
  it('the renderer loads only renderer code, the shared protocol, and pure game data', () => {
    const { files, packages } = rendererGraph();
    const outside = [...files]
      .map(relative)
      .filter(
        (f) => !f.startsWith('renderer/') && !f.startsWith('shared/') && !PURE_ENGINE_MODULES.includes(f),
      );
    expect(outside).toEqual([]);
    expect([...packages].sort()).toEqual(['react', 'react-dom/client']);
  });

  it('the pure engine modules the renderer may load import nothing else', () => {
    for (const module of PURE_ENGINE_MODULES) {
      const file = path.join(src, module);
      const imports = runtimeImports(file).map((s) => resolveLocal(file, s));
      expect(
        imports.every((i) => i === null || PURE_ENGINE_MODULES.includes(relative(i))),
        module,
      ).toBe(true);
    }
  });

  it('no renderer source imports engine, host, Electron or Node modules — even for types', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const text = readFileSync(full, 'utf8');
          if (
            /from ['"](\.\.\/)+(engine|sim-host|electron)\/|from ['"](electron|sql\.js|node:[a-z]+)['"]/.test(
              text,
            )
          )
            offenders.push(relative(full));
        }
      }
    };
    walk(path.join(src, 'renderer'));
    expect(offenders).toEqual([]);
  });

  it('the production renderer bundle carries no simulation, SQL or database code', () => {
    const assets = path.join(root, 'dist', 'assets');
    if (!existsSync(assets)) return; // not built yet (npm run build)
    for (const file of readdirSync(assets).filter((f) => f.endsWith('.js'))) {
      const code = readFileSync(path.join(assets, file), 'utf8');
      for (const marker of ['sql-wasm', 'CREATE TABLE', 'world_meta', 'advanceTicks', 'INSERT INTO']) {
        expect(code.includes(marker), `${file} contains "${marker}"`).toBe(false);
      }
    }
  });
});
