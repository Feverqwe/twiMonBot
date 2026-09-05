# Shared source guide

Files under this directory are shared infrastructure. Keep every file byte-for-byte identical with
the corresponding path in the sibling `twiMonBot` or `ytWatchBot` repository.

- Apply shared changes to both repositories in the same work session.
- Run `npm run shared:check` before handoff.
- Keep project-specific provider and persistence behavior outside this directory.
- Imports outside `shared` are stable extension points; keep their paths and expected contracts
  compatible in both projects.

