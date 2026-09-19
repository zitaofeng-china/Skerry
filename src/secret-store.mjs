import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { dataDir } from "./paths.mjs";

const SERVICE = "Skerry";

function secretsDir(env = process.env) {
  if (env.MULTI_AGENT_SECRETS) return env.MULTI_AGENT_SECRETS;
  return path.join(dataDir(env), "secrets");
}

function safeName(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function accountOf(id) {
  return `skerry.${safeName(id)}`;
}

function dpapiFile(id, env) {
  return path.join(secretsDir(env), `${safeName(id)}.dpapi`);
}

function fallbackFile(id, env) {
  return path.join(secretsDir(env), `${safeName(id)}.secret`);
}

function writeFallback(id, value, env) {
  const dir = secretsDir(env);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fallbackFile(id, env), String(value), { encoding: "utf8", mode: 0o600 });
}

function saveWindows(id, value, env) {
  const dir = secretsDir(env);
  fs.mkdirSync(dir, { recursive: true });
  const output = execFileSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    "Add-Type -AssemblyName System.Security; $plain=[Text.Encoding]::UTF8.GetBytes($env:MAC_SECRET); $protected=[Security.Cryptography.ProtectedData]::Protect($plain,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Convert]::ToBase64String($protected)",
  ], { env: { ...process.env, MAC_SECRET: String(value) }, encoding: "utf8" }).trim();
  fs.writeFileSync(dpapiFile(id, env), `${output}\n`, { encoding: "utf8", mode: 0o600 });
}

function loadWindows(id, env) {
  const file = dpapiFile(id, env);
  if (!fs.existsSync(file)) return null;
  try {
    return execFileSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "Add-Type -AssemblyName System.Security; $protected=[Convert]::FromBase64String($env:MAC_CIPHER); $plain=[Security.Cryptography.ProtectedData]::Unprotect($protected,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Text.Encoding]::UTF8.GetString($plain)",
    ], { env: { ...process.env, MAC_CIPHER: fs.readFileSync(file, "utf8").trim() }, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function useKeychain(env = process.env) {
  return process.platform === "darwin" && !env.MULTI_AGENT_SECRETS && !env.NODE_TEST_CONTEXT;
}

function saveDarwin(id, value) {
  execFileSync("security", [
    "add-generic-password", "-U", "-s", SERVICE, "-a", accountOf(id), "-w", String(value),
  ], { stdio: "pipe" });
}

function loadDarwin(id) {
  try {
    return execFileSync("security", [
      "find-generic-password", "-s", SERVICE, "-a", accountOf(id), "-w",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function deleteDarwin(id) {
  try {
    execFileSync("security", [
      "delete-generic-password", "-s", SERVICE, "-a", accountOf(id),
    ], { stdio: "pipe" });
  } catch { /* best effort */ }
}

export function saveSecret(id, value, env = process.env) {
  if (!String(value ?? "").trim()) throw new Error("secret value is required");
  if (process.platform === "win32") {
    saveWindows(id, value, env);
    return dpapiFile(id, env);
  }
  if (useKeychain(env)) {
    try {
      saveDarwin(id, value);
      return `keychain:${SERVICE}`;
    } catch {
      writeFallback(id, value, env);
      return fallbackFile(id, env);
    }
  }
  writeFallback(id, value, env);
  return fallbackFile(id, env);
}

export function loadSecret(id, env = process.env) {
  if (process.platform === "win32") return loadWindows(id, env);
  if (useKeychain(env)) {
    const fromKeychain = loadDarwin(id);
    if (fromKeychain) return fromKeychain;
  }
  const file = fallbackFile(id, env);
  if (!fs.existsSync(file)) return null;
  try { return fs.readFileSync(file, "utf8"); } catch { return null; }
}

export function hasSecret(id, env = process.env) {
  if (useKeychain(env)) {
    if (loadDarwin(id)) return true;
  }
  if (process.platform === "win32" && fs.existsSync(dpapiFile(id, env))) return true;
  return fs.existsSync(fallbackFile(id, env));
}

export function deleteSecret(id, env = process.env) {
  if (useKeychain(env)) deleteDarwin(id);
  for (const file of [dpapiFile(id, env), fallbackFile(id, env)]) {
    try { fs.rmSync(file, { force: true }); } catch { /* best effort */ }
  }
}

export function secretBackend(env = process.env) {
  if (process.platform === "win32") return "dpapi";
  if (useKeychain(env)) return "keychain";
  return "file";
}
