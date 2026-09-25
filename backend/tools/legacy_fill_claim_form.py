#!/usr/bin/env python3
"""
Medi Assist Reimbursement Claim Form filler (Part A + Part B).

The blank form has no fillable fields, so this script:
  1. Detects every character box on the page (small vector curves) with pdfplumber.
  2. Writes one character per box / ticks checkboxes / writes free text with reportlab.
  3. Merges that text layer onto the original PDF with pypdf.

Data lives in claim_data.json; form coordinates live in LAYOUT below.
Only change claim_data.json for a new claim.

Usage:
    pip install pdfplumber reportlab pypdf
    python fill_claim_form.py --form Medi_Assist_Reimbursement_Claim_Form_BLANK.pdf \
                              --data claim_data.json --out filled_claim.pdf [--preview]
"""
import argparse
import io
import json
import sys

import pdfplumber
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas

FONT = "Helvetica-Bold"
INK = (0.05, 0.10, 0.45)          # dark blue
BOX_MIN, BOX_MAX = 5, 14          # size range (pt) of a character box
ROW_TOL = 2.2                     # Y tolerance when matching a row of boxes

# ---------------------------------------------------------------------------
# LAYOUT: page index -> field -> placement.  Coordinates are PDF points,
# measured from the TOP of the page (pdfplumber convention).
#   boxes : {"top", "x", "x_to"(opt), "right"(opt)}  -> one char per box
#   tick  : {"options": {value: [top, x]}}            -> X in the matching box
#   text  : {"x", "base", "size"(opt)}                -> free text at baseline
# ---------------------------------------------------------------------------
P_A, P_DECL, P_B = 1, 2, 3

