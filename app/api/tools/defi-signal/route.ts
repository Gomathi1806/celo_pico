import { NextResponse } from "next/server";
import { MAX_PROMPT_LENGTH, SAFETY_SUFFIX, clampText } from "@/lib/safety";
import { createToolHandler } from "@/lib/thirdweb-x402";

export const POST = createToolHandler("defi-signal", "$0.05", async (_req, body) => {
  const { token, context } = body;
  if (!token || token.trim().length < 1) {
    return NextResponse.json({ error: "Token name or address is required." }, { status: 400 });
  }

  const userMsg =
    `Give me a concise DeFi signal for ${clampText(token, 100)} on the Celo network. ` +
    (context ? `Context: ${clampText(context, MAX_PROMPT_LENGTH)}. ` : "") +
    "Cover: current sentiment, key risks, and a one-line recommendation. Max 80 words.";

  const system =
    "You are a DeFi analyst focused on the Celo ecosystem (Ubeswap, Mento, Moola, GoodDollar). " +
    "Give concise, honest signals — not financial advice. Flag high-risk protocols clearly." +
    SAFETY_SUFFIX;

  const res = await fetch("https://text.pollinations.ai/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMsg },
      ],
      model: "openai",
    }),
  });

  if (!res.ok) throw new Error(`AI provider failed: ${res.status}`);
  const text = (await res.text()).trim();
  return NextResponse.json({ kind: "text", text, token });
});
