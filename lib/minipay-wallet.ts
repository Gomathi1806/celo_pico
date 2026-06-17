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

// Full chain config — used by wallet_addEthereumChain when a browser wallet
// (MetaMask, Coinbase Wallet, etc.) doesn't yet know about Celo.
const CHAIN_MAP = {
  celo: {
    chainId: 42220,
    chainIdHex: "0xA4EC" as const,
    chainName: "Celo Mainnet",
    nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
    rpcUrls: ["https://forno.celo.org"],
    blockExplorerUrls: ["https://celoscan.io"],
  },
  "celo-alfajores": {
    chainId: 44787,
    chainIdHex: "0xAEF3" as const,
    chainName: "Celo Alfajores Testnet",
    nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
    rpcUrls: ["https://alfajores-forno.celo-testnet.org"],
    blockExplorerUrls: ["https://alfajores.celoscan.io"],
  },
} as const;

// Strict MiniPay flag (Opera sets this in the production app)
export function isMiniPayEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window.ethereum as { isMiniPay?: boolean } | undefined)?.isMiniPay;
}

// Accept any injected EIP-1193 provider — MiniPay primary, but MetaMask /
// Coinbase Wallet / Rabby etc. all work in regular browsers for testing.
// Polls up to ~2s because some wallets inject after React mounts.
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
      const result = { available: true, isMiniPay, providerKeys };
      // eslint-disable-next-line no-console
      console.log("[pico] wallet detected:", result);
      return result;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  // eslint-disable-next-line no-console
  console.warn("[pico] no injected wallet detected after", timeoutMs, "ms");
  return { available: false, isMiniPay: false, providerKeys: [] };
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

  const chainCfg = CHAIN_MAP[network];
  const { chainIdHex, chainId } = chainCfg;

  // Switch to Celo. If the wallet doesn't know about Celo yet (4902 error,
  // common in MetaMask first-time), add it via wallet_addEthereumChain.
  try {
    const current = (await provider.request({ method: "eth_chainId" })) as string;
    if (current.toLowerCase() !== chainIdHex.toLowerCase()) {
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: chainIdHex }],
        });
      } catch (switchErr: unknown) {
        const code = (switchErr as { code?: number })?.code;
        if (code === 4902 || code === -32603) {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: chainIdHex,
              chainName: chainCfg.chainName,
              nativeCurrency: chainCfg.nativeCurrency,
              rpcUrls: chainCfg.rpcUrls,
              blockExplorerUrls: chainCfg.blockExplorerUrls,
            }],
          });
        } else {
          throw switchErr;
        }
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[pico] chain switch failed — tx will fail if wallet is on wrong chain:", e);
  }

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
    // thirdweb calls this to sign EIP-2612 permit (cUSD) or EIP-3009 (USDC).
    // The typedData payload contains BigInts (chainId, value, nonce, deadline)
    // which JSON.stringify can't serialize natively — use a replacer that
    // converts BigInt → decimal string (EIP-712 / JSON-RPC standard format).
    async signTypedData(typedData: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) {
      const payload = JSON.stringify(
        {
          types: typedData.types,
          domain: typedData.domain,
          primaryType: typedData.primaryType,
          message: typedData.message,
        },
        (_key, value) => (typeof value === "bigint" ? value.toString() : value)
      );
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
