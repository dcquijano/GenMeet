import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type TunnelStatus = "idle" | "downloading" | "starting" | "running" | "error";

export interface TunnelState {
  status: TunnelStatus;
  publicUrl: string | null;
  error: string | null;
}

const TRY_CLOUDFLARE_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i;
const MAX_REDIRECTS = 5;
const MIN_BINARY_BYTES = 1_000_000;
const MAX_BINARY_BYTES = 120_000_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const STARTUP_TIMEOUT_MS = 25_000;

const CLOUDFLARED_DOWNLOAD_URLS: Record<string, string> = {
  "win32:x64":
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
  "win32:ia32":
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-386.exe",
  "linux:x64":
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
  "linux:arm64":
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64",
};

const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "releases.githubusercontent.com",
]);

export interface HeaderLookup {
  get(name: string): string | null;
}

/** Extract a strictly validated Cloudflare Quick Tunnel HTTPS URL from log output. */
export function extractTunnelUrl(text: string): string | null {
  const match = text.match(TRY_CLOUDFLARE_REGEX);
  if (!match) return null;
  const candidate = match[0].toLowerCase();
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".trycloudflare.com")) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function extractHostName(hostHeader: string): string {
  const trimmed = hostHeader.trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end !== -1 ? trimmed.slice(1, end) : trimmed;
  }
  return trimmed.split(":")[0] ?? "";
}

/**
 * Determine whether an incoming HTTP request originates directly from the local host PC
 * (and NOT through a reverse proxy / Cloudflare Tunnel).
 */
