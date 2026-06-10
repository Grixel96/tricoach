#!/usr/bin/env python3
"""
build_ics.py — Erzeugt app/plan.ics aus einem Trainingsplan-Block (coach/plan-*.json).

Reines stdlib. Jede Trainingseinheit wird ein VEVENT zur disziplin-typischen
Uhrzeit. iPhone-Kalender kann die Datei als Feed abonnieren (read-only).

Aufruf:  python tools/build_ics.py [plan-datei]
Default: jüngste coach/plan-*.json
"""
import json
import sys
import glob
import os
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "app", "plan.ics")
TZID = "Europe/Berlin"

ICON = {"swim": "🏊", "bike": "🚴", "run": "🏃", "strength": "💪", "rest": "😴"}
NAME = {"swim": "Schwimmen", "bike": "Rad", "run": "Lauf", "strength": "Kraft", "rest": "Ruhe"}


def latest_plan():
    files = sorted(glob.glob(os.path.join(ROOT, "coach", "plan-*.json")))
    if not files:
        sys.exit("Kein coach/plan-*.json gefunden.")
    return files[-1]


def esc(text):
    """ICS-Text escapen."""
    return (text.replace("\\", "\\\\").replace(";", "\\;")
                .replace(",", "\\,").replace("\n", "\\n"))


def fold(line):
    """RFC5545: Zeilen > 75 Oktett umbrechen."""
    out, cur = [], line
    while len(cur.encode("utf-8")) > 73:
        # grobe Annäherung: 70 Zeichen je Zeile, sicher unter 75 Oktett
        out.append(cur[:70])
        cur = " " + cur[70:]
    out.append(cur)
    return "\r\n".join(out)


def vevent(date_str, time_str, dur_min, s, dtstamp):
    start = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
    end = start + timedelta(minutes=int(dur_min))
    disc = s.get("discipline", "rest")
    icon = ICON.get(disc, "•")
    summary = f"{icon} {NAME.get(disc, disc)} — {s.get('title','')}"

    desc_parts = [f"Intensität: {s.get('intensity','')}", ""]
    for step in s.get("structure", []):
        desc_parts.append(f"• {step}")
    if s.get("purpose"):
        desc_parts += ["", f"Ziel: {s['purpose']}"]
    description = "\n".join(desc_parts)

    uid = f"{date_str}-{disc}-{abs(hash(summary)) % 100000}@tricoach"
    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART;TZID={TZID}:{start.strftime('%Y%m%dT%H%M%S')}",
        f"DTEND;TZID={TZID}:{end.strftime('%Y%m%dT%H%M%S')}",
        fold(f"SUMMARY:{esc(summary)}"),
        fold(f"DESCRIPTION:{esc(description)}"),
        "BEGIN:VALARM",
        "TRIGGER:-PT60M",
        "ACTION:DISPLAY",
        fold(f"DESCRIPTION:{esc(summary)}"),
        "END:VALARM",
        "END:VEVENT",
    ]
    return "\r\n".join(lines)


def vtimezone():
    # Europe/Berlin statische Definition (CET/CEST)
    return "\r\n".join([
        "BEGIN:VTIMEZONE",
        f"TZID:{TZID}",
        "BEGIN:DAYLIGHT",
        "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST",
        "DTSTART:19700329T020000",
        "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
        "END:DAYLIGHT",
        "BEGIN:STANDARD",
        "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET",
        "DTSTART:19701025T030000",
        "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
        "END:STANDARD",
        "END:VTIMEZONE",
    ])


def main():
    plan_file = sys.argv[1] if len(sys.argv) > 1 else latest_plan()
    with open(plan_file, encoding="utf-8") as f:
        plan = json.load(f)

    times = plan.get("defaultTimes", {"swim": "07:00", "bike": "16:00", "run": "17:30", "strength": "12:00", "rest": "09:00"})
    dtstamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    out = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//TriCoach//Marvin//DE",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:TriCoach Training",
        "X-WR-TIMEZONE:" + TZID,
        vtimezone(),
    ]

    count = 0
    # Mehrere Einheiten/Tag an gleicher Disziplin-Zeit → +15 min Versatz
    for week in plan.get("weeks", []):
        for day in week.get("days", []):
            date_str = day["date"]
            used = {}
            for s in day.get("sessions", []):
                disc = s.get("discipline", "rest")
                base = times.get(disc, "12:00")
                offset = used.get(base, 0)
                if offset:
                    hh, mm = map(int, base.split(":"))
                    t = (datetime.strptime(base, "%H:%M") + timedelta(minutes=15 * offset)).strftime("%H:%M")
                else:
                    t = base
                used[base] = offset + 1
                out.append(vevent(date_str, t, s.get("duration", 60), s, dtstamp))
                count += 1

    out.append("END:VCALENDAR")
    with open(OUT, "w", encoding="utf-8", newline="") as f:
        f.write("\r\n".join(out) + "\r\n")

    print(f"OK - {count} Einheiten aus {os.path.basename(plan_file)} -> {OUT}")


if __name__ == "__main__":
    main()
