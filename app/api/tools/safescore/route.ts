import { NextResponse } from "next/server";
import { lookupProtocol, formatSafeScoreLine } from "@/lib/safescore";
import { createToolHandler } from "@/lib/thirdweb-x402";

function formatTvl(tvl: number): string {
  if (tvl >= 1e9) return `$${(tvl / 1e9).toFixed(2)}B`;
  if (tvl >= 1e6) return `$${(tvl / 1e6).toFixed(1)}M`;
  if (tvl >= 1e3) return `$${(tvl / 1e3).toFixed(0)}K`;
  return `$${tvl.toFixed(0)}`;
}

export const POST = createToolHandler("safescore", "$0.05", async (_req, body) => {
  const { protocol } = body;
  if (!protocol || protocol.trim().length < 2) {
    return NextResponse.json(
      { error: "Protocol name is required (2+ chars). Try: Ubeswap, Mento, Moola." },
      { status: 400 }
    );
  }

  const result = await lookupProtocol(protocol.trim());

  if (!result) {
    return NextResponse.json({
      kind: "text",
      title: "SafeScore",
      text: `No DeFiLlama data found for "${protocol.trim()}". Try the exact protocol name.`,
    });
  }

  const factors = result.factors.slice(0, 3).map((f: string) => `• ${f}`).join("\n");
  const text =
    `${formatSafeScoreLine(result)}\n` +
    `chain: ${result.chain} · TVL: ${formatTvl(result.tvl)}\n` +
    `${factors}\n\nnot financial advice — verify before depositing`;

  return NextResponse.json({
    kind: "text",
    title: `SafeScore: ${result.protocol}`,
    text,
    safescore: {
      protocol: result.protocol,
      score: result.safeScore,
      rating: result.rating,
      emoji: result.emoji,
      chain: result.chain,
    },
  });
});
