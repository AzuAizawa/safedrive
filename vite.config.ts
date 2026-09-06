import path from "path"
import { existsSync } from "fs"
import { fileURLToPath } from "url"
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const localApiPlugin = (): Plugin => ({
  name: "safedrive-local-api",
  apply: "serve",
  configureServer(server) {
    const apiRoot = path.resolve(__dirname, "api")

    server.middlewares.use(async (incoming, outgoing, next) => {
      const requestUrl = new URL(
        incoming.url || "/",
        `http://${incoming.headers.host || "127.0.0.1:5173"}`,
      )

      if (
        !requestUrl.pathname.startsWith("/api/") ||
        requestUrl.pathname.startsWith("/api/lib/") ||
        !/^\/api\/[a-z0-9/-]+$/i.test(requestUrl.pathname)
      ) {
        next()
        return
      }

      const relativeModulePath = `${requestUrl.pathname.slice(1)}.ts`
      const absoluteModulePath = path.resolve(__dirname, relativeModulePath)
      if (
        !absoluteModulePath.startsWith(`${apiRoot}${path.sep}`) ||
        !existsSync(absoluteModulePath)
      ) {
        next()
        return
      }

      try {
        const chunks: Buffer[] = []
        for await (const chunk of incoming) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        }

        const headers = new Headers()
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) {
            value.forEach((entry) => headers.append(name, entry))
          } else if (value !== undefined) {
            headers.set(name, value)
          }
        }

        const method = incoming.method || "GET"
        const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined
        const request = new Request(requestUrl, {
          method,
          headers,
          ...(method !== "GET" && method !== "HEAD" && body ? { body } : {}),
        })

        const apiModule = await server.ssrLoadModule(`/${relativeModulePath}`)
        if (typeof apiModule.default !== "function") {
          throw new Error(`Local API route ${requestUrl.pathname} has no default handler`)
        }

        const response = await apiModule.default(request)
        if (!(response instanceof Response)) {
          throw new Error(`Local API route ${requestUrl.pathname} did not return a Response`)
        }

        outgoing.statusCode = response.status
        response.headers.forEach((value, name) => outgoing.setHeader(name, value))
        if (method === "HEAD" || response.body === null) {
          outgoing.end()
          return
        }

        outgoing.end(Buffer.from(await response.arrayBuffer()))
      } catch (error) {
        if (error instanceof Error) server.ssrFixStacktrace(error)
        console.error(`Local API error for ${requestUrl.pathname}`, error)
        if (!outgoing.headersSent) {
          outgoing.statusCode = 500
          outgoing.setHeader("Content-Type", "application/json")
        }
        outgoing.end(JSON.stringify({ error: "Local API request failed" }))
      }
    })
  },
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const localEnvironment = loadEnv(mode, __dirname, "")
  for (const [name, value] of Object.entries(localEnvironment)) {
    if (process.env[name] === undefined) process.env[name] = value
  }

  return {
    plugins: [
      localApiPlugin(),
      react(),
      tailwindcss(),
      // Renter/lister-facing PWA support. The manifest is a hand-authored
      // static file (public/manifest.webmanifest) rather than plugin-
      // generated, so `manifest: false` here and the <link rel="manifest">
      // + Apple meta tags are added by hand in index.html.
      //
      // Supabase (*.supabase.co) and this app's own /api/* edge functions
      // must NEVER be served from the service-worker cache - both carry live
      // booking/payment/account data. Workbox already passes any request
      // that matches no route straight to the network, so these two rules
      // are belt-and-suspenders: they make that "never cached" guarantee
      // visible in config instead of relying on the absence of a rule.
      //
      // registerType: 'autoUpdate' (+ skipWaiting/clientsClaim) matches this
      // codebase's existing "recover automatically, don't ask the user to
      // manually refresh" philosophy already used for stale-chunk recovery
      // (see src/lib/lazyWithReload.ts and the vite:preloadError listener in
      // src/main.tsx) - a new service worker takes over promptly instead of
      // leaving an old one in control indefinitely.
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        manifest: false,
        includeAssets: ['favicon.svg', 'icons.svg', 'apple-touch-icon.png', 'icons/*.png'],
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
          skipWaiting: true,
          clientsClaim: true,
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co'),
              handler: 'NetworkOnly',
            },
            {
              urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/api/'),
              handler: 'NetworkOnly',
            },
          ],
        },
      }),
    ],
    // Use one deterministic local listener. This prevents separate IPv4 and
    // IPv6 Vite processes from serving different optimized React runtimes.
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      // Keep router/UI packages on the same React instance during dev-server
      // restarts and dependency re-optimization.
      dedupe: ["react", "react-dom", "react-router"],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.split("\\").join("/")
            if (!normalizedId.includes("node_modules")) return undefined
            const packagePath = normalizedId.split("/node_modules/")[1] || ""
            const packageParts = packagePath.split("/")
            const packageName = packageParts[0]?.startsWith("@")
              ? `${packageParts[0]}/${packageParts[1] ?? ""}`
              : packageParts[0] ?? "vendor"

            if (
              [
                "react",
                "react-dom",
                "react-router",
                "@tanstack/react-query",
              ].includes(packageName) || packageName === "cookie-es"
            ) {
              return "react-vendor"
            }

            if (packageName.startsWith("@supabase/") || ["cookie", "set-cookie-parser"].includes(packageName)) {
              return "supabase-vendor"
            }

            if (["date-fns", "react-day-picker"].includes(packageName)) {
              return "date-vendor"
            }

            if (
              [
                "@base-ui/react",
                "lucide-react",
                "sonner",
                "next-themes",
                "react-hook-form",
                "@hookform/resolvers",
                "zod",
                "clsx",
                "class-variance-authority",
                "tailwind-merge",
              ].includes(packageName)
            ) {
              return "ui-vendor"
            }

            if (packageName === "tesseract.js") {
              return "ocr-vendor"
            }

            return undefined
          }
        },
      },
    },
  }
})
