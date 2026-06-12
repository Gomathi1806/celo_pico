import { NextResponse } from "next/server";
import { MAX_URL_LENGTH, SAFETY_SUFFIX } from "@/lib/safety";
import { createToolHandler } from "@/lib/thirdweb-x402";
import { generateText, scrapeUrl } from "@/lib/ai-providers";

export const POST = createToolHandler("summarize-url", "$0.05", async (_req, body) => {
  const { url } = body;
  if (!url || url.trim().length < 10) {
    return NextResponse.json({ error: "A valid URL is required." }, { status: 400 });
  }
  if (url.length > MAX_URL_LENGTH) {
    return NextResponse.json({ error: "URL too long." }, { status: 400 });
  }

  const pageContent = await scrapeUrl(url);

  const text = await generateText({
    system:
      "You write TL;DR summaries: 3-4 bullet points followed by one sentence on why it matters." +
      SAFETY_SUFFIX,
    user: `URL: ${url}\n\nContent:\n${pageContent}\n\nSummarize for a busy reader.`,
    maxTokens: 400,
  });

  return NextResponse.json({ kind: "text", text, sourceUrl: url });
});
