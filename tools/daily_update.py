#!/usr/bin/env python3
"""
daily_update.py — Autonomer Morgen-/Sonntag-Job (GitHub Actions).

Reines Python, KEIN LLM/API-Key:
  1. Garmin-Login via gespeichertem Token (Secret GARMINTOKENS, base64).
  2. Morgen-Health ziehen (Readiness, HRV, RHR, Body Battery, Schlaf, Stress, VO2max).
  3. Ampel (grün/gelb/rot) regelbasiert → heutige Einheit aus aktuellem Plan-Block anpassen.
  4. app/data.json schreiben (Quelle der PWA) + plan.ics neu bauen.
  Commit/Push übernimmt der Workflow.

Lokaler Testlauf ohne Garmin:  python tools/daily_update.py --offline
"""
import os, sys, json, base64, tempfile, glob
from datetime import datetime, date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app")
CONFIG = json.load(open(os.path.join(ROOT, "config", "athlete.json"), encoding="utf-8"))

OFFLINE = "--offline" in sys.argv
TODAY = os.environ.get("TRICOACH_DATE") or date.today().isoformat()

DISC_FROM_GARMIN = {
    "running": "run", "trail_running": "run", "treadmill_running": "run",
    "cycling": "bike", "road_biking": "bike", "virtual_ride": "bike", "indoor_cycling": "bike",
    "lap_swimming": "swim", "open_water_swimming": "swim", "swimming": "swim",
    "strength_training": "strength", "indoor_cardio": "strength",
}


# ---------------- Garmin ----------------
def garmin_login():
    from garminconnect import Garmin
    tokens = os.environ.get("GARMINTOKENS", "")
    # BOM / Whitespace / Zeilenumbrüche entfernen (entstehen leicht beim Secret-Setzen)
    tokens = tokens.lstrip("﻿").strip()
    if not tokens:
        raise RuntimeError("GARMINTOKENS Secret fehlt.")
    # Secret ist base64 des ~/.garminconnect Token-Ordners-Inhalts (garth)
    tokendir = tempfile.mkdtemp()
    try:
        decoded = base64.b64decode(tokens)
        # Erwartet: base64 eines JSON {dateiname: inhalt}
        files = json.loads(decoded)
        for name, content in files.items():
            with open(os.path.join(tokendir, name), "w") as fh:
                fh.write(content)
    except Exception:
        # Fallback: Secret ist direkt der garth oauth-Token-String
        with open(os.path.join(tokendir, "oauth1_token.json"), "w") as fh:
            fh.write(base64.b64decode(tokens).decode("utf-8", "ignore"))
    api = Garmin()
    api.login(tokendir)
    return api


def safe(fn, default=None):
    try:
        return fn()
    except Exception as e:
        print(f"  ! {e}")
        return default


def pull_metrics(api):
    m = {}
    tr = safe(lambda: api.get_training_readiness(TODAY)) or []
    if isinstance(tr, list) and tr:
        tr = tr[0]
    elif not isinstance(tr, dict):
        tr = {}
    m["readinessScore"] = tr.get("score")
    m["readinessLevel"] = tr.get("level")
    m["recoveryTimeHours"] = tr.get("recovery_time_hours") or tr.get("recoveryTime")
    m["hrvWeekly"] = tr.get("hrv_weekly_avg") or tr.get("hrvWeeklyAvg")

    stats = safe(lambda: api.get_stats_and_body(TODAY)) or {}
    m["rhr"] = stats.get("restingHeartRate")
    m["rhr7"] = stats.get("lastSevenDaysAvgRestingHeartRate")
    m["bodyBattery"] = stats.get("bodyBatteryMostRecentValue") or stats.get("bodyBatteryHighestValue")
    m["bbHigh"] = stats.get("bodyBatteryHighestValue")
    m["bbLow"] = stats.get("bodyBatteryLowestValue")
    m["stress"] = stats.get("averageStressLevel")

    sleep = safe(lambda: api.get_sleep_data(TODAY)) or {}
    secs = (sleep.get("dailySleepDTO") or {}).get("sleepTimeSeconds")
    m["sleepHours"] = round(secs / 3600, 1) if secs else None

    vo2 = safe(lambda: api.get_max_metrics(TODAY)) or []
    try:
        m["vo2max"] = vo2[0]["generic"]["vo2MaxValue"]
    except Exception:
        m["vo2max"] = CONFIG["physiology"]["vo2maxRunning"]

    m["activities"] = safe(lambda: api.get_activities(0, 8)) or []
    m["racePredictions"] = safe(lambda: api.get_race_predictions()) or {}
    return m


