/* ============================================================
   TriCoach Chat Worker — Anthropic-Proxy (Cloudflare Workers)
   ------------------------------------------------------------
   Hält den ANTHROPIC_API_KEY (Secret), nimmt Chat-Anfragen der
   PWA entgegen, prüft eine Passphrase (Secret CHAT_PASSPHRASE,
   da GitHub Pages öffentlich ist) und streamt die Coach-Antwort
   zurück. Modell: claude-sonnet-4-6.

   Deploy (Windows, im Ordner worker/):
     npx wrangler secret put ANTHROPIC_API_KEY
     npx wrangler secret put CHAT_PASSPHRASE
     npx wrangler deploy
   ============================================================ */

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;

// Coach-Persona + harte Regeln. Selbstständig im Worker gehalten,
// da der Worker zur Laufzeit keine Repo-Dateien lesen kann.
// Spiegelt coach/methodology.md (Kurzfassung).
const COACH_SYSTEM = `Du bist der persönliche KI-Triathlon-Coach von Marvin Griegel, auf dem Weg zum IRONMAN 70.3 Zell am See (≈ 29.08.2027). Du sprichst Deutsch, direkt, motivierend und präzise — wie ein erfahrener Long-Course-Coach (Schule Laura Philipp / Kristian Blummenfelt).

TRAININGSPHILOSOPHIE:
- Polarisiert 80/20: 80 % der Zeit locker (Z1–Z2), 20 % gezielt hart (Z4–Z5). Kein Junk-Mitteltempo.
- Periodisierung 3:1 (3 Belastungswochen + 1 Entlastung). Umfang +8–10 %/Belastungswoche, Entlastung −35–40 %. Nur eine neue Stressquelle pro Zeit (Umfang ODER Intensität).
- Schwimmen ist der Limiter und Priorität #1: 3×/Woche, Technik vor Umfang, erst CSS etablieren.
- Rad ist die Stärke (aerobe Long Rides + Sweet-Spot/Schwelle), Lauf ökonomisch halten + Durability (Bricks).
- Kraft 2×/Woche für Verletzungsschutz und Rumpf.

TAGESFORM-AMPEL (entscheidet die heutige Anpassung):
- GRÜN: Plan voll ausführen, Quality frei.
- GELB: Intensität raus — harte Einheit → Z2-Dauer, Intervalle −30 %, Long −20 %.
- ROT: Ruhe oder Z1 ≤ 30–40 min, kein Quality, Quality auf Folgetag schieben.

PHYSIOLOGIE: RHR 42, HRmax ~191, LTHR 167, HRV-Baseline 71, VO₂max Lauf 54. FTP und Schwimm-CSS noch offen (TBD).

VERHALTEN:
- Nutze den mitgelieferten Athleten-Kontext (heutige Readiness, heutige Einheit, letzte Aktivitäten) für konkrete, datengestützte Antworten.
- Sei knapp und konkret. Keine medizinischen Diagnosen — bei Krankheitszeichen zu Ruhe und ggf. Arzt raten.
- Wenn dir Daten fehlen, sag es und gib trotzdem die beste Trainings-Empfehlung nach den Regeln oben.`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-TriCoach-Pass",
  "Access-Control-Max-Age": "86400",
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function buildContextText(ctx) {
  if (!ctx || typeof ctx !== "object") return "";
  const lines = [];
  const r = ctx.readiness;
  if (r) lines.push(`Heutige Readiness: ${r.score}/100 (${r.verdict?.toUpperCase?.() || r.verdict}) — ${r.message || ""}`);
  const t = ctx.today;
  if (t) {
    lines.push(`Heutige Einheit: ${t.title} (${t.discipline}, ${t.duration}). ${t.coachNote || ""}`);
    if (t.adjustment) lines.push(`Geplante Anpassung: ${t.adjustment}`);
  }
  const v = ctx.vitals;
  if (v) {
    const bits = [];
    if (v.hrv) bits.push(`HRV ${v.hrv.value}`);
    if (v.rhr) bits.push(`RHR ${v.rhr.value}`);
    if (v.sleep) bits.push(`Schlaf ${v.sleep.value}`);
    if (v.bodyBattery) bits.push(`Body Battery ${v.bodyBattery.value}`);
    if (v.stress) bits.push(`Stress ${v.stress.value}`);
    if (v.vo2max) bits.push(`VO₂max ${v.vo2max.value}`);
    if (bits.length) lines.push(`Vitalwerte: ${bits.join(", ")}.`);
  }
  if (ctx.phase?.block) lines.push(`Aktueller Block: ${ctx.phase.block}.`);
  if (ctx.race) lines.push(`Rennen: ${ctx.race.name} in ${ctx.race.daysToGo} Tagen.`);
  if (Array.isArray(ctx.recentActivities) && ctx.recentActivities.length) {
    const acts = ctx.recentActivities.slice(0, 6)
      .map((a) => `${a.name} (${a.detail || ""}, ${a.date})`).join("; ");
    lines.push(`Letzte Aktivitäten: ${acts}.`);
  }
  if (!lines.length) return "";
  return `AKTUELLER ATHLETEN-KONTEXT (vom Garmin-Morgen-Pull):\n${lines.join("\n")}`;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || !url.pathname.endsWith("/chat")) {
      return json(404, { error: "Not found. POST /chat erwartet." });
    }

    // Passphrase-Schutz (GitHub Pages ist öffentlich)
    const pass = request.headers.get("X-TriCoach-Pass") || "";
    if (!env.CHAT_PASSPHRASE || pass !== env.CHAT_PASSPHRASE) {
      return json(401, { error: "Falsche oder fehlende Passphrase." });
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json(500, { error: "Server: ANTHROPIC_API_KEY nicht gesetzt." });
    }

    let body;
    try {
      body = await request.json();
    } catch (_) {
      return json(400, { error: "Ungültiger JSON-Body." });
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return json(400, { error: "Keine messages." });

    let system = COACH_SYSTEM;
    const ctxText = buildContextText(body.context);
    if (ctxText) system += `\n\n${ctxText}`;

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: messages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content || ""),
        })),
        stream: true,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      return json(upstream.status, { error: "Anthropic-Fehler", detail: errText.slice(0, 500) });
    }

    // SSE-Stream unverändert durchreichen
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...CORS,
      },
    });
  },
};
