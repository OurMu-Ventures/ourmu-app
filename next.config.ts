import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "1mb",
    },
  },
  async redirects() {
    return [
      {
        source: "/admin/investors",
        destination: "/admin/partners",
        permanent: true,
      },
    ];
  },
  async headers() {
    // NOTE: when multiple rules match a path and set the same header key,
    // the LAST rule wins. The generic catch-all therefore comes first so the
    // `/auth/start` rule below is the final authority for that page
    // (Referrer-Policy: no-referrer must survive).
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        source: "/auth/start",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
