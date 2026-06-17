/**
 * Server-side on-chain payment verification for the MiniPay path.
 *
 * MiniPay does not support EIP-712 signTypedData (per Celopedia's official
 * MiniPay requirements doc), so the x402/thirdweb signature flow won't work
 * inside MiniPay. We instead do a two-step:
 *   1. Client sends an ERC-20 transfer via eth_sendTransaction
 *   2. Server verifies the resulting txHash represents a valid stablecoin
 *      transfer to the operator address with the required amount
 *
 * Replay protection: used txHashes are stored in Redis with a 7-day TTL.
 */

import { createPublicClient, http, parseUnits, type Hash } from "viem";
import { celo, celoAlfajores } from "viem/chains";
import { getRedis } from "./upstash";

export const STABLECOIN = {
  celo: {
    address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as `0x${string}`,
    symbol: "USDC",
    decimals: 6,
  },
  "celo-alfajores": {
    address: "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1" as `0x${string}`,
    symbol: "USDm",
    decimals: 18,
  },
} as const;

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as `0x${string}`;

export type SupportedNetwork = "celo" | "celo-alfajores";

function getPublicClient(network: SupportedNetwork) {
  return createPublicClient({
    chain: network === "celo" ? celo : celoAlfajores,
    transport: http(),
  });
}

export type PaymentVerification =
  | { valid: true; payer: `0x${string}` }
  | { valid: false; reason: string };

export async function verifyDirectPayment({
  txHash,
  operatorAddress,
  requiredUsd,
  network,
}: {
  txHash: Hash;
  operatorAddress: `0x${string}`;
  requiredUsd: number;
  network: SupportedNetwork;
}): Promise<PaymentVerification> {
  // 1. Replay-attack prevention
  const redis = getRedis();
  if (redis) {
    const key = `pico:used-tx:${txHash.toLowerCase()}`;
    const set = await redis.set(key, "1", { nx: true, ex: 60 * 60 * 24 * 7 });
    if (set === null) {
      return { valid: false, reason: "Transaction already used." };
    }
  }

  const client = getPublicClient(network);
  const stable = STABLECOIN[network];
  const requiredAmount = parseUnits(requiredUsd.toFixed(stable.decimals), stable.decimals);

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
      log.address.toLowerCase() !== stable.address.toLowerCase() ||
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
      return { valid: true, payer };
    }
    return {
      valid: false,
      reason: `Underpayment: got ${value} wei, need ${requiredAmount} wei.`,
    };
  }

  return {
    valid: false,
    reason: `No ${stable.symbol} Transfer to operator found in this transaction.`,
  };
}

export function parsePriceUsd(price: string): number {
  return parseFloat(price.replace("$", ""));
}
