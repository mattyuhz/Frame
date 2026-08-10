# Working together on Frame

How M (owner), Claude (Claude Code), and Codex collaborate on this repository.
`CLAUDE.md` and `AGENTS.md` tell each assistant how to *build*; this file tells
all three of us how to work without stepping on each other. If this file and an
assistant's instruction file ever disagree, this file wins on process,
`CLAUDE.md` wins on product constraints.

## Roles

- **M** — product owner. Decides what gets built and what gets cut, assigns
  tasks, does the on-device (iPhone Safari) testing, and is the **only one who
  merges to `main`**.
- **Claude** — primary engineer. Owns feature work and bug fixes in
  `index.html`, `compose.html`, and `sw.js` unless M assigns otherwise.
- **Codex** — reviewer, tester, documenter. Reviews behaviour changes, builds
  dev tooling and test harnesses, writes and maintains docs, and takes small
  features that don't overlap Claude's active work when M assigns them.

Roles are defaults, not walls — M can hand any task to either assistant. The
rule that actually matters is one pen per file, below.

## Source of truth

- **GitHub is the source of truth.** Work that isn't pushed doesn't exist.
  Local folders and chat transcripts are scratch space.
- **The assistants cannot see each other's chats.** Anything the other
  assistant needs must live in the repo: PR descriptions, review comments,
  commit messages, docs. If it was only said in a chat, it wasn't said.
- **`main` is the released version.** GitHub Pages publishes it directly —
  there is no build step and no separate deploy branch — so treat every merge
  to `main` as a deploy to M's phone. Nobody commits to `main` directly;
  changes arrive by pull request, and only M merges.

## Branch rules

1. Branch names: `claude/<topic>` for Claude, `codex/<topic>` for Codex.
2. Start every branch from the latest `origin/main`. One task = one branch =
   one PR; delete the branch after merge.
3. Never push to `main`. Never push to the other assistant's branch. Never
   force-push anything except your own unmerged branch.
4. If `main` moves while your branch is open, rebase or restart your branch
   from `origin/main` yourself — conflict resolution is never left to M.

### One pen per file

Frame and Compose are each a **single file**. Two branches editing
`index.html` in parallel will conflict almost every time, and separate
branches do nothing to prevent that — they only make the collision visible at
merge time, when it's most expensive. So:

- At any moment, one assistant holds the pen for each of `index.html`,
  `compose.html`, and `sw.js`. M assigns the pen by assigning the task.
- The other assistant works on things that can't conflict: review, tests,
  docs, or the other app file.
- If your task needs a file whose pen the other assistant holds, stop and say
  so — don't branch and hope.

## Before starting any task (both assistants, every time)

1. `git fetch origin` and start (or rebase) your branch from `origin/main`.
2. Check open branches and PRs — they are the live record of what the other
   assistant is doing. If your task touches a file an open PR also touches,
   stop and ask M.
3. Read `CLAUDE.md`. It is the canonical project brief for both assistants —
   architecture, iOS lessons learned, and what was deliberately removed and
   must not quietly return.

## Finishing a task

1. Run the verification ritual below; everything must pass.
2. Push the branch and open a PR. The PR description is the handoff record:
   - what changed and why, in plain words;
   - what was verified — paste the ritual output, don't summarize it;
   - anything unfinished, uncertain, or needing M's on-device pass;
   - whether it needs the other assistant's review.
3. Any change to the behaviour of `index.html`, `compose.html`, or `sw.js`
   gets a review from the other assistant before M merges. Docs-only changes
   don't need cross-review.
4. **Ship-together rule:** the three shipped files are one unit. If a change
   spans files, or an old cached page would misbehave against the new files,
   bump `CACHE` in `sw.js` (`frame-v5` → `frame-v6` → …) in the same PR so the
   offline shell reinstalls as a set.

## Review protocol

A review checks, in order:

1. **Constraints** — does the change violate any non-negotiable below? An
   otherwise-perfect PR that adds a CDN link is rejected, full stop.
