import path from "path"
import { existsSync } from "fs"
import { fileURLToPath } from "url"
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
    plugins: [localApiPlugin(), react(), tailwindcss()],
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
