import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const revalidate = 86400; // 1 day

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background:
            "radial-gradient(circle at 30% 20%, #064e3b 0%, #0a0a0a 70%)",
          color: "white",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          padding: 80,
        }}
      >
        {/* Glow halo — Celo yellow/green palette */}
        <div
          style={{
            position: "absolute",
            top: 200,
            display: "flex",
            width: 520,
            height: 520,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(252,255,82,0.35) 0%, rgba(252,255,82,0) 70%)",
          }}
        />
        {/* The orb */}
        <div
          style={{
            display: "flex",
            width: 240,
            height: 240,
            borderRadius: "50%",
            background:
              "radial-gradient(circle at 35% 30%, #fef9c3 0%, #fcff52 28%, #35d07f 65%, #064e3b 100%)",
            marginBottom: 60,
          }}
        />
        <div
          style={{
            display: "flex",
            fontSize: 168,
            fontWeight: 700,
            letterSpacing: "-0.05em",
            lineHeight: 1,
            fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
          }}
        >
          pico
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 28,
            fontSize: 36,
            color: "rgba(255,255,255,0.65)",
            letterSpacing: "-0.01em",
          }}
        >
          Pennies of AI, settled inline.
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 12,
            fontSize: 22,
            color: "rgba(255,255,255,0.35)",
            fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
          }}
        >
          pay-per-use AI for MiniPay · settled in cUSD over x402 on Celo
        </div>
      </div>
    ),
    { width: 1200, height: 800 },
  );
}
