"use client";

import {
  Image as ImageIcon,
  Link2,
  Loader2,
  MessageSquare,
  Wand2,
  Activity,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPublicClient, formatUnits, http } from "viem";
import { celo, celoAlfajores } from "viem/chains";
import { PicoHero } from "@/components/pico-logo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  getConnectedWallet,
  getWalletAddress,
  detectInjectedProvider,
  payDirect,
  resolveNetwork,
  type SupportedNetwork,
} from "@/lib/minipay-wallet";
import { TOKENS, type TokenId, type TokenInfo } from "@/lib/payment";
import { TOOLS, type Tool, type ToolId } from "@/lib/tools";

const OPERATOR_ADDRESS = (
  process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ??
  "0x0000000000000000000000000000000000000000"
) as `0x${string}`;

const NETWORK_CONFIG = {
  celo: { name: "Celo", chain: celo },
  "celo-alfajores": { name: "Alfajores", chain: celoAlfajores },
} as const;

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const ICONS: Record<ToolId, React.ComponentType<{ className?: string }>> = {
  image: ImageIcon,
  scrape: Link2,
  ask: Wand2,
  "summarize-url": MessageSquare,
  "defi-signal": Activity,
  safescore: ShieldCheck,
};

type Result =
  | { kind: "image"; url: string; prompt: string }
  | { kind: "text"; text: string; title?: string; sourceUrl?: string };

