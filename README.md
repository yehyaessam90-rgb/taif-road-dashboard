# Taif Road Sec-C — Project Controls Dashboard

Static dashboard (GitHub Pages) for **Development of Taif Road – Section C** (Contract 20250928162, RTCC – IC ICTAS JV).
Tracks performance (planned vs actual, SPI), spending plan, BOQ quantities and the IPC payment log.

Tabs: Overview · Performance · Spending Plan · Quantities (BOQ) · Invoices (IPC) · Import File. A Full screen button is in the header.

## Monthly update
1. Open `data/project-data.xlsx` (or `templates/Dashboard_Update_Template.xlsx`) and fill the yellow cells: a new row in **Invoices**, the IPC summary in **Sections**, quantities in **BOQ_Items**, the P6 update in **Performance**, and **Data Date** in **Project**.
2. Check it on the site: **Import File** tab → drop the workbook. The preview is stored only in your browser.
3. Publish it for everyone: GitHub → `data/` → *Add file › Upload files* → upload as `project-data.xlsx` → Commit.

Baseline: drop the P6 baseline `.xer` in the Import tab. It builds the monthly planned curve, then use *Export what's loaded* and publish that file. You can also paste monthly planned values into **Baseline_Plan**.

## Publish on GitHub Pages
Settings → Pages → *Deploy from a branch* → `main` / root → Save. The site goes live at `https://<user>.github.io/<repo>/`.

## Files
- `index.html`, `assets/` — the site (Chart.js and SheetJS are bundled in `assets/vendor`, no CDN needed)
- `data/project-data.xlsx` — the published data the site loads
- `data/default-data.js` — embedded copy used when opening `index.html` straight from disk
- `templates/Dashboard_Update_Template.xlsx` — blank update template
- `tools/build_data.py` — regenerates the data files from the IPC-07 source values

## Schedule (Primavera P6)
- **Schedule & Gantt** tab: look-ahead (1–12 weeks), achieved (last week / month / custom), delayed, critical, milestones; WBS, status, float and text filters; Gantt with baseline bars and data-date line; CSV export.
- **Forecast** tab: baseline vs update vs certified cumulative cost, monthly forecast for coming months, performance % forecast and the activities required each month by WBS.
- Weekly update: Import File → drop the baseline and the update `.xer` → **Download schedule.json** → upload it to `data/` (replace the old one).

## Weekly report
- **Weekly Report** tab: progress by area, major quantities, losses, works completed / planned, manpower & equipment, HSE, quality, engineering, permits, procurement, issues, risks, photos and trends across weeks. Every number, row, bar and photo opens its details.
- Each week: Import File → drop the contractor's weekly report `.docx` → **Download weekly.json** → upload it to `data/` (it holds every week imported so far; photos are kept for the latest 2 weeks).
- Phone numbers and named contact persons are removed before anything is stored.

## Two P6 programmes
- `data/schedule-dbl.json` = **Detailed Baseline Rev.04** (contract baseline) + its latest update; `data/schedule.json` = **Target Plan** + its latest update.
- A programme switch sits on the Schedule, Junctions and Forecast pages (default: Detailed Baseline); the Overview strip follows it.
- **Compare Programmes** tab: summary, curves, delay distribution, monthly forecast, junctions, WBS levels 1–2 and activity-by-activity differences (CSV export).
- Junctions presentation: `data/slides.json` (slide images per junction). Update via Import → "Junctions presentation" with the slides exported as JPEG.

## Forecast to Date, resources and logic
- **Forecast to Date**: pick any future date (or a from–until window). For every activity: planned % (baseline), forecast % (update dates) and achievable % (limited by the site manpower / equipment against the P6 resource loading), with Achievable / At risk / Overstated flags, value in the period, resource coverage tables and weekly demand charts.
- Site resources: `data/site-resources.json`, from the daily manpower & equipment sheet (Import → 5).
- **Logic Check**: out-of-sequence links, SF links, open ends, dangling starts/finishes, leads, long lags, hard constraints — with the automatic correction for each. `downloads/TP_update_261016_logic-fixed.zip` = Target Plan update 16-Oct-26 with the corrections applied (import into P6 and reschedule).

