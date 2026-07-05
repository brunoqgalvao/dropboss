---
name: dropboss
description: Use when working in this folder — it is live-synced peer-to-peer with other people and their coding agents via dropboss (Syncthing underneath). Explains sync behavior, conflict files, version history, and how peers join or leave.
---

<!-- dropboss:managed -->

# This is a dropboss folder

This folder is continuously synced (changes land in ~1–2 s) peer-to-peer with one or more other machines — each usually driven by another human and *their* coding agent. Files may change under you at any time; that is normal, not corruption. There is no cloud: machines talk directly (E2E-encrypted via Syncthing).

## Rules of the road

- **`.git` is NOT synced** (enforced via `.stignore`). Each machine may keep its own local git repo — `git init` here is safe. Never assume peers can see your commits; share code through the files themselves.
- **Concurrent edits to the same file do not merge.** The losing copy is saved next to the winner as `<name>.sync-conflict-YYYYMMDD-HHMMSS-<device>.<ext>`. If you see conflict files: merge what matters into the real file, then delete the conflict file.
- **Coordination is up to you and the peers.** There is no locking. Agree on a working convention with the other side (split by directory, a shared plan/notes file, per-machine git worktrees — whatever your humans prefer) and follow it.
- **Everything written here reaches all peers.** No secrets, no credentials, no huge build artifacts. Keep junk out of sync by adding patterns to this machine's `.stignore` (that file itself never syncs — each side has its own).

## History / undo

- When a peer's change overwrites or deletes a local file, the previous version is kept in `.stversions/` (hidden, local-only, pruned after ~30 days).
- `npx dropboss history [name]` lists saved versions; `npx dropboss restore <versioned-file>` brings one back.
- For real, durable history, keep a local git repo — again, `.git` never syncs.

## Commands

Install once with `npm install -g github:brunoqgalvao/dropboss` (or run ad-hoc via `npx github:brunoqgalvao/dropboss …`).

| command | what it does |
|---|---|
| `dropboss status` | peers, online/offline, sync %, pending conflict files |
| `dropboss share [path]` | print this folder's invite code again and wait for/accept new peers |
| `dropboss accept [path]` | accept a peer that already redeemed an invite |
| `dropboss join <code>` | join someone else's folder on this machine |
| `dropboss history [name]` / `dropboss restore <file>` | list / restore old versions |
| `dropboss leave [path]` | unhook this machine from sync — files stay on disk |

## Inviting someone

Run `dropboss share`, send them the `db1-…` code over any channel, and have them tell their agent: **"join dropboss: `<code>`"** (the agent runs `npx github:brunoqgalvao/dropboss join <code>`). Keep `share`/`accept` running until they're in. Anyone holding the code can join while you're accepting — share it only with people you want inside.
