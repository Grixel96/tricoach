#!/usr/bin/env python3
"""
weekly_review.py — Wöchentliches KI-Review der Trainingswoche (So-Cron).

Läuft im bestehenden Sonntags-Cron von .github/workflows/daily.yml. Liest den
aktuellen Plan + die letzte Woche aus app/history.json, lässt Claude (Anthropic)
ein kurzes Coach-Review + konkrete Anpassungs-Vorschläge für die kommende Woche
erzeugen und schreibt es nach app/review.json (von der PWA im Plan-Tab gezeigt).

Bewusst: der handgebaute coach/plan-*.json wird NICHT automatisch überschrieben
(Risiko, gute Struktur zu zerstören). Strukturelle Neubauten macht der monatliche
Claude-Code-Lauf. Hier zählt das sichtbare Review + die Vorschläge.

Braucht ANTHROPIC_API_KEY (Secret). Ohne Key / mit --offline: regelbasiertes
Fallback-Review, damit Pipeline + Plan-View auch ohne API funktionieren.

  python tools/weekly_review.py            # mit ANTHROPIC_API_KEY → KI-Review
  python tools/weekly_review.py --offline  # regelbasiertes Review ohne API
"""
import os, sys, json, glob, urllib.request, urllib.error
from datetime import datetime, date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app")
CONFIG = json.load(open(os.path.join(ROOT, "config", "athlete.json"), encoding="utf-8"))

OFFLINE = "--offline" in sys.argv
TODAY = os.environ.get("TRICOACH_DATE") or date.today().isoformat()
MODEL = "claude-opus-4-8"


def latest_plan():
    files = sorted(glob.glob(os.path.join(ROOT, "coach", "plan-*.json")))
    return json.load(open(files[-1], encoding="utf-8")) if files else None


def load_history():
    p = os.path.join(APP, "history.json")
    if os.path.exists(p):
        try:
            return json.load(open(p, encoding="utf-8"))
        except Exception:
            return []
    return []


def pick_weeks(plan, today_iso):
    """(letzte abgeschlossene Woche, kommende/aktuelle Woche) aus dem Plan."""
    if not plan:
        return None, None
    td = date.fromisoformat(today_iso)
    weeks = sorted(plan["weeks"], key=lambda w: w["weekStart"])
    upcoming = next((w for w in weeks if date.fromisoformat(w["weekStart"]) >= td), None)
    if upcoming is None:
        upcoming = weeks[-1]  # Block vorbei → letzte Woche referenzieren
    ws = date.fromisoformat(upcoming["weekStart"])
    last = None
    for w in weeks:
        wend = date.fromisoformat(w["weekStart"]) + timedelta(days=6)
        if wend < ws:
            last = w
    return last, upcoming


def summarize_last_week(history, last_week):
    """Ist-Werte der letzten 7 Tage aus history.json (TSS, Readiness, Einheiten)."""
    cut = (date.fromisoformat(TODAY) - timedelta(days=7)).isoformat()
    recs = [r for r in history if r.get("date", "") >= cut]
    if not recs:
        return {"hasData": False}
    tss = round(sum(r.get("tss", 0) or 0 for r in recs), 0)
    reads = [r["readiness"] for r in recs if r.get("readiness")]
    by_disc = {}
    sessions = 0
    for r in recs:
        for a in r.get("activities", []):
            by_disc[a["discipline"]] = by_disc.get(a["discipline"], 0) + 1
            sessions += 1
    planned_tss = None
    last_rec = recs[-1]
    return {
        "hasData": True,
        "actualTss": tss,
        "sessions": sessions,
        "byDiscipline": by_disc,
        "avgReadiness": round(sum(reads) / len(reads)) if reads else None,
        "ctl": last_rec.get("ctl"), "atl": last_rec.get("atl"), "tsb": last_rec.get("tsb"),
        "plannedTss": planned_tss,
    }


def week_planned_summary(week):
    if not week:
        return ""
    lines = []
    for d in week["days"]:
        sess = d.get("sessions") or []
        if not sess:
            lines.append(f"{d['day']}: Ruhe")
        else:
            parts = [f"{s['discipline']} {s.get('duration', 0)}min ({s.get('intensity', '')})" for s in sess]
            lines.append(f"{d['day']}: " + " + ".join(parts))
    return "\n".join(lines)


COACH_SYSTEM = (
    "Du bist der persönliche KI-Triathlon-Coach von Marvin (Ziel IRONMAN 70.3 Zell am See, ~29.08.2027). "
    "Stil: polarisiert 80/20, Periodisierung 3:1, Umfang max +8–10 %/Belastungswoche, nur eine neue "
    "Stressquelle pro Zeit. Schwimmen ist Limiter und Priorität #1. Regeneration datengesteuert (HRV/RHR/"
    "Readiness). Antworte ausschließlich mit gültigem JSON nach dem vorgegebenen Schema, auf Deutsch, knapp und konkret."
)