## Page structure (Oct 2026)
- **Overview** — site progress only: P6 strip, physical S-curve with weekly-report actuals, latest weekly report, progress by WBS, junctions, look-ahead. No financial figures.
- **P6 Explorer** — drill-down filter (WBS level by level + activity keywords such as `concrete, -bituminous`, status, lane, critical) → planned / actual / SPI / dates / value, breakdown by the next WBS level, progress curve and the full activity list (CSV).
- **Resources** — same filter → every P6 resource on the selected activities (labour, equipment, material): budget / actual / remaining, crew per day, busiest month, monthly demand chart, per-resource activity list.
- **Financial** — everything in SAR: Summary · Invoices (IPC) · Spending plan · Cash-flow forecast (P6) · BOQ & sections.
- Resources page: **Filter reference** (exact WBS codes, keywords, status / lane / float, programme, resulting labour & equipment codes, CSV of the activity IDs), **manpower & equipment S-curve** (planned / actual / forecast, cumulative and per working day, hours or 10-h days, any single resource) and a **monthly distribution** table (actual / remaining / actual + remaining / planned, per day or month total). Actual = budget − remaining where P6 has no actual units.

## Cut-off (data date)
- Default cut-off = the XER data date (`last_recalc_date`) moved to the **Friday 00:00** of its week (the P6 data-date convention: progress up to the end of Thursday; Friday is a non-working day on the project calendars).
- **Planned %** = for every activity, the share of its baseline duration elapsed at the cut-off **in P6 working time** (its baseline calendar: 07:00–12:00 / 13:00–18:00, Friday off, holidays/exceptions), weighted by baseline budget cost. Calendars are read from the XER `CALENDAR` table and published in the programme JSON (`cals`, `meta.bt`, `meta.cl`).
- The **Cut-off block** on the Overview (also from the header pill and the *Cut-off ✎* chip on every programme bar) lets anyone pick any date and hour, step a Friday back / forward, or reset to the XER Friday. It applies to both programmes and is kept in that browser only (`localStorage trd_cutoff`). Actual % always comes from the XER update.

