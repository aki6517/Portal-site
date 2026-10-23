// 本番で動いている Node.js の版をログに残す（Vercel のランタイム更新の確認用）
export function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    console.info(
      `[runtime] node ${process.version} env=${process.env.VERCEL_ENV ?? "local"} region=${process.env.VERCEL_REGION ?? "-"}`
    );
  }
}