def offline_metrics():
    """Letzte data.json wiederverwenden, falls vorhanden — für Testläufe."""
    p = os.path.join(APP, "data.json")
    base = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}
    r = base.get("readiness", {})
    v = base.get("vitals", {})
    return {
        "readinessScore": r.get("score", 75), "readinessLevel": r.get("level", "HIGH"),
        "recoveryTimeHours": r.get("recoveryTimeHours", 8), "hrvWeekly": v.get("hrv", {}).get("value", 71),
        "rhr": v.get("rhr", {}).get("value", 42), "rhr7": 44,
        "bodyBattery": v.get("bodyBattery", {}).get("value", 59), "bbHigh": 59, "bbLow": 38,
        "stress": v.get("stress", {}).get("value", 17), "sleepHours": v.get("sleep", {}).get("value", 8),
        "vo2max": v.get("vo2max", {}).get("value", 54),
        "activities": [], "racePredictions": {},
    }


# ---------------- Ampel-Logik ----------------
def verdict(m):
    base_rhr = CONFIG["physiology"]["restingHr"]
    hrv_base = CONFIG["physiology"]["hrvBaseline"]
    score = m.get("readinessScore") or 0
    rhr = m.get("rhr") or base_rhr
    hrv = m.get("hrvWeekly") or hrv_base
    sleep = m.get("sleepHours") or 8

    if score < 40 or rhr > base_rhr + 8 or hrv < hrv_base * 0.8 or sleep < 5:
        return "red"
    if score < 65 or hrv < hrv_base or rhr > base_rhr + 5 or sleep < 7:
        return "amber"
    return "green"


VERDICT_MSG = {
    "green": ("Grünes Licht — voll angreifen", "Readiness {s} — Plan wie vorgesehen, Quality freigegeben."),
    "amber": ("Gelb — heute dosieren", "Readiness {s} — Intensität raus: locker statt hart, Umfang leicht kürzen."),
    "red":   ("Rot — Erholung priorisieren", "Readiness {s} — heute Ruhe oder lockeres Z1. Quality verschoben."),
}
ADJUST = {
    "green": "Keine Anpassung — Readiness grün ({s}). Plan wie vorgesehen.",
    "amber": "Angepasst (gelb, {s}): harte Teile → Z2, Intervalle −30 %, Long −20 %.",
    "red":   "Angepasst (rot, {s}): Quality gestrichen → lockere Regeneration Z1, max 30–40 min.",
}


def status_of(value, kind):
    """Grobe Statuszuordnung für die Vital-Punkte in der App."""
    b_rhr, hrv_b = CONFIG["physiology"]["restingHr"], CONFIG["physiology"]["hrvBaseline"]
    if kind == "hrv":   return "very_good" if value >= hrv_b else "amber"
    if kind == "rhr":   return "good" if value <= b_rhr + 3 else ("amber" if value <= b_rhr + 7 else "red")
    if kind == "bb":    return "high" if value >= 50 else ("amber" if value >= 25 else "red")
    if kind == "sleep": return "very_good" if value >= 7.5 else ("amber" if value >= 6 else "red")
    if kind == "stress":return "low" if value <= 30 else ("amber" if value <= 50 else "red")
    return "good"


# ---------------- Plan / Tag ----------------
def latest_plan():
    files = sorted(glob.glob(os.path.join(ROOT, "coach", "plan-*.json")))
    return json.load(open(files[-1], encoding="utf-8")) if files else None


def find_week_and_today(plan, today_iso):
    if not plan:
        return None, None, []
    td = date.fromisoformat(today_iso)
    weeks = plan["weeks"]
    # 1) Woche, die HEUTE enthält
    for w in weeks:
        ws = date.fromisoformat(w["weekStart"])
        if ws <= td <= ws + timedelta(days=6):
            today_day = next((d for d in w["days"] if d["date"] == today_iso), None)
            return w, today_day, w["days"]
    # 2) Heute außerhalb des Blocks → nächste anstehende Woche zeigen
    #    (z.B. vor Blockstart), sonst die letzte Woche (nach Blockende).
    upcoming = [w for w in weeks if date.fromisoformat(w["weekStart"]) > td]
    w = upcoming[0] if upcoming else weeks[-1]
    return w, None, w["days"]


