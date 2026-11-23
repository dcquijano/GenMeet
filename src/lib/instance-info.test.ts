import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  generateVirtualIp,
  getInstanceNetworkInfo,
  loadOrCreateInstanceConfig,
} from "./instance-info";

describe("instance-info", () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    for (const file of tempFiles) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
    tempFiles.length = 0;
  });

  it("generates a valid 100.64.x.y overlay identifier", () => {
    const ip = generateVirtualIp();
    expect(ip).toMatch(/^100\.64\.\d{1,3}\.\d{1,3}$/);
  });

  it("creates and persists a unique per-install config", () => {
    const configPath = path.join(
      os.tmpdir(),
      `genmeet-instance-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );
    tempFiles.push(configPath);

    const first = loadOrCreateInstanceConfig(configPath, 3456);
    const second = loadOrCreateInstanceConfig(configPath, 4000);

    expect(first.instanceId).toBe(second.instanceId);
    expect(first.virtualIp).toBe(second.virtualIp);
    expect(second.port).toBe(3456);
  });

  it("returns localUrl and lanUrls matching the configured port", () => {
    const configPath = path.join(
      os.tmpdir(),
      `genmeet-net-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );
    tempFiles.push(configPath);

    const info = getInstanceNetworkInfo(configPath, 3123);
    expect(info.localUrl).toBe("http://localhost:3123");
    for (const url of info.lanUrls) {
      expect(url).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:3123$/);
    }
  });
});