## Recovery / Revised programme (Logic Check page, owner only)
Drop the update XER of a programme and choose **Recovery** (fit to the contract / baseline finish) or **Revised** (fit to a new finish date and hour). Steps, all in the browser:
1. Logic fix (same rules as the Logic Check: out-of-sequence FS → SS + FF, SS → FF, SF, leads, open / dangling ends, mandatory constraints).
2. Remaining durations: in progress = original × (1 − %), not started = original (or keep P6's).
3. CPM on the XER calendars from the data date — retained logic, lag on the predecessor calendar, float to the project must-finish-by (matches P6's scheduled finish on the 16-Oct files; P6 dates that differ are resource-levelled).
4. Not-started activities with negative float are shortened by one common factor (whole days, max compression set in the block) — or, for a later new finish, all not-started activities are spread by one factor.
5. Re-baseline: planned dates = actual dates (completed), actual start + new finish (in progress), new early dates (not started); actual cost = EV, remaining cost = budget − EV, at completion = budget; units follow the same split.
Outputs: `<file>_Recovery|_Revised.xer` (project ID suffixed -RCV / -REV, Windows-1252 kept) and an Excel log (Summary, Changes, Activities, Relationships, Assignments, Issues).

## Events (NCO register)
`data/events.json` holds every owner event (Notice of Change Order …) with its start (issue) date, received date, end date (when closed), status, ball in court, time / cost impact, next action, a P6 name pattern for the related activities, and the full letter chain (reference No., date, received, from → to, type, subject, what the letter does). The **Events** tab shows KPIs, a timeline with every letter, one card per event (click for the details, letters and related P6 activities) and a letter register (CSV).
Owner updates: **Import › 6 · Events & letters** — drop the letter (Word letters fill reference / date / subject / NCO No.; PDF names fill the reference and direction), pick the event or open a new one, set status / end date / impacts, then **Download events.json** and upload it to `data/`. No personal names are stored — roles only.

## Junctions — weekly PowerPoint & daily photos
- `data/junctions/index.json` lists every weekly presentation (`weekly/<status-date>.pptx`, with each slide's junction and planned / actual figures read from the slide) and every group of daily photos (`daily/<date>/<J7|J5|J3|J1|general>/<nn>.jpg` + `_t.jpg` thumbnails).
- The Junctions page shows the chosen week (selector at the top, latest first) as real PowerPoint slides — rendered in the browser by `assets/vendor/pptx-renderer` (@aiden0z/pptx-renderer 1.4.0, Apache-2.0) — with the week's figures vs the previous week, a progress-by-week table, each junction's slide on its card, and the daily photos grouped by day (per junction).
- Owner: **Import › 4** — drop the .pptx (status date and slide → junction mapping are detected; author names are removed from the file because the site is public), drop daily photos per day / junction (resized to 1600 px + thumbnails), then **Publish to GitHub** (one commit, using a fine-grained token with Contents read/write on this repository, kept only in that browser) or **Download for manual upload** (zip of the `data/` folder).

## Publishing (owner) — the public link updates by itself
The bar at the top of the admin link lists every update that exists only in that browser (schedules, weekly reports, financial workbook, site sheet, events, junction presentations / photos) and publishes them to GitHub in one commit with the right file names (`assets/publish.js`). Connect once with a fine-grained token (this repository only, Contents: Read and write — kept only in that browser); with **Auto-publish** on, every import is published a few seconds later. Unchanged files are skipped and a schedule older than the one on the site is never published. Each publish writes `data/version.json`; open viewer pages check it every 3 minutes and offer a refresh.

## Invoices — IPA Monthly Breakdown workbook
`data/ipa-breakdown.xlsx` is the contractor's **IPA-Monthly_Breakdown.xlsx** (author names removed). On load the site reads: **Progress Statement** (work done, advance recovery, VAT, retention, net per IPC), **Payment Followup** (status, Etimad upload date, payment date, days), **BOQ Summary** (sections with the amount of every IPC) and **Combined BOQ** (2,191 priced items with contract / NCO-revised quantities and the quantity of every IPC). It replaces the invoices, sections and BOQ items of `project-data.xlsx`; certified periods and the IPC document links typed on the site are kept. Every IPC is checked = sum of its sections = sum of its items.
Owner: **Import › 1b** — drop the workbook after each new IPC; the publish bar sends it to the site.

## Summary of Progress
`assets/sop.js` — every P6 item broken down by location and detail. **By work type → area** (default): location › work › element › type › area (part / junction) › chainage, e.g. Service Road › Wet Utilities › Stormwater Manhole › Catch Basin Manholes › East Bond › Section-A Part-1 › +0.00-+1.00; or **P6 WBS order**. Each row: activities (done / in progress), cost-weighted progress vs planned at the cut-off, earned value / BAC / remaining (SAR excl. VAT), the quantities loaded on the activities (executed = loaded × physical %; P6 remaining units are not updated), the look-ahead count and the forecast finish. Row details: quantities, BOQ ↔ P6, look-ahead and EV per activity. **Look-ahead** (7–28 days) lists what must start / finish to send to site (Excel / print). **BOQ ↔ P6** pairs each BOQ-coded P6 resource (e.g. `B-5A /5A.6 COO`) with the BOQ group of the IPA workbook: BOQ qty and certified to date vs P6 loaded and executed (temporary works such as scaffolding have no BOQ item). Excel export: summary, look-ahead, activities with quantities and EV, BOQ vs P6.
