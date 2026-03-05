import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    const baseSecurityHeaders = [
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "X-Frame-Options",
        value: "SAMEORIGIN",
      },
      {
        key: "Cross-Origin-Resource-Policy",
        value: "same-site",
      },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
    ];

    const pageSecurityHeaders = [
      ...baseSecurityHeaders,
      {
        key: "Cross-Origin-Opener-Policy",
        value: "same-origin",
      },
    ];

    const adminSecurityHeaders = [
      ...baseSecurityHeaders,
      {
        key: "Cross-Origin-Opener-Policy",
        value: "same-origin-allow-popups",
      },
    ];

    return [
      {
        source: "/admin",
        headers: adminSecurityHeaders,
      },
      {
        source: "/admin/:path*",
        headers: adminSecurityHeaders,
      },
      {
        source: "/((?!api|admin).*)",
        headers: pageSecurityHeaders,
      },
      {
        source: "/api/:path*",
        headers: [
          ...pageSecurityHeaders,
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow, noarchive",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
