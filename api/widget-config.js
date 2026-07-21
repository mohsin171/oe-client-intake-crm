// GET /api/widget-config -> public branding for the embeddable widget.
import { CONFIG } from "../lib/config.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json({
    firmName: CONFIG.firm.name,
    accent: CONFIG.widget.accent,
    greeting: CONFIG.widget.greeting,
    timezone: (CONFIG.firm.availability && CONFIG.firm.availability.timezone) || "Europe/London",
  });
}
