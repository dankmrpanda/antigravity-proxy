/**
 * Regression tests for the two sudo/start.sh bugs:
 *
 *   B1 (dashboard unreachable + root-owned files): running start.sh (or the
 *   CLI) under sudo reset $HOME to /var/root, so certs/config/logs went to
 *   the wrong home and GUI apps launched as root. The script must resolve
 *   the invoking user via SUDO_USER and run user-scoped ops as them.
 *
 *   B2 (Antigravity killed / logged out): the old port-reaping used plain
 *   `lsof -ti tcp:<port>`, which matches EVERY socket using the port —
 *   including outbound HTTPS from browsers and Antigravity itself. Killing
 *   those PIDs kills innocent apps. Only LISTEN sockets (a previous proxy
 *   instance) may be reaped.
 *
 * Static file-content checks (same approach as start-script.test.ts): the
 * buggy patterns must be gone and the fixed patterns present.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const startSh = readFileSync(resolve(repoRoot, "start.sh"), "utf-8");
const portTs = readFileSync(
	resolve(__dirname, "..", "src", "cli", "utils", "port.ts"),
	"utf-8",
);
const startTs = readFileSync(
	resolve(__dirname, "..", "src", "cli", "commands", "start.ts"),
	"utf-8",
);
const openTs = readFileSync(
	resolve(__dirname, "..", "src", "cli", "utils", "open.ts"),
	"utf-8",
);

// ─── B2: listeners-only port reaping ─────────────────────────────────────────

test("B2: port.ts restricts lsof to LISTEN sockets", () => {
	assert.ok(
		portTs.includes("-sTCP:LISTEN"),
		"port.ts must pass -sTCP:LISTEN to lsof so outbound connections are never matched",
	);
});

test("B2: start.sh restricts lsof to LISTEN sockets", () => {
	assert.ok(
		startSh.includes("-sTCP:LISTEN"),
		"start.sh must pass -sTCP:LISTEN to lsof",
	);
	// No bare `lsof -ti tcp:…` command without the LISTEN filter may remain
	// (skip comment lines — only actual commands matter).
	for (const line of startSh.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("#")) continue;
		if (line.includes("lsof -ti") && !line.includes("-sTCP:LISTEN")) {
			assert.fail(
				`bare lsof without LISTEN filter would kill innocent apps: ${line.trim()}`,
			);
		}
	}
	// The fixed lookup command itself must be present.
	assert.ok(
		/lsof -ti tcp:.*-sTCP:LISTEN/.test(startSh),
		"start.sh must contain an lsof lookup with the LISTEN filter",
	);
});

// ─── B1: sudo user resolution ────────────────────────────────────────────────

test("B1: start.sh resolves the invoking user via SUDO_USER", () => {
	assert.ok(startSh.includes("SUDO_USER"), "start.sh must detect SUDO_USER");
	assert.ok(
		/REAL_USER=/.test(startSh),
		"start.sh must define REAL_USER for user-scoped operations",
	);
	assert.ok(
		/REAL_HOME=/.test(startSh),
		"start.sh must define REAL_HOME so config/certs/logs land in the user home",
	);
});

test("B1: start.sh runs user-scoped ops as the real user", () => {
	assert.ok(
		/as_user open/.test(startSh),
		"dashboard browser must open as the real user (open as root never reaches the user session)",
	);
	assert.ok(
		/as_user.*[Oo]pen.*ANTIGRAVITY_APP|as_user open "\$ANTIGRAVITY_APP"/.test(
			startSh,
		),
		"Antigravity must launch as the real user (root launch corrupts profile data)",
	);
});

test("B1: start.sh keeps HOME on the real user for the proxy process", () => {
	assert.ok(
		startSh.includes('HOME="$REAL_HOME"'),
		"proxy must start with HOME=$REAL_HOME so it reads the user config, not /var/root",
	);
	assert.ok(
		!startSh.includes("--preserve-env=HOME"),
		"--preserve-env=HOME preserves /var/root under sudo; explicit HOME=$REAL_HOME is required",
	);
});

test("B1: start.sh hands files back to the real user after root runs", () => {
	assert.ok(
		/chown.*REAL_USER.*USER_DATA_DIR|chown -R "\$REAL_USER" "\$USER_DATA_DIR"/.test(
			startSh,
		),
		"root-created files under the user data dir must be chowned back",
	);
});

// ─── B1: CLI equivalents ─────────────────────────────────────────────────────

test("B1: CLI launches Antigravity as the invoking user under sudo", () => {
	assert.ok(
		startTs.includes("SUDO_USER"),
		"start.ts must handle SUDO_USER when launching the desktop app",
	);
	assert.ok(
		/sudo.*-u/.test(startTs),
		"start.ts must drop to the real user (sudo -u) for GUI launch",
	);
});

test("B1: CLI opens the dashboard browser as the invoking user under sudo", () => {
	assert.ok(
		openTs.includes("SUDO_USER"),
		"open.ts must handle SUDO_USER so the browser opens in the user session",
	);
});
