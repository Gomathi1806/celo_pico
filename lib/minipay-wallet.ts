"use client";

import { createThirdwebClient } from "thirdweb";
import { createWalletAdapter } from "thirdweb/wallets";
import { wrapFetchWithPayment } from "thirdweb/x402";

export type SupportedNetwork = "celo" | "celo-alfajores";

export function resolveNetwork(raw: string): SupportedNetwork {
  const lower = raw.toLowerCase();
  if (lower === "celo" || lower === "eip155:42220") return "celo";
  return "celo-alfajores";
}

export const DEFAULT_NETWORK = resolveNetwork(
  (process.env.NEXT_PUBLIC_X402_NETWORK ?? "celo-alfajores").trim()
);

const CHAIN_MAP = {
  celo:            { chainId: 42220, chainIdHex: "0xA4EC" as const },
  "celo-alfajores": { chainId: 44787, chainIdHex: "0xAEF3" as const },
} as const;

// Strict MiniPay flag (Opera sets this in the production app)
export function isMiniPayEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window.ethereum as { isMiniPay?: boolean } | undefined)?.isMiniPay;
}

// Strict MiniPay detection with polling — checks isMiniPay flag.
// Polls up to ~2s because MiniPay sometimes injects window.ethereum after
// React mounts. Rejects MetaMask and other non-MiniPay wallets cleanly.
export async function detectInjectedProvider(timeoutMs = 2000): Promise<{
  available: boolean;
  isMiniPay: boolean;
  providerKeys: string[];
}> {
  if (typeof window === "undefined") {
    return { available: false, isMiniPay: false, providerKeys: [] };
  }
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (window.ethereum) {
      const provider = window.ethereum as Record<string, unknown>;
      const isMiniPay = provider.isMiniPay === true;
      const providerKeys = Object.keys(provider).filter((k) => k.startsWith("is"));
      const result = {
        available: isMiniPay,  // only count as available if it's MiniPay
        isMiniPay,
        providerKeys,
      };
      // eslint-disable-next-line no-console
      console.log("[pico] injected provider detected:", { ...result, providerKeys });
      if (isMiniPay) return result;
      // Keep polling — MiniPay might inject later, overriding MetaMask
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const provider = (typeof window !== "undefined" ? window.ethereum : undefined) as
    | Record<string, unknown>
    | undefined;
  const providerKeys = provider
    ? Object.keys(provider).filter((k) => k.startsWith("is"))
    : [];
  // eslint-disable-next-line no-console
  console.warn(
    "[pico] MiniPay not detected after",
    timeoutMs,
    "ms. Found providers:",
    providerKeys
  );
  return { available: false, isMiniPay: false, providerKeys };
}

function getThirdwebClient() {
  return createThirdwebClient({
    clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID ?? "",
  });
}

export type ConnectedWallet = {
  address: `0x${string}`;
  fetchWithPay: ReturnType<typeof wrapFetchWithPayment>;
};

let cached: ConnectedWallet | null = null;
let cachedNetwork: SupportedNetwork | null = null;

/**
 * Connects MiniPay's window.ethereum to thirdweb's x402 payment client.
 *
 * Instead of importing viem types (which clash with thirdweb's internal viem bundle),
 * we build a thirdweb Account directly from window.ethereum's RPC methods.
 * thirdweb's wrapFetchWithPayment uses signTypedData to sign EIP-2612 (cUSD)
 * or EIP-3009 (USDC) — both are supported by MiniPay's injected provider.
 */
export async function getConnectedWallet(
  network: SupportedNetwork = DEFAULT_NETWORK
): Promise<ConnectedWallet> {
  if (cached && cachedNetwork === network) return cached;

  const provider = window.ethereum;
  if (!provider) throw new Error("No wallet. Open inside MiniPay.");

  const { chainIdHex, chainId } = CHAIN_MAP[network];

  // Switch to Celo if needed
  try {
    const current = (await provider.request({ method: "eth_chainId" })) as string;
    if (current.toLowerCase() !== chainIdHex.toLowerCase()) {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
    }
  } catch { /* tx will fail naturally if wrong chain */ }

  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as `0x${string}`[];
  const address = accounts[0];
  if (!address) throw new Error("Wallet returned no address.");

  // Build a thirdweb Account directly from window.ethereum — no viem types crossing
  const adaptedAccount = {
    address,
    async sendTransaction(tx: { to?: string | null; value?: bigint; data?: string; chainId?: number }) {
      const txHash = await provider.request({
        method: "eth_sendTransaction",
        params: [{
          from: address,
          to: tx.to ?? undefined,
          value: tx.value ? `0x${tx.value.toString(16)}` : undefined,
          data: tx.data,
        }],
      }) as `0x${string}`;
      return { transactionHash: txHash };
    },
    async signMessage({ message }: { message: string | { raw: `0x${string}` } }) {
      const msg = typeof message === "string" ? message : message.raw;
      return provider.request({
        method: "personal_sign",
        params: [msg, address],
      }) as Promise<`0x${string}`>;
    },
    // thirdweb calls this to sign EIP-2612 permit (cUSD) or EIP-3009 (USDC)
    async signTypedData(typedData: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) {
      const payload = JSON.stringify({
        types: typedData.types,
        domain: typedData.domain,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });
      return provider.request({
        method: "eth_signTypedData_v4",
        params: [address, payload],
      }) as Promise<`0x${string}`>;
    },
  };

  // Wrap into a thirdweb Wallet (needed by wrapFetchWithPayment).
  // Cast adaptedAccount — thirdweb's Account type references its bundled viem which
  // differs structurally from our project's viem. Runtime behavior is identical.
  const thirdwebWallet = createWalletAdapter({
    client: getThirdwebClient(),
    adaptedAccount: adaptedAccount as any,
    chain: { id: chainId } as any,
    onDisconnect: () => { cached = null; cachedNetwork = null; },
    switchChain: async () => {},
  });

  const fetchWithPay = wrapFetchWithPayment(fetch, getThirdwebClient(), thirdwebWallet);

  const next = { address, fetchWithPay };
  cached = next;
  cachedNetwork = network;
  return next;
}

export async function getWalletAddress(
  network: SupportedNetwork = DEFAULT_NETWORK
): Promise<`0x${string}`> {
  const { address } = await getConnectedWallet(network);
  return address;
}
