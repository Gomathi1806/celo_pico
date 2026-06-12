import { NextResponse } from "next/server";
import { MAX_PROMPT_LENGTH, isImagePromptBlocked } from "@/lib/safety";
import { createToolHandler } from "@/lib/thirdweb-x402";
import { generateImage } from "@/lib/ai-providers";

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

  const url = await generateImage({ prompt });

  return NextResponse.json({ kind: "image", url, prompt });
});
