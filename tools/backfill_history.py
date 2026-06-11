#!/usr/bin/env python3
"""
backfill_history.py — Einmaliges/seltenes Auffüllen von app/history.json mit
ECHTER Garmin-Vergangenheit, damit Analyse-Charts + CTL/ATL/TSB sofort sinnvoll
sind (statt bei null zu starten).

Zieht je Tag der letzten N Tage die Health-Werte (Readiness, HRV, RHR, Body
Battery, Schlaf, Stress, VO2max) und alle Aktivitäten des Zeitraums, rechnet
hrTSS + CTL/ATL/TSB (tools/metrics.py) und mergt das Ergebnis in app/history.json
(dedupe per Datum, bestehende Tage bleiben erhalten).

  python tools/backfill_history.py --days 120     # 120 Tage zurück
  python tools/backfill_history.py                 # Default 120

Auth wie daily_update.py über GARMINTOKENS (base64). Läuft NICHT im täglichen
Cron — bewusst manuell (Garmin-Rate-Limits). Reines Python, kein LLM/Key.
"""
import os, sys, json, time
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app")
CONFIG = json.load(open(os.path.join(ROOT, "config", "athlete.json"), encoding="utf-8"))

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from metrics import build_day_record, compute_loads
from daily_update import garmin_login, safe

LTHR = CONFIG["physiology"]["lactateThresholdHr"]
RHR_BASE = CONFIG["physiology"]["restingHr"]


def _arg_days(default=120):
    if "--days" in sys.argv:
        try:
            return int(sys.argv[sys.argv.index("--days") + 1])
        except Exception:
            pass
    return default


def day_vitals(api, d):
    """Health-Werte eines Tages als vitals_raw-Dict (wie daily_update sie nutzt)."""
    iso = d.isoformat()
    v = {"readiness": None, "hrv": None, "rhr": None, "bodyBattery": None,
         "sleep": None, "stress": None, "vo2max": None}

    tr = safe(lambda: api.get_training_readiness(iso)) or []
    if isinstance(tr, list) and tr:
        tr = tr[0]
    if isinstance(tr, dict):
        v["readiness"] = tr.get("score")
        v["hrv"] = tr.get("hrv_weekly_avg") or tr.get("hrvWeeklyAvg")

    stats = safe(lambda: api.get_stats_and_body(iso)) or {}
    v["rhr"] = stats.get("restingHeartRate")
    v["bodyBattery"] = stats.get("bodyBatteryMostRecentValue") or stats.get("bodyBatteryHighestValue")
    v["stress"] = stats.get("averageStressLevel")

    sleep = safe(lambda: api.get_sleep_data(iso)) or {}
    secs = (sleep.get("dailySleepDTO") or {}).get("sleepTimeSeconds")
    v["sleep"] = round(secs / 3600, 1) if secs else None

    vo2 = safe(lambda: api.get_max_metrics(iso)) or []
    try:
        v["vo2max"] = vo2[0]["generic"]["vo2MaxValue"]
    except Exception:
        pass
    return v


def main():
    days = _arg_days()
    today = date.today()
    start = today - timedelta(days=days)
    print(f"TriCoach backfill_history — {start.isoformat()} … {today.isoformat()} ({days} Tage)")

    api = garmin_login()

    # Alle Aktivitäten des Zeitraums in EINEM Rutsch (statt pro Tag).
    activities = safe(
        lambda: api.get_activities_by_date(start.isoformat(), today.isoformat()),
        default=[],
    ) or []
    print(f"  {len(activities)} Aktivitäten im Zeitraum geladen.")

    # Bestehende History laden (Tage, die wir nicht überschreiben wollen, bleiben).
    hist_path = os.path.join(APP, "history.json")
    existing = {}
    if os.path.exists(hist_path):
        try:
            for r in json.load(open(hist_path, encoding="utf-8")):
                existing[r["date"]] = r
        except Exception:
            pass

    records = dict(existing)
    pulled = 0
    d = start
    while d <= today:
        iso = d.isoformat()
        vit = day_vitals(api, d)
        rec = build_day_record(iso, vit, activities, LTHR, RHR_BASE)
        # Tage ganz ohne Signal (kein Vital, keine Einheit) überspringen — kein Müll.
        has_signal = rec["tss"] > 0 or any(vit[k] is not None for k in
                                           ("readiness", "hrv", "rhr", "sleep", "bodyBattery"))
        if has_signal:
            records[iso] = rec
            pulled += 1
        if pulled % 10 == 0 and has_signal:
            print(f"  … {iso} (TSS {rec['tss']}, {len(rec['activities'])} Einheiten)")
        time.sleep(0.4)  # höflich gegenüber Garmin (Rate-Limit)
        d += timedelta(days=1)

    merged = compute_loads(sorted(records.values(), key=lambda r: r["date"]))
    with open(hist_path, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)

    last = merged[-1] if merged else {}
    print(f"  history.json: {len(merged)} Tage geschrieben (neu/aktualisiert: {pulled}).")
    print(f"  Letzter Tag {last.get('date')}: CTL {last.get('ctl')}, ATL {last.get('atl')}, TSB {last.get('tsb')}")


if __name__ == "__main__":
    main()
