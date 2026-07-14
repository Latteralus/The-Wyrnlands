// Partial<Opt> alone would still carry the `| undefined` from Opt's own
// inferred value types (e.g. `actorId: string | undefined`), which is
// exactly what exactOptionalPropertyTypes rejects at a target like
// `actorId?: string`. This function guarantees at runtime that an included
// key's value is never undefined, so the return type says so explicitly.
type DefinedPartial<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

// Building an object literal with a key explicitly set to `undefined` is a
// type error under exactOptionalPropertyTypes (tsconfig.base.json) — the
// property must be entirely absent, not present-with-undefined. This copies
// `optional`'s keys into `base` only when their value isn't undefined, so
// callers can pass possibly-undefined fields through without fighting that
// rule at every call site.
export function withOptional<Base extends object, Opt extends object>(
  base: Base,
  optional: Opt,
): Base & DefinedPartial<Opt> {
  // TS can't correlate `key` and `optional[key]` through a dynamic loop over
  // Object.keys(), so the write below needs one narrow, deliberate cast; the
  // function's public signature (and every call site's type-checking) stays
  // fully sound regardless.
  const result = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(optional)) {
    const value = (optional as Record<string, unknown>)[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as Base & DefinedPartial<Opt>;
}
