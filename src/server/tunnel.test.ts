import { describe, expect, it } from "vitest";
import {
  extractTunnelUrl,
  isAllowedDownloadUrl,
  isAllowedLocalMutationRequest,
  isLocalHostRequest,
  TunnelManager,
} from "./tunnel";

function makeHeaders(record: Record<string, string>): { get(name: string): string | null } {
  const lowered = Object.fromEntries(
    Object.entries(record).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    get(name: string) {
      return lowered[name.toLowerCase()] ?? null;
    },
  };
}

describe("tunnel helpers", () => {
  it("extracts valid Cloudflare quick tunnel HTTPS URLs from cloudflared logs", () => {
    const sampleLog = `
      2026-11-24T01:45:00Z INF +--------------------------------------------------------------------+
      2026-11-24T01:45:00Z INF |  https://ocean-breeze-cloud-123.trycloudflare.com                 |
      2026-11-24T01:45:00Z INF +--------------------------------------------------------------------+
    `;
    expect(extractTunnelUrl(sampleLog)).toBe("https://ocean-breeze-cloud-123.trycloudflare.com");
  });

  it("ignores non-trycloudflare or http URLs", () => {
    expect(extractTunnelUrl("http://evil.trycloudflare.com")).toBeNull();
    expect(extractTunnelUrl("https://example.com/trycloudflare.com")).toBeNull();
    expect(extractTunnelUrl("no url here")).toBeNull();
  });

  it("allows direct localhost requests and blocks remote or proxied callers", () => {
    expect(isLocalHostRequest(makeHeaders({ host: "localhost:3000" }))).toBe(true);
    expect(isLocalHostRequest(makeHeaders({ host: "127.0.0.1:3000" }))).toBe(true);
    expect(isLocalHostRequest(makeHeaders({ host: "[::1]:3000" }))).toBe(true);

    // LAN IP and public domains are remote
    expect(isLocalHostRequest(makeHeaders({ host: "192.168.8.171:3000" }))).toBe(false);
    expect(isLocalHostRequest(makeHeaders({ host: "demo-room.trycloudflare.com" }))).toBe(false);

    // Spoofed Host header coming through Cloudflare or reverse proxy must be rejected
    expect(
      isLocalHostRequest(makeHeaders({ host: "localhost:3000", "cf-ray": "abc123" }))
    ).toBe(false);
    expect(
      isLocalHostRequest(makeHeaders({ host: "localhost:3000", "x-forwarded-for": "1.2.3.4" }))
    ).toBe(false);
    expect(
      isLocalHostRequest(makeHeaders({ host: "localhost:3000", forwarded: "for=1.2.3.4" }))
    ).toBe(false);
  });

  it("enforces same-origin JSON CSRF protection on local mutation requests", () => {
    // Valid same-origin browser POST
    expect(
      isAllowedLocalMutationRequest(
        makeHeaders({
          host: "localhost:3000",
          "content-type": "application/json",
          origin: "http://localhost:3000",
          "sec-fetch-site": "same-origin",
        })
      )
    ).toBe(true);

    // Valid local CLI JSON POST without Origin
    expect(
      isAllowedLocalMutationRequest(
        makeHeaders({
          host: "127.0.0.1:3000",
          "content-type": "application/json; charset=utf-8",
        })
      )
    ).toBe(true);

    // Blocks cross-site no-cors text/plain CSRF
    expect(
      isAllowedLocalMutationRequest(
        makeHeaders({
          host: "localhost:3000",
          "content-type": "text/plain",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        })
      )
    ).toBe(false);

    // Blocks mismatched Origin even with application/json
    expect(
      isAllowedLocalMutationRequest(
        makeHeaders({
          host: "localhost:3000",
          "content-type": "application/json",
          origin: "https://evil.example",
        })
      )
    ).toBe(false);

    // Blocks cross-site Sec-Fetch-Site
    expect(
      isAllowedLocalMutationRequest(
        makeHeaders({
          host: "localhost:3000",
          "content-type": "application/json",
          "sec-fetch-site": "cross-site",
        })
      )
    ).toBe(false);
  });

  it("allowlists only HTTPS GitHub release download URLs", () => {
    expect(
      isAllowedDownloadUrl(
        "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
      )
    ).toBe(true);
    expect(
      isAllowedDownloadUrl("https://objects.githubusercontent.com/github-production-release-asset/123")
    ).toBe(true);
    expect(isAllowedDownloadUrl("http://github.com/cloudflare/cloudflared")).toBe(false);
    expect(isAllowedDownloadUrl("https://evil.example/cloudflared.exe")).toBe(false);
  });

  it("resets cleanly to idle on stop()", () => {
    const manager = new TunnelManager();
    expect(manager.getState()).toEqual({ status: "idle", publicUrl: null, error: null });
    expect(manager.stop()).toEqual({ status: "idle", publicUrl: null, error: null });
  });
});
