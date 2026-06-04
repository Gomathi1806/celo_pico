// SafeScore — DeFi protocol rug-risk scoring for the `safescore` tool and
// for enriching `summarize-thread` output.
//
// Self-contained: scores protocols off live DeFiLlama TVL/audit signals.
// No dependency on any external newsie.tech deployment — DeFiLlama is just
// another upstream API, consistent with pico's "thin layer over upstream
// APIs" design.
//
// SafeScore = 100 - riskScore. Higher = safer. 0–100.
//   80–100 🟢 safe · 60–79 🟡 caution · 40–59 🟠 risky · 0–39 🔴 critical

export interface DefiLlamaProtocol {
  name: string;
  slug?: string;
  symbol?: string;
  tvl?: number;
  change_1d?: number;
  change_7d?: number;
  chain?: string;
  chains?: string[];
  category?: string;
  audit_links?: string[];
  url?: string;
}

export interface SafeScoreResult {
  protocol: string;
  slug: string;
  chain: string;
  category: string;
  tvl: number;
  change_1d: number;
  change_7d: number;
  riskScore: number;
  safeScore: number;
  rating: "safe" | "caution" | "risky" | "critical";
  emoji: string;
  factors: string[];
}

const ENDPOINT = "https://api.llama.fi/protocols";

// Module-level cache — Fluid Compute reuses instances, so this often hits
// warm across requests. 5-min TTL matches DeFiLlama's refresh cadence.
let cache: { data: DefiLlamaProtocol[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadProtocols(): Promise<DefiLlamaProtocol[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.data;
  const res = await fetch(ENDPOINT, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`DeFiLlama responded ${res.status}`);
  const data = (await res.json()) as DefiLlamaProtocol[];
  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

function calculateRisk(p: DefiLlamaProtocol): { score: number; factors: string[] } {
  let score = 0;
  const factors: string[] = [];
  const c1 = p.change_1d ?? 0;
  const c7 = p.change_7d ?? 0;
  const tvl = p.tvl ?? 0;

  if (c1 <= -50) { score += 40; factors.push(`TVL crashed ${Math.abs(c1).toFixed(1)}% in 24h`); }
  else if (c1 <= -30) { score += 30; factors.push(`TVL fell ${Math.abs(c1).toFixed(1)}% in 24h`); }
  else if (c1 <= -15) { score += 20; factors.push(`TVL down ${Math.abs(c1).toFixed(1)}% in 24h`); }
  else if (c1 <= -10) { score += 10; factors.push(`TVL down ${Math.abs(c1).toFixed(1)}% in 24h`); }

  if (c7 <= -70) { score += 25; factors.push(`Weekly TVL collapse ${Math.abs(c7).toFixed(1)}%`); }
  else if (c7 <= -50) { score += 20; factors.push(`Weekly TVL drop ${Math.abs(c7).toFixed(1)}%`); }
  else if (c7 <= -30) { score += 15; factors.push(`Weekly TVL drop ${Math.abs(c7).toFixed(1)}%`); }

  if (tvl > 0 && tvl < 50_000) { score += 15; factors.push(`Critically low TVL ($${tvl.toFixed(0)})`); }
  else if (tvl < 100_000) { score += 10; factors.push(`Low TVL ($${(tvl / 1000).toFixed(0)}K)`); }
  else if (tvl < 500_000) { score += 5; factors.push(`Modest TVL ($${(tvl / 1000).toFixed(0)}K)`); }

  if (!p.audit_links || p.audit_links.length === 0) {
    score += 10;
    factors.push("No public audit found");
  }

  return { score: Math.min(100, score), factors };
}

function rate(safeScore: number): { rating: SafeScoreResult["rating"]; emoji: string } {
  if (safeScore >= 80) return { rating: "safe", emoji: "🟢" };
  if (safeScore >= 60) return { rating: "caution", emoji: "🟡" };
  if (safeScore >= 40) return { rating: "risky", emoji: "🟠" };
  return { rating: "critical", emoji: "🔴" };
}

function scoreProtocol(p: DefiLlamaProtocol): SafeScoreResult {
  const { score: riskScore, factors } = calculateRisk(p);
  const safeScore = 100 - riskScore;
  const { rating, emoji } = rate(safeScore);
  return {
    protocol: p.name,
    slug: p.slug || p.name.toLowerCase().replace(/\s+/g, "-"),
    chain: p.chain || p.chains?.[0] || "Multi-chain",
    category: p.category || "Unknown",
    tvl: p.tvl ?? 0,
    change_1d: p.change_1d ?? 0,
    change_7d: p.change_7d ?? 0,
    riskScore,
    safeScore,
    rating,
    emoji,
    factors: factors.length ? factors : ["No major red flags detected"],
  };
}

/** Look up one protocol by name / slug / symbol. Returns null if not found. */
export async function lookupProtocol(query: string): Promise<SafeScoreResult | null> {
  if (!query?.trim()) return null;
  const protocols = await loadProtocols();
  const q = query.trim().toLowerCase();
  const match =
    protocols.find((p) => p.slug?.toLowerCase() === q) ||
    protocols.find((p) => p.name?.toLowerCase() === q) ||
    protocols.find((p) => p.symbol?.toLowerCase() === q) ||
    protocols.find((p) => p.name?.toLowerCase().includes(q));
  return match ? scoreProtocol(match) : null;
}

/**
 * Scan free text for known protocol names and return SafeScores for any
 * matches. Used by summarize-thread to auto-enrich DeFi conversations.
 * Capped at `limit` results so a chatty thread doesn't balloon the output.
 */
export async function scoreProtocolsInText(
  text: string,
  limit = 2
): Promise<SafeScoreResult[]> {
  if (!text) return [];
  const protocols = await loadProtocols();
  const lower = text.toLowerCase();
  const hits: SafeScoreResult[] = [];
  const seen = new Set<string>();
  // Only consider reasonably-sized protocols to avoid matching common words
  // (e.g. a protocol literally named "the"). Word-boundary match required.
  for (const p of protocols) {
    if (hits.length >= limit) break;
    const name = p.name?.toLowerCase();
    if (!name || name.length < 4 || seen.has(name)) continue;
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(lower)) {
      seen.add(name);
      hits.push(scoreProtocol(p));
    }
  }
  return hits;
}

/** One-line SafeScore summary for embedding in cast text. */
export function formatSafeScoreLine(r: SafeScoreResult): string {
  return `${r.emoji} ${r.protocol}: SafeScore ${r.safeScore}/100 (${r.rating})`;
}
