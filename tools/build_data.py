"""Builds data/project-data.xlsx, templates/Dashboard_Update_Template.xlsx and data/default-data.js.

Source: IPC-07 (period 23-Jul-2026 → 22-Aug-2026), RP01-RCRC-ICR-WSP-TR-01-COM-IAP-00008.
Usage: python3 tools/build_data.py [items.json]
"""
import datetime as dt
import json
import os
import sys

import xlsxwriter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PROJECT = [
    ("Project Name", "Development of Taif Road — Section C"),
    ("Contract No", "20250928162"),
    ("Client", "Royal Commission for Riyadh City (RCRC)"),
    ("Consultant", "WSP"),
    ("Contractor", "RTCC – IC ICTAS JV"),
    ("Contract Value (excl VAT)", 1557000000.10),
    ("Contract Value (incl VAT)", 1790550000.11),
    ("Approved Change Orders (excl VAT)", 0),
    ("Advance Payment (incl VAT)", 179055000.01),
    ("VAT %", 15),
    ("Advance Recovery %", 10),
    ("Retention %", 0),
    ("Commencement Date", dt.date(2025, 10, 15)),
    ("Planned Completion Date", None),
    ("Data Date", dt.date(2026, 8, 22)),
]
PROJECT_NOTES = {
    "Commencement Date": "Start of IPC-01 period",
    "Planned Completion Date": "Fill from contract / P6 baseline (enables Time-elapsed KPI)",
    "Data Date": "Usually the 'Period To' of the latest IPC",
}

D = dt.date
INVOICES = [
    # IPC, from, to, work done, advance recovery, VAT, retention, net certified, status
    (1, D(2025, 10, 15), D(2026, 2, 22), 1409896.37, 140989.64, 190336.01, 0, 1459242.74, "Certified"),
    (2, D(2026, 2, 23), D(2026, 3, 22), 656249.40, 65624.94, 88593.67, 0, 679218.13, "Certified"),
    (3, D(2026, 3, 23), D(2026, 4, 22), 3620445.21, 362044.52, 488760.10, 0, 3747160.79, "Certified"),
    (4, D(2026, 4, 23), D(2026, 5, 22), 4926757.07, 492675.71, 665112.20, 0, 5099193.57, "Certified"),
    (5, D(2026, 5, 23), D(2026, 6, 22), 3099142.08, 309914.21, 418384.18, 0, 3207612.05, "Certified"),
    (6, D(2026, 6, 23), D(2026, 7, 22), 4881764.98, 488176.50, 659038.27, 0, 5052626.75, "Certified"),
    (7, D(2026, 7, 23), D(2026, 8, 22), 33138886.06, 3313888.61, 4473749.62, 0, 34298747.07, "Submitted"),
]

