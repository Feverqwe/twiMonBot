# Livestream provider adapters

These instructions extend the root and `src/` guides for `src/services/`.

## Adapter contract

- Every adapter implements `ServiceInterface<T>` from `src/checker.ts` and supplies stable `id`,
  display `name`, provider-specific `batchSize`, `match`, `findChannel`, `getStreams`, and
  `getExistsChannelIds`.
- Return raw provider IDs from adapters. `Checker`/`Db` apply the `serviceId` namespace. Preserve ID
  types (`number` versus `string`) because persisted IDs are decoded back to those raw values.
- `getStreams` must always return `{streams, skippedChannelIds, removedChannelIds}`. Put IDs in
  `skippedChannelIds` on transient request, auth, quota, parsing, or partial-batch failure so the
  checker retains prior state. Use `removedChannelIds` only when the provider positively confirms
  that a channel is gone.
- A valid offline channel produces no stream and is not skipped or removed. `getExistsChannelIds`
  should conservatively retain IDs on unknown/transient errors and omit only confirmed missing
  channels.
- Normalize each live result to `ServiceStream`: stable stream ID, raw channel ID, canonical URLs,
  title, nullable game/viewers as appropriate, `isRecord`, and JSON-serialized preview URL array.

## HTTP and API behavior

- Use `shared/tools/fetchRequest.ts` so timeout, keep-alive, cookies, response metadata, and error
  types are consistent. Use existing batching/rate-limit helpers and stay within each provider's
  API limits.
- Validate external JSON with `valibot` before mapping it. Keep schemas close to the adapter and
  mask responses so unrelated upstream fields do not leak into internal models.
- Preserve access-token caching and single-flight refresh behavior in Twitch and Kick. Never log
  tokens, client secrets, authorization headers, or full signed callback URLs.
- YouTube stream discovery is coupled to `Main.ytPubSub` and quota accounting. Update
  `ytPubSub.ts`, YouTube parsing, and quota costs together when an API flow changes.
- URL matchers should be narrow enough to avoid claiming another service's input. `findChannel`
  must support the adapter's advertised URL forms and plain-name fallback, returning a canonical
  channel URL.

## Tests

- Prefer fixture-driven tests for mapping, malformed responses, pagination, missing channels, and
  transient errors. Stub `fetchRequest` and `Main` collaborators for deterministic coverage.
- `__tests__/twitch.ts` currently calls the live Twitch API and requires credentials/network. Treat
  it as an opt-in integration test, not as the default validation path.
- When adding an adapter, register it in `main.ts`, add required environment keys to
  `appConfig.ts` and `example.env`, and ensure the first two characters of its `id` do not collide
  with another service because `serviceId.wrap` uses that prefix.
