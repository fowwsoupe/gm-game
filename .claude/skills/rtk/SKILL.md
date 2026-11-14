---
name: rtk
description: Use rtk (Rust Token Killer) to cut tokens on shell output. Use whenever running git, test, build, lint, ls/find/grep or package-manager commands in a shell, or when the user mentions rtk or token savings.
---

# rtk — Rust Token Killer

rtk (github.com/rtk-ai/rtk) is a single Rust binary that sits between the shell
and the agent. It runs a command and returns a condensed version of the output
(60-90% fewer tokens) while keeping errors, failures, file names and counts.

## 1. Check it is there

Run once per session:

```bash
command -v rtk && rtk --version && rtk gain >/dev/null && echo RTK_OK
```

- `RTK_OK` → use rtk as below.
- `rtk gain` fails → the wrong "rtk" (Rust Type Kit) is installed. Don't use it; tell the user.
- Not found → run commands normally. Do not install rtk yourself unless the
  user asks; mention once that `brew install rtk && rtk init -g` (macOS) sets it
  up for Claude Code on their machine.

If `rtk init -g` has already been run on this machine, a Claude Code hook
rewrites Bash commands to rtk automatically, so plain `git status` is already
condensed. Prefixing by hand is then optional.

## 2. Use it

Prefix ordinary dev commands with `rtk`:

```bash
rtk git status            rtk git diff            rtk git log -n 10
rtk git add . / commit -m "msg" / push / pull      # one-line "ok ..." results
rtk ls .                  rtk find . -name "*.ts"  rtk grep "pattern" src
rtk npm test              rtk npx vitest run       rtk pnpm test
rtk tsc                   rtk eslint .             rtk cargo test
rtk docker ps             rtk gh pr list
```

Batch related commands into one call.

## 3. Treat condensed output as complete

rtk output keeps every signal and drops noise. Treat it as the full result.
If output is truncated, it says how to get the rest. Re-run with
`rtk bypass <cmd>` only when the result is unusable: empty when output was
clearly expected, contradicting the exit code, or garbled.

Use `rtk bypass` (raw output) when exact text matters, e.g. copying a full
log into a file or a commit message, or parsing output with a script.

## 4. Savings

- `rtk gain` — tokens saved so far (`--graph`, `--daily`, `--history`)
- `rtk discover` — commands from past Claude Code sessions that rtk could have shortened

## Limits

rtk only touches shell commands. Claude Code's built-in Read, Grep and Glob
tools don't go through it.
