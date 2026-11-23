import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts", "src/server.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: false,
  },
  {
    // The React entry keeps the directive Next.js App Router needs.
    entry: ["src/react.tsx"],
    format: ["esm", "cjs"],
    dts: true,
    clean: false,
    external: ["react"],
    // The boundary must share the core's state, so it imports the published
    // core entry instead of bundling a second copy of it.
    esbuildPlugins: [
      {
        name: "core-external",
        setup(build) {
          build.onResolve({ filter: /^\.\/index$/ }, () => ({ path: "edxr-error-reporter", external: true }));
        },
      },
    ],
    banner: { js: '"use client";' },
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
]);