LAYOUT = {
  P_A: {
    # Section A - primary insured
    "policy_no":        {"t": "boxes", "top": 67,  "x": 63,  "x_to": 306},
    "certificate_no":   {"t": "boxes", "top": 67,  "x": 375},
    "tpa_id":           {"t": "boxes", "top": 80,  "x": 100},
    "ins_surname":      {"t": "boxes", "top": 94,  "x": 63,  "x_to": 232},
    "ins_first":        {"t": "boxes", "top": 94,  "x": 232, "x_to": 380},
    "ins_middle":       {"t": "boxes", "top": 94,  "x": 380},
    "address_1":        {"t": "boxes", "top": 107, "x": 63},
    "address_2":        {"t": "boxes", "top": 120, "x": 63},
    "city":             {"t": "boxes", "top": 133, "x": 75,  "x_to": 306},
    "state":            {"t": "boxes", "top": 133, "x": 327},
    "pin":              {"t": "boxes", "top": 146, "x": 87,  "x_to": 160},
    "phone":            {"t": "boxes", "top": 146, "x": 207, "x_to": 360},
    "email":            {"t": "text",  "x": 379, "base": 153.5},
    # Section B - insurance history
    "other_cover_now":  {"t": "tick", "options": {"YES": [174, 184.6], "NO": [174, 207.6]}},
    "first_ins_dd":     {"t": "boxes", "top": 173, "x": 375, "x_to": 400},
    "first_ins_mm":     {"t": "boxes", "top": 173, "x": 411, "x_to": 435},
    "first_ins_yyyy":   {"t": "boxes", "top": 173, "x": 447},
    "hosp_last_4yrs":   {"t": "tick", "options": {"YES": [200, 364.6], "NO": [200, 387.9]}},
    "diagnosis_prev":   {"t": "text",  "x": 66, "base": 220},
    "prev_covered":     {"t": "tick", "options": {"YES": [212, 510.2], "NO": [212, 533.4]}},
    # Section C - patient
    "pat_surname":      {"t": "boxes", "top": 254, "x": 63,  "x_to": 232},
    "pat_first":        {"t": "boxes", "top": 254, "x": 232, "x_to": 380},
    "pat_middle":       {"t": "boxes", "top": 254, "x": 380},
    "pat_gender":       {"t": "tick", "options": {"MALE": [266, 100.5], "FEMALE": [266, 136.5]}},
    "pat_age_years":    {"t": "boxes", "top": 266, "x": 208, "x_to": 232},
    "pat_age_months":   {"t": "boxes", "top": 266, "x": 255, "x_to": 280},
    "pat_dob_dd":       {"t": "boxes", "top": 265, "x": 327, "x_to": 352},
    "pat_dob_mm":       {"t": "boxes", "top": 266, "x": 363, "x_to": 387},
    "pat_dob_yyyy":     {"t": "boxes", "top": 266, "x": 400},
    "pat_relation":     {"t": "tick", "options": {
                            "SELF": [279, 136.3], "SPOUSE": [280, 185.2], "CHILD": [280, 221.8],
                            "FATHER": [280, 257.3], "MOTHER": [278, 305.2], "OTHER": [280, 340.2]}},
    "pat_address":      {"t": "boxes", "top": 307, "x": 123},
    # Section D - hospitalization
    "hospital_name":    {"t": "boxes", "top": 374, "x": 124},
    "room_category":    {"t": "tick", "options": {
                            "DAY CARE": [388, 161.4], "SINGLE": [388, 233.9],
                            "TWIN": [388, 304.9], "3+ BEDS": [388, 411.9]}},
    "hosp_due_to":      {"t": "tick", "options": {
                            "INJURY": [400, 125.3], "ILLNESS": [400, 161.7], "MATERNITY": [400, 209.3]}},
    "detected_dd":      {"t": "boxes", "top": 400, "x": 411, "x_to": 436},
    "detected_mm":      {"t": "boxes", "top": 399, "x": 448, "x_to": 472},
    "detected_yyyy":    {"t": "boxes", "top": 399, "x": 484},
    "adm_dd":           {"t": "boxes", "top": 414, "x": 88,  "x_to": 111},
    "adm_mm":           {"t": "boxes", "top": 414, "x": 124, "x_to": 147},
    "adm_yy":           {"t": "boxes", "top": 414, "x": 161, "x_to": 184},
    "adm_hh":           {"t": "boxes", "top": 414, "x": 220, "x_to": 243},
    "adm_min":          {"t": "boxes", "top": 414, "x": 256, "x_to": 279},
    "dis_dd":           {"t": "boxes", "top": 414, "x": 353, "x_to": 376},
    "dis_mm":           {"t": "boxes", "top": 414, "x": 387, "x_to": 410},
    "dis_yy":           {"t": "boxes", "top": 414, "x": 423, "x_to": 446},
    "dis_hh":           {"t": "boxes", "top": 414, "x": 483, "x_to": 506},
    "dis_min":          {"t": "boxes", "top": 414, "x": 519, "x_to": 543},
    "medico_legal":     {"t": "tick", "options": {"YES": [427, 437.8], "NO": [427, 461.2]}},
    "mlc_fir_attached": {"t": "tick", "options": {"YES": [441, 245.4], "NO": [441, 268.7]}},
    "system_of_medicine": {"t": "text", "x": 367, "base": 446.5},
    # Section E - claim (rupees, no paise)
    "pre_hosp_amt":     {"t": "boxes", "top": 480, "x": 148, "x_to": 232, "right": True},
    "hosp_amt":         {"t": "boxes", "top": 480, "x": 339, "x_to": 425, "right": True},
    "post_hosp_amt":    {"t": "boxes", "top": 493, "x": 148, "x_to": 232, "right": True},
    "total_amt":        {"t": "boxes", "top": 520, "x": 339, "x_to": 425, "right": True},
    "pre_hosp_days":    {"t": "boxes", "top": 533, "x": 148, "x_to": 185, "right": True},
    "post_hosp_days":   {"t": "boxes", "top": 533, "x": 350, "x_to": 390, "right": True},
    "domiciliary":      {"t": "tick", "options": {"YES": [547, 150.5], "NO": [547, 173.9]}},
    "checklist":        {"t": "multi", "options": {
                            "CLAIM FORM": [480, 435.6], "INTIMATION": [492, 435.6],
                            "MAIN BILL": [504, 435.6], "BREAKUP BILL": [515, 435.6],
                            "PAYMENT RECEIPT": [527, 435.6], "DISCHARGE SUMMARY": [539, 435.6],
                            "PHARMACY BILL": [550, 435.6], "OT NOTES": [561, 435.6],
                            "ECG": [573, 435.6], "DOCTOR REQUEST": [584, 435.6],
                            "INVESTIGATION REPORTS": [595, 435.6], "PRESCRIPTIONS": [606, 435.6],
                            "OTHERS": [616, 435.6]}},
    # Section G - bank
    "pan":              {"t": "boxes", "top": 760, "x": 64,  "x_to": 190},
    "account_no":       {"t": "boxes", "top": 760, "x": 268},
    "bank_branch":      {"t": "boxes", "top": 774, "x": 100},
    "payable_to":       {"t": "text",  "x": 117, "base": 794.5},
    "ifsc":             {"t": "boxes", "top": 788, "x": 364},
  },
  P_DECL: {
    "decl_dd":          {"t": "boxes", "top": 125, "x": 58,  "x_to": 80},
    "decl_mm":          {"t": "boxes", "top": 125, "x": 93,  "x_to": 115},
    "decl_yyyy":        {"t": "boxes", "top": 125, "x": 129, "x_to": 175},
    "decl_place":       {"t": "text",  "x": 205, "base": 131.5},
  },
  P_B: {
    "h_name":           {"t": "boxes", "top": 72,  "x": 104},
    "h_id":             {"t": "boxes", "top": 88,  "x": 104, "x_to": 215},
    "h_type":           {"t": "tick", "options": {"NETWORK": [89, 342.4], "NON NETWORK": [89, 413.3]}},
    "doc_surname":      {"t": "boxes", "top": 104, "x": 117, "x_to": 272},
    "doc_first":        {"t": "boxes", "top": 104, "x": 272, "x_to": 420},
    "doc_qualification":{"t": "text",  "x": 97,  "base": 126.5},
    "doc_reg_no":       {"t": "boxes", "top": 119, "x": 294, "x_to": 392},
    "doc_phone":        {"t": "boxes", "top": 118, "x": 434},
    "b_pat_surname":    {"t": "boxes", "top": 155, "x": 104, "x_to": 272},
    "b_pat_first":      {"t": "boxes", "top": 155, "x": 272, "x_to": 420},
    "ip_no":            {"t": "text",  "x": 106, "base": 177.8, "size": 7},
    "b_gender":         {"t": "tick", "options": {"MALE": [171, 259.2], "FEMALE": [171, 294.9]}},
    "b_age_years":      {"t": "boxes", "top": 171, "x": 353, "x_to": 377},
    "b_age_months":     {"t": "boxes", "top": 171, "x": 399, "x_to": 423},
    "b_dob_dd":         {"t": "boxes", "top": 171, "x": 471, "x_to": 495},
    "b_dob_mm":         {"t": "boxes", "top": 171, "x": 506, "x_to": 530},
    "b_dob_yy":         {"t": "boxes", "top": 171, "x": 542, "x_to": 566},
    "b_adm_dd":         {"t": "boxes", "top": 185, "x": 104, "x_to": 128},
    "b_adm_mm":         {"t": "boxes", "top": 185, "x": 140, "x_to": 163},
    "b_adm_yy":         {"t": "boxes", "top": 185, "x": 175, "x_to": 198},
    "b_adm_hh":         {"t": "boxes", "top": 185, "x": 234, "x_to": 258},
    "b_adm_min":        {"t": "boxes", "top": 185, "x": 270, "x_to": 294},
    "b_dis_dd":         {"t": "boxes", "top": 185, "x": 375, "x_to": 399},
    "b_dis_mm":         {"t": "boxes", "top": 185, "x": 411, "x_to": 434},
    "b_dis_yy":         {"t": "boxes", "top": 185, "x": 447, "x_to": 470},
    "b_dis_hh":         {"t": "boxes", "top": 185, "x": 506, "x_to": 530},
    "b_dis_min":        {"t": "boxes", "top": 185, "x": 542, "x_to": 566},
    "admission_type":   {"t": "tick", "options": {
                            "EMERGENCY": [204, 129.4], "PLANNED": [204, 165.7],
                            "DAY CARE": [204, 208], "MATERNITY": [204, 248.1]}},
    "discharge_status": {"t": "tick", "options": {
                            "HOME": [220, 165.7], "ANOTHER HOSPITAL": [220, 259.5], "DECEASED": [220, 306.3]}},
    "b_total_amt":      {"t": "boxes", "top": 219, "x": 480, "x_to": 566, "right": True},
    "primary_dx_1":     {"t": "text", "x": 198, "base": 280.8, "size": 6.6},
    "primary_dx_2":     {"t": "text", "x": 198, "base": 290.3, "size": 6.6},
    "additional_dx":    {"t": "text", "x": 198, "base": 307.8, "size": 6.6},
    "preauth":          {"t": "tick", "options": {"YES": [392, 200.0], "NO": [392, 226.2]}},
    "no_preauth_reason":{"t": "text", "x": 201, "base": 414.5, "size": 7},
    "injury":           {"t": "tick", "options": {"YES": [427, 115.4], "NO": [427, 140.6]}},
    "b_medico_legal":   {"t": "tick", "options": {"YES": [445, 411.8], "NO": [445, 435.5]}},
    "b_police":         {"t": "tick", "options": {"YES": [445, 520.5], "NO": [445, 544.5]}},
    "b_checklist":      {"t": "multi", "options": {
                            "CLAIM FORM": [505, 47.5], "PREAUTH REQUEST": [517, 47.5],
                            "PREAUTH APPROVAL": [529, 47.5], "PHOTO ID VERIFIED": [540, 47.5],
                            "DISCHARGE SUMMARY": [552, 47.5], "OT NOTES": [565, 47.5],
                            "MAIN BILL": [575, 47.5], "BREAKUP BILL": [588, 47.5],
                            "INVESTIGATION REPORTS": [505, 322.8], "CT/MR/USG/HPE": [517, 322.8],
                            "DOCTOR REF SLIP": [529, 322.8], "ECG": [540, 322.8],
                            "PHARMACY BILLS": [552, 322.8], "MLC/FIR": [565, 322.8],
                            "DEATH SUMMARY": [575, 322.8], "ANY OTHER": [588, 322.8]}},
    "h_address_1":      {"t": "boxes", "top": 630, "x": 102},
    "h_address_2":      {"t": "boxes", "top": 645, "x": 102},
    "h_city":           {"t": "boxes", "top": 660, "x": 115, "x_to": 330},
    "h_state":          {"t": "boxes", "top": 660, "x": 347},
    "h_pin":            {"t": "boxes", "top": 674, "x": 125, "x_to": 200},
    "h_phone":          {"t": "boxes", "top": 674, "x": 244, "x_to": 365},
    "h_place":          {"t": "text",  "x": 64, "base": 812.5},
  },
}

