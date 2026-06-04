import "./env-init";
import { createFacilitatorConfig } from "@coinbase/x402";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { withX402 } from "@x402/next";
import { NextRequest, NextResponse } from "next/server";

// Celo mainnet: eip155:42220  |  Alfajores testnet: eip155:44787
const NETWORK_ALIAS: Record<string, "eip155:42220" | "eip155:44787"> = {
  celo: "eip155:42220",
  "eip155:42220": "eip155:42220",
  "celo-alfajores": "eip155:44787",
  alfajores: "eip155:44787",
  "eip155:44787": "eip155:44787",
};

export const DEFAULT_NETWORK = (
  NETWORK_ALIAS[
    (process.env.X402_NETWORK?.trim() || "celo-alfajores").toLowerCase()
  ] ?? "eip155:44787"
) as string;

export const IS_MAINNET =
  process.env.X402_NETWORK?.trim().toLowerCase() === "celo" ||
  process.env.X402_NETWORK?.trim() === "eip155:42220";

export const OPERATOR_ADDRESS = (
  process.env.OPERATOR_WALLET_ADDRESS?.trim() ||
  "0x0000000000000000000000000000000000000000"
) as `0x${string}`;

// The x402.org public facilitator supports all EVM chains that have a
// deployed USDC/cUSD with EIP-3009 transferWithAuthorization — which
// Celo's cUSD satisfies. CDP facilitator is also included as a fallback.
const facilitatorClients = [
  new HTTPFacilitatorClient({ url: "https://www.x402.org/facilitator" }),
  new HTTPFacilitatorClient(
    createFacilitatorConfig(
      process.env.CDP_API_KEY_ID,
      process.env.CDP_API_KEY_SECRET
    )
  ),
];

export const x402Server = new x402ResourceServer(facilitatorClients);

let initialized = false;

export async function ensureAllX402Ready() {
  if (initialized) return;

  const currentKeyId = process.env.CDP_API_KEY_ID || process.env.cdp_api_key_id;
  if (currentKeyId) process.env.CDP_API_KEY_ID = currentKeyId.trim();
  const currentKeySecret =
    process.env.CDP_API_KEY_SECRET || process.env.cdp_api_key_secret;
  if (currentKeySecret)
    process.env.CDP_API_KEY_SECRET = currentKeySecret.trim().replace(/\\n/g, "\n");

  const networks: string[] = ["eip155:42220", "eip155:44787"];

  for (const net of networks) {
    try {
      x402Server.register(net as any, new ExactEvmScheme());
    } catch (error: any) {
      console.error(`[pico-celo] Failed to register ${net}:`, error);
    }
  }

  try {
    await x402Server.initialize();
    initialized = true;
    console.log("[pico-celo] x402 ready for Celo networks");
  } catch (error: any) {
    console.error("[pico-celo] x402 initialization failed:", error);
  }
}

export function createCeloHandler<T = unknown>(
  handler: (req: NextRequest) => Promise<NextResponse<T>>,
  price: string,
  description: string
) {
  return async function POST(req: NextRequest) {
    try {
      await ensureAllX402Ready();

      const requestedNet =
        req.headers.get("x-x402-network") ||
        req.headers.get("X-X402-Network") ||
        DEFAULT_NETWORK;
      const targetNetwork = (
        NETWORK_ALIAS[requestedNet.trim().toLowerCase()] ?? DEFAULT_NETWORK
      ) as any;

      if (!x402Server.hasRegisteredScheme(targetNetwork, "exact")) {
        return NextResponse.json(
          { error: `Network ${targetNetwork} not registered.` },
          { status: 500 }
        );
      }

      const supportedKind = x402Server.getSupportedKind(2, targetNetwork, "exact");
      if (!supportedKind) {
        return NextResponse.json(
          { error: `Facilitator not ready for ${targetNetwork}.` },
          { status: 500 }
        );
      }

      const accepts = [
        {
          scheme: "exact" as const,
          price,
          network: targetNetwork,
          payTo: OPERATOR_ADDRESS,
        },
      ];

      const wrapped = withX402(
        handler,
        { accepts, description },
        x402Server,
        undefined,
        undefined,
        false
      );

      return await wrapped(req);
    } catch (error: any) {
      console.error("[pico-celo] handler failed:", error);
      return NextResponse.json(
        { error: `Internal Server Error: ${error.message || "Unknown error"}` },
        { status: 500 }
      );
    }
  };
}
