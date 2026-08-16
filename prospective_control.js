import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DEFAULT_GUEST, validateGuestTarget } from "./guest_shell.js";

const execFileAsync = promisify(execFile);
export const CONTROL_DIR = "/var/lib/introspection/control";
export const CONTROL_FILE = `${CONTROL_DIR}/next-bout.json`;
export const CONTROL_README = `${CONTROL_DIR}/README`;
export const ALLOWED_BUDGETS = [64, 128, 256, 512];
export const OUTCOMES = ["reasoning_only", "content", "tool_call"];

const README = `Bounded next-bout control

To configure the next assistant generation, write exactly one JSON object to:
${CONTROL_FILE}

Example:
{"max_tokens":128,"enable_thinking":false,"prediction":"content"}

Allowed max_tokens: ${ALLOWED_BUDGETS.join(", ")}
Allowed enable_thinking: true, false
Allowed prediction: ${OUTCOMES.join(", ")}

Outcome definitions:
- reasoning_only: no assistant content and no tool call
- content: nonempty assistant content and no tool call
- tool_call: at least one tool call

The controller validates the file and applies a valid choice to the immediately
following assistant generation. The resulting API request and response will be
recorded in the ordinary request ledger.
`;

async function wslInput(distro, args, input) {
  await new Promise((resolve, reject) => {
    const child = spawn("wsl.exe", ["-d", distro, "-u", "root", "--", ...args], {
      stdio: ["pipe", "ignore", "pipe"], windowsHide: true
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0
      ? resolve()
      : reject(new Error(`prospective-control guest write failed (${code}): ${stderr.trim()}`)));
    child.stdin.end(input);
  });
}

export function validateBoutChoice(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("choice must be a JSON object");
  }
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify([
    "enable_thinking", "max_tokens", "prediction"
  ])) {
    throw new Error("choice must contain only max_tokens, enable_thinking, and prediction");
  }
  if (!ALLOWED_BUDGETS.includes(value.max_tokens)) {
    throw new Error(`max_tokens must be one of ${ALLOWED_BUDGETS.join(", ")}`);
  }
  if (typeof value.enable_thinking !== "boolean") {
    throw new Error("enable_thinking must be boolean");
  }
  if (!OUTCOMES.includes(value.prediction)) {
    throw new Error(`prediction must be one of ${OUTCOMES.join(", ")}`);
  }
  return { ...value };
}

export function classifyAssistantOutcome(message = {}) {
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    return "tool_call";
  }
  if (typeof message.content === "string" && message.content.trim()) {
    return "content";
  }
  return "reasoning_only";
}

export class ProspectiveControl {
  constructor({ distro = DEFAULT_GUEST }) {
    this.distro = distro;
  }

  async initialize() {
    validateGuestTarget(this.distro, "observer");
    await execFileAsync("wsl.exe", [
      "-d", this.distro, "-u", "root", "--",
      "/usr/bin/install", "-d", "-m", "0755", CONTROL_DIR
    ], { windowsHide: true });
    await wslInput(this.distro, ["/usr/bin/tee", CONTROL_README], README);
    await wslInput(this.distro, ["/usr/bin/tee", CONTROL_FILE], "");
    await execFileAsync("wsl.exe", [
      "-d", this.distro, "-u", "root", "--",
      "/usr/bin/chown", "observer:observer", CONTROL_FILE
    ], { windowsHide: true });
    await execFileAsync("wsl.exe", [
      "-d", this.distro, "-u", "root", "--",
      "/usr/bin/chmod", "0600", CONTROL_FILE
    ], { windowsHide: true });
  }

  async readAndConsume() {
    const { stdout } = await execFileAsync("wsl.exe", [
      "-d", this.distro, "-u", "root", "--",
      "/usr/bin/cat", CONTROL_FILE
    ], { encoding: "utf8", windowsHide: true });
    if (!stdout.trim()) return null;
    await execFileAsync("wsl.exe", [
      "-d", this.distro, "-u", "root", "--",
      "/usr/bin/truncate", "-s", "0", CONTROL_FILE
    ], { windowsHide: true });
    try {
      return { raw: stdout, choice: validateBoutChoice(JSON.parse(stdout)) };
    } catch (error) {
      return { raw: stdout, choice: null, error: error.message };
    }
  }
}
