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
  resolveNetwork,
  type SupportedNetwork,
} from "@/lib/minipay-wallet";
import { TOOLS, type Tool, type ToolId } from "@/lib/tools";

// USDC on Celo (6 decimals, EIP-3009) — used for balance display
// cUSD on Celo (18 decimals, EIP-2612) — thirdweb facilitator handles both
const NETWORK_CONFIG = {
  celo: {
    name: "Celo",
    chain: celo,
    cusd: "0x765DE816845861e75A25fCA122bb6898B8B1282a" as `0x${string}`,
    cusdDecimals: 18,
  },
  "celo-alfajores": {
    name: "Alfajores",
    chain: celoAlfajores,
    cusd: "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1" as `0x${string}`,
    cusdDecimals: 18,
  },
} as const;

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
  const [cusdBalance, setCusdBalance] = useState<string | null>(null);

  const [selectedNetwork, setSelectedNetwork] = useState<SupportedNetwork>(
    () =>
      resolveNetwork(
        (process.env.NEXT_PUBLIC_X402_NETWORK ?? "celo-alfajores").trim()
      )
  );

  const config = NETWORK_CONFIG[selectedNetwork];
  const IS_MAINNET = selectedNetwork === "celo";

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
        setWalletAddress(address);
        const publicClient = createPublicClient({
          chain: config.chain,
          transport: http(),
        });
        const bal = await publicClient.readContract({
          address: config.cusd,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address as `0x${string}`],
        });
        setCusdBalance(formatUnits(bal, config.cusdDecimals));
      } catch (e) {
        console.error("Wallet init failed:", e);
        setCusdBalance("?");
      }
    })();
    return () => { cancelled = true; };
  }, [selectedNetwork, config.chain, config.cusd, config.cusdDecimals]);

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
      // Get MiniPay wallet connected to thirdweb x402 client
      let fetchWithPay: Awaited<ReturnType<typeof getConnectedWallet>>["fetchWithPay"];
      try {
        ({ fetchWithPay } = await getConnectedWallet(selectedNetwork));
      } catch (e) {
        throw new Error("Wallet not available. Open this app inside MiniPay.");
      }

      const body = JSON.stringify({
        ...Object.fromEntries(
          tool.fields.map((f) => [f.name, inputs[f.name] ?? ""])
        ),
        network: selectedNetwork,
      });

      // x402 protocol — single call:
      // 1. fetchWithPay sends the request
      // 2. Server returns 402 with payment descriptor (price, network, payTo)
      // 3. thirdweb auto-signs the payment (EIP-2612 permit for cUSD, EIP-3009 for USDC)
      //    — MiniPay shows native sign prompt, no custom UI needed
      // 4. fetchWithPay retries with X-PAYMENT header
      // 5. Server settles on Celo via thirdweb facilitator → returns result
      // 30s timeout so user isn't stuck on a hung signature prompt.
      let res: Response;
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
          {/* Network selector — only show on dev/testnet environments */}
          {!IS_MAINNET && (
            <span className="text-[10px] font-mono text-muted-foreground border border-border rounded px-2 py-0.5">
              {config.name} (testnet)
            </span>
          )}
        </div>
      </header>

      {/* No injected wallet detected */}
      {isMiniPay === false && (
        <Alert>
          <AlertTitle>Wallet not detected</AlertTitle>
          <AlertDescription>
            pico needs an injected Ethereum wallet (MiniPay on Celo). Open
            this URL inside the MiniPay app. If you&apos;re already in
            MiniPay and still see this, try refreshing — the wallet provider
            is sometimes injected late. Check the browser console for
            details.
          </AlertDescription>
        </Alert>
      )}

      {/* Wallet + cUSD balance */}
      {walletAddress && (
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Wallet</span>
            <span className="font-mono truncate max-w-[180px]">
              {walletAddress}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">cUSD balance</span>
            <span
              className={`font-mono font-medium ${
                parseFloat(cusdBalance ?? "0") < 0.1
                  ? "text-destructive"
                  : "text-green-500"
              }`}
            >
              {cusdBalance ?? "…"} cUSD
            </span>
          </div>
          {parseFloat(cusdBalance ?? "0") < 0.1 && (
            <div className="pt-1 text-destructive">
              ⚠ Not enough cUSD.{" "}
              {IS_MAINNET ? (
                <span>
                  Add cUSD on Celo to this address to use pico.
                </span>
              ) : (
                <a
                  href="https://faucet.celo.org/alfajores"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Get free Alfajores cUSD →
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
            Charged:{" "}
            <span className="font-mono">{tool.price}</span> cUSD
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
