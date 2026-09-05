# Shared source guide

Files under this directory are shared infrastructure. Keep every file byte-for-byte identical with
the corresponding path in the sibling `twiMonBot` or `ytWatchBot` repository.

- Apply shared changes to both repositories in the same work session.
- Preserve the same relative paths; additions, renames, and deletions must happen in both trees.
- Run the relevant tests in both repositories and `npm run shared:check` before handoff.
- Keep project-specific provider and persistence behavior outside this directory.
- Do not branch on the project name inside shared code. Pass differences through typed inputs or
  keep the orchestration in project-specific modules.
- Imports outside `shared` are stable extension points; keep their paths and expected contracts
  compatible in both projects.
- If shared code needs a new dependency, update both manifests and lockfiles.
- If the sibling repository is unavailable, report that synchronization is unverified rather than
  treating the skipped check as proof of equality.
