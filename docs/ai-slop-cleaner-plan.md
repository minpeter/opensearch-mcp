# AI Slop Cleanup Plan

## Scope

- `src/fetch.ts`
- `src/search.ts`
- `src/__tests__/fetch.test.ts`

## Behavior lock before cleanup

- Existing fetch tests already lock HTML-to-markdown extraction, PDF extraction, image stripping, cache behavior, and Jina fallback behavior.
- Existing search tests already lock provider fallback order, error aggregation, cache behavior, and result slicing.
- Add one focused fetch regression test to keep `length` aligned with the final extracted content after fallback behavior.

## Smells to remove

1. **Duplicate removal / dead work**
   - `src/fetch.ts` strips `<img>` tags before parsing and also removes images during markdown conversion; keep one behavior-preserving path.
2. **Needless abstraction**
   - `src/fetch.ts` uses pass-through helpers for article title/content extraction that only unwrap nullable values.
   - `src/search.ts` exports a thin wrapper around the real search implementation.
3. **Test reinforcement**
   - Add a targeted fetch regression around final content length so the cleanup stays behavior-preserving.

## Planned pass order

1. Remove redundant image preprocessing in `fetch.ts` while keeping existing image-free output tests green.
2. Inline the pass-through article helper logic in `fetch.ts`.
3. Delete the extra search wrapper by making `search` the primary implementation path.
4. Add a regression test for final fetch result length.
5. Run lint/check, typecheck, and tests.

## Guardrails

- No behavior changes to tool outputs.
- No new dependencies.
- Keep diffs small and reversible.