export function isLocalHostRequest(headers: HeaderLookup): boolean {
  if (
    headers.get("cf-ray") ||
    headers.get("cf-connecting-ip") ||
    headers.get("x-forwarded-for") ||
    headers.get("x-forwarded-host") ||
    headers.get("forwarded")
  ) {
    return false;
  }

  const hostHeader = (headers.get("host") ?? "").trim().toLowerCase();
  if (!hostHeader) return false;

  const hostname = extractHostName(hostHeader);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/**
 * Stricter authorization + CSRF check for state-changing tunnel requests (POST /api/tunnel).
 * Blocks cross-site requests from other browser tabs (e.g. mode: "no-cors" text/plain CSRF).
 */
export function isAllowedLocalMutationRequest(headers: HeaderLookup): boolean {
  if (!isLocalHostRequest(headers)) {
    return false;
  }

  const contentType = (headers.get("content-type") ?? "").trim().toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return false;
  }

  const secFetchSite = (headers.get("sec-fetch-site") ?? "").trim().toLowerCase();
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    return false;
  }

  const origin = (headers.get("origin") ?? "").trim();
  if (origin) {
    const hostHeader = (headers.get("host") ?? "").trim().toLowerCase();
    try {
      const parsedOrigin = new URL(origin);
      if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") {
        return false;
      }
      if (parsedOrigin.host.toLowerCase() !== hostHeader) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

/** Validate a download URL target (HTTPS + allowlisted GitHub release host). */
export function isAllowedDownloadUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:" && ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function findExistingCloudflared(baseDir: string): string | null {
  const binName = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const localBin = path.join(baseDir, "bin", binName);
  if (fs.existsSync(localBin)) return localBin;

  if (process.platform === "win32") {
    const commonPaths = [
      "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
      "C:\\Program Files\\cloudflared\\cloudflared.exe",
    ];
    for (const p of commonPaths) {
      if (fs.existsSync(p)) return p;
    }
  }

  const pathDirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, binName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function fetchAllowlistedBinary(
  initialUrl: string,
  signal: AbortSignal
): Promise<Response> {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedDownloadUrl(currentUrl)) {
      throw new Error("Blocked untrusted download host.");
    }

    const res = await fetch(currentUrl, {
      redirect: "manual",
      signal,
      headers: { "User-Agent": "GenMeet-Tunnel/0.1.6" },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        throw new Error("Download redirect missing Location header.");
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return res;
  }

  throw new Error("Too many redirects while downloading cloudflared.");
}

async function downloadCloudflared(
  baseDir: string,
  signal: AbortSignal
): Promise<string> {
  const key = `${process.platform}:${process.arch}`;
  const url = CLOUDFLARED_DOWNLOAD_URLS[key];
  if (!url) {
    throw new Error(
      `Automatic cloudflared download is not configured for ${key}. Install cloudflared manually.`
    );
  }

  const binDir = path.join(baseDir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const binName = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const destPath = path.join(binDir, binName);
  const tmpPath = `${destPath}.download`;

  try {
    const res = await fetchAllowlistedBinary(url, signal);
    if (!res.ok) {
      throw new Error(`Failed to download cloudflared (HTTP ${res.status}).`);
    }

    const contentLengthHeader = res.headers.get("content-length");
    if (contentLengthHeader) {
      const declaredSize = Number.parseInt(contentLengthHeader, 10);
      if (Number.isFinite(declaredSize) && declaredSize > MAX_BINARY_BYTES) {
        throw new Error("Downloaded cloudflared binary exceeded maximum expected size.");
      }
    }

    const arrayBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    if (buf.length < MIN_BINARY_BYTES || buf.length > MAX_BINARY_BYTES) {
      throw new Error("Downloaded cloudflared binary size check failed.");
    }
    if (process.platform === "win32" && (buf[0] !== 0x4d || buf[1] !== 0x5a)) {
      throw new Error("Downloaded cloudflared binary failed Windows PE header check.");
    }

    fs.writeFileSync(tmpPath, buf, { mode: 0o755 });
    fs.renameSync(tmpPath, destPath);
    return destPath;
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // Ignore temp cleanup failure
    }
    throw err;
  }
}

export class TunnelManager {
  private child: ChildProcess | null = null;
  private downloadController: AbortController | null = null;
  private generation = 0;
  private state: TunnelState = {
    status: "idle",
    publicUrl: null,
    error: null,
  };
  private startPromise: Promise<TunnelState> | null = null;

  getState(): TunnelState {
    return { ...this.state };
  }

  /**
   * Kick off tunnel startup in the background so API callers receive an immediate 202
   * and can poll GET /api/tunnel for live downloading -> starting -> running transitions.
   */
  startAsync(port: number, baseDir: string = process.cwd()): TunnelState {
    if (this.state.status === "running" && this.state.publicUrl) {
      return this.getState();
    }
    if (this.startPromise) {
      return this.getState();
    }

    const existingBin = findExistingCloudflared(baseDir);
    const gen = ++this.generation;
    this.state = {
      status: existingBin ? "starting" : "downloading",
      publicUrl: null,
      error: null,
    };

    const run = this.startInternal(port, baseDir, existingBin, gen).finally(() => {
      if (this.generation === gen) {
        this.startPromise = null;
      }
    });
    this.startPromise = run;
    // Prevent unhandled rejection; startInternal always resolves to TunnelState
    void run;
    return this.getState();
  }

  async start(port: number, baseDir: string = process.cwd()): Promise<TunnelState> {
    this.startAsync(port, baseDir);
    if (this.startPromise) {
      return this.startPromise;
    }
    return this.getState();
  }

  private async startInternal(
    port: number,
    baseDir: string,
    existingBin: string | null,
    gen: number
  ): Promise<TunnelState> {
    let binPath = existingBin;

    if (!binPath) {
      const controller = new AbortController();
      this.downloadController = controller;
      const dlTimeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

      try {
        binPath = await downloadCloudflared(baseDir, controller.signal);
      } catch (err) {
        if (this.generation !== gen) {
          return this.getState();
        }
        const message =
          err instanceof Error && err.name === "AbortError"
            ? "Timed out downloading cloudflared. Check your internet connection and retry."
            : err instanceof Error
            ? err.message
            : "Failed to download cloudflared.";
        this.state = {
          status: "error",
          publicUrl: null,
          error: message,
        };
        return this.getState();
      } finally {
        clearTimeout(dlTimeout);
        if (this.downloadController === controller) {
          this.downloadController = null;
        }
      }
    }

    if (this.generation !== gen) {
      return this.getState();
    }

    this.state = { status: "starting", publicUrl: null, error: null };

    return new Promise<TunnelState>((resolve) => {
      let settled = false;
      let logTail = "";

      const finish = (nextState: TunnelState) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.generation === gen) {
          this.state = nextState;
        }
        resolve(this.getState());
      };

      const targetUrl = `http://127.0.0.1:${port}`;
      const child = spawn(binPath!, ["tunnel", "--url", targetUrl, "--no-autoupdate"], {
        cwd: baseDir,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.child = child;

      const handleChunk = (chunk: Buffer) => {
        if (this.generation !== gen) return;
        logTail = (logTail + chunk.toString("utf8")).slice(-4096);
        const found = extractTunnelUrl(logTail);
        if (found) {
          finish({ status: "running", publicUrl: found, error: null });
        }
      };

      child.stdout?.on("data", handleChunk);
      child.stderr?.on("data", handleChunk);

      child.on("error", (err) => {
        if (this.child === child) {
          this.child = null;
        }
        finish({
          status: "error",
          publicUrl: null,
          error: `Could not start cloudflared: ${err.message}`,
        });
      });

      child.on("exit", (code) => {
        if (this.child === child) {
          this.child = null;
        }
        if (this.generation !== gen) {
          finish(this.getState());
          return;
        }
        if (!settled) {
          finish({
            status: "error",
            publicUrl: null,
            error: `cloudflared exited before tunnel became ready (code ${code ?? "unknown"}). Check internet connection.`,
          });
        } else if (this.state.status === "running") {
          this.state = {
            status: "idle",
            publicUrl: null,
            error: null,
          };
        }
      });

      const timer = setTimeout(() => {
        if (this.generation !== gen) {
          finish(this.getState());
          return;
        }
        if (this.child === child) {
          try {
            child.kill();
          } catch {
            // Ignore kill error
          }
          this.child = null;
        }
        finish({
          status: "error",
          publicUrl: null,
          error: "Timed out waiting for Cloudflare HTTPS URL. Check your internet connection and retry.",
        });
      }, STARTUP_TIMEOUT_MS);
    });
  }

  stop(): TunnelState {
    this.generation += 1;
    this.startPromise = null;

    if (this.downloadController) {
      try {
        this.downloadController.abort();
      } catch {
        // Ignore abort errors
      }
      this.downloadController = null;
    }

    if (this.child) {
      try {
        this.child.kill();
      } catch {
        // Ignore kill errors on already-exited child
      }
      this.child = null;
    }

    this.state = {
      status: "idle",
      publicUrl: null,
      error: null,
    };
    return this.getState();
  }
}

const globalForTunnel = globalThis as unknown as {
  __genmeetTunnelManager?: TunnelManager;
};

export function getTunnelManager(): TunnelManager {
  if (!globalForTunnel.__genmeetTunnelManager) {
    globalForTunnel.__genmeetTunnelManager = new TunnelManager();
  }
  return globalForTunnel.__genmeetTunnelManager;
}
