import "./env-init";
import { NextRequest, NextResponse } from "next/server";
import { safeHandler } from "./safe-handler";
import { verifyPayment, parsePriceUsd, type SupportedNetwork, type SupportedToken } from "./payment";

const OPERATOR_ADDRESS = (
  process.env.OPERATOR_WALLET_ADDRESS?.trim() ||
  "0x0000000000000000000000000000000000000000"
) as `0x${string}`;

/**
 * Wraps a tool handler with:
 *   1. Payment verification — checks txHash is a valid cUSD transfer to operator
 *   2. Error handling via safeHandler
 *
 * Request body must include { txHash, network, token?, ...toolInputs }
 * Server returns 402 if payment is invalid, 200 + result if valid.
 */
export function createToolHandler(
  toolName: string,
  priceUsd: string,
  fn: (req: NextRequest, body: Record<string, string>) => Promise<NextResponse>
) {
  const inner = safeHandler(toolName, async (req: NextRequest) => {
    const body = (await req.json()) as Record<string, string>;
    const { txHash, network = "celo-alfajores", token = "cusd" } = body;

    if (!txHash || !txHash.startsWith("0x")) {
      return NextResponse.json(
        { error: "Missing txHash. Pay first, then submit the transaction hash." },
        { status: 402 }
      );
    }

    const result = await verifyPayment({
      txHash: txHash as `0x${string}`,
      operatorAddress: OPERATOR_ADDRESS,
      requiredUsd: parsePriceUsd(priceUsd),
      network: network as SupportedNetwork,
      token: token as SupportedToken,
    });

    if (!result.valid) {
      return NextResponse.json(
        { error: `Payment invalid: ${result.reason}` },
        { status: 402 }
      );
    }

    return fn(req, body);
  });

  return async function POST(req: NextRequest) {
    return inner(req);
  };
}
