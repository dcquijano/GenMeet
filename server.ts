import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { DEFAULT_INSTANCE_CONFIG_PATH, getInstanceNetworkInfo } from "./src/lib/instance-info";
import { createSignalingController } from "./src/server/signaling";
import { getTunnelManager } from "./src/server/tunnel";

const isProd = process.argv.includes("--prod") || process.env.NODE_ENV === "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const envPort = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : undefined;
const instanceInfo = getInstanceNetworkInfo(
  DEFAULT_INSTANCE_CONFIG_PATH,
  Number.isFinite(envPort) ? envPort : undefined
);
const port = instanceInfo.port;
const pidFilePath = path.join(process.cwd(), "logs", "server.pid");

function writePidFile() {
  try {
    fs.mkdirSync(path.dirname(pidFilePath), { recursive: true });
    fs.writeFileSync(pidFilePath, `${process.pid}\n`, "utf8");
  } catch {
    // Non-fatal in read-only environments
  }
}

function removePidFile() {
  try {
    if (fs.existsSync(pidFilePath)) {
      const stored = fs.readFileSync(pidFilePath, "utf8").trim();
      if (stored === String(process.pid)) {
        fs.unlinkSync(pidFilePath);
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

async function main() {
  const app = next({ dev: !isProd, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();

  const httpServer = http.createServer((req, res) => {
    handle(req, res);
  });

  const io = new SocketIOServer(httpServer, {
    path: "/socket.io",
    maxHttpBufferSize: 256 * 1024,
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });

  const signaling = createSignalingController();
  signaling.attach(io);

  httpServer.listen(port, hostname, () => {
    writePidFile();
    const liveInfo = getInstanceNetworkInfo(DEFAULT_INSTANCE_CONFIG_PATH, port);
    console.log(`GenMeet ready (${isProd ? "production" : "development"})`);
    console.log(`  Local URL   : ${liveInfo.localUrl}`);
    for (const url of liveInfo.lanUrls) {
      console.log(`  LAN URL     : ${url}`);
    }
    console.log(`  Install ID  : ${liveInfo.instanceId}`);
    console.log(`  Virtual IP  : ${liveInfo.virtualIp}`);
  });

  const shutdown = () => {
    getTunnelManager().stop();
    removePidFile();
    io.close(() => {
      httpServer.close(() => {
        process.exit(0);
      });
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("exit", () => {
    getTunnelManager().stop();
    removePidFile();
  });
}

main().catch((err) => {
  getTunnelManager().stop();
  removePidFile();
  console.error("Failed to start GenMeet server:", err);
  process.exit(1);
});
