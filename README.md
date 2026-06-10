# TriCoach 🏊🚴🏃

Persönliche KI-Triathlon-Coach-App für **Marvin** auf dem Weg zum **IRONMAN 70.3 Zell am See** (≈ Aug 2027).
Zieht jeden Morgen Garmin-Health, passt das Training an die Tagesform an, zeigt alles in einer iPhone-PWA und legt den Plan in Kalender + auf die Garmin-Uhr.

## Wie es funktioniert

```
                ┌──────────────────────────────────────────────┐
   Garmin  ───► │ GitHub Actions (täglich, PC-aus-tauglich)     │
   Connect      │  tools/daily_update.py                        │
                │   • Health-Pull (Readiness/HRV/RHR/Schlaf…)   │
                │   • Ampel grün/gelb/rot → heutige Einheit      │
                │   • schreibt app/data.json + app/plan.ics      │
                └───────────────┬──────────────────────────────┘
                                │ commit
                ┌───────────────▼──────────────────────────────┐
   iPhone  ◄─── │ GitHub Pages (feste URL)                      │
                │   app/  = PWA (Home-Bildschirm)               │
                │   plan.ics = Kalender-Abo                      │
                └──────────────────────────────────────────────┘

   Claude Code (≈1×/Monat):  baut nächsten 4-Wochen-Block (coach/plan-*.json)
                             + pusht strukturierte Workouts auf die Garmin-Uhr
```

- **KI-Coaching** (Periodisierung, Wochenplanung) macht **Claude Code** in 4-Wochen-Blöcken — kein API-Key nötig.
- **Tägliche Mechanik** (Pull + Anpassung + Commit) macht **reines Python in GitHub Actions** — autonom, ohne LLM.

## Struktur

| Pfad | Zweck |
|---|---|
| `app/` | PWA: `index.html`, `style.css`, `app.js`, `manifest.webmanifest`, `sw.js` |
| `app/data.json` | Tagesdaten (vom Actions-Job geschrieben) — Quelle der App |
| `app/plan.ics` | Kalender-Feed (vom Generator geschrieben) |
| `config/athlete.json` | Profil, Zonen, Race, Methodik, Readiness-Regeln |
| `coach/methodology.md` | Trainingsphilosophie + Makro-Periodisierung |
| `coach/plan-*.json` | 4-Wochen-Trainingsblöcke |
| `tools/daily_update.py` | Autonomer Morgen-Job |
| `tools/build_ics.py` | Plan → `plan.ics` |
| `tools/export_token.py` | Garmin-Token → GitHub-Secret |
| `.github/workflows/daily.yml` | Cron-Automatik |

## Setup (einmalig)

### 1. Repo + Hosting
```bash
cd triathlon-coach
git init && git add . && git commit -m "TriCoach init"
gh repo create tricoach --private --source=. --push   # oder manuell auf github.com
```
GitHub → Repo → **Settings → Pages** → Source: `Deploy from a branch`, Branch `main`, Ordner `/app`.
→ App-URL: `https://<user>.github.io/tricoach/`

### 2. Garmin-Secret für die Automatik
```bash
python tools/export_token.py     # gibt base64-String aus
```
GitHub → **Settings → Secrets and variables → Actions → New secret**
Name `GARMINTOKENS`, Wert = der String. (Token läuft ~1 Jahr; bei Ablauf neu exportieren.)

### 3. iPhone
- **App:** URL in Safari öffnen → Teilen → **„Zum Home-Bildschirm"**. Läuft im Vollbild wie native App.
- **Kalender:** Einstellungen → Kalender → Accounts → Account hinzufügen → **Andere → Kalenderabo** → URL `https://<user>.github.io/tricoach/plan.ics`.

### 4. Race-Termin
Offiziellen 70.3-Termin 2027 in `config/athlete.json` (`race.date`) eintragen, sobald veröffentlicht.

## Wartung
- **Monatlich:** Claude Code öffnen → „nächsten Trainingsblock bauen". Ich ziehe deinen Verlauf, baue `coach/plan-<JJJJ-MM>.json`, pushe Workouts auf die Uhr, committe.
- **Täglich:** läuft von allein. App morgens checken.

## Lokal testen
```bash
python -m http.server 8765 --directory app   # → http://localhost:8765
python tools/daily_update.py --offline        # Engine-Testlauf ohne Garmin
```
