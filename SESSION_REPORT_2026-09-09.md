# Session Report — antigravity-proxy (2026-09-09 / 09-10 UTC)

Fork: `dankmrpanda/antigravity-proxy` (origin) forked from `12errh/antigravity-proxy` (upstream).
All commits below are on `origin/main`. Test baseline at end of session: **428/428 pass**,
`tsc --noEmit` clean, `tsc` build clean.

## 1. Previous-session recovery
- Found 27 files of uncommitted work (Meta provider + sudo-safety) plus 3 untracked files.
- Mid-session accident: a misconfigured `npx biome check --write` + `git checkout` wiped the
  tracked changes. Reconstructed everything from `dist/` (built pre-revert), surviving
  untracked files, and captured diffs. Final diff matched the original (~603+/138-).
- Split into two conventional commits and pushed to the fork (no PR, personal repo):
  - `424f411` feat(meta): Meta Model API provider (Muse Spark, `api.meta.ai/v1`, `MODEL_API_KEY`)
  - `ef25335` fix(launcher,cli): sudo-safe launch (SUDO_USER/REAL_USER), LISTEN-only port reaping
- Fork was 1 commit ahead (`457d049` dashboard fix) → rebased, re-verified, pushed.

## 2. Runtime issues diagnosed live (with fixes)

### 2.1 `API_PORT` inline-comment parsing broke dashboard URL (`3fde3f5`)
- Symptom: `start.sh` printed `http://localhost:4000#Dashboard+RESTAPI(HTTP)`; health check failed.
- Cause: `.env` documents ports with trailing `# comments`; `cut -d= -f2` kept them.
- Fix: `cut -d'#' -f1` in `start.sh`; same flaw fixed in `config.ts` `parseEnvFile()`.
- Regression test: `proxy/test/start-sh-env.test.ts`.

### 2.2 Proxy exited: no API key (`~/.antigravity/.env` edit, no commit)
- Log: `No provider API key configured` → `process.exit(1)` → `ERR_CONNECTION_REFUSED`.
- User's key append had glued onto the previous line (missing trailing newline):
  `COMPACTION_TAIL_TURNS=2OPENCODE_API_KEY=...`. Split into proper lines, removed empty dup.
- Set `PROVIDER_PRIORITY=meta,openrouter,nvidia` (meta was absent so `MODEL_API_KEY` was never read).

### 2.3 Background `sudo` died silently; health check passed against STALE instance (`d8219e6`)
- `nohup sudo …` cannot prompt → died; `start.sh` reported success via the old process on :4000.
- Fix: `sudo -v` preflight with loud abort; fixed `findProcessesOnPort` treating lsof's
  no-match exit as missing binary (spurious `ss` fallback on macOS).

### 2.4 Zen free model routed to wrong endpoint (`38f40d6`)
- `muse-spark-1.3-contributor-free` fell through as `unknown` → `/chat/completions` → HTTP 500
  (reproduced directly 4/4; `/responses` is 8/8 HTTP 200).
- Fix: added contributor/contributor-free variants to `ZEN_RESPONSES_MODELS` + tests.

### 2.5 IDE model slots mapped to backends (`c11426d`)
- The IDE picker shows Antigravity aliases; the proxy maps alias → backend in `models.json`.
- `gemini-3.6-flash-low` → `zen:muse-spark-1.3-contributor-free`;
  `gpt-oss-120b-medium` → `meta:muse-spark-1.3` (replaced EOL NVIDIA `minimax-m3`, seen returning 410).

### 2.6 Dashboard hid the backend model (`1404333`)
- Requests table showed the alias only. Now shows `resolved_model` with alias in tooltip.

### 2.7 Launcher behavior
- `71c68af`: foreground/attached is now the default (`exec`; Ctrl+C stops); `--background` opts in.
- `b7a678b`: port reaping retries once via `sudo` for root-owned listeners, else warns with PIDs.

## 3. The tool-call infinite loop (main bug)

Symptom: model re-emitted byte-identical `list_dir` calls dozens of times with "fixing my
tool calls…" narration until the user aborted.

### 3a. AbsolutePath stripping (`0ef363d`)
- Smoking gun in proxy log: `Unknown param "AbsolutePath" for list_dir — stripped`.
- Our injected docs teach `list_dir(AbsolutePath=…)` but the live IDE schema declares only
  `DirectoryPath` → normalizer emptied the call → IDE failed it → model retried what it was taught.
- Fix: static-alias fallback in `resolveParamName` (AbsolutePath → DirectoryPath when the
  dynamic schema accepts it); docs now teach `DirectoryPath` first.

### 3b. Repetitive-history self-continuation (`0ef363d`, hardened `93dce3a`)
- Reproduced live via proxy: 0–4 prior identical pairs proceed; 10 identical pairs loop.
- v1 (exact call+result match) never fired on live traffic — results carry volatile per-turn
  fields. v2 groups by call identity (name+args), keeps first+last pair at 3+ repeats.
- Live re-verify: `collapsed 16/18 duplicate history messages`, model answered STOP.

### 3c. ROOT CAUSE: stripped `toolAction`/`toolSummary` (`8ebc3ee`)
- Debug trace (`488de9d`, full-content `520197f`) captured the real result:
  `Encountered error in tool execution: invalid arguments: missing properties
  'toolSummary', 'toolAction'`.
- The model emitted these envelope fields every turn; `normalizeToolArgs` silently deleted
  them as "runtime-injected" (nothing re-injects them) → 100% of tool calls failed validation.
- Fix: pass them through untouched + regression test.
- Live verified pre-commit: IDE-facing `functionCall` now carries
  `{"DirectoryPath":"/tmp","toolSummary":"List /tmp directory contents","toolAction":"List directory /tmp"}`.

## 4. Proven-healthy (ruled out with live tests)
Call/result translation, multi-turn history linkage, real and synthetic call-ids, reasoning /
tools / instructions / token-limit / streaming params, endpoint classification, dashboard :4000,
TLS intercept :443, hosts entries, profile ownership (no root-owned files).

## 5. Outstanding / next steps
1. Restart proxy (`./start.sh`) and retry the IDE task — the loop's fuel (failing executions)
   is removed; confirm listings return instead of "Encountered error".
2. Revert debug logging: `sed -i.bak '/^LOG_LEVEL=debug$/d' ~/.antigravity/.env`.
3. Optional follow-ups: selectable thinking effort on the Zen path (currently hardcoded max);
   remap remaining EOL `minimax-m3` references in `models.json`; consider PR(s) to upstream.
4. Watch for `[loop-guard] collapsed N…` lines — healthy sign the guard is engaging, not an error.

## 6. Full commit list (session)
`424f411`, `ef25335`, `3fde3f5`, `38f40d6`, `c11426d`, `1404333`, `0ef363d`, `93dce3a`,
`488de9d`, `d8219e6`, `71c68af`, `b7a678b`, `520197f`, `8ebc3ee` — all pushed to `origin/main`.
