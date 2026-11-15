import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

function serveDataExplorePlugin(): Plugin {
  const dataExploreRoot = path.resolve(__dirname, '..', 'data', 'explore')

  const attachMiddleware = (middlewares: {
    use: (
      fn: (
        req: { url?: string; method?: string },
        res: {
          statusCode: number
          setHeader: (name: string, value: string) => void
          end: (body?: string | Buffer) => void
        },
        next: () => void,
      ) => void,
    ) => void
  }) => {
    middlewares.use((req, res, next) => {
      const rawUrl = req.url?.split('?')[0] ?? ''
      if (!rawUrl.startsWith('/data/explore/')) {
        next()
        return
      }

      const relPath = decodeURIComponent(rawUrl.slice('/data/explore/'.length))

      // Índice dinámico de escenas disponibles en ../data/explore/ para evitar 404 en consola
      if (relPath === '_index.json') {
        const scenes: Record<string, { hasCapas: boolean; hasGraficas: boolean }> = {}
        if (fs.existsSync(dataExploreRoot)) {
          for (const entry of fs.readdirSync(dataExploreRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue
            const dir = path.join(dataExploreRoot, entry.name)
            scenes[entry.name] = {
              hasCapas: fs.existsSync(path.join(dir, 'web', 'capas.json')),
              hasGraficas: fs.existsSync(path.join(dir, 'graficas.json')),
            }
          }
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(JSON.stringify({ scenes }))
        return
      }

      const absPath = path.resolve(dataExploreRoot, relPath)

      // Evitar cualquier escape fuera de ../data/explore/
      if (!absPath.startsWith(dataExploreRoot + path.sep) && absPath !== dataExploreRoot) {
        res.statusCode = 403
        res.end('Forbidden')
        return
      }

      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
        res.statusCode = 404
        res.end('Not found')
        return
      }

      const ext = path.extname(absPath).toLowerCase()
      const contentType =
        ext === '.json'
          ? 'application/json; charset=utf-8'
          : ext === '.png'
            ? 'image/png'
            : ext === '.tif' || ext === '.tiff'
              ? 'image/tiff'
              : ext === '.txt' || ext === '.csv'
                ? 'text/plain; charset=utf-8'
                : 'application/octet-stream'

      res.statusCode = 200
      res.setHeader('Content-Type', contentType)
      res.setHeader('Cache-Control', 'no-cache')
      res.end(fs.readFileSync(absPath))
    })
  }

  return {
    name: 'serve-data-explore',
    configureServer(server) {
      attachMiddleware(server.middlewares)
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serveDataExplorePlugin()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
})
