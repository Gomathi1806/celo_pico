/**
 * Multi-provider AI layer with graceful fallback.
 *
 * Each function tries paid providers in priority order, then falls back to
 * Pollinations.ai (free, no key needed). Add API keys to .env.local to
 * upgrade quality and reliability without code changes.
 *
 * Provider precedence:
 *   Text:     Groq → Google Gemini → Pollinations
 *   Image:    Fal (Flux) → Pollinations (Flux)
 *   Scrape:   Firecrawl → Pollinations (LLM-based)
 */

const GROQ_API_KEY = () => process.env.GROQ_API_KEY?.trim();
const GOOGLE_API_KEY = () => process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
const FAL_KEY = () => process.env.FAL_KEY?.trim();
const FIRECRAWL_API_KEY = () => process.env.FIRECRAWL_API_KEY?.trim();

type TextArgs = {
  system: string;
  user: string;
  /** Max tokens for the response. Default 600. */
  maxTokens?: number;
};

/** Try Groq → Gemini → Pollinations. Returns the first successful response. */
export async function generateText(args: TextArgs): Promise<string> {
  const providers: Array<{ name: string; fn: (a: TextArgs) => Promise<string> }> = [];
  if (GROQ_API_KEY()) providers.push({ name: "groq", fn: groqText });
  if (GOOGLE_API_KEY()) providers.push({ name: "gemini", fn: geminiText });
  providers.push({ name: "pollinations", fn: pollinationsText });

  let lastError: unknown;
  for (const p of providers) {
    try {
      const text = await p.fn(args);
      if (text && text.length > 0) return text;
    } catch (e) {
      lastError = e;
      console.warn(`[pico] ${p.name} text provider failed:`, e);
    }
  }
  throw new Error(
    `All text providers failed. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

/** Try Fal Flux → Pollinations Flux. Returns image URL. */
export async function generateImage(args: { prompt: string }): Promise<string> {
  if (FAL_KEY()) {
    try {
      return await falImage(args.prompt);
    } catch (e) {
      console.warn("[pico] fal image failed, falling back:", e);
    }
  }
  return pollinationsImage(args.prompt);
}

/** Try Firecrawl → LLM-based summary fallback. Returns the scraped content. */
export async function scrapeUrl(url: string): Promise<string> {
  if (FIRECRAWL_API_KEY()) {
    try {
      return await firecrawlScrape(url);
    } catch (e) {
      console.warn("[pico] firecrawl failed, falling back:", e);
    }
  }
  // Fallback: ask the LLM what it knows about this URL
  return generateText({
    system: "You are a web research assistant. Be accurate and concise.",
    user: `Describe the content at this URL in 3-4 sentences: ${url}`,
    maxTokens: 400,
  });
}

/* ─────────────────────────── Providers ─────────────────────────── */

async function groqText({ system, user, maxTokens = 600 }: TextArgs): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

async function geminiText({ system, user, maxTokens = 600 }: TextArgs): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GOOGLE_API_KEY()}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: user }] }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
}

async function pollinationsText({ system, user }: TextArgs): Promise<string> {
  const res = await fetch("https://text.pollinations.ai/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      model: "openai",
    }),
  });
  if (!res.ok) throw new Error(`Pollinations HTTP ${res.status}`);
  return (await res.text()).trim();
}

async function falImage(prompt: string): Promise<string> {
  const res = await fetch("https://fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL_KEY()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      image_size: "square_hd",
      num_inference_steps: 4,
      enable_safety_checker: true,
    }),
  });
  if (!res.ok) throw new Error(`Fal HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const imageUrl = data.images?.[0]?.url;
  if (!imageUrl) throw new Error("Fal returned no image URL");
  return imageUrl;
}

function pollinationsImage(prompt: string): string {
  const seed = Math.floor(Math.random() * 1_000_000);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(
    prompt
  )}?seed=${seed}&nologo=true&model=flux`;
}

async function firecrawlScrape(url: string): Promise<string> {
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FIRECRAWL_API_KEY()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
  });
  if (!res.ok) throw new Error(`Firecrawl HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const markdown = data.data?.markdown ?? "";
  if (!markdown) throw new Error("Firecrawl returned empty content");
  // Trim to ~2500 chars so downstream summarizers don't choke
  return markdown.slice(0, 2500);
}
