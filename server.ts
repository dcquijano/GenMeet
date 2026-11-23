import http from "node:http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { DEFAULT_INSTANCE_CONFIG_PATH, getInstanceNetworkInfo } from "./src/lib/instance-info";
import { createSignalingController } from "./src/server/signaling";

const isProd = process.argv.includes("--prod") || process.env.NODE_ENV === "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const envPort = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : undefined;
const instanceInfo = getInstanceNetworkInfo(
  DEFAULT_INSTANCE_CONFIG_PATH,
  Number.isFinite(envPort) ? envPort : undefined
);
const port = instanceInfo.port;

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
    io.close(() => {
      httpServer.close(() => {
        process.exit(0);
      });
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Failed to start GenMeet server:", err);
  process.exit(1);
});
