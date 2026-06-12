import { NextResponse } from "next/server";
import { MAX_URL_LENGTH, SAFETY_SUFFIX } from "@/lib/safety";
import { createToolHandler } from "@/lib/thirdweb-x402";
import { generateText, scrapeUrl } from "@/lib/ai-providers";

export const POST = createToolHandler("scrape", "$0.05", async (_req, body) => {
  const { url } = body;
  if (!url || url.trim().length < 10) {
    return NextResponse.json({ error: "A valid URL is required." }, { status: 400 });
  }
  if (url.length > MAX_URL_LENGTH) {
    return NextResponse.json({ error: "URL too long." }, { status: 400 });
  }

  // Get the page content via Firecrawl (preferred) or LLM-based fallback
  const pageContent = await scrapeUrl(url);

  // Summarize what we got into a 2-3 sentence takeaway
  const text = await generateText({
    system:
      "You distill the key takeaway from a web page in 2-3 sentences. Be precise and avoid filler." +
      SAFETY_SUFFIX,
    user: `URL: ${url}\n\nContent:\n${pageContent}\n\nGive me the key takeaway.`,
    maxTokens: 250,
  });

  return NextResponse.json({ kind: "text", text, sourceUrl: url });
});
