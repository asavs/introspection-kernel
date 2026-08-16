import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SOURCE_DISTRO = "Ubuntu";
const TARGET_DISTRO = "IntrospectionKernel";
const SOURCE = "/root/src/llama.cpp/build/bin/llama-server";
const STAGED = "/opt/runtime/bin/llama-server.next";
const TARGET = "/opt/runtime/bin/llama-server";

function wslArgs(distro, ...args) {
  return ["-d", distro, "-u", "root", "--", ...args];
}

async function transferBinary() {
  await new Promise((resolve, reject) => {
    const source = spawn("wsl.exe", wslArgs(SOURCE_DISTRO, "/bin/cat", SOURCE), {
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true
    });
    const target = spawn("wsl.exe", wslArgs(TARGET_DISTRO, "/usr/bin/tee", STAGED), {
      stdio: ["pipe", "ignore", "pipe"], windowsHide: true
    });
    let sourceError = "";
    let targetError = "";
    source.stderr.setEncoding("utf8");
    target.stderr.setEncoding("utf8");
    source.stderr.on("data", chunk => { sourceError += chunk; });
    target.stderr.on("data", chunk => { targetError += chunk; });
    source.on("error", reject);
    target.on("error", reject);
    source.stdout.pipe(target.stdin);
    let sourceCode;
    let targetCode;
    const finish = () => {
      if (sourceCode == null || targetCode == null) return;
      if (sourceCode === 0 && targetCode === 0) resolve();
      else reject(new Error(
        `binary transfer failed source=${sourceCode} target=${targetCode}: `
        + `${sourceError.trim()} ${targetError.trim()}`
      ));
    };
    source.on("close", code => { sourceCode = code; finish(); });
    target.on("close", code => { targetCode = code; finish(); });
  });
}

async function target(...args) {
  return execFileAsync("wsl.exe", wslArgs(TARGET_DISTRO, ...args), {
    encoding: "utf8", windowsHide: true, timeout: 120_000
  });
}

async function writeTarget(path, content) {
  await new Promise((resolve, reject) => {
    const child = spawn("wsl.exe", wslArgs(TARGET_DISTRO, "/usr/bin/tee", path), {
      stdio: ["pipe", "ignore", "pipe"], windowsHide: true
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0
      ? resolve()
      : reject(new Error(`guest write failed (${code}): ${stderr.trim()}`)));
    child.stdin.end(content);
  });
}

await transferBinary();
await target("/bin/chmod", "0755", STAGED);
const sourceHash = (await execFileAsync(
  "wsl.exe", wslArgs(SOURCE_DISTRO, "/usr/bin/sha256sum", SOURCE),
  { encoding: "utf8", windowsHide: true }
)).stdout.trim().split(/\s+/)[0];
const stagedHash = (await target("/usr/bin/sha256sum", STAGED)).stdout.trim().split(/\s+/)[0];
if (sourceHash !== stagedHash) {
  throw new Error(`binary hash mismatch source=${sourceHash} staged=${stagedHash}`);
}

const activationOverride = "[Service]\nEnvironment=IK_ACTIVATION_LAYERS=0,18,35\n";
await target("/usr/bin/install", "-d", "-m", "0700", "-o", "svc-a", "-g", "svc-a", "/var/lib/runtime-a/slots");
for (const service of ["runtime-a", "runtime-b"]) {
  const directory = `/etc/systemd/system/${service}.service.d`;
  await target("/usr/bin/install", "-d", "-m", "0755", directory);
  await writeTarget(`${directory}/activation.conf`, activationOverride);
}
await target("/usr/bin/systemctl", "daemon-reload");

await target("/usr/bin/systemctl", "stop", "runtime-a.service", "runtime-b.service");
try {
  await target("/bin/mv", "-f", STAGED, TARGET);
  await target("/usr/bin/systemctl", "start", "runtime-a.service", "runtime-b.service");
} catch (error) {
  await target("/usr/bin/systemctl", "start", "runtime-a.service", "runtime-b.service").catch(() => {});
  throw error;
}

console.log(JSON.stringify({ source: SOURCE, target: TARGET, sha256: sourceHash }));
