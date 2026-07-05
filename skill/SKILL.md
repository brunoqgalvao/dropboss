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
| `dropboss status` | peers, online/offline, sync %, conflict files, open invites |
| `dropboss share [path]` | (re)print the invite and open it — by default a background "porteiro" auto-accepts **1 person** within 7 days, then the door closes itself (`--uses N`, `--uses 0` unlimited, `--ttl D`, `--manual` to disable auto-accept) |
| `dropboss close [path]` | stop accepting new peers (existing peers stay) |
| `dropboss join <code>` | join someone else's folder on this machine |
| `dropboss history [name]` / `dropboss restore <file>` | list / restore old versions |
| `dropboss leave [path]` | unhook this machine from sync — files stay on disk |

## Inviting someone

Run `dropboss share` and forward the printed message to them — it already contains the full command their agent needs (`npx -y github:brunoqgalvao/dropboss join <code>`; npx handles the install, Syncthing auto-installs). They just paste it to their agent. Your side accepts automatically — by default exactly **one** person, then the invite self-invalidates (a used or leaked code only produces an unanswered pending request after that). Inviting a group: `--uses N` or `--uses 0`; then close with `dropboss close` when everyone's in.