# Section, description, contract, previous, current, cumulative  (IPC-07 BOQ summary page)
SECTIONS = [
    ("Section 01", "General Items", 0, 0, 0, 0),
    ("Section 02", "Earthworks", 90825644.98, 3086007.57, 215072.73, 3301080.30),
    ("Section 03", "Base Courses", 47371713.86, 0, 0, 0),
    ("Section 04", "Bituminous Works", 171682971.50, 0, 0, 0),
    ("Section 05", "Minor Structures, Underpasses & Retaining Walls", 52056078.88, 0, 0, 0),
    ("Section 5A", "Bridge @ 4+050", 94018403.04, 8674314.30, 17610032.03, 26284346.33),
    ("Section 5B", "Bridge @ 7+300", 93631147.04, 1974696.69, 9848160.52, 11822857.21),
    ("Section 5C", "Bridge @ 10+550", 81506724.92, 0, 1358425.14, 1358425.14),
    ("Section 5D", "Underpass @ 13+500", 26754465.60, 0, 0, 0),
    ("Section 5E", "Underpass @ 14+400", 32793604.40, 0, 0, 0),
    ("Section 5F", "Bridge @ Jeddah Junction", 41934082.47, 508801.46, 764204.07, 1273005.53),
    ("Section 06", "Road Safety Works", 106639613.90, 0, 0, 0),
    ("Section 07", "Electrical Works", 290371156.22, 0, 1739513.68, 1739513.68),
    ("Section 08", "Landscape", 36719942.93, 0, 0, 0),
    ("Section 09", "Traffic Appurtenances", 19257511.58, 0, 0, 0),
    ("Section 10", "Wet Utility", 148746136.60, 4350435.09, 1603477.89, 5953912.98),
    ("Section 11", "ITS", 24852042.87, 0, 0, 0),
    ("Section 12", "Diversion Works", 77221842.65, 0, 0, 0),
    ("Section 13A", "Pedestrian Bridge 1", 17256741.20, 0, 0, 0),
    ("Section 13B", "Pedestrian Bridge 2", 18275591.85, 0, 0, 0),
    ("Section 13C", "Pedestrian Bridge 3", 16062627.03, 0, 0, 0),
    ("Section 13D", "Pedestrian Bridge 4", 16055504.47, 0, 0, 0),
    ("Section 13E", "Pedestrian Bridge 5", 16076872.15, 0, 0, 0),
    ("Section 13F", "Pedestrian Bridge 6", 17256741.20, 0, 0, 0),
    ("Section 13G", "Pedestrian Bridge 7", 17256741.20, 0, 0, 0),
    ("Section 14", "Traffic Signal", 2376097.56, 0, 0, 0),
]

README = [
    ("HOW TO UPDATE THE DASHBOARD", "طريقة تحديث لوحة المتابعة"),
    ("1. Each month, after the IPC is issued, add one row in 'Invoices' (copy values from the Payment Log).",
     "١. كل شهر بعد إصدار المستخلص أضف سطراً في شيت Invoices من سجل الدفعات."),
    ("2. In 'Sections' update Previous / Current / Cumulative from the BOQ Summary page of the IPC.",
     "٢. في شيت Sections حدّث السابق / الحالي / التراكمي من صفحة ملخص الـBOQ في المستخلص."),
    ("3. In 'BOQ_Items' update Previous / Current / To-Date quantities (rates & amounts are recalculated if left blank).",
     "٣. في شيت BOQ_Items حدّث الكميات السابقة / الحالية / التراكمية (المبالغ تُحسب تلقائياً لو تُركت فارغة)."),
    ("4. In 'Performance' add the P6 update row: Data Date, Planned %, Actual % (physical progress).",
     "٤. في شيت Performance أضف سطر التحديث من البريمافيرا: تاريخ البيانات، المخطط ٪، الفعلي ٪."),
    ("5. 'Baseline_Plan' = monthly planned value (SAR excl. VAT) from the P6 baseline (or import the .xer in the site).",
     "٥. شيت Baseline_Plan = القيمة المخططة الشهرية من البيز لاين (أو استورد ملف ‎.xer من الموقع مباشرة)."),
    ("6. Update 'Data Date' in 'Project'. Then open the site → Import File tab → drop this workbook.",
     "٦. حدّث Data Date في شيت Project، ثم افتح الموقع ← تبويب Import File ← ارفع الملف."),
    ("7. To publish for everyone: upload it to GitHub as data/project-data.xlsx (replace the old one).",
     "٧. للنشر للجميع: ارفعه على GitHub باسم data/project-data.xlsx بدلاً من القديم."),
    ("", ""),
    ("RULES", "قواعد"),
    ("• Do not rename sheets or header cells. Extra columns are ignored.", "• لا تغيّر أسماء الشيتات أو العناوين. الأعمدة الإضافية يتم تجاهلها."),
    ("• Amounts in SAR. Work done & recovery are EXCLUDING VAT. Dates as real Excel dates.", "• المبالغ بالريال. قيمة الأعمال والاسترداد بدون ضريبة. التواريخ بصيغة تاريخ إكسل."),
    ("• Percent columns: type 12.5 or 12.5% — both work.", "• أعمدة النسب: اكتب 12.5 أو ‎12.5% — الاثنين صحيح."),
    ("• Blank VAT / Net Certified are computed from VAT % in 'Project'.", "• لو تُركت الضريبة أو الصافي فارغة يتم حسابها تلقائياً."),
]


