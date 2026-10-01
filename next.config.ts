import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/WASM packages run in Node only; keep them out of the server bundle.
  serverExternalPackages: ["@electric-sql/pglite", "@react-pdf/renderer", "pg"],
  // Migrations are read at runtime by the PGlite path.
  outputFileTracingIncludes: { "/**": ["./drizzle/**/*"] },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
