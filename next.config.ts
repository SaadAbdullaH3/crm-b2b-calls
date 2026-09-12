import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * pdfkit (RP-01 PDF export) loads its built-in font metrics from files inside
   * its own package at runtime. Bundled into a route's server chunk those paths
   * no longer resolve and every PDF export fails at the first `.font()` call —
   * at runtime, not at build time. Keeping it external is the documented fix.
   */
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