def build_today(today_day, v, score):
    if not today_day or not today_day.get("sessions"):
        return {
            "date": TODAY, "weekday": weekday_de(TODAY), "discipline": "rest",
            "title": "Ruhetag", "duration": "—", "loadLabel": "Erholung",
            "adjustment": ADJUST[v].format(s=score), "status": "rest",
            "structure": ["Lockere Mobility / Spaziergang", "Auf Schlaf & Ernährung achten"],
            "coachNote": "Heute kein strukturiertes Training im Block. Regeneration ist Training.",
        }
    s = today_day["sessions"][0]  # Hauptsession; weitere folgen im Tagesverlauf
    extra = today_day["sessions"][1:]
    note = s.get("purpose", "")
    if extra:
        note += " Heute außerdem: " + ", ".join(f"{e['title']}" for e in extra) + "."
    return {
        "date": TODAY, "weekday": weekday_de(TODAY), "discipline": s["discipline"],
        "title": s["title"], "duration": f"{s.get('duration', 60)} min",
        "loadLabel": s.get("intensity", "—"),
        "adjustment": ADJUST[v].format(s=score), "status": "as_planned" if v == "green" else "adjusted",
        "structure": s.get("structure", []), "coachNote": note,
    }


def build_week_strip(days, today_iso):
    short = {"Mo": "Mo", "Di": "Di", "Mi": "Mi", "Do": "Do", "Fr": "Fr", "Sa": "Sa", "So": "So"}
    out = []
    for d in days:
        disc = d["sessions"][0]["discipline"] if d.get("sessions") else "rest"
        label = d["sessions"][0]["title"] if d.get("sessions") else "Ruhe"
        st = "today" if d["date"] == today_iso else ("done" if d["date"] < today_iso else "planned")
        out.append({"day": short.get(d["day"], d["day"]), "date": d["date"],
                    "discipline": disc, "label": label, "status": st})
    return out


def map_activities(acts):
    out = []
    for a in acts[:5]:
        t = (a.get("activityType") or {}).get("typeKey") or a.get("type") or ""
        disc = DISC_FROM_GARMIN.get(t, "run")
        name = a.get("activityName") or a.get("name") or disc
        dist = a.get("distance") or a.get("distance_meters") or 0
        detail = f"{dist/1000:.1f} km" if dist else (a.get("activityType", {}).get("typeKey", ""))
        d = (a.get("startTimeLocal") or a.get("start_time") or "")[:10]
        out.append({"date": d, "discipline": disc, "name": name, "detail": detail})
    return out


def weekday_de(iso):
    return ["Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag","Sonntag"][date.fromisoformat(iso).weekday()]


