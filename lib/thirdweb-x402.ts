import "./env-init";
import { createThirdwebClient, defineChain } from "thirdweb";
import { celo } from "thirdweb/chains";
import { facilitator, settlePayment } from "thirdweb/x402";
import { NextRequest, NextResponse } from "next/server";
import { safeHandler } from "./safe-handler";

export type SupportedNetwork = "celo" | "celo-alfajores";

// Alfajores (44787) is not a named export in thirdweb/chains — use defineChain
const celoAlfajores = defineChain(44787);

export const NETWORK_CHAIN = {
  celo,
  "celo-alfajores": celoAlfajores,
} as const;

export const DEFAULT_NETWORK: SupportedNetwork =
  ((process.env.X402_NETWORK?.trim().toLowerCase() === "celo"
    ? "celo"
    : "celo-alfajores") as SupportedNetwork);

export const OPERATOR_ADDRESS = (
  process.env.OPERATOR_WALLET_ADDRESS?.trim() ||
  "0x0000000000000000000000000000000000000000"
) as `0x${string}`;

// Thirdweb client — uses secretKey server-side (never exposed to client)
function getServerClient() {
  return createThirdwebClient({
    secretKey: process.env.THIRDWEB_SECRET_KEY ?? "",
  });
}

// Thirdweb facilitator — handles on-chain settlement via thirdweb's infrastructure.
// Supports Celo mainnet + Alfajores testnet. cUSD (EIP-2612) and USDC (EIP-3009).
// No CDP keys or custom facilitator server needed.
function getThirdwebFacilitator() {
  return facilitator({
    client: getServerClient(),
    serverWalletAddress: OPERATOR_ADDRESS,
  });
}

// USDC on Celo (Circle, 6 decimals) — MiniPay users primarily hold USDC, not cUSD.
// Settling in USDC avoids "insufficient funds" errors for users who only have USDC.
// Both USDC and cUSD are supported by thirdweb's facilitator on Celo.
const USDC_ASSET = {
  celo: {
    address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as `0x${string}`,
    decimals: 6,
    eip712: {
      name: "USD Coin",
      version: "2",
      primaryType: "TransferWithAuthorization" as const, // EIP-3009
    },
  },
  // Alfajores testnet doesn't have official Circle USDC — fall back to cUSD there
  "celo-alfajores": {
    address: "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1" as `0x${string}`,
    decimals: 18,
    eip712: {
      name: "Celo Dollar",
      version: "1",
      primaryType: "Permit" as const, // EIP-2612
    },
  },
} as const;

function priceToAsset(usdPrice: string, network: SupportedNetwork) {
  const usd = parseFloat(usdPrice.replace("$", ""));
  const asset = USDC_ASSET[network];
  const amount = Math.round(usd * 10 ** asset.decimals).toString();
  return { amount, asset };
}

/**
 * Wraps a Next.js route handler with x402 payment gating via thirdweb.
 *
 * Flow:
 *  1. No X-PAYMENT header → return 402 with payment descriptor
 *  2. Client pays (signs permit/EIP-3009 via MiniPay) and retries with X-PAYMENT header
 *  3. settlePayment verifies + settles on Celo → call tool → return result
 */
export function createToolHandler(
  toolName: string,
  price: string,
  fn: (req: NextRequest, body: Record<string, string>) => Promise<NextResponse>
) {
  const inner = safeHandler(toolName, async (req: NextRequest) => {
    const body = (await req.json()) as Record<string, string>;
    const network: SupportedNetwork =
      (body.network as SupportedNetwork) ?? DEFAULT_NETWORK;
    const chain = NETWORK_CHAIN[network];

    const paymentData =
      req.headers.get("X-PAYMENT") ||
      req.headers.get("PAYMENT-SIGNATURE") ||
      null;

    const result = await settlePayment({
      resourceUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}${req.nextUrl.pathname}`,
      method: req.method as "POST",
      paymentData,
      payTo: OPERATOR_ADDRESS,
      network: chain,
      // Explicitly settle in USDC (mainnet) or cUSD (alfajores) — the user's
      // balance must be in this asset for payment to succeed.
      price: priceToAsset(price, network),
      facilitator: getThirdwebFacilitator(),
      routeConfig: {
        description: `pico: ${toolName}`,
        mimeType: "application/json",
      },
    });

    if (result.status === 200) {
      return fn(req, body);
    }

    // 402 — return payment descriptor so client can sign and retry
    return NextResponse.json(result.responseBody, {
      status: result.status,
      headers: result.responseHeaders as Record<string, string>,
    });
  });

  return async function POST(req: NextRequest) {
    return inner(req);
  };
}
