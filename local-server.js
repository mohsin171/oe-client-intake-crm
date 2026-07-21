// Local-only: mounts the /api serverless functions on an Express server so we
// can test them locally exactly as they'll run on Vercel. NOT used in
// production - Vercel serves /api itself. Run: node local-server.js
import "dotenv/config";
import express from "express";
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Auto-mount every file in /api as a route at /api/<name>.
const apiDir = join(__dirname, "api");
for (const file of readdirSync(apiDir).filter((f) => f.endsWith(".js"))) {
  const route = "/api/" + file.replace(/\.js$/, "");
  const mod = await import(pathToFileURL(join(apiDir, file)).href);
  const handler = mod.default;
  app.all(route, (req, res) => {
    // shim: Vercel puts query on req.query (Express does too) - fine as-is
    handler(req, res);
  });
  console.log("mounted", route);
}

const PORT = process.env.API_PORT || 3001;
app.listen(PORT, () => console.log(`Local API server on http://localhost:${PORT}`));
