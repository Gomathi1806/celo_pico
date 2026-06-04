import { NextResponse } from "next/server";
import { MAX_URL_LENGTH, SAFETY_SUFFIX } from "@/lib/safety";
import { createToolHandler } from "@/lib/thirdweb-x402";

export const POST = createToolHandler("scrape", "$0.05", async (_req, body) => {
  const { url } = body;
  if (!url || url.trim().length < 10) {
    return NextResponse.json({ error: "A valid URL is required." }, { status: 400 });
  }
  if (url.length > MAX_URL_LENGTH) {
    return NextResponse.json({ error: "URL too long." }, { status: 400 });
  }

  const system =
    `You are a helpful assistant. The user wants the key takeaway from this URL: ${url}. ` +
    "Give a 2-3 sentence summary of what it covers." +
    SAFETY_SUFFIX;

  const res = await fetch("https://text.pollinations.ai/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: system }],
      model: "openai",
    }),
  });

  if (!res.ok) throw new Error(`AI provider failed: ${res.status}`);
  const text = (await res.text()).trim();
  return NextResponse.json({ kind: "text", text, sourceUrl: url });
});
