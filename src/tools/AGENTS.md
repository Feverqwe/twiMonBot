# Shared tools

These instructions extend the root and `src/` guides for `src/tools/`.

- Keep helpers small, single-purpose, and independent of the `Main` composition root unless they
  are explicitly an integration wrapper such as `telegramBotApi` or `expressPubSub`.
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
- A change to a shared helper needs call-site review with `rg` and validation of every semantic
  consumer, especially for error handling, time units (milliseconds versus seconds), batching, and
  mutation versus copied arrays/objects.
