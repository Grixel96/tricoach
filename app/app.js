/* ============================================================
   TriCoach — App Renderer
   Lädt data.json (vom GitHub-Actions-Job geschrieben) und
   rendert das Dashboard. Offline-fähig via Service Worker.
   ============================================================ */

const DISC = {
  swim:     { icon: "🏊", name: "Schwimmen" },
  bike:     { icon: "🚴", name: "Rad" },
  run:      { icon: "🏃", name: "Lauf" },
  strength: { icon: "🏋️", name: "Kraft" },
  rest:     { icon: "😴", name: "Ruhe" },
};

const $ = (sel, el = document) => el.querySelector(sel);

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return "Guten Morgen";
  if (h < 17) return "Servus";
  return "Guten Abend";
}

let DATA = null;
let HISTORY = [];
let PLAN = null;
let REVIEW = null;

async function load() {
  let data;
  try {
    const res = await fetch("./data.json", { cache: "no-store" });
    data = await res.json();
  } catch (e) {
    try {
      const cached = await caches.match("./data.json");
      data = await cached.json();
    } catch (_) {
      return fail();
    }
  }
  DATA = data;
  // Zusatz-Files optional — Views nutzen sie, Rest läuft ohne
  [HISTORY, PLAN, REVIEW] = await Promise.all([
    fetchJSON("./history.json", []),
    fetchJSON("./plan.json", null),
    fetchJSON("./review.json", null),
  ]);
  route();
}

async function fetchJSON(url, fallback) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (r.ok) return await r.json();
  } catch (_) {}
  return fallback;
}

function fail() {
  document.getElementById("app").innerHTML =
    `<div class="loading"><p>Keine Daten gefunden.<br/>Bist du offline und noch nie online gewesen?</p></div>`;
}

/* ---------- Router (hash-basiert, kein Build) ---------- */
const VIEWS = {
  dashboard: { render: viewDashboard, post: postDashboard },
  plan:      { render: viewPlan },
  analyse:   { render: viewAnalyse, post: postAnalyse },
  coach:     { render: viewCoach, post: postCoach },
  profil:    { render: viewProfil, post: postProfil },
};

