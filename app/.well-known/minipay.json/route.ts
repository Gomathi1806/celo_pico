import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";

export function GET() {
  const APP_URL = getAppUrl();
  return NextResponse.json({
    name: "pico",
    description: "Pennies of AI, settled inline. Pay a few cents of cUSD per AI call over x402.",
    iconUrl: `${APP_URL}/icon.png`,
    appUrl: APP_URL,
  });
}
