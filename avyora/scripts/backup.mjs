#!/usr/bin/env node
/**
 * Cross-platform backup helper for local/dev machines.
 * Prefers pg_dump when available; always copies data/*.json when present.
 *
 * Usage: node scripts/backup.mjs
 * Env: DATABASE_URL, BACKUP_DIR, KEEP_DAYS, DATA_DIR
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(root, "backups"));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
const keepDays = Number(process.env.KEEP_DAYS || 14);
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const staging = path.join(backupDir, `avyora-${stamp}`);

fs.mkdirSync(staging, { recursive: true });

function parseDatabaseUrl(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port || "5432",
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, "").split("?")[0],
    };
  } catch {
    return null;
  }
}

const dbUrl = process.env.DATABASE_URL || "";
const parsed = dbUrl ? parseDatabaseUrl(dbUrl) : null;
const pgDump = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });

if (parsed && pgDump.status === 0) {
  const dumpPath = path.join(staging, "postgres.dump");
  console.log(`[backup] pg_dump → ${dumpPath}`);
  execFileSync(
    "pg_dump",
    [
      "-h",
      parsed.host,
      "-p",
      parsed.port,
      "-U",
      parsed.user,
      "-d",
      parsed.database,
      "--format=custom",
      `--file=${dumpPath}`,
    ],
    {
      env: { ...process.env, PGPASSWORD: parsed.password },
      stdio: "inherit",
    },
  );
} else {
  console.warn("[backup] skipping postgres dump (pg_dump missing or DATABASE_URL unset)");
}

const dataOut = path.join(staging, "data");
fs.mkdirSync(dataOut, { recursive: true });
for (const name of ["commerce.json", "smtp.json"]) {
  const src = path.join(dataDir, name);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(dataOut, name));
    console.log(`[backup] copied ${name}`);
  }
}

const manifest = {
  createdAt: new Date().toISOString(),
  databaseUrlHost: parsed?.host ?? null,
  files: fs.readdirSync(staging, { recursive: true }),
};
fs.writeFileSync(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2));

const archive = path.join(backupDir, `avyora-${stamp}.json`);
// Portable archive without requiring tar: write a simple directory marker + zip via tar if available
const tar = spawnSync("tar", ["--version"], { encoding: "utf8" });
if (tar.status === 0) {
  const tgz = path.join(backupDir, `avyora-${stamp}.tar.gz`);
  execFileSync("tar", ["-C", backupDir, "-czf", tgz, `avyora-${stamp}`], { stdio: "inherit" });
  fs.rmSync(staging, { recursive: true, force: true });
  console.log(`[backup] archive → ${tgz}`);
} else {
  fs.writeFileSync(archive, JSON.stringify(manifest, null, 2));
  console.log(`[backup] staging left at ${staging} (tar not available)`);
}

const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
for (const entry of fs.readdirSync(backupDir)) {
  if (!entry.startsWith("avyora-")) continue;
  const full = path.join(backupDir, entry);
  const stat = fs.statSync(full);
  if (stat.mtimeMs < cutoff) {
    fs.rmSync(full, { recursive: true, force: true });
    console.log(`[backup] pruned ${entry}`);
  }
}

console.log("[backup] complete");
