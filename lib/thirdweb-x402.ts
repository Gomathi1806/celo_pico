import "./env-init";
import { createThirdwebClient, defineChain } from "thirdweb";
import { celo } from "thirdweb/chains";
import { facilitator, settlePayment } from "thirdweb/x402";
import { NextRequest, NextResponse } from "next/server";
import { safeHandler } from "./safe-handler";
import {
  verifyDirectPayment,
  parsePriceUsd,
  getToken,
  type SupportedNetwork,
  type TokenId,
} from "./payment";

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

function priceToAsset(
  usdPrice: string,
  network: SupportedNetwork,
  tokenId: TokenId
) {
  const token = getToken(network, tokenId);
  const amount = Math.round(parsePriceUsd(usdPrice) * 10 ** token.decimals).toString();
  return {
    amount,
    asset: {
      address: token.address,
      decimals: token.decimals,
      eip712: token.eip712,
    },
  };
}

function resolveTokenId(input: unknown): TokenId {
  const lower = String(input ?? "").toLowerCase();
  if (lower === "usdc" || lower === "usdm") return lower;
  return "usdc"; // default — mainnet has USDC; getToken falls back to USDm on testnet
}

export function createToolHandler(
  toolName: string,
  price: string,
  fn: (req: NextRequest, body: Record<string, string>) => Promise<NextResponse>
) {
  const inner = safeHandler(toolName, async (req: NextRequest) => {
    const body = (await req.json()) as Record<string, string>;
    const network: SupportedNetwork =
      (body.network as SupportedNetwork) ?? DEFAULT_NETWORK;
    const tokenId = resolveTokenId(body.tokenId ?? body.token);
    const chain = NETWORK_CHAIN[network];

    // Path A — MiniPay direct-transfer verification
    if (body.txHash && typeof body.txHash === "string" && body.txHash.startsWith("0x")) {
      const result = await verifyDirectPayment({
        txHash: body.txHash as `0x${string}`,
        operatorAddress: OPERATOR_ADDRESS,
        requiredUsd: parsePriceUsd(price),
        network,
        tokenId,
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
      price: priceToAsset(price, network, tokenId),
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
