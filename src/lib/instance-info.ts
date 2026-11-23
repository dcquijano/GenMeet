import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface InstanceConfig {
  instanceId: string;
  virtualIp: string;
  port: number;
  createdAt: string;
}

export interface InstanceNetworkInfo extends InstanceConfig {
  localUrl: string;
  lanIps: string[];
  lanUrls: string[];
}

export const DEFAULT_INSTANCE_CONFIG_PATH = path.join(
  process.cwd(),
  "genmeet.instance.json"
);

/**
 * Generate a unique non-routable CGNAT-range overlay identifier (100.64.x.y)
 * used to distinguish installations within GenMeet.
 */
export function generateVirtualIp(): string {
  const third = crypto.randomInt(1, 255);
  const fourth = crypto.randomInt(2, 254);
  return `100.64.${third}.${fourth}`;
}

/**
 * Load an existing per-install config from disk, or create one with a unique
 * instanceId and virtualIp if it does not yet exist.
 */
export function loadOrCreateInstanceConfig(
  configPath: string = DEFAULT_INSTANCE_CONFIG_PATH,
  preferredPort = 3000
): InstanceConfig {
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<InstanceConfig>;
      if (
        typeof parsed.instanceId === "string" &&
        parsed.instanceId.length > 0 &&
        typeof parsed.virtualIp === "string" &&
        parsed.virtualIp.length > 0 &&
        typeof parsed.port === "number" &&
        parsed.port >= 1024 &&
        parsed.port <= 65535
      ) {
        return {
          instanceId: parsed.instanceId,
          virtualIp: parsed.virtualIp,
          port: parsed.port,
          createdAt:
            typeof parsed.createdAt === "string"
              ? parsed.createdAt
              : new Date().toISOString(),
        };
      }
    }
  } catch {
    // Regenerate a clean config if the file is unreadable or corrupt
  }

  const config: InstanceConfig = {
    instanceId: crypto.randomUUID(),
    virtualIp: generateVirtualIp(),
    port: preferredPort,
    createdAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  } catch {
    // Allow running in read-only environments with in-memory config
  }

  return config;
}

/** Detect non-internal IPv4 LAN addresses assigned to this host by the OS/router. */
export function detectLanIpv4Addresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];

  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }

  return Array.from(new Set(addresses));
}

export function getInstanceNetworkInfo(
  configPath: string = DEFAULT_INSTANCE_CONFIG_PATH,
  portOverride?: number
): InstanceNetworkInfo {
  const config = loadOrCreateInstanceConfig(configPath);
  const activePort = portOverride ?? config.port;
  const lanIps = detectLanIpv4Addresses();

  return {
    ...config,
    port: activePort,
    localUrl: `http://localhost:${activePort}`,
    lanIps,
    lanUrls: lanIps.map((ip) => `http://${ip}:${activePort}`),
  };
}
