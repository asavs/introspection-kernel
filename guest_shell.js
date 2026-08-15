import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_GUEST = "IntrospectionKernel";
export const DEFAULT_GUEST_USER = "observer";

export function validateGuestTarget(distro, user) {
  if (!/^[A-Za-z0-9._-]+$/.test(distro || "")) {
    throw new Error("invalid WSL distribution name");
  }
  if (!/^[a-z_][a-z0-9_-]*$/.test(user || "")) {
    throw new Error("invalid guest user name");
  }
  if (distro !== DEFAULT_GUEST) {
    throw new Error(
      `raw shell is locked to the disposable ${DEFAULT_GUEST} guest`
    );
  }
}

export async function executeGuestShell(command, {
  distro = DEFAULT_GUEST,
  user = DEFAULT_GUEST_USER,
  timeoutMs = 12_000,
  maxOutputBytes = 64 * 1024
} = {}) {
  validateGuestTarget(distro, user);
  if (typeof command !== "string" || command.trim().length === 0) {
    throw new Error("shell command must be a non-empty string");
  }
  if (Buffer.byteLength(command, "utf8") > 4096) {
    throw new Error("shell command exceeds 4096 bytes");
  }

  const started = process.hrtime.bigint();
  try {
    const { stdout, stderr } = await execFileAsync("wsl.exe", [
      "-d", distro,
      "-u", user,
      "--",
      "/usr/bin/prlimit",
      "--nproc=64:64",
      "--nofile=256:256",
      "--fsize=2097152:2097152",
      "--cpu=10:10",
      "--",
      "/usr/bin/timeout", "10s",
      "/bin/bash", "--noprofile", "--norc", "-lc", command
    ], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: maxOutputBytes,
      windowsHide: true
    });
    return {
      command,
      exit_code: 0,
      stdout,
      stderr,
      duration_ms: Number(process.hrtime.bigint() - started) / 1e6,
      truncated: false
    };
  } catch (error) {
    const overflow = error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
    return {
      command,
      exit_code: Number.isInteger(error?.code) ? error.code : null,
      signal: error?.signal ?? null,
      stdout: String(error?.stdout ?? "").slice(0, maxOutputBytes),
      stderr: String(error?.stderr ?? error?.message ?? "").slice(0, maxOutputBytes),
      duration_ms: Number(process.hrtime.bigint() - started) / 1e6,
      truncated: overflow,
      timed_out: error?.killed === true || error?.signal === "SIGTERM"
    };
  }
}
