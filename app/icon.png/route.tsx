import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const revalidate = 86400;

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
        }}
      >
        <div
          style={{
            display: "flex",
            width: 840,
            height: 840,
            borderRadius: "50%",
            background:
              "radial-gradient(circle at 35% 30%, #fef9c3 0%, #f59e0b 28%, #a855f7 65%, #1e1b4b 100%)",
          }}
        />
      </div>
    ),
    // 1024×1024 — square (1:1), the size Base App / base.dev expects.
    { width: 1024, height: 1024 },
  );
}
