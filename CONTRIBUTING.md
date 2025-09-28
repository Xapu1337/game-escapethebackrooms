## Contributing

Thank you for considering a contribution. This project aims to keep the Escape The Backrooms Vortex extension lean and maintainable.

### Quick Start
1. Fork and clone the repo.
2. Install deps: `npm install`.
3. Build: `npm run build` (outputs to `dist/`).
4. In Vortex, open Extensions -> Drop the produced zip (or use buildandcopy script if configured).

### Branching
- Use feature/* or fix/* prefixes.

### Coding Guidelines
- Keep functions short and purposeful.
- Avoid large inline anonymous functions; extract helpers.
- Fail fast and log with context.
- No semi-required lint layer here; rely on clear naming & structure.

### Commit Messages
Format: `<type>: <short summary>` (e.g. `fix: handle empty load order file`).
Types: feat, fix, refactor, chore, docs, build.

### Testing
Currently no automated test suite. Manual validation:
- Build succeeds.
- Install in Vortex; basic mod install (PAK + movie + UE4SS logic) paths function.

### Releasing
1. Bump version in `package.json`.
2. Build & verify `dist/info.json` reflects new version.
3. Tag `vX.Y.Z` and attach built archive if distributing manually.



---
Lightweight process is intentional; propose improvements via PR if needed.
