# Project-specific tools

These instructions extend the root and `src/` guides for `src/tools/`. Generic helpers shared with
`ytWatchBot` live in `src/shared/tools/` and follow `src/shared/AGENTS.md`. Move a helper into
`shared` when the two implementations can be identical.

- Keep helpers small, single-purpose, and independent of the `Main` composition root unless they
  are explicitly an integration wrapper such as `expressPubSub`.
- Preserve concurrency semantics in scheduling, caching, retry, and rate-limit helpers. Callers
  rely on deduplication, cancellation callbacks, queue limits, and timers being released after both
  success and failure.
- `fetchRequest` is the common network boundary. Maintain its normalized response shape and
  `RequestError`/`HTTPError`/`TimeoutError` distinctions; redact sensitive response/request data in
  errors and debug output.
- Functions that format Telegram HTML or stream text must escape all provider-controlled content.
  Verify Telegram message and caption paths when changing shared formatting.
- Prefer generic type-safe signatures and deterministic unit tests. For timer helpers, use fake
  timers; for HTTP/Telegram wrappers, mock the transport rather than calling external services.
- A change to a helper under `src/shared/tools/` must be applied to both sibling repositories,
  reviewed at all call sites, and validated with `npm run shared:check`.