def build(path, items, blank=False):
    wb = xlsxwriter.Workbook(path)
    H = wb.add_format({"bold": True, "font_color": "#FFFFFF", "bg_color": "#0F6B45", "border": 1, "text_wrap": True, "valign": "vcenter"})
    T = wb.add_format({"bold": True, "font_size": 14, "font_color": "#0F6B45"})
    money = wb.add_format({"num_format": "#,##0.00", "border": 1})
    qty = wb.add_format({"num_format": "#,##0.00", "border": 1})
    date = wb.add_format({"num_format": "dd-mmm-yyyy", "border": 1})
    txt = wb.add_format({"border": 1})
    wrap = wb.add_format({"border": 1, "text_wrap": True})
    inp = wb.add_format({"border": 1, "bg_color": "#FFF8E1", "num_format": "#,##0.00"})
    inpd = wb.add_format({"border": 1, "bg_color": "#FFF8E1", "num_format": "dd-mmm-yyyy"})
    note = wb.add_format({"italic": True, "font_color": "#7A8781"})
    rtl = wb.add_format({"reading_order": 2, "align": "right"})
    rtlb = wb.add_format({"reading_order": 2, "align": "right", "bold": True, "font_size": 13, "font_color": "#0F6B45"})

    ws = wb.add_worksheet("README")
    ws.set_column(0, 0, 100)
    ws.set_column(1, 1, 90)
    for r, (en, ar) in enumerate(README):
        big = en.isupper() and en
        ws.write(r, 0, en, T if big else None)
        ws.write(r, 1, ar, rtlb if big else rtl)
    ws.write(len(README) + 1, 0, "Yellow cells = inputs you update every month.", note)

    ws = wb.add_worksheet("Project")
    ws.set_column(0, 0, 36); ws.set_column(1, 1, 44); ws.set_column(2, 2, 60)
    ws.write_row(0, 0, ["Field", "Value", "Note"], H)
    for r, (k, v) in enumerate(PROJECT, 1):
        ws.write(r, 0, k, txt)
        if isinstance(v, dt.date):
            ws.write_datetime(r, 1, dt.datetime.combine(v, dt.time()), inpd if k == "Data Date" else date)
        elif v is None:
            ws.write_blank(r, 1, None, inpd)
        elif isinstance(v, (int, float)):
            ws.write_number(r, 1, v, money)
        else:
            ws.write(r, 1, v, txt)
        ws.write(r, 2, PROJECT_NOTES.get(k, ""), note)

    ws = wb.add_worksheet("Invoices")
    heads = ["IPC No", "Period From", "Period To", "Work Done (excl VAT)", "Advance Recovery (excl VAT)", "VAT",
             "Retention (incl VAT)", "Net Certified (incl VAT)", "Status", "Paid Amount", "Paid Date", "Remarks"]
    ws.write_row(0, 0, heads, H)
    ws.set_row(0, 32)
    ws.set_column(0, 0, 8); ws.set_column(1, 2, 13); ws.set_column(3, 7, 19); ws.set_column(8, 8, 12)
    ws.set_column(9, 9, 16); ws.set_column(10, 10, 13); ws.set_column(11, 11, 30)
    ws.freeze_panes(1, 1)
    ws.data_validation(1, 8, 200, 8, {"validate": "list", "source": ["Submitted", "Certified", "Paid", "Rejected"]})
    if not blank:
        for r, row in enumerate(INVOICES, 1):
            ws.write_number(r, 0, row[0], txt)
            ws.write_datetime(r, 1, dt.datetime.combine(row[1], dt.time()), date)
            ws.write_datetime(r, 2, dt.datetime.combine(row[2], dt.time()), date)
            for c in range(3, 8):
                ws.write_number(r, c, row[c], money)
            ws.write(r, 8, row[8], txt)
            ws.write_blank(r, 9, None, inp); ws.write_blank(r, 10, None, inpd); ws.write_blank(r, 11, None, txt)
    start = 1 if blank else len(INVOICES) + 1
    for r in range(start, start + 3):
        for c in range(12):
            ws.write_blank(r, c, None, inpd if c in (1, 2, 10) else inp)

    ws = wb.add_worksheet("Sections")
    ws.write_row(0, 0, ["Section", "Description", "Contract Amount", "Previous Amount", "Current Amount", "Cumulative Amount", "Planned % To Date"], H)
    ws.set_row(0, 32)
    ws.set_column(0, 0, 13); ws.set_column(1, 1, 46); ws.set_column(2, 5, 19); ws.set_column(6, 6, 14)
    ws.freeze_panes(1, 2)
    for r, s in enumerate(SECTIONS, 1):
        ws.write(r, 0, s[0], txt); ws.write(r, 1, s[1], txt); ws.write_number(r, 2, s[2], money)
        for c in (3, 4, 5):
            if blank:
                ws.write_blank(r, c, None, inp)
            else:
                ws.write_number(r, c, s[c], inp)
        ws.write_blank(r, 6, None, inp)
    n = len(SECTIONS)
    ws.write(n + 1, 1, "Grand Total", H)
    for c in range(2, 6):
        col = "CDEF"[c - 2]
        ws.write_formula(n + 1, c, f"=SUM({col}2:{col}{n + 1})", H)
    ws.write(n + 3, 1, "Planned % To Date: optional, from P6 (per WBS/section) — draws a planned marker on each progress bar.", note)

    ws = wb.add_worksheet("BOQ_Items")
    heads = ["Bill", "Item No", "Description", "Unit", "Contract Qty", "Unit Rate", "Contract Amount",
             "Previous Qty", "Current Qty", "To-Date Qty", "Current Amount", "To-Date Amount"]
    ws.write_row(0, 0, heads, H)
    ws.set_row(0, 32)
    ws.set_column(0, 0, 7); ws.set_column(1, 1, 11); ws.set_column(2, 2, 60); ws.set_column(3, 3, 13)
    ws.set_column(4, 11, 15)
    ws.freeze_panes(1, 3)
    ws.autofilter(0, 0, max(1, len(items)), len(heads) - 1)
    for r, it in enumerate(items, 1):
        ws.write(r, 0, it["bill"], txt); ws.write(r, 1, it["item"], txt); ws.write(r, 2, it["desc"], wrap)
        ws.write(r, 3, it["unit"], txt)
        ws.write_number(r, 4, it["contract_qty"], qty); ws.write_number(r, 5, it["rate"], money)
        ws.write_number(r, 6, it["contract_amount"], money)
        pq, cq = (0, 0) if blank else (it["prev_qty"], it["curr_qty"])
        ws.write_number(r, 7, pq, inp); ws.write_number(r, 8, cq, inp)
        ws.write_formula(r, 9, f"=H{r+1}+I{r+1}", qty, pq + cq)
        ws.write_formula(r, 10, f"=I{r+1}*F{r+1}", money, cq * it["rate"])
        ws.write_formula(r, 11, f"=J{r+1}*F{r+1}", money, (pq + cq) * it["rate"])

    ws = wb.add_worksheet("Baseline_Plan")
    ws.write_row(0, 0, ["Month", "Planned Value (excl VAT)", "Planned Cum Value", "Planned Cum %"], H)
    ws.set_row(0, 32)
    ws.set_column(0, 0, 13); ws.set_column(1, 3, 20)
    cv = PROJECT[5][1]
    first = dt.date(2025, 10, 1)
    for r in range(1, 61):
        y, m = divmod(first.month - 1 + r - 1, 12)
        ws.write_datetime(r, 0, dt.datetime(first.year + y, m + 1, 1), wb.add_format({"num_format": "mmm-yyyy", "border": 1}))
        ws.write_blank(r, 1, None, inp)
        ws.write_formula(r, 2, f"=SUM($B$2:B{r+1})", money)
        ws.write_formula(r, 3, f"=IF(C{r+1}=0,\"\",C{r+1}/{cv})", wb.add_format({"num_format": "0.00%", "border": 1}))
    ws.write(0, 5, "Paste monthly planned value from the P6 baseline (cost-loaded S-curve / spending plan).", note)
    ws.write(1, 5, "Or: site → Import File → drop the baseline .xer → Export what's loaded.", note)
    ws.write(2, 5, "Add or delete month rows as needed (dates = 1st of month).", note)

    ws = wb.add_worksheet("Performance")
    ws.write_row(0, 0, ["Data Date", "Planned %", "Actual %", "Remarks"], H)
    ws.set_row(0, 32)
    ws.set_column(0, 0, 13); ws.set_column(1, 2, 12); ws.set_column(3, 3, 50)
    for r in range(1, 25):
        ws.write_blank(r, 0, None, inpd); ws.write_blank(r, 1, None, inp); ws.write_blank(r, 2, None, inp); ws.write_blank(r, 3, None, txt)
    ws.write(0, 5, "Physical progress from each P6 update (Planned % = baseline, Actual % = performance % complete).", note)
    wb.close()


