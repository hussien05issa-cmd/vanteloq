#!/usr/bin/env node

import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const duration = args.shift();
const command = args.shift();
if (!duration || !command) process.exit(64);

const match = /^(\d+)(ms|s|m)?$/.exec(duration);
if (!match) process.exit(64);
const multiplier = match[2] === "m" ? 60_000 : match[2] === "ms" ? 1 : 1_000;
const timeoutMs = Number(match[1]) * multiplier;
const child = spawn(command, args, { stdio: "inherit" });
const timer = setTimeout(() => {
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
}, timeoutMs);

child.on("error", () => process.exit(69));
child.on("exit", (code, signal) => {
  clearTimeout(timer);
  process.exit(code ?? (signal ? 124 : 1));
});
