import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const configPath = path.join(rootDir, "genmeet.instance.json");

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen(port, "0.0.0.0", () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort = 3000) {
  for (let p = startPort; p < startPort + 50; p += 1) {
    if (await isPortAvailable(p)) return p;
  }
  return startPort;
}

function detectLanIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === "IPv4" && !entry.internal) {
        ips.push(entry.address);
      }
    }
  }
  return Array.from(new Set(ips));
}

async function main() {
  let existing = null;
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch {
      existing = null;
    }
  }

  const forceReset = process.argv.includes("--reset");
  const port =
    !forceReset && existing?.port
      ? existing.port
      : await findAvailablePort(3000);

  const config = {
    instanceId: !forceReset && existing?.instanceId ? existing.instanceId : crypto.randomUUID(),
    virtualIp:
      !forceReset && existing?.virtualIp
        ? existing.virtualIp
        : `100.64.${crypto.randomInt(1, 255)}.${crypto.randomInt(2, 254)}`,
    port,
    createdAt: !forceReset && existing?.createdAt ? existing.createdAt : new Date().toISOString(),
  };

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const lanIps = detectLanIps();
  console.log("========================================");
  console.log(" GenMeet Instance Configured");
  console.log("========================================");
  console.log(` Instance ID   : ${config.instanceId}`);
  console.log(` Virtual Peer  : ${config.virtualIp} (unique per install)`);
  console.log(` Local URL     : http://localhost:${config.port}`);
  if (lanIps.length > 0) {
    for (const ip of lanIps) {
      console.log(` LAN Join URL  : http://${ip}:${config.port}`);
    }
  } else {
    console.log(" LAN Join URL  : (no external IPv4 interface detected)");
  }
  console.log("========================================");
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
