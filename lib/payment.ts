import { createPublicClient, http, parseAbi, parseUnits, type Hash } from "viem";
import { celo, celoAlfajores } from "viem/chains";
import { getRedis } from "./upstash";

export const CUSD_ADDRESS = {
  celo: "0x765DE816845861e75A25fCA122bb6898B8B1282a" as `0x${string}`,
  "celo-alfajores": "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1" as `0x${string}`,
} as const;

export const CEUR_ADDRESS = {
  celo: "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73" as `0x${string}`,
  "celo-alfajores": "0x10c892A6EC43a53E45D0B916B4b7D383B1b78470" as `0x${string}`,
} as const;

// cUSD and cEUR both have 18 decimals (Mento standard)
const DECIMALS = 18;

// Keccak256 of "Transfer(address,address,uint256)"
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as `0x${string}`;

const ERC20_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export type SupportedNetwork = "celo" | "celo-alfajores";
export type SupportedToken = "cusd" | "ceur";

function getPublicClient(network: SupportedNetwork) {
  return createPublicClient({
    chain: network === "celo" ? celo : celoAlfajores,
    transport: http(),
  });
}

function getTokenAddress(
  token: SupportedToken,
  network: SupportedNetwork
): `0x${string}` {
  return token === "cusd" ? CUSD_ADDRESS[network] : CEUR_ADDRESS[network];
}

export type PaymentVerification =
  | { valid: true; payer: `0x${string}` }
  | { valid: false; reason: string };

/**
 * Verifies that a txHash represents a successful cUSD (or cEUR) transfer
 * to the operator address of at least the required amount.
 *
 * Also checks Redis to prevent the same txHash being used twice (replay attack).
 */
export async function verifyPayment({
  txHash,
  operatorAddress,
  requiredUsd,
  network,
  token = "cusd",
}: {
  txHash: Hash;
  operatorAddress: `0x${string}`;
  requiredUsd: number;
  network: SupportedNetwork;
  token?: SupportedToken;
}): Promise<PaymentVerification> {
  // 1. Replay-attack prevention via Redis
  const redis = getRedis();
  if (redis) {
    const key = `pico:used-tx:${txHash.toLowerCase()}`;
    // SET NX — only succeeds if key doesn't exist; TTL 7 days
    const set = await redis.set(key, "1", { nx: true, ex: 60 * 60 * 24 * 7 });
    if (set === null) {
      return { valid: false, reason: "Transaction already used." };
    }
  }

  const client = getPublicClient(network);
  const tokenAddress = getTokenAddress(token, network);
  const requiredAmount = parseUnits(requiredUsd.toFixed(6), DECIMALS);

  let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>>;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch {
    return { valid: false, reason: "Transaction not found on Celo." };
  }

  if (receipt.status !== "success") {
    return { valid: false, reason: "Transaction failed on-chain." };
  }

  // 2. Find a Transfer log from the cUSD/cEUR contract to the operator
  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() !== tokenAddress.toLowerCase() ||
      log.topics[0] !== TRANSFER_TOPIC ||
      log.topics.length < 3
    ) {
      continue;
    }

    // topics[2] = to address (padded to 32 bytes)
    const toAddress = ("0x" +
      log.topics[2]!.slice(26).toLowerCase()) as `0x${string}`;

    if (toAddress !== operatorAddress.toLowerCase()) continue;

    // Decode the value from the data field
    try {
      const [decoded] = client.chain // use the ABI decoder
        ? decodeTransferLog(log.data)
        : [BigInt(log.data)];

      if (decoded >= requiredAmount) {
        // topics[1] = from address
        const payer = ("0x" +
          log.topics[1]!.slice(26)) as `0x${string}`;
        return { valid: true, payer };
      } else {
        return {
          valid: false,
          reason: `Underpayment: got ${decoded} wei, need ${requiredAmount} wei.`,
        };
      }
    } catch {
      return { valid: false, reason: "Could not decode Transfer log." };
    }
  }

  return {
    valid: false,
    reason: `No ${token.toUpperCase()} Transfer to operator found in this transaction.`,
  };
}

function decodeTransferLog(data: `0x${string}`): [bigint] {
  // data is a single uint256 — 32 bytes hex
  return [BigInt(data)];
}

/** Price string like "$0.05" → number 0.05 */
export function parsePriceUsd(price: string): number {
  return parseFloat(price.replace("$", ""));
}
