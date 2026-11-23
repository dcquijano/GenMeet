import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GITHUB_REPO = "dcquijano/GenMeet";

interface VersionMetadata {
  version?: string;
  build?: string;
  directSetupUrl?: string;
  repoUrl?: string;
}

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

function readLocalVersion(): VersionMetadata {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "version.json"), "utf8");
    return JSON.parse(raw) as VersionMetadata;
  } catch {
    return { version: "0.1.2", build: "" };
  }
}

export async function GET() {
  const local = readLocalVersion();
  const currentVersion = local.version ?? "0.1.2";
  const currentBuild = local.build ?? "";
  const releaseUrl = `https://github.com/${GITHUB_REPO}/releases`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/${GITHUB_REPO}/main/version.json?t=${Date.now()}`,
      {
        signal: controller.signal,
        headers: { "User-Agent": `GenMeet/${currentVersion}` },
        cache: "no-store",
      }
    );

    if (!res.ok) {
      return NextResponse.json({
        currentVersion,
        currentBuild,
        latestVersion: currentVersion,
        latestBuild: currentBuild,
        updateAvailable: false,
        releaseUrl,
      });
    }

    const remote = (await res.json()) as VersionMetadata;
    const latestVersion = remote.version ?? currentVersion;
    const latestBuild = remote.build ?? "";
    const semCmp = compareSemver(latestVersion, currentVersion);
    const updateAvailable =
      semCmp > 0 || (semCmp === 0 && Boolean(latestBuild && currentBuild && latestBuild > currentBuild));

    return NextResponse.json({
      currentVersion,
      currentBuild,
      latestVersion,
      latestBuild,
      updateAvailable,
      releaseUrl,
      downloadUrl: remote.directSetupUrl ?? releaseUrl,
    });
  } catch {
    return NextResponse.json({
      currentVersion,
      currentBuild,
      latestVersion: currentVersion,
      latestBuild: currentBuild,
      updateAvailable: false,
      releaseUrl,
    });
  } finally {
    clearTimeout(timer);
  }
}
