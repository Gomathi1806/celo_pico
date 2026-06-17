import "./env-init";
import { createThirdwebClient, defineChain } from "thirdweb";
import { celo } from "thirdweb/chains";
import { facilitator, settlePayment } from "thirdweb/x402";
import { NextRequest, NextResponse } from "next/server";
import { safeHandler } from "./safe-handler";
import {
  verifyDirectPayment,
  parsePriceUsd,
  type SupportedNetwork,
} from "./payment";

// Alfajores (44787) is not a named export in thirdweb/chains
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

function getServerClient() {
  return createThirdwebClient({
    secretKey: process.env.THIRDWEB_SECRET_KEY ?? "",
  });
}

function getThirdwebFacilitator() {
  return facilitator({
    client: getServerClient(),
    serverWalletAddress: OPERATOR_ADDRESS,
  });
}

// USDC (mainnet, EIP-3009) / USDm (Alfajores, EIP-2612) — used for x402 path
const X402_ASSET = {
  celo: {
    address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as `0x${string}`,
    decimals: 6,
    eip712: {
      name: "USD Coin",
      version: "2",
      primaryType: "TransferWithAuthorization" as const,
    },
  },
  "celo-alfajores": {
    address: "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1" as `0x${string}`,
    decimals: 18,
    eip712: {
      name: "Celo Dollar",
      version: "1",
      primaryType: "Permit" as const,
    },
  },
} as const;

function priceToAsset(usdPrice: string, network: SupportedNetwork) {
  const asset = X402_ASSET[network];
  const amount = Math.round(parsePriceUsd(usdPrice) * 10 ** asset.decimals).toString();
  return { amount, asset };
}

/**
 * Dual-path payment handler.
 *
 * Path A — MiniPay (direct transfer):
 *   Client signs eth_sendTransaction(transfer), posts txHash in body.
 *   Server verifies the Transfer log on-chain.
 *   Used because MiniPay does NOT support eth_signTypedData.
 *
 * Path B — Browser wallets (x402):
 *   Client signs an EIP-2612/3009 typed-data permit via thirdweb.
 *   Server settles atomically through thirdweb's facilitator.
 *   Used for MetaMask / Coinbase Wallet / Rabby etc.
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

    // Path A — MiniPay direct-transfer verification
    if (body.txHash && typeof body.txHash === "string" && body.txHash.startsWith("0x")) {
      const result = await verifyDirectPayment({
        txHash: body.txHash as `0x${string}`,
        operatorAddress: OPERATOR_ADDRESS,
        requiredUsd: parsePriceUsd(price),
        network,
      });

      if (!result.valid) {
        return NextResponse.json(
          { error: `Payment invalid: ${result.reason}` },
          { status: 402 }
        );
      }
      return fn(req, body);
    }

    // Path B — x402 thirdweb settlement (browser wallets)
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

    return NextResponse.json(result.responseBody, {
      status: result.status,
      headers: result.responseHeaders as Record<string, string>,
    });
  });

  return async function POST(req: NextRequest) {
    return inner(req);
  };
}
