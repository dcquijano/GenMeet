import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";

describe("/api/tunnel route contract", () => {
  it("reports idle state and canManage=true for direct localhost GET", async () => {
    const req = new Request("http://localhost:3000/api/tunnel", {
      method: "GET",
      headers: { host: "localhost:3000" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      status: "idle",
      publicUrl: null,
      error: null,
      canManage: true,
    });
  });

  it("reports canManage=false for remote or Cloudflare-proxied GET", async () => {
    const req = new Request("https://demo.trycloudflare.com/api/tunnel", {
      method: "GET",
      headers: {
        host: "localhost:3000",
        "cf-ray": "9123456789abcdef-SIN",
      },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.canManage).toBe(false);
  });

  it("rejects remote, proxied, or cross-site CSRF POST requests with 403", async () => {
    const crossSiteReq = new Request("http://localhost:3000/api/tunnel", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        "content-type": "application/json",
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ action: "start" }),
    });
    const crossSiteRes = await POST(crossSiteReq);
    expect(crossSiteRes.status).toBe(403);

    const proxiedReq = new Request("http://localhost:3000/api/tunnel", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        "content-type": "application/json",
        "cf-ray": "abc123",
      },
      body: JSON.stringify({ action: "start" }),
    });
    const proxiedRes = await POST(proxiedReq);
    expect(proxiedRes.status).toBe(403);
  });

  it("validates JSON syntax and action enum on local POST requests", async () => {
    const badJsonReq = new Request("http://localhost:3000/api/tunnel", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "sec-fetch-site": "same-origin",
      },
      body: "{not-json",
    });
    expect((await POST(badJsonReq)).status).toBe(400);

    const badActionReq = new Request("http://localhost:3000/api/tunnel", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ action: "restart" }),
    });
    expect((await POST(badActionReq)).status).toBe(400);
  });

  it("handles idempotent stop on local POST requests", async () => {
    const req = new Request("http://localhost:3000/api/tunnel", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ action: "stop" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      status: "idle",
      publicUrl: null,
      error: null,
      canManage: true,
    });
  });
});
