# Cognitra PRO — Elite GIA-style Cognitive Assessment

An **elite, premium, fully-functional SaaS web app** that delivers a
Thomas GIA-style cognitive battery in the browser. Five timed tasks,
twenty minutes, one composite score — plus the kind of report and
admin tooling you'd expect from a $300/seat assessment product.

> ⚠️ Original-code educational replica. Not affiliated with or endorsed
> by Thomas International Ltd.

---

## ✨ Elite features

| Capability | Detail |
|---|---|
| 🧠 **Full 5-task battery** | Perceptual Speed (3m), Reasoning (4m), Working Memory (4m), Number Speed & Accuracy (4m), Spatial Visualisation (5m) |
| 👤 **Candidate intake** | Name / email / role attached to every report |
| 🪄 **Authentic test flow** | Intro → 8 practice items → timed task → between-task summary → final report |
| ⏱ **Per-item response-time analytics** | Spark-line per task with median RT and correctness dots |
| 🕸 **SVG radar chart** | Subscale strengths at a glance |
| 📈 **Percentile mapping** | Composite score → normal-curve percentile |
| 🖨 **Print-ready PDF report** | `Cmd/Ctrl+P` outputs a polished, branded report |
| 📥 **JSON & CSV export** | Per-attempt or all-attempts |
| 🗂 **Admin dashboard** | Browser-local recruiter view: stats, list, view, delete, bulk CSV |
| 🛡 **Integrity monitoring** | Logs tab-switches, focus loss, fullscreen exits — surfaced on the report |
| ⛶ **Fullscreen focus mode** | Optional, candidate-controlled |
| 💾 **Auto-save & resume** | Refresh / quit recovery via localStorage |
| 🌗 **Dark mode** | Persisted preference, respects OS setting |
| ⌨ **Keyboard shortcuts** | `1`–`5` to answer · `Space/Enter` to advance |
| ♿ **Accessibility** | Focus rings, ARIA live regions, reduced-motion support |
| 📱 **Installable PWA** | Manifest + service worker, fully offline-capable |
| ⚡ **Zero dependencies / zero build** | Pure HTML/CSS/JS. Drop into any static host |

---

## 🗂 Project structure

```
.
├── index.html               # all screens (SPA)
├── styles.css               # design system, dark mode, print stylesheet
├── app.js                   # engine, generators, scoring, analytics, admin
├── sw.js                    # offline service worker
├── manifest.webmanifest     # PWA manifest
├── .github/workflows/
│   └── deploy.yml           # GitHub Pages auto-deploy
├── LICENSE
└── README.md
```

## ▶ Run locally

```bash
git clone https://github.com/<you>/cognitra-gia.git
cd cognitra-gia

# any static server works
python3 -m http.server 8080
# → http://localhost:8080
```

> The service worker requires `http://` (or `https://`) — opening
> `index.html` via `file://` works but the PWA features won't register.

## 🚀 Deploy to GitHub Pages (one push)

```bash
git init
git add .
git commit -m "Cognitra PRO v2"
git branch -M main
git remote add origin https://github.com/<you>/cognitra-gia.git
git push -u origin main
```

Then in **Settings → Pages → Source: GitHub Actions**. The included
workflow publishes the site automatically. Done — live at
`https://<you>.github.io/cognitra-gia/`.

## 🎯 How scoring works

Each timed task produces a 0–100 **subscale score**:

```
subscale = accuracy% × 0.55  +  throughput-vs-baseline% × 0.45
```

The **composite GIA score** is the unweighted mean of the five
subscales. That composite is mapped to a **percentile** using a normal-
curve approximation (mean 50, SD ≈ 17) — illustrative, not clinically
calibrated. Baselines live in `baselineFor()` inside `app.js`.

## 🛡 Integrity events

While in any task screen, Cognitra silently records:

- Tab/window hides
- Window blur
- Fullscreen exits

Each event timestamps into `series.integrity` and appears on the
candidate report under **Assessment integrity**. Admins also see a
clean/flag badge on the dashboard.

## 🧪 Try it like a recruiter

1. Take the assessment once (top-right → **Take assessment**)
2. Click the logo to go home
3. Top-right → **Admin** → you'll see your attempt with composite,
   percentile, integrity badge, view & delete actions, and a
   **Export all (CSV)** button.

## 🎨 Customisation

| Want to change | Where |
|---|---|
| Brand name / copy | `index.html` |
| Palette (light & dark) | `:root` & `body[data-theme="dark"]` in `styles.css` |
| Task durations | `seconds` in the `TASKS` array in `app.js` |
| Item generators | `genPerceptual` / `genReasoning` / `genWord` / `genNumber` / `genSpatial` |
| Scoring weights | `finishTask()` in `app.js` |
| Percentile curve | `percentileFor()` in `app.js` |

## 🗒 Honest limitations

- **Local-only storage** — attempts live in `localStorage`. For a
  multi-user backend, plug `saveAttempt`/`loadAttempts` into Supabase or
  Firebase (3 lines each).
- **Norms are illustrative**, not psychometrically validated against a
  reference sample.
- **Spatial glyphs** use rotated Latin letters (R, F, G, J, P, L) rather
  than the original GIA's custom symbol — visually equivalent, easy to
  swap for SVG assets.
- **English only.** Strings are centralised and easy to i18n.

## 📜 Licence

MIT — see [LICENSE](./LICENSE).
