import { NextResponse } from "next/server";
import { MAX_PROMPT_LENGTH, isImagePromptBlocked } from "@/lib/safety";
import { createToolHandler } from "@/lib/thirdweb-x402";

export const POST = createToolHandler("image", "$0.10", async (_req, body) => {
  const { prompt } = body;

  if (!prompt || prompt.trim().length < 3) {
    return NextResponse.json({ error: "Prompt is required (3+ chars)." }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json({ error: `Prompt too long (max ${MAX_PROMPT_LENGTH} chars).` }, { status: 400 });
  }
  if (isImagePromptBlocked(prompt)) {
    return NextResponse.json({ error: "Prompt contains blocked terms." }, { status: 400 });
  }

  const seed = Math.floor(Math.random() * 1000000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    prompt
  )}?seed=${seed}&nologo=true&model=flux`;

  return NextResponse.json({ kind: "image", url, prompt });
});
