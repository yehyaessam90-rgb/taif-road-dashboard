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
