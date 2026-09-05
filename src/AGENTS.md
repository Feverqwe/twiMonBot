# Application source guide

These instructions extend the repository-level `AGENTS.md` for files under `src/`.

## Lifecycle and boundaries

- `main.ts` is the composition root. Initialization order is database authentication/schema sync,
  then HTTP server and Telegram polling, then checker and sender intervals.
- Components receive the `Main` instance and communicate through it. Follow that pattern rather
  than creating duplicate database, bot, service, or scheduler instances.
- `Checker` owns provider polling and persistence reconciliation. `Sender` schedules per-chat work;
  `ChatSender` owns the state machine for sending, updating, and deleting one chat's messages.
- `Chat` declares commands and middleware through `Router`. Preserve middleware ordering: migration
  handling, callback acknowledgement, group-admin authorization, tracking, then command routes.
- Shared `WebServer` owns only the Express/HTTP lifecycle. Register project routes from the
  composition root; YouTube WebSub routes and signature handling belong in
  `ytPubSub.ts`/`tools/expressPubSub.ts`, not in provider polling code.

## Persistence and concurrency invariants

- Keep multi-model stream reconciliation inside `Db.putStreams` transactional. Do not split writes
  in a way that can expose streams without their chat queue rows or message-change flags.
- Respect `syncTimeoutExpiresAt`, `lastSyncAt`, offline/timeout fields, and the different retry
  windows for active versus stale channels. They are leases that prevent duplicate workers and
  false offline transitions.
- Use the existing helpers (`parallel`, `promiseLimit`, `getInProgress`, `RateLimit2`, `everyTime`)
  instead of ad-hoc unbounded `Promise.all`, overlapping timers, or sleeps.
- Clean-up methods rely on foreign-key cascades and relationship tables. Confirm association and
  query semantics before changing deletion behavior.
- Store serialized preview lists in the format already expected by `ChatSender`; do not silently
  change database representation at one call site.

## Telegram and localization

- Route handlers must catch/report Telegram and provider failures consistently so polling does not
  acquire an unhandled rejection. Reuse `passTgEx` and the error classifiers in `chatSender.ts` for
  expected Telegram API failures.
- Telegram text uses HTML in several paths. Sanitize provider/user data with the existing helpers
  and keep message/caption length constraints in mind.
- Add every locale key to both `locale/en.ts` and `locale/ru.ts`. The English dictionary defines the
  TypeScript key contract, so mismatched keys or placeholders are regressions.
- Preserve string chat IDs; Telegram IDs can be negative and should not be normalized through
  lossy numeric transformations in persistence code.

## Testing seams

- Prefer tests around pure helpers, router matching, response parsing, and reconciliation inputs.
- Mock HTTP, Telegram, timers, and database collaborators for unit tests. Importing `main.ts` has
  startup side effects, and the test config also sets `IS_TEST_ENV=1` and default debug logging.
- When changing a command, cover both text and callback-query entry points when both are supported.
  When changing reconciliation, cover success, transient/skipped IDs, confirmed removed IDs, and
  an empty live-stream result.
