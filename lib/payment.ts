/**
 * Server-side on-chain payment verification (MiniPay direct-transfer path)
 * + the canonical token registry used by both client and server.
 *
 * Multi-stablecoin: MiniPay users hold a mix of USDC (Circle, 6 decimals)
 * and USDm (formerly cUSD, Mento USD-pegged, 18 decimals). Both peg 1:1
 * with USD, so a $0.10 price is 0.10 of either token. We let the user
 * pick which to pay with.
 *
 * Replay protection: used txHashes are stored in Redis with a 7-day TTL.
 */

import { createPublicClient, http, parseUnits, type Hash } from "viem";
import { celo, celoAlfajores } from "viem/chains";
import { getRedis } from "./upstash";

export type SupportedNetwork = "celo" | "celo-alfajores";
export type TokenId = "usdc" | "usdm";

export type TokenInfo = {
  id: TokenId;
  address: `0x${string}`;
  symbol: string;       // canonical name shown in UI (USDC / USDm)
  decimals: number;
  eip712: {
    name: string;       // domain.name for typed-data signing
    version: string;
    primaryType: "TransferWithAuthorization" | "Permit";
  };
};

// Per-network token registry. Mainnet has both USDC and USDm; Alfajores
// only has USDm (Circle USDC isn't deployed there).
export const TOKENS: Record<SupportedNetwork, Partial<Record<TokenId, TokenInfo>>> = {
  celo: {
    usdc: {
      id: "usdc",
      address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
      symbol: "USDC",
      decimals: 6,
      eip712: {
        name: "USD Coin",
        version: "2",
        primaryType: "TransferWithAuthorization",
      },
    },
    usdm: {
      id: "usdm",
      address: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
      symbol: "USDm",
      decimals: 18,
      eip712: {
        name: "Celo Dollar",
        version: "1",
        primaryType: "Permit",
      },
    },
  },
  "celo-alfajores": {
    usdm: {
      id: "usdm",
      address: "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1",
      symbol: "USDm",
      decimals: 18,
      eip712: {
        name: "Celo Dollar",
        version: "1",
        primaryType: "Permit",
      },
    },
  },
};

export function getToken(network: SupportedNetwork, id: TokenId): TokenInfo {
  const token = TOKENS[network][id];
  if (!token) {
    // Fall back to whatever IS available on this network (e.g. USDm on Alfajores
    // when the user picked USDC). Better than throwing — graceful UX.
    const fallback = Object.values(TOKENS[network])[0];
    if (!fallback) {
      throw new Error(`No tokens configured for network ${network}`);
    }
    return fallback;
  }
  return token;
}

export function listTokens(network: SupportedNetwork): TokenInfo[] {
  return Object.values(TOKENS[network]).filter((t): t is TokenInfo => !!t);
}

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as `0x${string}`;

function getPublicClient(network: SupportedNetwork) {
  return createPublicClient({
    chain: network === "celo" ? celo : celoAlfajores,
    transport: http(),
  });
}

export type PaymentVerification =
  | { valid: true; payer: `0x${string}`; tokenId: TokenId }
  | { valid: false; reason: string };

/**
 * Verifies that `txHash` is a successful Transfer of the chosen stablecoin
 * to the operator address with at least the required amount.
 */
export async function verifyDirectPayment({
  txHash,
  operatorAddress,
  requiredUsd,
  network,
  tokenId,
}: {
  txHash: Hash;
  operatorAddress: `0x${string}`;
  requiredUsd: number;
  network: SupportedNetwork;
  tokenId: TokenId;
}): Promise<PaymentVerification> {
  // Replay-attack prevention
  const redis = getRedis();
  if (redis) {
    const key = `pico:used-tx:${txHash.toLowerCase()}`;
    const set = await redis.set(key, "1", { nx: true, ex: 60 * 60 * 24 * 7 });
    if (set === null) {
      return { valid: false, reason: "Transaction already used." };
    }
  }

  const client = getPublicClient(network);
  const token = getToken(network, tokenId);
  const requiredAmount = parseUnits(requiredUsd.toFixed(token.decimals), token.decimals);

  let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>>;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch {
    return { valid: false, reason: "Transaction not found on Celo." };
  }

  if (receipt.status !== "success") {
    return { valid: false, reason: "Transaction failed on-chain." };
  }

  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() !== token.address.toLowerCase() ||
      log.topics[0] !== TRANSFER_TOPIC ||
      log.topics.length < 3
    ) {
      continue;
    }

    const toAddress = ("0x" + log.topics[2]!.slice(26).toLowerCase()) as `0x${string}`;
    if (toAddress !== operatorAddress.toLowerCase()) continue;

    const value = BigInt(log.data);
    if (value >= requiredAmount) {
      const payer = ("0x" + log.topics[1]!.slice(26)) as `0x${string}`;
      return { valid: true, payer, tokenId };
    }
    return {
      valid: false,
      reason: `Underpayment: got ${value} ${token.symbol} wei, need ${requiredAmount}.`,
    };
  }

  return {
    valid: false,
    reason: `No ${token.symbol} Transfer to operator found in this transaction.`,
  };
}

export function parsePriceUsd(price: string): number {
  return parseFloat(price.replace("$", ""));
}
