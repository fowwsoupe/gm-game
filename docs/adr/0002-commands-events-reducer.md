# 0002: Commands in, events out, one reducer

Status: accepted

## Context

The game needs a living league (news feed, history, "sim until it matters"), multiplayer
later (hot-seat, then hosted over Steam), and long saves that stay fast. In a previous
project, state was changed from many places and it became hard to change anything.

## Decision

- Every change is a serializable `Command`, handled by one function, `handleCommand`.
- Every outcome is a serializable `LeagueEvent`.
- Only `applyEvent` (the reducer) changes `LeagueState`. Even the clock and RNG position
  move through an event (`clock.advanced`), and event ids come from a counter the reducer
  advances, so every copy of the state stays identical.
- The main process sends a copy of the state and the command to a worker, gets events back,
  applies them to its own copy and persists them (rows + event log) in one transaction.

## Consequences

- Multiplayer = send commands to a host, broadcast events back. No rewrite.
- The news feed and history are just event queries.
- Adding a state-changing feature touches three places (event type, reducer, persist);
  exhaustive switches make forgetting one a compile error.
- The worker receives a copy of the whole state per command. Fine at current size (a few
  MB); if it grows, keep a long-lived state inside the worker instead.