def main():
    items_path = sys.argv[1] if len(sys.argv) > 1 else None
    items = []
    if items_path and os.path.exists(items_path):
        items = json.load(open(items_path))["items"]
    for it in items:
        for k in ("contract_qty", "rate", "prev_qty", "curr_qty", "contract_amount", "curr_amount", "todate_amount"):
            it[k] = float(it.get(k) or 0)
    build(os.path.join(ROOT, "data", "project-data.xlsx"), items)
    build(os.path.join(ROOT, "templates", "Dashboard_Update_Template.xlsx"), items, blank=True)

    proj = dict(PROJECT)
    model = {
        "project": {
            "name": proj["Project Name"], "contractNo": proj["Contract No"], "client": proj["Client"],
            "consultant": proj["Consultant"], "contractor": proj["Contractor"], "cv": proj["Contract Value (excl VAT)"],
            "cvVat": proj["Contract Value (incl VAT)"], "co": 0, "advance": proj["Advance Payment (incl VAT)"],
            "vat": 15, "advPct": 10, "retPct": 0, "start": "2025-10-15", "finish": "", "dataDate": "2026-08-22",
        },
        "invoices": [{
            "ipc": str(r[0]), "from": r[1].isoformat(), "to": r[2].isoformat(), "work": r[3], "recovery": r[4],
            "vat": r[5], "retention": r[6], "net": r[7], "status": r[8], "paid": 0, "paidDate": "", "remarks": "",
        } for r in INVOICES],
        "sections": [{"code": s[0], "desc": s[1], "contract": s[2], "prev": s[3], "curr": s[4], "cum": s[5], "plannedPct": None} for s in SECTIONS],
        "items": [{
            "bill": it["bill"], "item": it["item"], "desc": it["desc"], "unit": it["unit"],
            "cqty": it["contract_qty"], "rate": it["rate"], "camt": it["contract_amount"],
            "pqty": it["prev_qty"], "qqty": it["curr_qty"], "tqty": it["prev_qty"] + it["curr_qty"],
            "qamt": it["curr_amount"], "tamt": it["todate_amount"],
        } for it in items],
        "baseline": [],
        "performance": [],
    }
    with open(os.path.join(ROOT, "data", "default-data.js"), "w", encoding="utf-8") as f:
        f.write("/* Embedded copy of data/project-data.xlsx — used when the xlsx cannot be fetched (e.g. opened from disk). */\n")
        f.write("window.DEFAULT_DATA = " + json.dumps(model, ensure_ascii=False) + ";\n")
    print("sections total", round(sum(s[2] for s in SECTIONS), 2), "cum", round(sum(s[5] for s in SECTIONS), 2), "items", len(items))


if __name__ == "__main__":
    main()