export function Launcher() {
  const [activeId, setActiveId] = useState<ToolId>(TOOLS[0].id);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [isMiniPay, setIsMiniPay] = useState<boolean | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  // Balance per token (e.g. {usdc: "3.59", usdm: "0.00"}).
  const [balances, setBalances] = useState<Record<TokenId, string>>(
    {} as Record<TokenId, string>
  );
  const [selectedToken, setSelectedToken] = useState<TokenId | null>(null);

  const [selectedNetwork, setSelectedNetwork] = useState<SupportedNetwork>(
    () =>
      resolveNetwork(
        (process.env.NEXT_PUBLIC_X402_NETWORK ?? "celo-alfajores").trim()
      )
  );

  const config = NETWORK_CONFIG[selectedNetwork];
  const IS_MAINNET = selectedNetwork === "celo";
  // Tokens available on this network (mainnet: USDC + USDm; testnet: USDm only)
  const availableTokens: TokenInfo[] = Object.values(TOKENS[selectedNetwork]).filter(
    (t): t is TokenInfo => !!t
  );

  // Detect any injected provider (polls up to 2s — MiniPay sometimes
  // injects window.ethereum after React mounts).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await detectInjectedProvider(2000);
      if (cancelled) return;
      setIsMiniPay(result.available);
      if (!result.available) return;

      try {
        const address = await getWalletAddress(selectedNetwork);
        if (cancelled) return;
        setWalletAddress(address);

        // Fetch balances for ALL tokens on this network in parallel.
        const publicClient = createPublicClient({
          chain: config.chain,
          transport: http(),
        });
        const balanceEntries = await Promise.all(
          availableTokens.map(async (token) => {
            try {
              const raw = await publicClient.readContract({
                address: token.address,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [address as `0x${string}`],
              });
              return [token.id, formatUnits(raw, token.decimals)] as const;
            } catch {
              return [token.id, "0"] as const;
            }
          })
        );
        if (cancelled) return;
        const balancesMap = Object.fromEntries(balanceEntries) as Record<TokenId, string>;
        setBalances(balancesMap);

        // Auto-pick the token with the highest balance as the default —
        // this is what Celopedia's "single-token UX" guidance expects.
        const best = availableTokens
          .map((t) => ({ id: t.id, n: parseFloat(balancesMap[t.id] ?? "0") }))
          .sort((a, b) => b.n - a.n)[0];
        setSelectedToken(best?.id ?? availableTokens[0]?.id ?? null);
      } catch (e) {
        console.error("Wallet init failed:", e);
      }
    })();
    return () => { cancelled = true; };
    // availableTokens derives from selectedNetwork — listing it explicitly
    // would re-run on every render because its identity isn't stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNetwork, config.chain]);

  // Resolve the currently-selected token's info + balance for UI display
  const activeToken: TokenInfo | null =
    availableTokens.find((t) => t.id === selectedToken) ?? availableTokens[0] ?? null;
  const activeBalance = activeToken ? balances[activeToken.id] : undefined;

  const tool = TOOLS.find((t) => t.id === activeId)!;

  function setField(name: string, value: string) {
    setInputs((prev) => ({ ...prev, [name]: value }));
  }

  async function run() {
    setError(null);
    setResult(null);

    const missing = tool.fields.filter(
      (f) => f.required && !inputs[f.name]?.trim()
    );
    if (missing.length) {
      setError(`Missing: ${missing.map((m) => m.label).join(", ")}`);
      return;
    }

    setRunning(true);
    try {
      const toolInputs = Object.fromEntries(
        tool.fields.map((f) => [f.name, inputs[f.name] ?? ""])
      );
      const priceUsd = parseFloat(tool.price.replace("$", ""));

      let res: Response;

      if (!activeToken) throw new Error("No stablecoin available on this network.");
      const tokenId = activeToken.id;

      if (isMiniPay) {
        // Path A — MiniPay: direct ERC-20 transfer + on-chain verify.
        // MiniPay does NOT support eth_signTypedData, so the x402 flow
        // cannot work inside MiniPay's WebView. Server verifies the
        // resulting txHash before running the tool.
        let txHash: `0x${string}`;
        try {
          txHash = await payDirect({
            network: selectedNetwork,
            tokenId,
            toAddress: OPERATOR_ADDRESS,
            amountUsd: priceUsd,
          });
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          throw new Error(`Payment cancelled or failed: ${reason}`);
        }

        res = await fetch(tool.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...toolInputs,
            network: selectedNetwork,
            tokenId,
            txHash,
          }),
        });
      } else {
        // Path B — Browser wallet (MetaMask / Coinbase / Rabby): x402
        // signTypedData flow via thirdweb. Works because regular browser
        // wallets support EIP-712 properly.
        const { fetchWithPay } = await getConnectedWallet(selectedNetwork);
        const body = JSON.stringify({
          ...toolInputs,
          network: selectedNetwork,
          tokenId,
        });

        try {
          res = await Promise.race([
            fetchWithPay(tool.endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body,
            }),
            new Promise<Response>((_, reject) =>
              setTimeout(
                () => reject(new Error("Payment timed out after 30s. Did you sign the prompt?")),
                30_000
              )
            ),
          ]);
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          throw new Error(`Payment failed: ${reason}`);
        }
      }

      if (!res.ok) {
        let message = `Request failed (${res.status}).`;
        try {
          const data = await res.clone().json();
          if (data?.error) message = data.error;
        } catch {
          const text = await res.text().catch(() => "");
          if (text) message = text.slice(0, 200);
        }
        throw new Error(message);
      }

      setResult((await res.json()) as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setRunning(false);
    }
  }

  async function shareResult() {
    if (!result) return;
    const stamp = `made with pico — pennies of AI on Celo ↗ ${
      process.env.NEXT_PUBLIC_APP_URL ?? ""
    }`;
    const text =
      result.kind === "image"
        ? `${result.prompt}\n\n${stamp}`
        : `${result.text}${
            result.sourceUrl ? `\n\nsource: ${result.sourceUrl}` : ""
          }\n\n${stamp}`;

    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch { /* fall through to clipboard */ }
    }
    await navigator.clipboard.writeText(text);
    alert("Copied to clipboard!");
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <PicoHero />
        <div className="flex flex-col items-end gap-1.5">
          {/* Network badge — always show, like Base PICO shows "base" */}
          <span className="text-[10px] font-mono text-muted-foreground bg-muted/40 rounded-full px-2 py-0.5">
            {IS_MAINNET ? "celo" : `${config.name.toLowerCase()} · testnet`}
          </span>
        </div>
      </header>

      {/* No injected wallet detected at all (browser without any wallet extension) */}
      {isMiniPay === false && (
        <Alert>
          <AlertTitle>No wallet detected</AlertTitle>
          <AlertDescription>
            pico needs an injected Ethereum wallet. Best experience: open
            this URL inside the <strong>MiniPay</strong> app on mobile. For
            desktop testing, install <a
              href="https://metamask.io/download/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >MetaMask</a>, Coinbase Wallet, or Rabby — the app will switch
            you to Celo and add it to your wallet automatically. Then refresh
            this page.
          </AlertDescription>
        </Alert>
      )}

      {/* Account + multi-stablecoin picker. Default = highest-balance.
          Address shown as truncated secondary hint per MiniPay rules. */}
      {walletAddress && activeToken && (
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              Balance ({activeToken.symbol})
            </span>
            <span
              className={`font-mono text-base font-semibold ${
                parseFloat(activeBalance ?? "0") < 0.1
                  ? "text-destructive"
                  : "text-foreground"
              }`}
            >
              {activeBalance !== undefined ? parseFloat(activeBalance).toFixed(2) : "…"}
            </span>
          </div>

          {/* Token picker — pills, like the Mento/MiniPay reference UX.
              Only render when >1 token available (no picker on testnet). */}
          {availableTokens.length > 1 && (
            <div className="flex items-center gap-1.5 pt-0.5">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mr-1">
                Pay in
              </span>
              {availableTokens.map((t) => {
                const isActive = t.id === activeToken.id;
                const tokBal = parseFloat(balances[t.id] ?? "0");
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedToken(t.id)}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] font-mono transition-colors ${
                      isActive
                        ? "border-foreground bg-foreground/10 text-foreground"
                        : "border-border text-muted-foreground hover:border-foreground/40"
                    }`}
                    title={`${tokBal.toFixed(2)} ${t.symbol} available`}
                  >
                    {t.symbol}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground/70">
            <span>Account</span>
            <span className="font-mono">{shortAddress(walletAddress)}</span>
          </div>

          {parseFloat(activeBalance ?? "0") < 0.1 && (
            <div className="pt-1 text-xs text-destructive">
              ⚠ Not enough {activeToken.symbol}.{" "}
              {availableTokens.length > 1 && (
                <span>Try a different stablecoin above, or </span>
              )}
              {IS_MAINNET ? (
                <span>deposit more in MiniPay.</span>
              ) : (
                <a
                  href="https://faucet.celo.org/alfajores"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  get free testnet stablecoin →
                </a>
              )}
            </div>
          )}
        </div>
      )}

      <Tabs
        value={activeId}
        onValueChange={(v) => setActiveId(v as ToolId)}
      >
        <TabsList className="grid w-full grid-cols-6">
          {TOOLS.map((t) => {
            const Icon = ICONS[t.id];
            return (
              <TabsTrigger
                key={t.id}
                value={t.id}
                className="gap-1 px-1.5"
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden md:inline truncate text-[11px]">
                  {t.label}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      <ToolForm
        tool={tool}
        inputs={inputs}
        onChange={setField}
        onRun={run}
        running={running}
      />

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Run failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {running && <ResultSkeleton kind={tool.resultKind} />}
      {!running && result && (
        <ResultView result={result} onShare={shareResult} />
      )}
    </div>
  );
}

function ToolForm({
  tool,
  inputs,
  onChange,
  onRun,
  running,
}: {
  tool: Tool;
  inputs: Record<string, string>;
  onChange: (name: string, value: string) => void;
  onRun: () => void;
  running: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tool.label}</CardTitle>
        <CardDescription>{tool.tagline}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {tool.fields.map((f) => (
          <div key={f.name} className="flex flex-col gap-2">
            <Label htmlFor={f.name}>{f.label}</Label>
            {f.type === "textarea" ? (
              <Textarea
                id={f.name}
                placeholder={f.placeholder}
                value={inputs[f.name] ?? ""}
                onChange={(e) => onChange(f.name, e.target.value)}
                rows={4}
              />
            ) : (
              <Input
                id={f.name}
                type={f.type === "url" ? "url" : "text"}
                placeholder={f.placeholder}
                value={inputs[f.name] ?? ""}
                onChange={(e) => onChange(f.name, e.target.value)}
              />
            )}
          </div>
        ))}
        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Charged: <span className="font-mono">{tool.price}</span> in stablecoin (network fee included)
          </span>
          <Button onClick={onRun} disabled={running}>
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Working…
              </>
            ) : (
              `Pay ${tool.price} & Run`
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ResultSkeleton({ kind }: { kind: "image" | "text" }) {
  return (
    <Card>
      <CardContent className="pt-6">
        {kind === "image" ? (
          <Skeleton className="aspect-square w-full" />
        ) : (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResultView({
  result,
  onShare,
}: {
  result: Result;
  onShare: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        {result.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={result.url}
            alt={result.prompt}
            className="w-full rounded-md border border-border"
          />
        ) : (
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {result.text}
            {result.sourceUrl && (
              <div className="mt-3 truncate text-xs text-muted-foreground">
                {result.sourceUrl}
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onShare}>
            Share
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
