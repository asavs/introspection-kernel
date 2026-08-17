import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const runner = fs.readFileSync(path.join(moduleDir, "run_rule_given_factorial_v3.js"), "utf8");
const predictBody = runner.slice(runner.indexOf("async function predict"), runner.indexOf("function syntheticContext"));
const integrityBody = runner.slice(runner.indexOf("async function promptIntegrityGate"), runner.indexOf("function predictionPath"));

assert.ok(predictBody.indexOf("if (factors.calculator_available)")
  < predictBody.indexOf("if (factors.thinking_enabled)"), "calculator must precede thinking");
assert.match(predictBody, /content: calculation\.message\.content \?\? ""/,
  "calculator replay must normalize only nullish content to empty string");
assert.match(predictBody, /tools: \[calculatorTool\], toolChoice: "required"/);
assert.match(predictBody, /tools: null, toolChoice: null, thinking: true/);
assert.match(predictBody, /tools: \[recordTool\], toolChoice: "required"/);
assert.ok(integrityBody.indexOf("if (factors.calculator_available)")
  < integrityBody.indexOf("if (factors.thinking_enabled)"), "gate transcript must mirror stage order");
assert.doesNotMatch(runner, /sourceContext\.outcome.*initialMessages/s,
  "source outcomes must not enter model messages");

console.log("rule-given factorial V3 runner tests passed");