def build_user_prompt(last_week, upcoming, last_stats):
    phys = CONFIG["physiology"]
    ctx = {
        "heute": TODAY,
        "physiologie": {"LTHR": phys["lactateThresholdHr"], "RHR": phys["restingHr"],
                        "HRV_Baseline": phys["hrvBaseline"], "VO2max": phys["vo2maxRunning"]},
        "letzteWoche_geplant": week_planned_summary(last_week) if last_week else "—",
        "letzteWoche_ist": last_stats,
        "kommendeWoche_label": upcoming.get("label") if upcoming else "—",
        "kommendeWoche_zielStunden": upcoming.get("targetHours") if upcoming else None,
        "kommendeWoche_geplant": week_planned_summary(upcoming) if upcoming else "—",
    }
    schema = {
        "summary": "2–4 Sätze: Was lief letzte Woche gut, was fehlte, Gesamteinschätzung der Form.",
        "highlights": ["kurze Stichpunkte zu Positivem"],
        "focus": ["2–4 Fokuspunkte für die kommende Woche"],
        "adjustments": [{"day": "Mo/Di/…", "change": "konkrete Anpassung ggü. Plan, falls nötig"}],
        "load": "eine von: halten | leicht erhöhen | reduzieren",
    }
    return (
        "Analysiere die Trainingswoche und plane die kommende Woche feinjustiert.\n\n"
        f"KONTEXT (JSON):\n{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        f"Antworte NUR mit JSON exakt in diesem Schema:\n{json.dumps(schema, ensure_ascii=False, indent=2)}"
    )


def call_anthropic(system, user):
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY nicht gesetzt.")
    body = json.dumps({
        "model": MODEL,
        "max_tokens": 1200,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=body, method="POST",
        headers={"Content-Type": "application/json", "x-api-key": key,
                 "anthropic-version": "2023-06-01"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        out = json.loads(resp.read().decode("utf-8"))
    text = "".join(b.get("text", "") for b in out.get("content", []) if b.get("type") == "text")
    return parse_json(text)


def parse_json(text):
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.lstrip().startswith("json"):
            text = text.lstrip()[4:]
    a, b = text.find("{"), text.rfind("}")
    if a >= 0 and b > a:
        text = text[a:b + 1]
    return json.loads(text)


def fallback_review(last_week, upcoming, last_stats):
    """Regelbasiertes Review ohne API — ehrlich und nützlich, kein Platzhalter-Fake."""
    if not last_stats.get("hasData"):
        summary = ("Noch keine erfassten Vorwochen-Daten. Starte die kommende Woche wie geplant — "
                   "die App sammelt ab jetzt Last- und Erholungswerte für künftige Reviews.")
        highlights = ["Erste erfasste Woche steht an."]
        load = "halten"
    else:
        tsb = last_stats.get("tsb")
        avg_r = last_stats.get("avgReadiness")
        if tsb is not None and tsb < -15:
            load, note = "reduzieren", f"Form (TSB {tsb}) deutlich negativ — Ermüdung hoch."
        elif avg_r and avg_r >= 70 and (tsb is None or tsb > -10):
            load, note = "leicht erhöhen", f"Gute Erholung (Ø Readiness {avg_r}) — Spielraum nach oben."
        else:
            load, note = "halten", "Solide Woche, Last konstant fahren."
        summary = (f"Letzte Woche: {last_stats['sessions']} Einheiten, {int(last_stats['actualTss'])} TSS, "
                   f"Ø Readiness {avg_r}. {note}")
        highlights = [f"{n}× {d}" for d, n in (last_stats.get("byDiscipline") or {}).items()]
    focus = ["Schwimmtechnik & Frequenz (Limiter)", "Aerobe Basis locker halten (80/20)",
             "Quality nur bei grüner Tagesform"]
    return {"summary": summary, "highlights": highlights, "focus": focus,
            "adjustments": [], "load": load}


def main():
    print(f"TriCoach weekly_review — {TODAY} {'(offline)' if OFFLINE else ''}")
    plan = latest_plan()
    history = load_history()
    last_week, upcoming = pick_weeks(plan, TODAY)
    last_stats = summarize_last_week(history, last_week)

    source = "regelbasiert"
    review = None
    if not OFFLINE and os.environ.get("ANTHROPIC_API_KEY"):
        try:
            review = call_anthropic(COACH_SYSTEM, build_user_prompt(last_week, upcoming, last_stats))
            source = MODEL
        except Exception as e:
            print(f"  ! KI-Review fehlgeschlagen ({e}) — nutze Fallback.")
    if review is None:
        review = fallback_review(last_week, upcoming, last_stats)

    out = {
        "generatedAt": datetime.now().strftime("%Y-%m-%dT%H:%M:00+02:00"),
        "source": source,
        "weekStart": upcoming.get("weekStart") if upcoming else None,
        "weekLabel": upcoming.get("label") if upcoming else None,
        "targetHours": upcoming.get("targetHours") if upcoming else None,
        "lastWeek": last_stats,
        "summary": review.get("summary", ""),
        "highlights": review.get("highlights", []),
        "focus": review.get("focus", []),
        "adjustments": review.get("adjustments", []),
        "load": review.get("load", "halten"),
    }
    with open(os.path.join(APP, "review.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"  review.json geschrieben — Quelle {source}, kommende Woche {out['weekStart']} ({out['weekLabel']})")


if __name__ == "__main__":
    main()
