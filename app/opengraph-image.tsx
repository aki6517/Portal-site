import { ImageResponse } from "next/og";

// サイト全体の既定OG画像（1200x630）。個別ページでbuildMetadataにimageを渡さない場合、
// このファイル規約画像がNextにより自動適用される（lib/seo.tsのimages省略と対応）。

export const alt = "福岡アクトポータル - 福岡の演劇・舞台公演ポータル";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#111318";
const PAPER = "#f6f6f8";
const POP_PINK = "#ff4785";
const POP_BLUE = "#206cee";
const POP_YELLOW = "#ffd600";

const TITLE_TEXT = "福岡アクトポータル";
const SUBTITLE_TEXT = "福岡の演劇・舞台公演ポータル";
const EYEBROW_TEXT = "FUKUOKA ACT PORTAL";

// next/og（satori）は日本語グリフを内蔵していないため、Google Fontsから
// 必要な文字だけを含むフォントファイルをビルド時に取得して埋め込む。
// User-AgentをレガシーChromeにするとGoogleがwoff2ではなくtruetypeを返す
// （satoriがtruetype/opentypeのみ対応のため。新規npm依存の追加ではない）。
const loadGoogleFont = async (weight: number, text: string) => {
  const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@${weight}&text=${encodeURIComponent(
    text
  )}`;
  const cssResponse = await fetch(cssUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2228.0 Safari/537.36",
    },
  });
  const css = await cssResponse.text();
  const match = css.match(/src: url\(([^)]+)\) format\('(?:opentype|truetype|woff)'\)/);
  if (!match) {
    throw new Error(`opengraph-image: Google Fontsのソースが見つかりません（weight=${weight}）`);
  }
  const fontResponse = await fetch(match[1]);
  return fontResponse.arrayBuffer();
};

// 20px間隔のドット柄（globals.cssのbody背景と同トーン）をdata URIのタイル画像で表現。
// satoriのbackground-imageはurl()指定の画像タイルに対応している。
const DOT_PATTERN_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Ccircle cx='1.5' cy='1.5' r='1.5' fill='%23e2e2e6'/%3E%3C/svg%3E";

export default async function OpengraphImage() {
  const fontData = await loadGoogleFont(900, `${TITLE_TEXT}${SUBTITLE_TEXT}${EYEBROW_TEXT}`);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: PAPER,
          backgroundImage: `url("${DOT_PATTERN_URL}")`,
          backgroundRepeat: "repeat",
          backgroundSize: "20px 20px",
          padding: "48px",
          fontFamily: "Noto Sans JP",
        }}
      >
        <div
          style={{
            position: "relative",
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            backgroundColor: "#ffffff",
            border: `6px solid ${INK}`,
            borderRadius: "28px",
            boxShadow: `18px 18px 0px 0px ${INK}`,
            padding: "72px",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "-30px",
              left: "-30px",
              width: "68px",
              height: "68px",
              display: "flex",
              backgroundColor: POP_PINK,
              border: `6px solid ${INK}`,
              borderRadius: "9999px",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: "-28px",
              right: "88px",
              width: "84px",
              height: "84px",
              display: "flex",
              backgroundColor: POP_BLUE,
              border: `6px solid ${INK}`,
              borderRadius: "16px",
              transform: "rotate(14deg)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "48px",
              right: "-24px",
              width: "56px",
              height: "56px",
              display: "flex",
              backgroundColor: POP_YELLOW,
              border: `6px solid ${INK}`,
              borderRadius: "14px",
              transform: "rotate(-10deg)",
            }}
          />

          <div
            style={{
              display: "flex",
              fontSize: 28,
              fontWeight: 900,
              color: POP_BLUE,
              letterSpacing: "0.08em",
            }}
          >
            {EYEBROW_TEXT}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: "20px",
              fontSize: 88,
              fontWeight: 900,
              color: INK,
              lineHeight: 1.15,
            }}
          >
            {TITLE_TEXT}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: "28px",
              fontSize: 34,
              fontWeight: 900,
              color: "#464b57",
            }}
          >
            {SUBTITLE_TEXT}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Noto Sans JP",
          data: fontData,
          weight: 900,
          style: "normal",
        },
      ],
    }
  );
}