# ---------------- data.json ----------------
def build_data(m):
    v = verdict(m)
    score = m.get("readinessScore") or 0
    plan = latest_plan()
    week, today_day, days = find_week_and_today(plan, TODAY)

    race = CONFIG["race"]
    rd = date.fromisoformat(race["date"])
    days_to = (rd - date.fromisoformat(TODAY)).days

    hrv = m.get("hrvWeekly") or CONFIG["physiology"]["hrvBaseline"]
    rhr = m.get("rhr") or CONFIG["physiology"]["restingHr"]
    bb = m.get("bodyBattery") or 50
    sleep = m.get("sleepHours") or 8
    stress = m.get("stress") or 25
    vo2 = m.get("vo2max") or CONFIG["physiology"]["vo2maxRunning"]

    head, msg = VERDICT_MSG[v]
    data = {
        "generatedAt": datetime.now().strftime("%Y-%m-%dT%H:%M:00+02:00"),
        "source": "Garmin Connect (Marvin Griegel)",
        "athlete": {"firstName": CONFIG["athlete"]["firstName"], "age": CONFIG["athlete"]["age"]},
        "race": {"name": "IRONMAN " + race["shortName"], "location": race["location"],
                 "date": race["date"], "distanceLabel": "1,9 / 90 / 21,1 km",
                 "daysToGo": days_to, "weeksToGo": days_to // 7},
        "phase": {"block": plan["block"] if plan else "—", "macro": plan.get("focus","") if plan else "",
                  "weekIndex": 1, "totalWeeks": days_to // 7, "blockProgress": 0.0},
        "readiness": {"score": score, "level": m.get("readinessLevel") or "—",
                      "label": head.split(" — ")[0], "verdict": v,
                      "recoveryTimeHours": m.get("recoveryTimeHours") or 0,
                      "message": msg.format(s=score)},
        "today": build_today(today_day, v, score),
        "vitals": {
            "hrv":         {"value": hrv, "unit": "ms", "status": status_of(hrv, "hrv"), "baseline": CONFIG["physiology"]["hrvBaseline"], "trendIcon": "→", "label": "HRV"},
            "rhr":         {"value": rhr, "unit": "bpm", "status": status_of(rhr, "rhr"), "baseline": CONFIG["physiology"]["restingHr"], "trendIcon": "↓", "label": "Ruhepuls"},
            "bodyBattery": {"value": bb, "unit": "", "status": status_of(bb, "bb"), "high": m.get("bbHigh"), "low": m.get("bbLow"), "trendIcon": "↑", "label": "geladen"},
            "sleep":       {"value": sleep, "unit": "h", "status": status_of(sleep, "sleep"), "trendIcon": "→", "label": "Schlaf"},
            "stress":      {"value": stress, "unit": "", "status": status_of(stress, "stress"), "trendIcon": "→", "label": "Stress"},
            "vo2max":      {"value": vo2, "unit": "", "status": "up", "trendIcon": "↑", "label": "VO₂max"},
        },
        "racePredictions": format_predictions(m.get("racePredictions")),
        "vo2maxTrend": load_prev_trend(vo2),
        "week": build_week_strip(days, TODAY) if days else [],
        "recentActivities": map_activities(m.get("activities", [])),
        "weekSummary": {"note": f"Tagesform {v.upper()} · Readiness {score}."},
    }
    return data, v


def format_predictions(rp):
    if not rp:
        return [{"dist": "5K", "time": "19:37"}, {"dist": "10K", "time": "41:49"},
                {"dist": "HM", "time": "1:33:50"}, {"dist": "M", "time": "3:27:15"}]
    def fmt(sec):
        if not sec: return "—"
        h, r = divmod(int(sec), 3600); mnt, s = divmod(r, 60)
        return f"{h}:{mnt:02d}:{s:02d}" if h else f"{mnt}:{s:02d}"
    return [
        {"dist": "5K", "time": fmt(rp.get("time5K") or rp.get("5K"))},
        {"dist": "10K", "time": fmt(rp.get("time10K") or rp.get("10K"))},
        {"dist": "HM", "time": fmt(rp.get("timeHalfMarathon"))},
        {"dist": "M", "time": fmt(rp.get("timeMarathon"))},
    ]


def load_prev_trend(latest):
    """VO2max-Trend aus letzter data.json fortschreiben (max 8 Punkte)."""
    p = os.path.join(APP, "data.json")
    pts = []
    if os.path.exists(p):
        pts = json.load(open(p, encoding="utf-8")).get("vo2maxTrend", [])
    if not pts or pts[-1].get("v") != latest:
        pts.append({"date": TODAY, "v": latest})
    return pts[-8:]


# ---------------- main ----------------
def main():
    print(f"TriCoach daily_update — {TODAY} {'(offline)' if OFFLINE else ''}")
    if OFFLINE:
        m = offline_metrics()
    else:
        api = garmin_login()
        m = pull_metrics(api)
    data, v = build_data(m)

    with open(os.path.join(APP, "data.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"  data.json geschrieben — Ampel {v.upper()}, Readiness {data['readiness']['score']}")

    # plan.ics neu bauen
    sys.argv = [sys.argv[0]]
    import importlib.util
    spec = importlib.util.spec_from_file_location("build_ics", os.path.join(ROOT, "tools", "build_ics.py"))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    mod.main()
    print("  fertig.")


if __name__ == "__main__":
    main()
