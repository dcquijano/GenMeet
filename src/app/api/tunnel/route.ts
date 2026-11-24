import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_INSTANCE_CONFIG_PATH, getInstanceNetworkInfo } from "@/lib/instance-info";
import {
  getTunnelManager,
  isAllowedLocalMutationRequest,
  isLocalHostRequest,
} from "@/server/tunnel";

export const dynamic = "force-dynamic";

const tunnelActionSchema = z.object({
  action: z.enum(["start", "stop"]),
});

export async function GET(request: Request) {
  const manager = getTunnelManager();
  const canManage = isLocalHostRequest(request.headers);
  const state = manager.getState();

  return NextResponse.json({
    status: state.status,
    publicUrl: state.publicUrl,
    error: canManage ? state.error : null,
    canManage,
  });
}

export async function POST(request: Request) {
  if (!isAllowedLocalMutationRequest(request.headers)) {
    return NextResponse.json(
      {
        code: "FORBIDDEN",
        message: "Only the local host PC browser tab can start or stop the public HTTPS tunnel.",
      },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "INVALID_JSON", message: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const parsed = tunnelActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "VALIDATION_ERROR", message: "Action must be 'start' or 'stop'." },
      { status: 400 }
    );
  }

  const manager = getTunnelManager();

  if (parsed.data.action === "stop") {
    return NextResponse.json({
      ...manager.stop(),
      canManage: true,
    });
  }

  const envPort = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : undefined;
  const info = getInstanceNetworkInfo(
    DEFAULT_INSTANCE_CONFIG_PATH,
    Number.isFinite(envPort) ? envPort : undefined
  );

  const state = manager.startAsync(info.port);
  const statusCode = state.status === "running" ? 200 : 202;
  return NextResponse.json(
    {
      ...state,
      canManage: true,
    },
    { status: statusCode }
  );
}
