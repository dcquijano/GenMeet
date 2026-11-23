import { NextResponse } from "next/server";
import { DEFAULT_INSTANCE_CONFIG_PATH, getInstanceNetworkInfo } from "@/lib/instance-info";

export const dynamic = "force-dynamic";

export async function GET() {
  const envPort = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : undefined;
  const info = getInstanceNetworkInfo(
    DEFAULT_INSTANCE_CONFIG_PATH,
    Number.isFinite(envPort) ? envPort : undefined
  );

  return NextResponse.json({
    instanceId: info.instanceId,
    virtualIp: info.virtualIp,
    port: info.port,
    localUrl: info.localUrl,
    lanUrls: info.lanUrls,
  });
}
