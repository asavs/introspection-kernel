import fs from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DISTRO = "IntrospectionKernel";
const unit = fs.readFileSync(new URL("./runtime-c.service", import.meta.url), "utf8");

async function guest(...args) {
  return execFileAsync("wsl.exe", [
    "-d", DISTRO, "-u", "root", "--", ...args
  ], { encoding: "utf8", windowsHide: true, timeout: 120_000 });
}

async function writeGuest(destination, content) {
  await new Promise((resolve, reject) => {
    const child = spawn("wsl.exe", [
      "-d", DISTRO, "-u", "root", "--", "/usr/bin/tee", destination
    ], { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0
      ? resolve()
      : reject(new Error(`unit write failed (${code}): ${stderr.trim()}`)));
    child.stdin.end(content);
  });
}

await guest("/usr/bin/install", "-d", "-m", "0700", "-o", "svc-b", "-g", "svc-b", "/var/lib/runtime-c");
await writeGuest("/etc/systemd/system/runtime-c.service", unit);
await guest("/bin/chmod", "0644", "/etc/systemd/system/runtime-c.service");
await guest("/usr/bin/systemctl", "daemon-reload");
await guest("/usr/bin/systemctl", "enable", "--now", "runtime-c.service");

const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
  try {
    const response = await fetch("http://127.0.0.1:8082/health", {
      signal: AbortSignal.timeout(2000)
    });
    if (response.ok) {
      console.log(JSON.stringify({ service: "runtime-c", port: 8082, status: await response.json() }));
      process.exit(0);
    }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 500));
}
throw new Error("runtime C did not become healthy");