function currentView() {
  const h = (location.hash || "").replace(/^#/, "");
  return VIEWS[h] ? h : "dashboard";
}

function route() {
  if (!DATA) return;
  const app = document.getElementById("app");
  app.removeAttribute("aria-busy");
  const name = currentView();
  app.innerHTML = VIEWS[name].render(DATA);
  VIEWS[name].post?.(DATA);
  // aktiven Tab markieren
  document.querySelectorAll(".tab").forEach(t =>
    t.classList.toggle("active", t.dataset.view === name));
  window.scrollTo(0, 0);
  app.querySelectorAll(".card, .vitals, .week, .recent").forEach((el, i) => {
    el.classList.add("fade-in"); el.style.animationDelay = (i * 0.04) + "s";
  });
}

/* ---------- View: Dashboard ---------- */
function viewDashboard(d) {
  return [
    topbar(d),
    hero(d),
    today(d),
    `<div class="section-title">Tagesform</div>`,
    vitals(d),
    `<div class="section-title">${d.weekMeta && d.weekMeta.isUpcoming ? "Kommende Trainingswoche" : "Deine Woche"}</div>`,
    weekStrip(d),
    `<div class="section-title">Form & Prognose</div>`,
    form(d),
    `<div class="section-title">Zuletzt</div>`,
    recent(d),
    footer(d),
  ].join("");
}

function postDashboard(d) {
  // animate ring
  requestAnimationFrame(() => {
    const fg = $(".ring-fg");
    if (fg) {
      const c = 2 * Math.PI * 52;
      fg.style.strokeDashoffset = c * (1 - d.readiness.score / 100);
    }
  });
  bindWeek(d);
  $(".refresh")?.addEventListener("click", () => location.reload());
}

/* ---------- View-Stubs (werden in Phase B–E ausgebaut) ---------- */
function viewHeader(title, sub) {
  return `
  <div class="topbar">
    <div class="greeting">
      <div class="hi">${title}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ""}
    </div>
  </div>`;
}

function viewStub(title, sub, emoji, note) {
  return viewHeader(title, sub) + `
  <section class="card" style="text-align:center; padding:36px 22px;">
    <div style="font-size:40px; line-height:1; margin-bottom:12px;">${emoji}</div>
    <p style="color:var(--text-dim); font-size:14px;">${note}</p>
  </section>`;
}

/* ---------- View: Plan (Block + KI-Review) ---------- */
const LOAD_BADGE = {
  "leicht erhöhen": { cls: "up", icon: "↗", txt: "Last leicht erhöhen" },
  "halten":         { cls: "hold", icon: "→", txt: "Last halten" },
  "reduzieren":     { cls: "down", icon: "↘", txt: "Last reduzieren" },
};

function viewPlan(d) {
  const head = viewHeader("Plan", PLAN ? PLAN.block : "Dein Trainingsblock");
  return head + weekProgress(d) + reviewCard() + planWeeks();
}

/* Wochenfortschritt: Soll (Plan) vs Ist (history) je Disziplin als Ringe. */
function weekProgress(d) {
  if (!PLAN || !PLAN.weeks) return "";
  const todayIso = (d.today && d.today.date) || new Date().toISOString().slice(0, 10);
  const wk = PLAN.weeks.find((w) => todayIso >= w.weekStart && todayIso <= addDaysIso(w.weekStart, 6));
  if (!wk) return "";
  const ws = wk.weekStart, we = addDaysIso(ws, 6);

  const discs = ["swim", "bike", "run", "strength"];
  const soll = { swim: 0, bike: 0, run: 0, strength: 0 };
  wk.days.forEach((dd) => (dd.sessions || []).forEach((s) => {
    if (soll[s.discipline] != null) soll[s.discipline] += s.duration || 0;
  }));
  const ist = { swim: 0, bike: 0, run: 0, strength: 0 };
  HISTORY.filter((r) => r.date >= ws && r.date <= we).forEach((r) =>
    (r.activities || []).forEach((a) => {
      if (ist[a.discipline] != null) ist[a.discipline] += a.duration || 0;
    }));

  const rings = discs.filter((k) => soll[k] > 0).map((k) => {
    const pct = Math.min(ist[k] / soll[k], 1);
    return progressRing(k, pct, Math.round(ist[k]), Math.round(soll[k]));
  }).join("");
  if (!rings) return "";
  return `
  <section class="card">
    <div class="eyebrow">📊 Wochenfortschritt · ${wk.label}</div>
    <div class="wp-rings">${rings}</div>
  </section>`;
}

function progressRing(disc, pct, istMin, sollMin) {
  const R = 26, C = 2 * Math.PI * R;
  const off = C * (1 - pct);
  const done = pct >= 1;
  return `
  <div class="wp-ring" data-disc="${disc}">
    <svg width="64" height="64" viewBox="0 0 64 64">
      <circle class="wpr-bg" cx="32" cy="32" r="${R}" fill="none" stroke-width="6"></circle>
      <circle class="wpr-fg" cx="32" cy="32" r="${R}" fill="none" stroke-width="6"
        stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" stroke-linecap="round"
        transform="rotate(-90 32 32)"></circle>
    </svg>
    <div class="wpr-ic">${done ? "✓" : DISC[disc].icon}</div>
    <div class="wp-lbl">${DISC[disc].name}</div>
    <div class="wp-min">${Math.round(istMin / 60 * 10) / 10}/${Math.round(sollMin / 60 * 10) / 10} h</div>
  </div>`;
}

function reviewCard() {
  const rv = REVIEW;
  if (!rv) {
    return `<section class="card"><div class="eyebrow">KI-Review</div>
      <p style="color:var(--text-dim);font-size:13px;margin-top:10px;">
        Das wöchentliche KI-Review erscheint hier nach dem nächsten Sonntag-Lauf.</p></section>`;
  }
  const b = LOAD_BADGE[rv.load] || LOAD_BADGE["halten"];
  const lw = rv.lastWeek || {};
  const stats = lw.hasData ? `
    <div class="rv-stats">
      <div class="rv-stat"><span class="rs-v">${Math.round(lw.actualTss || 0)}</span><span class="rs-l">TSS</span></div>
      <div class="rv-stat"><span class="rs-v">${lw.sessions || 0}</span><span class="rs-l">Einheiten</span></div>
      <div class="rv-stat"><span class="rs-v">${lw.avgReadiness ?? "–"}</span><span class="rs-l">Ø Readiness</span></div>
      <div class="rv-stat"><span class="rs-v">${fmtSigned(lw.tsb)}</span><span class="rs-l">Form</span></div>
    </div>` : "";
  const focus = (rv.focus || []).map((f) => `<li>${f}</li>`).join("");
  const adj = (rv.adjustments || []).filter((a) => a && a.change).map((a) =>
    `<li><b>${a.day}:</b> ${a.change}</li>`).join("");
  return `
  <section class="card rv-card">
    <div class="rv-head">
      <div class="eyebrow">KI-Coach Review${rv.source && rv.source !== "regelbasiert" ? "" : " · regelbasiert"}</div>
      <span class="rv-load ${b.cls}">${b.icon} ${b.txt}</span>
    </div>
    <p class="rv-summary">${rv.summary || ""}</p>
    ${stats}
    ${focus ? `<div class="rv-sub">Fokus kommende Woche${rv.weekLabel ? ` · ${rv.weekLabel}` : ""}</div><ul class="rv-list">${focus}</ul>` : ""}
    ${adj ? `<div class="rv-sub">Anpassungen</div><ul class="rv-list adj">${adj}</ul>` : ""}
  </section>`;
}

function planWeeks() {
  if (!PLAN || !PLAN.weeks) {
    return `<section class="card"><p style="color:var(--text-dim);font-size:13px;">
      Kein Plan-Block geladen.</p></section>`;
  }
  const todayIso = (DATA && DATA.today && DATA.today.date) || new Date().toISOString().slice(0, 10);
  return PLAN.weeks.map((w) => {
    const ws = w.weekStart;
    const we = addDaysIso(ws, 6);
    const isCurrent = todayIso >= ws && todayIso <= we;
    const totalMin = w.days.reduce((a, dd) => a + (dd.sessions || []).reduce((x, s) => x + (s.duration || 0), 0), 0);
    const dots = w.days.map((dd) => {
      const sess = dd.sessions || [];
      const disc = sess.length ? sess[0].discipline : "rest";
      const isToday = dd.date === todayIso;
      const mins = sess.reduce((x, s) => x + (s.duration || 0), 0);
      return `<div class="pw-day ${isToday ? "today" : ""}" data-disc="${disc}">
        <span class="pw-wd">${dd.day}</span>
        <span class="pw-dot">${sess.length ? DISC[disc].icon : "·"}</span>
        <span class="pw-min">${mins ? mins + "′" : ""}</span>
      </div>`;
    }).join("");
    return `
    <section class="card pw-week ${isCurrent ? "current" : ""}">
      <div class="pw-head">
        <div class="pw-l">${w.label}${isCurrent ? ` <span class="pw-now">aktuell</span>` : ""}</div>
        <div class="pw-r">ab ${shortDate(ws)} · ${(totalMin / 60).toFixed(1)} h</div>
      </div>
      <div class="pw-grid">${dots}</div>
    </section>`;
  }).join("");
}

function addDaysIso(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
/* ---------- View: Analyse (Charts) ---------- */
const RANGES = [
  { k: "7d", label: "7T", days: 7 },
  { k: "4w", label: "4W", days: 28 },
  { k: "3m", label: "3M", days: 90 },
  { k: "1y", label: "1J", days: 365 },
];
let analyseRange = "4w";

function rangeRecords() {
  const days = (RANGES.find((r) => r.k === analyseRange) || RANGES[1]).days;
  const cut = new Date(); cut.setDate(cut.getDate() - days);
  const cutIso = cut.toISOString().slice(0, 10);
  return HISTORY.filter((r) => r.date >= cutIso);
}

function viewAnalyse(d) {
  const recs = rangeRecords();
  const tabs = RANGES.map((r) =>
    `<button class="rng ${r.k === analyseRange ? "active" : ""}" data-rng="${r.k}">${r.label}</button>`).join("");
  const head = viewHeader("Analyse", "Fitness, Form & Trends") +
    `<div class="rng-bar">${tabs}</div>`;

  if (recs.length < 2) {
    return head + `
    <section class="card" style="text-align:center;padding:34px 22px;">
      <div style="font-size:38px;margin-bottom:10px;">📈</div>
      <p style="color:var(--text-dim);font-size:14px;line-height:1.5;">
        Noch zu wenig Verlauf für Charts.<br/>Die App sammelt ab jetzt täglich Daten —
        in ein paar Tagen siehst du hier Fitness-Kurve, HRV und Volumen.</p>
    </section>`;
  }

  const last = recs[recs.length - 1];
  const ctl = recs.map((r) => r.ctl ?? null);
  const atl = recs.map((r) => r.atl ?? null);
  const tsb = recs.map((r) => r.tsb ?? null);
  const hrv = recs.map((r) => r.hrv ?? null);
  const vo2 = recs.map((r) => r.vo2max ?? null);

  return head + `
  ${chartCard("Fitness & Form", `CTL ${fmtNum(last.ctl)} · ATL ${fmtNum(last.atl)} · Form ${fmtSigned(last.tsb)}`,
    multiLineSVG([
      { vals: ctl, color: "var(--swim)", label: "Fitness (CTL)" },
      { vals: atl, color: "var(--run)", label: "Ermüdung (ATL)" },
      { vals: tsb, color: "var(--green)", label: "Form (TSB)", dashed: true },
    ], { zero: true }),
    `<span class="lg"><i style="background:var(--swim)"></i>Fitness</span>
     <span class="lg"><i style="background:var(--run)"></i>Ermüdung</span>
     <span class="lg"><i style="background:var(--green)"></i>Form</span>`)}

  ${chartCard("HRV-Trend", `${fmtNum(last.hrv)} ms`,
    multiLineSVG([{ vals: hrv, color: "var(--strength)", label: "HRV" }]))}

  ${chartCard("VO₂max", `${fmtNum(last.vo2max)}`,
    multiLineSVG([{ vals: vo2, color: "var(--swim)", label: "VO₂max" }]))}

  ${volumeCard(recs)}`;
}

function postAnalyse() {
  document.querySelectorAll(".rng").forEach((b) =>
    b.addEventListener("click", () => { analyseRange = b.dataset.rng; route(); }));
}

function fmtNum(v) { return v == null ? "–" : (Math.round(v * 10) / 10); }
function fmtSigned(v) { return v == null ? "–" : (v >= 0 ? "+" : "") + (Math.round(v * 10) / 10); }

function chartCard(title, value, svg, legend) {
  return `
  <section class="card chart-card">
    <div class="chart-head">
      <span class="ch-t">${title}</span>
      <span class="ch-v">${value}</span>
    </div>
    ${svg}
    ${legend ? `<div class="chart-legend">${legend}</div>` : ""}
  </section>`;
}

/* Mehrlinien-SVG über gemeinsame x-Achse (Index). Dependency-frei. */
function multiLineSVG(series, { h = 120, zero = false } = {}) {
  const W = 320, H = h, padX = 4, padY = 10;
  const flat = series.flatMap((s) => s.vals).filter((v) => v != null);
  if (flat.length < 2) return `<div class="chart-empty">—</div>`;
  let min = Math.min(...flat), max = Math.max(...flat);
  if (zero) { min = Math.min(min, 0); max = Math.max(max, 0); }
  if (min === max) { min -= 1; max += 1; }
  const n = Math.max(...series.map((s) => s.vals.length));
  const xAt = (i) => padX + (i / Math.max(n - 1, 1)) * (W - 2 * padX);
  const yAt = (v) => padY + (1 - (v - min) / (max - min)) * (H - 2 * padY);

  let zeroLine = "";
  if (zero && min < 0 && max > 0) {
    const zy = yAt(0).toFixed(1);
    zeroLine = `<line x1="${padX}" y1="${zy}" x2="${W - padX}" y2="${zy}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 4"/>`;
  }

  const paths = series.map((s) => {
    const pts = s.vals.map((v, i) => v == null ? null : `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`)
      .filter(Boolean).join(" ");
    if (!pts) return "";
    return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.2"
      stroke-linecap="round" stroke-linejoin="round" ${s.dashed ? 'stroke-dasharray="5 4"' : ""}/>`;
  }).join("");

  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">${zeroLine}${paths}</svg>`;
}

/* Wochenvolumen als gestapelte Balken (Swim/Bike/Run nach TSS). */
function volumeCard(recs) {
  const weeks = {};
  recs.forEach((r) => {
    const wk = isoWeekKey(r.date);
    const w = weeks[wk] || (weeks[wk] = { swim: 0, bike: 0, run: 0, other: 0, key: wk });
    (r.activities || []).forEach((a) => {
      const k = ["swim", "bike", "run"].includes(a.discipline) ? a.discipline : "other";
      w[k] += a.tss || 0;
    });
  });
  const list = Object.values(weeks).sort((a, b) => a.key.localeCompare(b.key)).slice(-12);
  const totalAll = list.reduce((s, w) => s + w.swim + w.bike + w.run + w.other, 0);
  if (!list.length || totalAll === 0) {
    return chartCard("Wochenvolumen", "—",
      `<div class="chart-empty">Noch keine erfassten Einheiten im Zeitraum.</div>`);
  }
  const maxW = Math.max(...list.map((w) => w.swim + w.bike + w.run + w.other), 1);
  const cols = { swim: "var(--swim)", bike: "var(--bike)", run: "var(--run)", other: "var(--rest)" };
  const AREA = 104; // px Höhe der Balkenfläche
  const bars = list.map((w) => {
    const total = w.swim + w.bike + w.run + w.other;
    const segs = ["swim", "bike", "run", "other"].filter((k) => w[k] > 0).map((k) =>
      `<div class="vseg" style="height:${(w[k] / maxW * AREA).toFixed(1)}px;background:${cols[k]}"></div>`).join("");
    return `<div class="vbar"><div class="vstack">${segs}</div><div class="vlbl">${total ? Math.round(total) : ""}</div></div>`;
  }).join("");
  return `
  <section class="card chart-card">
    <div class="chart-head">
      <span class="ch-t">Wochenvolumen</span>
      <span class="ch-v">TSS / Woche</span>
    </div>
    <div class="vchart">${bars}</div>
    <div class="chart-legend">
      <span class="lg"><i style="background:var(--swim)"></i>Schwimmen</span>
      <span class="lg"><i style="background:var(--bike)"></i>Rad</span>
      <span class="lg"><i style="background:var(--run)"></i>Lauf</span>
    </div>
  </section>`;
}

function isoWeekKey(iso) {
  const d = new Date(iso + "T00:00:00");
  const day = (d.getDay() + 6) % 7; // Mo=0
  d.setDate(d.getDate() - day + 3); // Donnerstag dieser Woche
  const firstThu = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}
/* ---------- View: Coach (KI-Chat) ---------- */
const CHAT_KEYS = { url: "tc_worker_url", pass: "tc_pass", hist: "tc_chat" };
const CHAT_SUGGESTIONS = [
  "Warum diese Einheit heute?",
  "Ich bin müde — sollte ich pausieren?",
  "Analysiere mein letztes Training",
  "Wie wird meine Woche aussehen?",
];

function chatCfg() {
  return {
    url: (localStorage.getItem(CHAT_KEYS.url) || "").trim().replace(/\/+$/, ""),
    pass: localStorage.getItem(CHAT_KEYS.pass) || "",
  };
}
function chatHistory() {
  try { return JSON.parse(localStorage.getItem(CHAT_KEYS.hist) || "[]"); }
  catch (_) { return []; }
}
function saveChatHistory(h) {
  localStorage.setItem(CHAT_KEYS.hist, JSON.stringify(h.slice(-40)));
}

function chatContext(d) {
  return {
    readiness: d.readiness, today: d.today, vitals: d.vitals,
    phase: d.phase, race: d.race, recentActivities: d.recentActivities,
  };
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function bubble(role, text) {
  return `<div class="msg ${role}">${esc(text).replace(/\n/g, "<br/>")}</div>`;
}

function viewCoach(d) {
  const { url, pass } = chatCfg();
  const configured = url && pass;
  const r = d.readiness;
  const t = d.today;
  const banner = `
    <div class="chat-banner" data-disc="${t.discipline}">
      <span class="cb-dot v-${r.verdict}"></span>
      <span class="cb-txt"><b>${r.score}</b> Readiness · Heute: ${t.title} (${t.duration})</span>
    </div>`;

  if (!configured) {
    return viewHeader("Coach", "Dein KI-Triathlon-Coach") + banner + chatSetupCard();
  }

  const hist = chatHistory();
  const intro = hist.length ? "" : `
    <div class="msg coach">Servus ${d.athlete.firstName}! Ich bin dein Coach. Frag mich was zu deinem Training, deiner Tagesform oder der Woche. 💪</div>`;
  const msgs = hist.map((m) => bubble(m.role === "user" ? "user" : "coach", m.content)).join("");
  const chips = CHAT_SUGGESTIONS.map((s) => `<button class="sugg" type="button">${s}</button>`).join("");

  return viewHeader("Coach", "Dein KI-Triathlon-Coach") + banner + `
    <div class="chat-scroll" id="chatScroll">${intro}${msgs}</div>
    <div class="chat-suggs" id="chatSuggs">${chips}</div>
    <div class="chat-input">
      <textarea id="chatText" rows="1" placeholder="Frag deinen Coach…" autocomplete="off"></textarea>
      <button id="chatSend" class="chat-send" type="button" aria-label="Senden">➤</button>
    </div>`;
}

function chatSetupCard() {
  return `
  <section class="card">
    <div class="eyebrow">Einmalige Einrichtung</div>
    <p style="font-size:13px;color:var(--text-dim);margin:10px 0 14px;line-height:1.5;">
      Der Chat läuft über deinen Cloudflare Worker. Trag die Worker-URL und deine Passphrase ein —
      sie bleiben nur auf diesem Gerät (localStorage).
    </p>
    <label class="fld"><span>Worker-URL</span>
      <input id="cfgUrl" type="url" inputmode="url" placeholder="https://tricoach-chat.dein-name.workers.dev" />
    </label>
    <label class="fld"><span>Passphrase</span>
      <input id="cfgPass" type="password" placeholder="deine CHAT_PASSPHRASE" />
    </label>
    <button id="cfgSave" class="btn-primary" type="button">Speichern & Chat starten</button>
  </section>`;
}

function postCoach(d) {
  const save = $("#cfgSave");
  if (save) {
    save.addEventListener("click", () => {
      const url = $("#cfgUrl").value.trim();
      const pass = $("#cfgPass").value.trim();
      if (!url || !pass) return;
      localStorage.setItem(CHAT_KEYS.url, url);
      localStorage.setItem(CHAT_KEYS.pass, pass);
      route(); // Chat-UI neu rendern
    });
    return;
  }

  const scroll = $("#chatScroll");
  const ta = $("#chatText");
  const send = $("#chatSend");
  if (!scroll || !ta || !send) return;

  const scrollDown = () => { scroll.scrollTop = scroll.scrollHeight; };
  scrollDown();

  // Auto-grow Textarea
  ta.addEventListener("input", () => {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  });

  let busy = false;
  const submit = async (text) => {
    text = (text || ta.value).trim();
    if (!text || busy) return;
    busy = true;
    ta.value = ""; ta.style.height = "auto";
    $("#chatSuggs")?.remove();

    const hist = chatHistory();
    hist.push({ role: "user", content: text });
    scroll.insertAdjacentHTML("beforeend", bubble("user", text));

    const replyEl = document.createElement("div");
    replyEl.className = "msg coach typing";
    replyEl.textContent = "…";
    scroll.appendChild(replyEl);
    scrollDown();

    try {
      const full = await streamChat(hist, chatContext(d), (chunk, acc) => {
        replyEl.classList.remove("typing");
        replyEl.innerHTML = esc(acc).replace(/\n/g, "<br/>");
        scrollDown();
      });
      hist.push({ role: "assistant", content: full });
      saveChatHistory(hist);
    } catch (err) {
      replyEl.classList.remove("typing");
      replyEl.classList.add("err");
      replyEl.textContent = "⚠ " + (err.message || "Fehler beim Coach-Chat.");
    } finally {
      busy = false;
    }
  };

  send.addEventListener("click", () => submit());
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  document.querySelectorAll(".sugg").forEach((b) =>
    b.addEventListener("click", () => submit(b.textContent)));
}

async function streamChat(history, context, onDelta) {
  const { url, pass } = chatCfg();
  const res = await fetch(url + "/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-TriCoach-Pass": pass },
    body: JSON.stringify({ messages: history, context }),
  });
  if (!res.ok) {
    let msg = "Fehler " + res.status;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) {}
    if (res.status === 401) msg = "Passphrase falsch — im Profil prüfen.";
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", acc = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const payload = s.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const ev = JSON.parse(payload);
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          acc += ev.delta.text;
          onDelta(ev.delta.text, acc);
        }
      } catch (_) { /* keep-alive / Teilzeile ignorieren */ }
    }
  }
  return acc;
}
/* ---------- View: Profil ---------- */
function viewProfil(d) {
  const p = d.profile || {};
  const phys = p.physiology || {};
  const head = viewHeader("Profil", p.name || d.athlete?.firstName || "");

  const ident = [
    ["Alter", p.age ? `${p.age} J` : "–"],
    ["Gewicht", p.weightKg ? `${p.weightKg} kg` : "–"],
    ["Größe", p.heightCm ? `${p.heightCm} cm` : "–"],
  ];
  const physRows = [
    ["VO₂max (Lauf)", phys.vo2maxRunning ?? "–"],
    ["Ruhepuls", phys.restingHr ? `${phys.restingHr} bpm` : "–"],
    ["Max. HF", phys.maxHr ? `${phys.maxHr} bpm` : "–"],
    ["Schwellen-HF (LTHR)", phys.lactateThresholdHr ? `${phys.lactateThresholdHr} bpm` : "–"],
    ["HRV-Baseline", phys.hrvBaseline ? `${phys.hrvBaseline} ms` : "–"],
    ["FTP Rad", phys.cyclingFtpWatts ? `${phys.cyclingFtpWatts} W` : "offen (TBD)"],
    ["Schwimm-CSS", phys.swimCssPer100m ? `${phys.swimCssPer100m}/100m` : "offen (TBD)"],
  ];

  const race = p.race || d.race || {};
  const raceCard = `
    <section class="card">
      <div class="eyebrow">🎯 Ziel</div>
      <div class="pf-race">${race.name || "—"}</div>
      ${race.location ? `<div class="pf-race-sub">${race.location} · ${race.date ? fmtDate(race.date) : ""}</div>` : ""}
      ${race.goal ? `<p class="pf-goal">${race.goal}</p>` : ""}
    </section>`;

  const idGrid = ident.map(([k, val]) =>
    `<div class="pf-id"><span class="pf-id-v">${val}</span><span class="pf-id-l">${k}</span></div>`).join("");
  const physList = physRows.map(([k, val]) =>
    `<div class="pf-row"><span class="pf-k">${k}</span><span class="pf-v">${val}</span></div>`).join("");

  const { url, pass } = chatCfg();
  const chatOk = url && pass;
  const chatCard = `
    <section class="card">
      <div class="eyebrow">💬 Coach-Chat</div>
      <div class="pf-row" style="margin-top:10px;">
        <span class="pf-k">Status</span>
        <span class="pf-v ${chatOk ? "ok" : "off"}">${chatOk ? "verbunden ✓" : "nicht eingerichtet"}</span>
      </div>
      ${chatOk ? `<div class="pf-row"><span class="pf-k">Worker</span><span class="pf-v" style="font-size:11px;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${url.replace(/^https?:\/\//, "")}</span></div>` : ""}
      <div class="pf-actions">
        ${chatOk
          ? `<button class="btn-ghost" id="pfClearChat" type="button">Chat-Zugang entfernen</button>`
          : `<a class="btn-ghost" href="#coach">Im Coach-Tab einrichten</a>`}
      </div>
    </section>`;

  return head + raceCard + `
    <section class="card">
      <div class="eyebrow">🧍 Athlet</div>
      <div class="pf-idgrid">${idGrid}</div>
    </section>
    <section class="card">
      <div class="eyebrow">❤️ Physiologie</div>
      <div class="pf-rows">${physList}</div>
    </section>
    ${p.philosophy ? `<section class="card"><div class="eyebrow">🧠 Methodik</div><p class="pf-phil">${p.philosophy}</p></section>` : ""}
    ${chatCard}
    <div class="foot">
      <button class="refresh" id="pfRefresh">↻ Daten aktualisieren</button>
      <div class="sig" style="margin-top:10px">TriCoach — auf dem Weg nach Zell am See</div>
    </div>`;
}

function postProfil() {
  $("#pfRefresh")?.addEventListener("click", () => location.reload());
  $("#pfClearChat")?.addEventListener("click", () => {
    localStorage.removeItem(CHAT_KEYS.url);
    localStorage.removeItem(CHAT_KEYS.pass);
    route();
  });
}

/* ---------- sections ---------- */

function topbar(d) {
  return `
  <div class="topbar">
    <div class="greeting">
      <div class="hi">${greeting()}, ${d.athlete.firstName} 👋</div>
      <div class="sub">${fmtDate(d.today.date)} · ${d.phase.block}</div>
    </div>
    <div class="countdown">
      <div class="days">${d.race.daysToGo}<span> Tage</span></div>
      <div class="race">${d.race.name}</div>
    </div>
  </div>`;
}

function hero(d) {
  const r = d.readiness;
  const c = 2 * Math.PI * 52;
  const col = r.verdict === "green" ? "var(--green)" : r.verdict === "amber" ? "var(--amber)" : "var(--red)";
  const vClass = "v-" + r.verdict;
  return `
  <section class="card hero" style="--ring-col:${col}">
    <div class="ring-wrap">
      <svg width="118" height="118" viewBox="0 0 118 118">
        <circle class="ring-bg" cx="59" cy="59" r="52" fill="none" stroke-width="9"></circle>
        <circle class="ring-fg" cx="59" cy="59" r="52" fill="none" stroke-width="9"
          stroke-dasharray="${c}" stroke-dashoffset="${c}"></circle>
      </svg>
      <div class="ring-center">
        <div class="score">${r.score}</div>
        <div class="of">Readiness</div>
      </div>
    </div>
    <div class="hero-info">
      <span class="verdict ${vClass}"><span class="dot" style="background:${col}"></span>${r.label}</span>
      <h2>${verdictHeadline(r.verdict)}</h2>
      <p>${r.message}</p>
    </div>
  </section>`;
}

function verdictHeadline(v) {
  return v === "green" ? "Grünes Licht — voll angreifen"
       : v === "amber" ? "Gelb — heute dosieren"
       : "Rot — Erholung priorisieren";
}

function today(d) {
  const t = d.today;
  const di = DISC[t.discipline] || DISC.rest;
  const steps = t.structure.map(s => `<li>${s}</li>`).join("");
  return `
  <section class="card today" data-disc="${t.discipline}">
    <div class="stripe"></div>
    <div class="head">
      <div>
        <div class="eyebrow">Heute · ${t.weekday}</div>
        <h3>${t.title}</h3>
      </div>
      <div class="disc-badge">${di.icon}</div>
    </div>
    <div class="chips">
      <span class="chip accent">${di.name}</span>
      <span class="chip">⏱ ${t.duration}</span>
      <span class="chip">Last: ${t.loadLabel}</span>
    </div>
    <ul class="structure">${steps}</ul>
    <div class="coach-note">
      <span class="who">Coach</span>${t.coachNote}
    </div>
    <div class="adjust-line"><span class="pulse"></span>${t.adjustment}</div>
  </section>`;
}

function vitals(d) {
  const v = d.vitals;
  const order = [
    ["hrv", "HRV"], ["rhr", "Ruhepuls"], ["bodyBattery", "Body Battery"],
    ["sleep", "Schlaf"], ["stress", "Stress"], ["vo2max", "VO₂max"],
  ];
  const cells = order.map(([k, lbl]) => {
    const m = v[k]; if (!m) return "";
    return `
    <div class="vital">
      <span class="sdot s-${m.status}"></span>
      <div class="vt">${lbl}</div>
      <div class="vv">${m.value}<span class="u">${m.unit || ""}</span></div>
      <div class="vl">${m.trendIcon || ""} ${m.label || ""}</div>
    </div>`;
  }).join("");
  return `<div class="vitals">${cells}</div>`;
}

function weekStrip(d) {
  const meta = d.weekMeta || {};
  const totalMin = d.week.reduce((a, w) => a + (w.totalMinutes || 0), 0);
  const hrs = (totalMin / 60);
  const head = (meta.label || meta.targetHours)
    ? `<div class="week-head">
         <div class="wh-l">${meta.label || "Woche"}${meta.weekStart ? ` · ab ${shortDate(meta.weekStart)}` : ""}</div>
         <div class="wh-r">${totalMin ? `${hrs.toFixed(1)} h geplant` : ""}</div>
       </div>` : "";
  const cells = d.week.map((w, i) => {
    const di = DISC[w.discipline] || DISC.rest;
    const mark = w.status === "done" ? "✓" : di.icon;
    return `
    <div class="wday ${w.status}" data-disc="${w.discipline}" data-i="${i}">
      <div class="wd">${w.day}</div>
      <div class="wdot">${mark}</div>
      <div class="wmin">${w.totalMinutes ? w.totalMinutes + "′" : "–"}</div>
    </div>`;
  }).join("");
  return `
  <section class="card">
    ${head}
    <div class="week">${cells}</div>
    <div class="week-detail" id="weekDetail"></div>
  </section>`;
}

function dayDetail(w) {
  const dayName = { Mo:"Montag", Di:"Dienstag", Mi:"Mittwoch", Do:"Donnerstag", Fr:"Freitag", Sa:"Samstag", So:"Sonntag" }[w.day] || w.day;
  const st = w.status === "done" ? `<span class="wd-state done">erledigt ✓</span>`
           : w.status === "today" ? `<span class="wd-state today">heute</span>` : "";
  if (!w.sessions || !w.sessions.length) {
    return `
    <div class="wd-head"><h4>${dayName}, ${shortDate(w.date)}</h4>${st}</div>
    <div class="wd-rest">😴 Ruhetag — Erholung ist Teil des Plans.</div>`;
  }
  const blocks = w.sessions.map(s => {
    const di = DISC[s.discipline] || DISC.rest;
    const steps = (s.structure || []).map(x => `<li>${x}</li>`).join("");
    return `
    <div class="wd-sess" data-disc="${s.discipline}">
      <div class="wd-stripe"></div>
      <div class="wd-sess-in">
        <div class="wd-sess-head">
          <span class="wd-ic">${di.icon}</span>
          <span class="wd-title">${s.title}</span>
        </div>
        <div class="wd-chips">
          <span class="chip accent">${di.name}</span>
          <span class="chip">⏱ ${s.duration} min</span>
          <span class="chip">${s.intensity}</span>
        </div>
        ${steps ? `<ul class="structure">${steps}</ul>` : ""}
        ${s.purpose ? `<div class="wd-purpose"><span class="who">Ziel</span>${s.purpose}</div>` : ""}
      </div>
    </div>`;
  }).join("");
  return `
  <div class="wd-head"><h4>${dayName}, ${shortDate(w.date)}</h4>${st}</div>
  ${blocks}`;
}

function bindWeek(d) {
  const detail = $("#weekDetail");
  const show = (i) => {
    detail.innerHTML = dayDetail(d.week[i]);
    document.querySelectorAll(".wday").forEach(el =>
      el.classList.toggle("sel", +el.dataset.i === i));
  };
  document.querySelectorAll(".wday").forEach(el => {
    el.addEventListener("click", () => show(+el.dataset.i));
  });
  // Standard: heute, sonst erster Tag mit Training, sonst Tag 0
  let idx = d.week.findIndex(w => w.status === "today");
  if (idx < 0) idx = d.week.findIndex(w => w.sessions && w.sessions.length);
  show(idx >= 0 ? idx : 0);
}

function form(d) {
  const tr = d.vo2maxTrend.map(p => p.v);
  const min = Math.min(...tr) - 0.5, max = Math.max(...tr) + 0.5;
  const W = 220, H = 56;
  const pts = tr.map((v, i) => {
    const x = (i / (tr.length - 1)) * W;
    const y = H - ((v - min) / (max - min)) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const last = tr[tr.length - 1];
  const delta = last - tr[0];
  const preds = d.racePredictions.map(p =>
    `<div class="pred"><div class="pd">${p.dist}</div><div class="pt">${p.time}</div></div>`).join("");
  return `
  <section class="card">
    <div class="form-row">
      <div class="spark">
        <div class="lbl">
          <div class="now">VO₂max ${last}<small>${delta >= 0 ? "+" : ""}${delta} seit Apr</small></div>
        </div>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--swim)" stop-opacity="0.35"/>
              <stop offset="100%" stop-color="var(--swim)" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <polyline points="0,${H} ${pts} ${W},${H}" fill="url(#g)" stroke="none"/>
          <polyline points="${pts}" fill="none" stroke="var(--swim)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>
    <div class="preds">${preds}</div>
  </section>`;
}

function recent(d) {
  const rows = d.recentActivities.map(a => {
    const di = DISC[a.discipline] || DISC.rest;
    return `
    <div class="act" data-disc="${a.discipline}">
      <div class="ai">${di.icon}</div>
      <div class="am"><div class="an">${a.name}</div><div class="ad">${a.detail}</div></div>
      <div class="ax">${shortDate(a.date)}</div>
    </div>`;
  }).join("");
  return `<section class="card recent">${rows}</section>`;
}

function footer(d) {
  const t = new Date(d.generatedAt);
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  return `
  <div class="foot">
    <button class="refresh">↻ Aktualisieren</button>
    <div style="margin-top:10px">Aktualisiert ${hh}:${mm} · ${d.source}</div>
    <div class="sig">TriCoach — auf dem Weg nach Zell am See</div>
  </div>`;
}

/* ---------- helpers ---------- */
function fmtDate(iso) {
  const days = ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];
  const mon = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
  const d = new Date(iso + "T00:00:00");
  return `${days[d.getDay()]}, ${d.getDate()}. ${mon[d.getMonth()]}`;
}
function shortDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}`;
}

/* ---------- boot ---------- */
window.addEventListener("hashchange", route);
load();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
