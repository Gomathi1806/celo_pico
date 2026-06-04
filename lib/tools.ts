export type ToolId =
  | "image"
  | "scrape"
  | "ask"
  | "summarize-url"
  | "defi-signal"
  | "safescore";

export type ToolField = {
  name: string;
  label: string;
  placeholder: string;
  type: "text" | "textarea" | "url";
  required?: boolean;
};

export type Tool = {
  id: ToolId;
  label: string;
  tagline: string;
  price: `$${string}`;
  resultKind: "image" | "text";
  fields: ToolField[];
  endpoint: string;
};

export const TOOLS: Tool[] = [
  {
    id: "image",
    label: "Image",
    tagline: "Generate an image from a prompt",
    price: "$0.10",
    resultKind: "image",
    endpoint: "/api/tools/image",
    fields: [
      {
        name: "prompt",
        label: "Prompt",
        placeholder: "a vibrant Nairobi skyline at golden hour, cinematic",
        type: "textarea",
        required: true,
      },
    ],
  },
  {
    id: "scrape",
    label: "Scrape",
    tagline: "Pull the key takeaway from any URL",
    price: "$0.05",
    resultKind: "text",
    endpoint: "/api/tools/scrape",
    fields: [
      {
        name: "url",
        label: "URL",
        placeholder: "https://example.com/article",
        type: "url",
        required: true,
      },
    ],
  },
  {
    id: "ask",
    label: "Ask AI",
    tagline: "One quick question, no subscription",
    price: "$0.05",
    resultKind: "text",
    endpoint: "/api/tools/ask",
    fields: [
      {
        name: "question",
        label: "Question",
        placeholder: "What is the x402 protocol?",
        type: "textarea",
        required: true,
      },
    ],
  },
  {
    id: "summarize-url",
    label: "Summarize",
    tagline: "TL;DR any article or blog post",
    price: "$0.05",
    resultKind: "text",
    endpoint: "/api/tools/summarize-url",
    fields: [
      {
        name: "url",
        label: "URL to summarize",
        placeholder: "https://example.com/long-article",
        type: "url",
        required: true,
      },
    ],
  },
  {
    id: "defi-signal",
    label: "DeFi Signal",
    tagline: "AI alpha on any Celo token before you move",
    price: "$0.05",
    resultKind: "text",
    endpoint: "/api/tools/defi-signal",
    fields: [
      {
        name: "token",
        label: "Token name or address",
        placeholder: "CELO, cUSD, G$, UBESWAP, or 0x…",
        type: "text",
        required: true,
      },
      {
        name: "context",
        label: "What are you trying to do? (optional)",
        placeholder: "Thinking of swapping 10 cUSD → CELO on Ubeswap",
        type: "textarea",
        required: false,
      },
    ],
  },
  {
    id: "safescore",
    label: "SafeScore",
    tagline: "Rug-risk score for any DeFi protocol",
    price: "$0.05",
    resultKind: "text",
    endpoint: "/api/tools/safescore",
    fields: [
      {
        name: "protocol",
        label: "Protocol name",
        placeholder: "Ubeswap, Mento, Moola, Valora…",
        type: "text",
        required: true,
      },
    ],
  },
];

export function getTool(id: string): Tool | undefined {
  return TOOLS.find((t) => t.id === id);
}
