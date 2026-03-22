// scheduler.js
//
// Runs update_and_rescore.js (mens then womens) on a fixed schedule.
// All run times are computed upfront at startup. If a run is still in
// progress when the next is due, it queues. Queued runs always execute
// even if they start after the window closes — they were scheduled
// within the window. No runs are scheduled outside the window.
//
// Usage:
//   node scheduler.js
//   node scheduler.js --start=12:30 --end=23:45 --interval=45

const { spawn } = require("child_process");
const path = require("path");

// ═══════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════

const DEFAULTS = { start: "12:30", end: "23:45", interval: 45 };

function parseArgs() {
  const config = { ...DEFAULTS };
  for (const arg of process.argv.slice(2)) {
    const [key, val] = arg.split("=");
    if (key === "--start")    config.start = val;
    if (key === "--end")      config.end = val;
    if (key === "--interval") config.interval = Number(val);
  }
  return config;
}

// ═══════════════════════════════════════════════════════════════════════
// TIME HELPERS (all in Eastern)
// ═══════════════════════════════════════════════════════════════════════

function nowET() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function todayET(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = nowET();
  d.setHours(h, m, 0, 0);
  return d;
}

function fmt(d) {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

// ═══════════════════════════════════════════════════════════════════════
// BUILD SCHEDULE
// ═══════════════════════════════════════════════════════════════════════

function buildSchedule(config) {
  const times = [];
  const start = todayET(config.start);
  const end = todayET(config.end);
  let t = new Date(start);

  while (t <= end) {
    times.push(new Date(t));
    t = new Date(t.getTime() + config.interval * 60000);
  }

  return times;
}

// ═══════════════════════════════════════════════════════════════════════
// RUN UPDATE_AND_RESCORE
// ═══════════════════════════════════════════════════════════════════════

const SCRIPT = path.join(__dirname, "update_and_rescore.js");

function run(label) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    console.log(`\n${"─".repeat(60)}`);
    console.log(`  ▶ ${label} — started at ${fmt(nowET())} ET`);
    console.log(`${"─".repeat(60)}`);

    const child = spawn("node", [SCRIPT], {
      stdio: "inherit",
      env: process.env,
    });

    child.on("close", (code) => {
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  ${code === 0 ? "✓" : "✗"} ${label} finished in ${sec}s (exit ${code})`);
      resolve(code);
    });

    child.on("error", (err) => {
      console.error(`  ✗ ${label} spawn error: ${err.message}`);
      resolve(1);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  const config = parseArgs();
  const schedule = buildSchedule(config);

  if (schedule.length === 0) {
    console.log("  No runs to schedule. Exiting.");
    process.exit(0);
  }

  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  BRACKET SCHEDULER                                      ║`);
  console.log(`╠══════════════════════════════════════════════════════════╣`);
  console.log(`║  Window:    ${config.start} – ${config.end} ET${" ".repeat(30)}║`);
  console.log(`║  Interval:  every ${config.interval} min${" ".repeat(33)}║`);
  console.log(`║  Runs:      ${String(schedule.length).padEnd(3)} total${" ".repeat(33)}║`);
  console.log(`╚══════════════════════════════════════════════════════════╝`);

  console.log(`\n  Full schedule:`);
  for (let i = 0; i < schedule.length; i++) {
    console.log(`    #${String(i + 1).padStart(2)}  ${fmt(schedule[i])} ET`);
  }

  // Skip runs whose time has already passed (if scheduler started late)
  const now = nowET();
  let nextIdx = 0;

  while (nextIdx < schedule.length && schedule[nextIdx] < now) {
    console.log(`\n  ⏩ Skipped #${nextIdx + 1} (${fmt(schedule[nextIdx])} ET — already past)`);
    nextIdx++;
  }

  if (nextIdx >= schedule.length) {
    console.log("\n  All scheduled runs are in the past. Exiting.");
    process.exit(0);
  }

  // Wait for first upcoming run
  const firstWait = schedule[nextIdx].getTime() - new Date().getTime();
  if (firstWait > 0) {
    const waitMin = Math.round(firstWait / 60000);
    console.log(`\n  ⏳ Waiting ${waitMin} min until first run at ${fmt(schedule[nextIdx])} ET...`);
    await new Promise(r => setTimeout(r, firstWait));
  }

  // Process runs sequentially
  while (nextIdx < schedule.length) {
    // Collect all due runs (scheduled time <= now)
    const queue = [];
    while (nextIdx < schedule.length && schedule[nextIdx].getTime() <= Date.now() + 1000) {
      queue.push(nextIdx);
      nextIdx++;
    }

    // Execute queued runs in order
    for (const idx of queue) {
      const label = `Run #${idx + 1} (scheduled ${fmt(schedule[idx])} ET)`;
      await run(label);
    }

    // If more runs remain, sleep until the next one
    if (nextIdx < schedule.length) {
      const sleepMs = Math.max(0, schedule[nextIdx].getTime() - Date.now());
      if (sleepMs > 0) {
        const sleepMin = (sleepMs / 60000).toFixed(1);
        console.log(`\n  ⏳ Next: #${nextIdx + 1} at ${fmt(schedule[nextIdx])} ET (${sleepMin} min)`);
        await new Promise(r => setTimeout(r, sleepMs));
      }
    }
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ✓ All ${schedule.length} scheduled runs complete. Shutting down.`);
  console.log(`${"═".repeat(60)}\n`);
  process.exit(0);
}

// Ctrl+C
process.on("SIGINT", () => {
  console.log("\n\n  Ctrl+C — exiting.");
  process.exit(0);
});

main();