2. **Honesty** — does every success message correspond to something the code
   actually verified? Does the PR claim only what the ritual output shows?
3. **Correctness** — does it respect the iOS realities documented in
   `CLAUDE.md` (decoder eviction, dropped seeks, stalls, invisible-element
   black frames)?
4. **Simplicity** — could this be less? Propose removals as readily as fixes.

Reviews happen as PR comments so they're part of the record. Disagreements are
argued with evidence — a harness, a measurement, a repro — not authority
(see "Working style" in `CLAUDE.md`). M breaks ties.

## Verification ritual (run from the repo root before every PR)

### 1. Security audit — the pages must stay network-dead

```bash
for f in index.html compose.html; do
  echo "== $f"
  grep -c 'https\?://' "$f"                                             # 0
  grep -nE 'fetch\(|XMLHttpRequest|WebSocket|new Worker|@import' "$f"   # no output
  grep -nE '\beval\(|new Function|innerHTML|document\.write' "$f"       # no output
  grep -c "connect-src 'none'" "$f"                                     # 1
done
```

`sw.js` is the only file allowed to contain `fetch`, and its same-origin guard
(`url.origin !== location.origin`) must stay. The acceptance test is literal:
everything works in Airplane Mode.

### 2. Syntax — check the shipped script bytes

```bash
node -e '
const fs=require("fs"),cp=require("child_process"),os=require("os"),path=require("path");
for(const f of ["index.html","compose.html"]){
  const m=fs.readFileSync(f,"utf8").match(/<script>([\s\S]*?)<\/script>/);
  if(!m) throw new Error(f+": no <script> block");
  const tmp=path.join(os.tmpdir(),f+".js");
  fs.writeFileSync(tmp,m[1]);
  cp.execSync("node --check "+JSON.stringify(tmp),{stdio:"inherit"});
  console.log(f+": syntax OK");
}'
```

### 3. ID cross-reference — every `$('id')` lookup must exist in markup

```bash
node -e '
const fs=require("fs");
for(const f of ["index.html","compose.html"]){
  const s=fs.readFileSync(f,"utf8");
  const used=[...new Set([...s.matchAll(/\$\(\x27([^\x27]+)\x27\)/g)].map(m=>m[1]))];
  const ids=new Set([...s.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
  const missing=used.filter(id=>!ids.has(id));
  if(missing.length){console.error(f+": MISSING "+missing.join(", "));process.exitCode=1;}
  else console.log(f+": all "+used.length+" $() lookups match an id");
}'
```

### 4. Runtime and logic (when behaviour changed)

Boot the page in jsdom with `runScripts:'dangerously'` and error listeners;
regex-extract shipped functions and test them against synthetic signals —
the full method is in "Testing ritual" in `CLAUDE.md`. Test the shipped bytes,
not a re-typed copy, and when a harness gives a surprising result, suspect the
harness first. There is no checked-in harness yet; building one is on Codex's
task list.

### 5. On-device reality

Some bugs exist only on iPhone Safari: black frames from invisible video
elements, decoder eviction under memory pressure, silent seek drops, stalls
with `paused === false`. If a change touches video decode, playback, or
export, say so in the PR — M does the on-device pass. **Never claim "works on
iOS" from a desktop browser.**

## Non-negotiables (bind all three of us; canonical text in `CLAUDE.md`)

1. **Zero network capability in the pages.** No CDN, no webfonts, no
   analytics, no external scripts — ever. Open-source is fine as reference or
   dev tooling, never as a shipped dependency.
2. **Video never leaves the device.**
3. **Simplicity over capability.** When in doubt, propose removal, not
   addition. Ask M before adding controls. Check "Deliberately removed" in
   `CLAUDE.md` before proposing a feature — it may have already been cut on
   purpose.
4. **Never lie about quality.** Exports are re-decoded and verified before any
   success message — and the same honesty applies to PR descriptions and
   review comments: never claim a check you didn't run.
