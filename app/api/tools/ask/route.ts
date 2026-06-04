import { NextRequest, NextResponse } from "next/server";
import { MAX_PROMPT_LENGTH, SAFETY_SUFFIX, clampText } from "@/lib/safety";
import { createToolHandler } from "@/lib/thirdweb-x402";

export const POST = createToolHandler("ask", "$0.05", async (_req, body) => {
  const { question } = body;
  if (!question || question.trim().length < 3) {
    return NextResponse.json({ error: "Question is required (3+ chars)." }, { status: 400 });
  }
  if (question.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json({ error: `Question too long (max ${MAX_PROMPT_LENGTH} chars).` }, { status: 400 });
  }

  const system =
    "You answer one question concisely. Be direct and under 60 words." + SAFETY_SUFFIX;

  const res = await fetch("https://text.pollinations.ai/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: system },
        { role: "user", content: clampText(question) },
      ],
      model: "openai",
    }),
  });

  if (!res.ok) throw new Error(`AI provider failed: ${res.status}`);
  const text = (await res.text()).trim();
  return NextResponse.json({ kind: "text", text, question });
});
