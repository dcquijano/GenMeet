"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type PublicTunnelStatus = "idle" | "downloading" | "starting" | "running" | "error";

export interface PublicTunnelState {
  status: PublicTunnelStatus;
  publicUrl: string | null;
  error: string | null;
  canManage: boolean;
  isBusy: boolean;
  startTunnel: () => Promise<void>;
  stopTunnel: () => Promise<void>;
}

interface TunnelApiPayload {
  status?: PublicTunnelStatus;
  publicUrl?: string | null;
  error?: string | null;
  canManage?: boolean;
  message?: string;
}

const VALID_STATUSES = new Set<PublicTunnelStatus>([
  "idle",
  "downloading",
  "starting",
  "running",
  "error",
]);

export function usePublicTunnel(): PublicTunnelState {
  const [status, setStatus] = useState<PublicTunnelStatus>("idle");
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const mountedRef = useRef(true);

  const applyPayload = useCallback((data: TunnelApiPayload | null) => {
    if (!data || !mountedRef.current) return;
    if (data.status && VALID_STATUSES.has(data.status)) {
      setStatus(data.status);
    }
    if (typeof data.publicUrl === "string" || data.publicUrl === null) {
      setPublicUrl(data.publicUrl);
    }
    if (typeof data.error === "string" || data.error === null) {
      setError(data.error);
    }
    if (typeof data.canManage === "boolean") {
      setCanManage(data.canManage);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/tunnel", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as TunnelApiPayload;
      applyPayload(data);
    } catch {
      // Non-fatal metadata poll failure
    }
  }, [applyPayload]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchStatus();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchStatus]);

  // Poll every second only while downloading or starting
  useEffect(() => {
    if (status !== "downloading" && status !== "starting") return;
    const timer = window.setInterval(() => {
      void fetchStatus();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status, fetchStatus]);

  const startTunnel = useCallback(async () => {
    setError(null);
    setStatus("starting");
    try {
      const res = await fetch("/api/tunnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const data = (await res.json().catch(() => null)) as TunnelApiPayload | null;
      if (!res.ok) {
        if (mountedRef.current) {
          setStatus("error");
          setError(data?.message ?? data?.error ?? "Could not start public HTTPS tunnel.");
        }
        return;
      }
      applyPayload(data);
    } catch {
      if (mountedRef.current) {
        setStatus("error");
        setError("Could not reach local GenMeet server to start tunnel.");
      }
    }
  }, [applyPayload]);

  const stopTunnel = useCallback(async () => {
    try {
      const res = await fetch("/api/tunnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const data = (await res.json().catch(() => null)) as TunnelApiPayload | null;
      if (res.ok && data) {
        applyPayload(data);
      } else if (mountedRef.current) {
        setError(data?.message ?? "Could not stop public HTTPS tunnel.");
      }
    } catch {
      if (mountedRef.current) {
        setError("Could not reach local GenMeet server to stop tunnel.");
      }
    }
  }, [applyPayload]);

  return {
    status,
    publicUrl,
    error,
    canManage,
    isBusy: status === "downloading" || status === "starting",
    startTunnel,
    stopTunnel,
  };
}
