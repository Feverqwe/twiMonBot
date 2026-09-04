# Database migrations

Migration sources live in this directory and are compiled to `dist/migrations`.
They run automatically during application startup and are recorded in the
`SequelizeMeta` table.

- Name migrations `YYYYMMDDHHmmss-description.ts` so ordering is deterministic.
- Export an `up` function typed with `Migration` from `../migrator`.
- Add `down` only when rollback is safe for production data.
- Keep committed migrations immutable. Add a new migration for every schema change.
- Update the Sequelize model in `src/db.ts` in the same change as its migration.

The initial baseline is intentionally idempotent: it creates missing tables and indexes while
adopting databases previously initialized with `sequelize.sync()` without changing their data.

