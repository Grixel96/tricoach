# TriCoach — Trainingsphilosophie & Periodisierung

> Coach-Gehirn für Marvin Griegel · Ziel: **IRONMAN 70.3 Zell am See** (≈ 2027-08-29)
> Stil: polarisiert 80/20, Long-Course-Schule im Geist von **Laura Philipp / Kristian Blummenfelt** — hohe aerobe Basis, Durability, Schwimm-Technik-Obsession, datengesteuerte Regeneration.

Dieses Dokument steuert (a) wie ich (Claude Code) die 4-Wochen-Blöcke baue und (b) wie der tägliche Python-Job die Tagesform-Anpassung macht. Werte/Zonen siehe `config/athlete.json`.

---

## 1. Ausgangslage (Stand 06/2026)

| Disziplin | Status | Konsequenz |
|---|---|---|
| 🏊 Schwimmen | **Limiter** — 0 Einheiten in Garmin, kein CSS | Priorität #1. Technik vor Umfang. Erst CSS-Test, dann 3×/Woche aufbauen. |
| 🚴 Rad | **Stärke** — 60–77 km Touren, Mallorca-Camp (1157 hm) | Ausbauen: aerobe Long Rides + Sweet-Spot/Schwelle (watt-gesteuert sobald FTP da). |
| 🏃 Lauf | **Gut** — VO₂max 54, HM 1:33, M 3:27 (Prognose) | Ökonomie halten, Durability (Brick), nicht überlaufen. |
| 💪 Kraft | 2×/Woche vorhanden | Beibehalten — Verletzungsschutz + Rumpf fürs Schwimmen. |

Physiologie: RHR 42, HRmax ~191, LTHR 167, HRV-Baseline 71. Bestens regenerierter Typ (Body Battery lädt stark).

---

## 2. Makro-Periodisierung (≈ 63 Wochen)

Langer Vorlauf → zwei Saisons. Limiter (Schwimmen) zuerst reparieren, dann spezifisch schärfen.

| Phase | Zeitraum | Fokus | Schlüssel |
|---|---|---|---|
| **Grundlage 1** | Jun–Aug 2026 | Schwimmen von 0 aufbauen, aerobe Basis, Bewegungsqualität | CSS etablieren, 3× Schwimmen/Woche, lange lockere Räder |
| **Grundlage 2 / B-Race** | Sep–Okt 2026 | Aerobe Tiefe + erstes Wettkampfgefühl | optional Sprint/Olympic als Test |
| **Off-Season / Kraft** | Nov–Dez 2026 | Maximalkraft, Schwimm-Technik-Block, Defizite | Gym-Block, Schwimm-Camp-Mentalität |
| **Base 3** | Jan–Mär 2027 | Umfang aufbauen, Schwelle Rad/Lauf | FTP-Aufbau, CSS senken |
| **Build / 70.3-spezifisch** | Apr–Jun 2027 | Renntempo, lange Bricks, Sweet-Spot 90 km | Tune-up-Race (Olympic/Half) ~Jun 2027 |
| **Peak + Taper** | Jul–Aug 2027 | Rennspezifik → Frische | 2–3 Wo Taper in Zell am See |

3:1-Rhythmus (3 Belastungswochen + 1 Entlastung). Alle 4–6 Wochen Re-Test (CSS, FTP, Schwellenlauf).

---

## 3. Schwimm-Entwicklungsplan (Limiter → Waffe)

1. **Woche 1:** CSS-Baseline-Test (400 m + 200 m all-out). CSS/100 m = (T400 − T200) / 2.
2. **Wochen 1–6:** Technik-Dominanz — Drills (Catch-up, Fingertip-Drag, Scull, Kick), kurze CSS-Sets, kontinuierlich bis 1500–2000 m.
3. **Wochen 6–16:** Umfang + Schwellen-Sets (CSS-Pace ± 2–5 s), Open-Water-Skills, Neopren, Sichten.
4. **Ziel Renntag:** 1,9 km entspannt unter ~34–36 min, raus mit frischen Beinen.

Regel: lieber 3× kurz/Woche als 1× lang. Frequenz baut Wassergefühl.

---

## 4. Wochen-Template (Grundlagenphase)

Honoriert verfügbare Tage (alle 7) + Garmin-Vorgabe lange Einheiten Di/Fr.

| Tag | Einheit | Zone |
|---|---|---|
| Mo | 🏊 Schwimm Technik + 💪 Kraft (Unterkörper/Rumpf) | Z1–2 / — |
| Di | 🏃 Lauf Quality (Schwelle/Intervalle) | Z4 Kern, Z1 Rest |
| Mi | 🚴 Rad Sweet-Spot / Endurance | Z2–3 |
| Do | 🏊 Schwimm Ausdauer + 💪 Kraft (Oberkörper) | Z2 / — |
| Fr | 🏃 Lauf Long (Garmin-Langtag) | Z2 |
| Sa | 🚴 Rad Long + 🏃 Brick-Run | Z2 + 10–20′ Renntempo |
| So | 🏊 Schwimm Technik + lockerer Ausgleich/Mobility | Z1 |

Volumen 12–16 h. 80 % der Zeit Z1–Z2, 20 % Z3+. Kein Junk-Mitteltempo.

---

## 5. Tagesform-Anpassung (Ampel — auch im Python-Job)

Inputs aus Garmin-Morgen-Pull: Training Readiness, HRV (vs Baseline 71), RHR (vs 42–44), Schlaf, Body Battery.

- 🟢 **GRÜN** (Readiness ≥ 65, HRV ≥ Baseline, RHR ≤ +5, Schlaf ≥ 7 h): Plan voll ausführen, Quality frei.
- 🟡 **GELB** (Readiness 40–64 ODER HRV unter Baseline ODER RHR +6…+8 ODER Schlaf 5–7 h): Intensität raus — harte Einheit → Z2-Dauer, Intervalle −30 %, Long −20 %.
- 🔴 **ROT** (Readiness < 40 ODER RHR > +8 ODER HRV stark runter ODER Schlaf < 5 h ODER krank): Ruhe oder Z1 ≤ 30–40′. Kein Quality. Quality auf Folgetag schieben.

Zusätzlich: 3 schlechte Tage in Folge → Woche zur Entlastung umbauen. ACWR (Garmin) > 1,5 → Volumen kappen.

---

## 6. Block-Regeneration (für Claude Code, ~1×/Monat)

Wenn der nächste 4-Wochen-Block fällig ist:
1. Garmin ziehen: VO₂max-Trend, Training-Load (CTL/ATL/TSB), letzte Aktivitäten, CSS/FTP-Updates, Readiness-Historie.
2. Aktuelle Makro-Phase aus Tabelle §2 bestimmen.
3. 3:1-Block bauen, Wochen-Template §4 als Basis, an Phase + Limiter-Fortschritt anpassen.
4. Schreiben nach `coach/plan-<JJJJ-MM>.json` (Schema wie bestehender Block).
5. `tools/build_ics.py` + Garmin-Push laufen lassen, committen.

Progressionsregeln: Umfang +8–10 %/Belastungswoche, Entlastung −35–40 %. Eine neue Stressquelle pro Zeit (entweder Umfang ODER Intensität steigern, nicht beides).
