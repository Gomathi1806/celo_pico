import { NextResponse } from "next/server";
import { MAX_PROMPT_LENGTH, SAFETY_SUFFIX, clampText } from "@/lib/safety";
import { createToolHandler } from "@/lib/thirdweb-x402";
import { generateText } from "@/lib/ai-providers";

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

  const text = await generateText({
    system,
    user: clampText(question),
    maxTokens: 200,
  });

  return NextResponse.json({ kind: "text", text, question });
});