# Section F (bills table) geometry on page P_A
BILL_ROW_TOPS = [647, 657, 666, 675, 685, 694, 704, 713, 722, 732]
BILL_DATE_CELLS = [88, 102, 116, 130, 144, 158]          # 14pt wide each
BILL_AMT_CELLS = [445, 459, 473, 487, 501, 515, 529]     # 14pt wide each
BILL_COLS = {"bill_no": 55.5, "issued_by": 175, "towards": 258}
PRINTED_TOWARDS_NOS_X = {2: 346, 3: 350}                 # rows with printed "Nos"


class FormFiller:
    def __init__(self, form_path):
        self.form_path = form_path
        self.pdf = pdfplumber.open(form_path)
        self.boxes = {}
        self.ops = {}                                    # page -> draw operations

    # -- geometry ----------------------------------------------------------
    def _page_boxes(self, pi):
        if pi not in self.boxes:
            page = self.pdf.pages[pi]
            self.boxes[pi] = sorted(
                [(c["x0"], c["top"], c["x1"], c["bottom"]) for c in page.curves
                 if BOX_MIN < c["x1"] - c["x0"] < BOX_MAX
                 and BOX_MIN < c["bottom"] - c["top"] < BOX_MAX],
                key=lambda b: (b[1], b[0]))
        return self.boxes[pi]

    def _row(self, pi, top, x_from, x_to=9999):
        return sorted([b for b in self._page_boxes(pi)
                       if abs(b[1] - top) <= ROW_TOL and x_from - 1.5 <= b[0] < x_to],
                      key=lambda b: b[0])

    def _op(self, pi, *op):
        self.ops.setdefault(pi, []).append(op)

    # -- primitives --------------------------------------------------------
    def boxes_text(self, pi, top, x_from, text, x_to=9999, right=False, size=7.2, field=""):
        text = str(text).upper()
        row = self._row(pi, top, x_from, x_to)
        if len(text) > len(row):
            raise ValueError(f"'{field}': '{text}' needs {len(text)} boxes, only {len(row)} available")
        if right:
            row = row[len(row) - len(text):]
        for ch, b in zip(text, row):
            if ch != " ":
                self._op(pi, "center", (b[0] + b[2]) / 2, b[1] + (b[3] - b[1]) * 0.78, ch, size)

    def tick(self, pi, top, x, field=""):
        row = self._row(pi, top, x, x + 3)
        if not row:
            raise ValueError(f"'{field}': no checkbox at top={top}, x={x}")
        b = row[0]
        self._op(pi, "center", (b[0] + b[2]) / 2, b[1] + (b[3] - b[1]) * 0.82, "X", 7.5)

    def free_text(self, pi, x, base, text, size=7.5):
        self._op(pi, "left", x, base, str(text).upper(), size)

    def whiteout(self, pi, x, top, w, h=8):
        self._op(pi, "white", x, top, w, h)

    # -- fields ------------------------------------------------------------
    def fill_fields(self, data):
        for pi, fields in LAYOUT.items():
            for name, spec in fields.items():
                value = data.get(name)
                if value in (None, "", []):
                    continue
                t = spec["t"]
                if t == "boxes":
                    self.boxes_text(pi, spec["top"], spec["x"], value,
                                    spec.get("x_to", 9999), spec.get("right", False), field=name)
                elif t == "text":
                    self.free_text(pi, spec["x"], spec["base"], value, spec.get("size", 7.5))
                elif t in ("tick", "multi"):
                    values = value if isinstance(value, list) else [value]
                    for v in values:
                        key = str(v).upper()
                        if key not in spec["options"]:
                            raise ValueError(f"'{name}': unknown option '{v}'. "
                                             f"Valid: {list(spec['options'])}")
                        top, x = spec["options"][key]
                        self.tick(pi, top, x, field=name)

    def fill_bills(self, bills):
        if len(bills) > len(BILL_ROW_TOPS):
            raise ValueError("Form has only 10 bill rows")
        for bill in bills:
            n = bill["row"]
            top = BILL_ROW_TOPS[n - 1]
            base = top + 7.3
            if bill.get("bill_no"):
                self._op(P_A, "left", BILL_COLS["bill_no"], base, bill["bill_no"], 6.6)
            date = bill.get("date_ddmmyy", "")
            for i, ch in enumerate(date):
                self.whiteout(P_A, BILL_DATE_CELLS[i] + 0.8, top + 0.8, 12.4)
                self._op(P_A, "center", BILL_DATE_CELLS[i] + 7, base, ch, 7)
            if bill.get("issued_by"):
                self._op(P_A, "left", BILL_COLS["issued_by"], base, bill["issued_by"], 6.6)
            if bill.get("towards"):
                x = PRINTED_TOWARDS_NOS_X.get(n, BILL_COLS["towards"])
                self._op(P_A, "left", x, base, bill["towards"], 6.8)
            amt = str(bill.get("amount", "")).rjust(len(BILL_AMT_CELLS))
            if len(amt) > len(BILL_AMT_CELLS):
                raise ValueError(f"Bill row {n}: amount too long")
            for i, ch in enumerate(amt):
                if ch != " ":
                    self._op(P_A, "center", BILL_AMT_CELLS[i] + 7, base, ch, 7)

    # -- output ------------------------------------------------------------
    def save(self, out_path):
        reader = PdfReader(self.form_path)
        writer = PdfWriter()
        for pi, page in enumerate(reader.pages):
            if pi in self.ops:
                w, h = float(page.mediabox.width), float(page.mediabox.height)
                buf = io.BytesIO()
                c = canvas.Canvas(buf, pagesize=(w, h))
                c.setFillColorRGB(*INK)
                for op in self.ops[pi]:
                    kind = op[0]
                    if kind == "white":
                        _, x, top, bw, bh = op
                        c.setFillColorRGB(1, 1, 1)
                        c.rect(x, h - top - bh, bw, bh, stroke=0, fill=1)
                        c.setFillColorRGB(*INK)
                    else:
                        _, x, base, s, size = op
                        c.setFont(FONT, size)
                        if kind == "center":
                            c.drawCentredString(x, h - base, s)
                        else:
                            c.drawString(x, h - base, s)
                c.save()
                buf.seek(0)
                page.merge_page(PdfReader(buf).pages[0])
            writer.add_page(page)
        with open(out_path, "wb") as f:
            writer.write(f)


