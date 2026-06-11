#!/usr/bin/env python3
"""
metrics.py — Trainingslast-Kennzahlen für TriCoach.

Reines Python, keine Abhängigkeiten. Wird von daily_update.py genutzt, um
app/history.json (append-only Tagesverlauf) zu pflegen.

  - hrTSS:  Stress-Score je Einheit aus Dauer + Ø-HR relativ zur Schwelle (LTHR).
            1 h an der Schwelle = 100 TSS. Power-TSS später, sobald FTP da ist.
  - CTL:    Chronische Last (Fitness), 42-Tage exponentieller Schnitt der TSS-Reihe.
  - ATL:    Akute Last (Ermüdung), 7-Tage exponentieller Schnitt.
  - TSB:    Form/Frische = CTL − ATL.
"""
import os, json
from datetime import date, timedelta

CTL_DAYS = 42
ATL_DAYS = 7

# Grobe Intensitäts-Faktoren (Anteil der HRR an der Schwelle), falls ein Lauf
# keine Ø-HR liefert — nach Disziplin/Intensität geschätzt.
_DEFAULT_IF = {"swim": 0.70, "bike": 0.68, "run": 0.72, "strength": 0.55, "rest": 0.0}


def hr_tss(duration_min, avg_hr, lthr, resting_hr, discipline="run"):
    """hrTSS einer Einheit. avg_hr optional — dann Schätzung über Default-IF."""
    if not duration_min or duration_min <= 0:
        return 0.0
    hrr_thr = max(lthr - resting_hr, 1)
    if avg_hr and avg_hr > resting_hr:
        frac = (avg_hr - resting_hr) / hrr_thr      # Anteil der HRR an der Schwelle
    else:
        frac = _DEFAULT_IF.get(discipline, 0.65)
    frac = max(0.0, min(frac, 1.3))                  # Ausreißer kappen
    tss = (duration_min / 60.0) * (frac ** 2) * 100.0
    return round(tss, 1)


def compute_loads(records):
    """CTL/ATL/TSB über die gesamte TSS-Reihe rechnen und in die Records schreiben.

    Lücken (Tage ohne Record) zählen als TSS 0 in die Glättung, werden aber nicht
    gespeichert. Seed CTL=ATL=0 — konvergiert nach ein paar Wochen.
    """
    if not records:
        return records
    recs = sorted(records, key=lambda r: r["date"])
    by_date = {r["date"]: r for r in recs}
    start = date.fromisoformat(recs[0]["date"])
    end = date.fromisoformat(recs[-1]["date"])

    ctl = atl = 0.0
    day = start
    while day <= end:
        iso = day.isoformat()
        tss = by_date.get(iso, {}).get("tss", 0.0) or 0.0
        ctl += (tss - ctl) / CTL_DAYS
        atl += (tss - atl) / ATL_DAYS
        if iso in by_date:
            by_date[iso]["ctl"] = round(ctl, 1)
            by_date[iso]["atl"] = round(atl, 1)
            by_date[iso]["tsb"] = round(ctl - atl, 1)
        day += timedelta(days=1)
    return recs


def build_day_record(today_iso, vitals_raw, activities, lthr, resting_hr):
    """Tages-Record für history.json aus heutigen Vitalwerten + Aktivitäten bauen.

    `activities` ist die rohe Garmin-Liste; nur Einheiten von HEUTE zählen für TSS.
    """
    from_garmin = {
        "running": "run", "trail_running": "run", "treadmill_running": "run",
        "cycling": "bike", "road_biking": "bike", "virtual_ride": "bike", "indoor_cycling": "bike",
        "lap_swimming": "swim", "open_water_swimming": "swim", "swimming": "swim",
        "strength_training": "strength", "indoor_cardio": "strength",
    }
    acts = []
    for a in activities or []:
        start = (a.get("startTimeLocal") or a.get("start_time") or "")[:10]
        if start != today_iso:
            continue
        tkey = (a.get("activityType") or {}).get("typeKey") or a.get("type") or ""
        disc = from_garmin.get(tkey, "run")
        dur_s = a.get("duration") or a.get("duration_seconds") or 0
        dur_min = round(dur_s / 60.0, 1) if dur_s else 0
        dist = a.get("distance") or a.get("distance_meters") or 0
        avg_hr = a.get("averageHR") or a.get("averageHr") or a.get("avg_hr")
        tss = hr_tss(dur_min, avg_hr, lthr, resting_hr, disc)
        acts.append({
            "discipline": disc,
            "duration": dur_min,
            "distanceKm": round(dist / 1000.0, 2) if dist else 0,
            "avgHr": avg_hr,
            "tss": tss,
        })
    day_tss = round(sum(a["tss"] for a in acts), 1)
    return {
        "date": today_iso,
        "readiness": vitals_raw.get("readiness"),
        "hrv": vitals_raw.get("hrv"),
        "rhr": vitals_raw.get("rhr"),
        "bodyBattery": vitals_raw.get("bodyBattery"),
        "sleep": vitals_raw.get("sleep"),
        "stress": vitals_raw.get("stress"),
        "vo2max": vitals_raw.get("vo2max"),
        "tss": day_tss,
        "activities": acts,
    }


def update_history(path, today_iso, vitals_raw, activities, lthr, resting_hr, keep_days=540):
    """history.json laden, heutigen Record ergänzen/ersetzen, Lasten rechnen, schreiben.

    Gibt die Liste der Records zurück.
    """
    history = []
    if os.path.exists(path):
        try:
            history = json.load(open(path, encoding="utf-8"))
        except Exception:
            history = []
    if not isinstance(history, list):
        history = []

    rec = build_day_record(today_iso, vitals_raw, activities, lthr, resting_hr)
    history = [r for r in history if r.get("date") != today_iso]  # dedupe
    history.append(rec)
    history = sorted(history, key=lambda r: r["date"])[-keep_days:]
    history = compute_loads(history)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)
    return history
