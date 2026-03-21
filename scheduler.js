// scheduler.js
//
// Unified scheduler for update_and_rescore.js.
// Ticks at the GCD of both intervals. When men's and women's coincide,
// runs the script with NO flag (both in one pass). Otherwise --mens or --womens.
// Runs are queued sequentially — nothing is skipped, nothing overlaps.
//
// Usage:
//   node scheduler.js                                          # defaults: x=30, y=15, stop=00:00
//   node scheduler.js --mens-interval=30 --womens-interval=15 --stop-at=00:00
//   node scheduler.js -x=30 -y=15 -z=00:00

const { spawn } = require("child_process");
const path = require("path");

// ═══════════════════════════════════════════════════════════════════════
// PARSE CLI ARGS
// ═══════════════════════════════════════════════════════════════════════

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    mensInterval: 30,
    womensInterval: 15,
    stopAt: "00:00",
  };

  for (const arg of args) {
    const [key, val] = arg.split("=");
    switch (key) {
      case "--mens-interval": case "-x": config.mensInterval = Number(val); break;
      case "--womens-interval": case "-y": config.womensInterval = Number(val); break;
      case "--stop-at": case "-z": config.stopAt = val; break;
    }
  }

  if (isNaN(config.mensInterval) || config.mensInterval < 1 ||
      isNaN(config.womensInterval) || config.womensInterval < 1) {
    console.error("Intervals must be positive numbers.");
    process.exit(1);
  }

  return config;
}

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

function getStopTime(stopAt) {
  const [h, m] = stopAt.split(":").map(Number);
  const stop = new Date();
  stop.setHours(h, m, 0, 0);
  if (stop <= new Date()) stop.setDate(stop.getDate() + 1);
  return stop;
}

function timeStr(d) {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

// ═══════════════════════════════════════════════════════════════════════
// SEQUENTIAL QUEUE
// ═══════════════════════════════════════════════════════════════════════

const SCRIPT = path.join(__dirname, "update_and_rescore.js");
const queue = [];
let processing = false;

function enqueue(label, flags) {
  queue.push({ label, flags });
  console.log(`  📥 Queued: ${label}${queue.length > 1 ? ` (${queue.length - 1} ahead)` : ""}`);
  drain();
}

function drain() {
  if (processing || queue.length === 0) return;
  processing = true;

  const { label, flags } = queue.shift();
  const startTime = new Date();
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ▶ ${label} started at ${timeStr(startTime)}`);
  console.log(`${"─".repeat(60)}`);

  const child = spawn("node", [SCRIPT, ...flags], {
    stdio: "inherit",
    env: process.env,
  });

  child.on("close", (code) => {
    const elapsed = ((Date.now() - startTime.getTime()) / 1000).toFixed(1);
    const status = code === 0 ? "✓" : `✗ exit ${code}`;
    console.log(`  ${status} ${label} finished in ${elapsed}s`);
    if (queue.length > 0) console.log(`  📋 ${queue.length} run(s) still queued`);
    processing = false;
    drain(); // process next in queue
  });

  child.on("error", (err) => {
    console.error(`  ✗ ${label} spawn error: ${err.message}`);
    processing = false;
    drain();
  });
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════

function main() {
  const config = parseArgs();
  const stopTime = getStopTime(config.stopAt);
  const remaining = stopTime.getTime() - Date.now();
  const tickInterval = gcd(config.mensInterval, config.womensInterval);

  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  BRACKET SCHEDULER                                      ║`);
  console.log(`╠══════════════════════════════════════════════════════════╣`);
  console.log(`║  Men's interval (x):   every ${String(config.mensInterval).padStart(3)} min                   ║`);
  console.log(`║  Women's interval (y): every ${String(config.womensInterval).padStart(3)} min                   ║`);
  console.log(`║  Tick interval (GCD):  every ${String(tickInterval).padStart(3)} min                   ║`);
  console.log(`║  Stop at (z):          ${config.stopAt.padEnd(6)}                            ║`);
  console.log(`║  Stop time:            ${timeStr(stopTime).padEnd(11)}                       ║`);
  console.log(`║  Remaining:            ${String((remaining / 60000).toFixed(0)).padStart(4)} min                         ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝`);

  if (remaining <= 0) {
    console.log("\n  Stop time already passed. Exiting.");
    process.exit(0);
  }

  // ── tick=0: always run both ──
  let tickCount = 0;
  enqueue("MEN'S + WOMEN'S (initial)", []);

  // ── schedule future ticks ──
  const timer = setInterval(() => {
    tickCount++;
    const elapsed = tickCount * tickInterval; // minutes since start

    if (stopTime.getTime() - Date.now() <= 0) return;

    const mensDue   = elapsed % config.mensInterval === 0;
    const womensDue = elapsed % config.womensInterval === 0;

    if (mensDue && womensDue) {
      enqueue(`MEN'S + WOMEN'S (t=${elapsed}min)`, []);
    } else if (mensDue) {
      enqueue(`MEN'S only (t=${elapsed}min)`, ["--mens"]);
    } else if (womensDue) {
      enqueue(`WOMEN'S only (t=${elapsed}min)`, ["--womens"]);
    }
    // if neither is due this tick, do nothing
  }, tickInterval * 60 * 1000);

  // ── shutdown at stop time ──
  const shutdownTimer = setTimeout(() => {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`  🛑 Stop time reached (${config.stopAt}). No new runs will be queued.`);
    console.log(`${"═".repeat(60)}`);
    clearInterval(timer);

    // Wait for queue to drain, then exit
    const exitCheck = setInterval(() => {
      if (!processing && queue.length === 0) {
        console.log("  All runs complete. Exiting.");
        clearInterval(exitCheck);
        process.exit(0);
      }
    }, 2000);

    setTimeout(() => {
      console.log("  Timeout waiting for in-flight run. Force exiting.");
      process.exit(0);
    }, 120000);
  }, remaining);

  // ── Ctrl+C ──
  process.on("SIGINT", () => {
    console.log("\n\n  Ctrl+C received. Cleaning up...");
    clearInterval(timer);
    clearTimeout(shutdownTimer);
    setTimeout(() => process.exit(0), 1000);
  });

  // ── preview schedule ──
  console.log(`\n  Schedule preview:`);
  const previewTicks = Math.min(Math.ceil((remaining / 60000) / tickInterval), 10);
  for (let i = 1; i <= previewTicks; i++) {
    const t = i * tickInterval;
    const m = t % config.mensInterval === 0;
    const w = t % config.womensInterval === 0;
    const what = m && w ? "MEN'S + WOMEN'S" : m ? "MEN'S only" : w ? "WOMEN'S only" : null;
    if (what) {
      const when = new Date(Date.now() + t * 60000);
      console.log(`    t=${String(t).padStart(4)}min  ${timeStr(when)}  →  ${what}`);
    }
  }
  if (previewTicks < Math.ceil((remaining / 60000) / tickInterval)) {
    console.log(`    ... and more until ${config.stopAt}`);
  }

  console.log(`\n  Press Ctrl+C to stop early.\n`);
}

main();