def validate(data):
    """Basic sanity checks before writing anything."""
    errors = []
    bills_total = sum(int(b.get("amount") or 0) for b in data.get("bills", []))
    claimed = int(data.get("hosp_amt") or 0) + int(data.get("pre_hosp_amt") or 0) \
        + int(data.get("post_hosp_amt") or 0)
    if data.get("total_amt") and int(data["total_amt"]) != claimed:
        errors.append(f"total_amt {data['total_amt']} != sum of expense heads {claimed}")
    if data.get("bills") and bills_total != int(data.get("total_amt") or 0):
        errors.append(f"bills add up to {bills_total}, total_amt is {data.get('total_amt')}")
    ifsc = data.get("ifsc", "")
    if ifsc and (len(ifsc) != 11 or ifsc[4] != "0"):
        errors.append(f"IFSC '{ifsc}' must be 11 chars with 5th char '0'")
    pan = data.get("pan", "")
    if pan and not (len(pan) == 10 and pan[:5].isalpha() and pan[5:9].isdigit() and pan[9].isalpha()):
        errors.append(f"PAN '{pan}' format invalid (AAAAA9999A)")
    return errors


def main():
    ap = argparse.ArgumentParser(description="Fill the Medi Assist reimbursement claim form")
    ap.add_argument("--form", required=True, help="blank claim form PDF")
    ap.add_argument("--data", required=True, help="claim_data.json")
    ap.add_argument("--out", required=True, help="output PDF path")
    ap.add_argument("--preview", action="store_true", help="also save page PNGs (needs pdf2image)")
    args = ap.parse_args()

    with open(args.data, encoding="utf-8") as f:
        data = json.load(f)

    errors = validate(data)
    if errors:
        print("Validation failed:\n  - " + "\n  - ".join(errors))
        sys.exit(1)

    filler = FormFiller(args.form)
    filler.fill_fields(data)
    filler.fill_bills(data.get("bills", []))
    filler.save(args.out)
    print(f"Filled form written to {args.out}")

    if args.preview:
        from pdf2image import convert_from_path
        for i, img in enumerate(convert_from_path(args.out, dpi=110), start=1):
            img.save(f"{args.out.rsplit('.', 1)[0]}_page{i}.png")
        print("Preview PNGs saved")


if __name__ == "__main__":
    main()
