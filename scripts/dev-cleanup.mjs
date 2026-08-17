#!/usr/bin/env node
// scripts/dev-cleanup.mjs
// ---------------------------------------------------------------------------
// Runs as the first step of `npm run dev`. Kills any stale `vite` process
// still bound to the dev-server port (5173) from a previous Preview / Deploy
// session that wasn't cleaned up.
//
// Why this exists
// ---------------
// `vite.config.ts` deliberately sets `strictPort: false` so the dev server
// gracefully falls through to 5174 / 5175 / ... when 5173 is already in use.
// When vite binds to a higher port, the platform's preview wrapper waits
// for vite to print  `Local: http://localhost:5173/`  and times out after
// reporting `Dev server failed with exit code -1`.
//
// The most common cause of an orphan on :5173 is a previous `vite` whose
// parent npm process was killed but whose esbuild / node-MainThread never
// received SIGTERM. The fix is to terminate that orphan before starting a
// fresh dev server, so vite can bind :5173 directly again.
//
// Safety
// ------
// - Only processes whose `ps` command line contains the word `vite` are
//   killed. Non-vite holders of :5173 (e.g. a user's own local server) are
//   left alone — vite will still fall through, with a clear warning logged.
// - All kills are SIGTERM first, escalated to SIGKILL after 3 s.
// - If port 5173 is already free this script exits silently in well under
//   200 ms and adds no perceptible overhead to `npm run dev`.
// ---------------------------------------------------------------------------

import { execSync } from "node:child_process";

const PORT = 5173;
const SOFT_KILL_TIMEOUT_MS = 3000;
const PORT_WAIT_TIMEOUT_MS = 3000;

function portPids(port) {
  // `ss -tlnpH 'sport = :<port>'`  -> one line per listener with a
  // `users:(("name",pid=NNNN,...))` block at the end. We only need the PIDs.
  try {
    const out = execSync(`ss -tlnpH 'sport = :${port}' 2>/dev/null`, {
      encoding: "utf8",
    });
    const pids = [...out.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]));
    return [...new Set(pids.filter((n) => Number.isFinite(n) && n > 0))];
  } catch {
    return [];
  }
}

function isViteProcess(pid) {
  try {
    const cmd = execSync(`ps -p ${pid} -o args= 2>/dev/null`, {
      encoding: "utf8",
    }).trim();
    return cmd.length > 0 && /vite/i.test(cmd);
  } catch {
    return false;
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    try {
      execSync("sleep 0.1");
    } catch {
      /* ignore */
    }
  }
  return predicate();
}

const pids = portPids(PORT).filter(isViteProcess);
if (pids.length === 0) {
  // Port is free or held by a non-vite process — nothing to do.
  process.exit(0);
}

console.log(
  `[dev-cleanup] found ${pids.length} stale vite process(es) on :${PORT}: [${pids.join(", ")}]`
);

// Soft-kill first so esbuild / browser-launcher children have a chance to
// shut down cleanly.
for (const pid of pids) {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}

waitFor(() => pids.every((pid) => !isAlive(pid)), SOFT_KILL_TIMEOUT_MS);

// Escalate to SIGKILL for any survivor.
const survivors = pids.filter(isAlive);
for (const pid of survivors) {
  try {
    process.kill(pid, "SIGKILL");
    console.log(`[dev-cleanup] force-killed pid ${pid}`);
  } catch {
    /* gone between checks */
  }
}

// Confirm port :5173 is actually free before handing off to vite so it
// won't immediately fall through again.
const free = waitFor(() => portPids(PORT).length === 0, PORT_WAIT_TIMEOUT_MS);
if (!free) {
  console.warn(
    `[dev-cleanup] port ${PORT} still busy after cleanup. vite will fall back to the next free port. ` +
      `If the platform preview still shows exit code -1, manually stop the process on :${PORT} (e.g. \`lsof -i :${PORT}\`).`
  );
} else {
  console.log(`[dev-cleanup] port ${PORT} is free, handing off to vite`);
}

process.exit(0);
