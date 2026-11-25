# Checks

- **Gate**: `pnpm check:changed` runs format, lint, typecheck, the tests that import your changes, and the ratchets your paths select, and prints only failures. Run it once when you are done editing (and again after a rebase or fix), then push. A pass is cached, so don't rerun it "to be sure", and don't also run `pnpm tc`, `pnpm lint`, or the full suite. Never `--no-verify`.
- **While iterating**: run only what you touched: `pnpm test <file.test.ts> --maxWorkers=2`, `pnpm tc:node|tc:web|tc:cli`, `pnpm exec oxlint <files>`, `pnpm exec oxfmt --write <files>`. Transitive tests and the full suite are CI's job ([details](.github/CONTRIBUTING.md#targeting-local-tests)).
- Run checks in the foreground with `timeout 900`. Don't background them and poll with `sleep`.
- Stacked PRs: `ORCA_CODE_QUALITY_BASE=<ref>` or `--base=<ref>`; `--base=HEAD` covers only uncommitted edits.
- CI: `gh pr checks --watch` or `gh run watch <id> --compact --exit-status` (no polling). Read failures with `gh run view <id> --log-failed`; for long logs, filter with `grep -nE "error|FAIL|✗"` instead of tailing.

# Repo Rules

- Ensure main is always releasable
- Never break the CI. If it's broken, merge fixes.
- **Do not add tests by default.** Low-value tests cost more than they catch. Add one only when it fails if your change is reverted, hardcodes its expected values (never computed by production code, locale files, or mocks), and runs at the single layer that owns the behavior. Never test copy/translations, CSS classes, constants, third-party libraries, private state, timing, or work counts. If you touch a test like that, delete it instead of updating it. One exception: a perf contract in a `*.performance.test.{ts,tsx,mjs}` file may count work ([rules](./docs/agents-md-refs/test-antipatterns.md#perf-contracts)). If not convinced see [anti-patterns](./docs/agents-md-refs/test-antipatterns.md).

# Design System

All UI work — layout, color, typography, spacing, component selection, UX behavior — must follow [`docs/STYLEGUIDE.md`](./docs/STYLEGUIDE.md). Use the tokens defined in `src/renderer/src/assets/main.css` (the canonical source) and the shadcn primitives in `src/renderer/src/components/ui/`. Don't invent new color values, font sizes, or shadow tiers when a documented one already covers the role.

# Electron UI Validation

- Always run tests and agent-launched apps in the background with `ORCA_BACKGROUND_LAUNCH=1`.
- Never steal monitor focus or reveal test windows: no `show()`, `showInactive()`, `bringToFront()`, `app.focus()`, or OS activation. Use CDP screenshots of hidden renderers.
- Keep native-focus and visible-window tests paused on the user's desktop; run them on an isolated display or CI.
- Rebuild modified launch-policy code before running an app (stale build wrappers are not safe).
- Use the `$electron` skill and Playwright CDP for rendered Orca UI checks. Do not use computer-use for Orca UI validation.
- Rendered UI E2E checks need an explicit, reproducible viewport and state.
- Screenshot presentational components without Electron: `pnpm fixtures:shot <id>` ([fixtures](docs/agents-md-refs/component-fixtures.md)).

# Code Style

## Reuse Before Reimplementing

Before writing new logic at any scale extend or generalize it instead of building a parallel version.

## Avoid Comments

- Only use when code does not describe
- BE CONCISE. 1 LINE if possible (why not how)

## File and Module Naming

Never use vague names like `helpers`, `utils`, `common`, `misc`, or `shared-stuff` for files, folders, or modules. They carry zero info and tend to become dumping grounds. Name files after what they _actually_ contain — prefer the concrete domain concept (e.g. `tab-group-state.ts`, `terminal-orphan-cleanup.ts`) over the generic role (`tabs-helpers.ts`, `terminal-utils.ts`). If you find yourself reaching for `helpers`, the file probably has more than one responsibility and should be split, or there's a better name hiding in the code that describes what the functions operate on.

# First Class Citizens

Every change must consider these areas:

1. Cross-Platform Support (mac/linux/windows)
   - Guard platform-specific behavior at runtime; use platform-aware shortcuts, paths, and existing process wrappers. Before changing platform-specific code, processes, shells, shortcuts, paths, or native modules, read [`docs/agents-md-refs/cross-platform-support.md`](./docs/agents-md-refs/cross-platform-support.md).
2. Remote hosts
   - Features should work locally and on remote hosts
3. Mobile
4. Folder Workspaces
   - Don't assume every workspace is a git worktree.

# Footguns

## Git / GitHub

If changing code around `git`, `gh`, source-control, or review behavior read [`docs/agents-md-refs/git-workflow.md`](./docs/agents-md-refs/git-workflow.md).

# Local macOS Custom Build

- Use `./scripts/build-local-mac.sh` (ad-hoc signed, fast offline build) instead of bare `pnpm run build:mac` when packaging a local macOS `Orca.app`.
  - Includes custom `orcad-template` by default so Managed SSH remote hosts auto-update to custom server JS + `out/mobile-web/` (on first run per Mac, `scripts/ensure-orcad-prebuilds.mjs` fetches only the ~2-4 MB native slots via HTTP Range from the matching official release and caches them under `~/.cache/orca-custom/orcad-prebuilds/`; pass `--no-orcad` to skip or `--orcad-from <path>` to seed offline).
  - First build on a new machine (or after native/mobile/WSL changes): `./scripts/build-local-mac.sh` (add `--install` to copy into `/Applications/Orca.app` and link `orca` CLI; add `--uninstall-brew` if Homebrew cask `orca` is still installed — never use `--zap`).
  - Incremental JS/TS rebuild: `./scripts/build-local-mac.sh --fast` (reuses already-built `out/relay/wsl`, `out/mobile-web`, and macOS Swift helpers; still refreshes `orcad-template`; add `--install` when ready to replace `/Applications/Orca.app`).
  - Pass `--dry-run` to preview steps without modifying files; pass `--typecheck` to run `pnpm run tc` before building.
  - Never kill a running `/Applications/Orca.app` if the user is chatting inside it; build to `dist/` first and let the user quit before installing.
- On macOS, never run bare `git fetch upstream` (upstream has case-colliding branch names); fetch a specific ref such as `git fetch upstream main`.
