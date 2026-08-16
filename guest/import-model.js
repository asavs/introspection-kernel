import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DISTRO = "IntrospectionKernel";
const source = path.resolve(process.argv[2] ?? "");
const expectedSha256 = (process.argv[3] ?? "").toLowerCase();
if (!fs.statSync(source).isFile()) throw new Error("model source is not a file");
if (!/^[0-9a-f]{64}$/.test(expectedSha256)) throw new Error("expected SHA-256 is required");
const filename = path.basename(source);
if (!/^[A-Za-z0-9._-]+\.gguf$/.test(filename)) throw new Error("unsafe GGUF filename");
const staged = `/opt/runtime/models/${filename}.next`;
const target = `/opt/runtime/models/${filename}`;

const localHash = await new Promise((resolve, reject) => {
  const hash = createHash("sha256");
  const stream = fs.createReadStream(source);
  stream.on("data", chunk => hash.update(chunk));
  stream.on("error", reject);
  stream.on("end", () => resolve(hash.digest("hex")));
});
if (localHash !== expectedSha256) throw new Error(`local hash mismatch: ${localHash}`);

await new Promise((resolve, reject) => {
  const input = fs.createReadStream(source);
  const output = spawn("wsl.exe", [
    "-d", DISTRO, "-u", "root", "--", "/usr/bin/tee", staged
  ], { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  let stderr = "";
  output.stderr.setEncoding("utf8");
  output.stderr.on("data", chunk => { stderr += chunk; });
  input.on("error", reject);
  output.on("error", reject);
  input.pipe(output.stdin);
  output.on("close", code => code === 0
    ? resolve()
    : reject(new Error(`model transfer failed (${code}): ${stderr.trim()}`)));
});

const guest = (...args) => execFileAsync("wsl.exe", [
  "-d", DISTRO, "-u", "root", "--", ...args
], { encoding: "utf8", windowsHide: true, timeout: 120_000 });
const remoteHash = (await guest("/usr/bin/sha256sum", staged)).stdout.trim().split(/\s+/)[0];
if (remoteHash !== expectedSha256) throw new Error(`guest hash mismatch: ${remoteHash}`);
await guest("/bin/chmod", "0444", staged);
await guest("/bin/mv", "-f", staged, target);
console.log(JSON.stringify({ source, target, bytes: fs.statSync(source).size, sha256: remoteHash }));
