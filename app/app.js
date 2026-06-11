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
  render(data);
}

function fail() {
  document.getElementById("app").innerHTML =
    `<div class="loading"><p>Keine Daten gefunden.<br/>Bist du offline und noch nie online gewesen?</p></div>`;
}

function render(d) {
  const app = document.getElementById("app");
  app.removeAttribute("aria-busy");
  app.innerHTML = [
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
  app.querySelectorAll(".card, .vitals, .week, .recent").forEach((el, i) => {
    el.classList.add("fade-in"); el.style.animationDelay = (i * 0.04) + "s";
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
load();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
