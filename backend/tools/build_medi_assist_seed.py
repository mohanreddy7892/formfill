"""Dev tool: convert the hand-measured LAYOUT of fill_claim_form.py into a generic seed template.

python tools/build_medi_assist_seed.py <blank_form.pdf> tools/legacy_fill_claim_form.py
"""
import importlib.util
import json
import sys
sys.path.insert(0, ".")
import pdfplumber
from app.detect import fingerprint

pdf_path, script = sys.argv[1], sys.argv[2]
spec = importlib.util.spec_from_file_location("legacy", script)
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)

pl = pdfplumber.open(pdf_path)
cache = {}
def boxes(pi):
    if pi not in cache:
        cache[pi] = [(c["x0"], c["top"], c["x1"], c["bottom"]) for c in pl.pages[pi].curves
                     if 5 < c["x1"] - c["x0"] < 14 and 5 < c["bottom"] - c["top"] < 14]
    return cache[pi]
def row(pi, top, x, x_to=9999):
    return sorted([list(map(lambda v: round(v, 2), b)) for b in boxes(pi)
                   if abs(b[1] - top) <= 2.2 and x - 1.5 <= b[0] < x_to], key=lambda b: b[0])

GROUPS = [("Section A - Primary insured", "policy_no", "email"),
          ("Section B - Insurance history", "other_cover_now", "prev_covered"),
          ("Section C - Patient", "pat_surname", "pat_address"),
          ("Section D - Hospitalization", "hospital_name", "system_of_medicine"),
          ("Section E - Claim", "pre_hosp_amt", "checklist"),
          ("Section G - Bank account", "pan", "ifsc")]
LABELS = {
 "policy_no": "Policy no.", "certificate_no": "Sl. no / Certificate no.", "tpa_id": "Company / TPA ID (MA ID)",
 "ins_surname": "Insured surname", "ins_first": "Insured first name", "ins_middle": "Insured middle name",
 "address_1": "Address line 1", "address_2": "Address line 2", "city": "City", "state": "State", "pin": "Pin code",
 "phone": "Phone", "email": "Email", "other_cover_now": "Covered by other mediclaim now",
 "first_ins_dd": "First insurance - day", "first_ins_mm": "First insurance - month", "first_ins_yyyy": "First insurance - year",
 "hosp_last_4yrs": "Hospitalized in last 4 years", "diagnosis_prev": "Previous diagnosis", "prev_covered": "Previously covered by other mediclaim",
 "pat_surname": "Patient surname", "pat_first": "Patient first name", "pat_middle": "Patient middle name", "pat_gender": "Gender",
 "pat_age_years": "Age - years", "pat_age_months": "Age - months", "pat_dob_dd": "DOB - day", "pat_dob_mm": "DOB - month",
 "pat_dob_yyyy": "DOB - year", "pat_relation": "Relationship to insured", "pat_address": "Patient address",
 "hospital_name": "Hospital name", "room_category": "Room category", "hosp_due_to": "Hospitalization due to",
 "detected_dd": "Disease detected - day", "detected_mm": "Disease detected - month", "detected_yyyy": "Disease detected - year",
 "adm_dd": "Admission - day", "adm_mm": "Admission - month", "adm_yy": "Admission - year (YY)", "adm_hh": "Admission - hour",
 "adm_min": "Admission - minute", "dis_dd": "Discharge - day", "dis_mm": "Discharge - month", "dis_yy": "Discharge - year (YY)",
 "dis_hh": "Discharge - hour", "dis_min": "Discharge - minute", "medico_legal": "Medico legal", "mlc_fir_attached": "MLC / FIR attached",
 "system_of_medicine": "System of medicine", "pre_hosp_amt": "Pre-hospitalization Rs", "hosp_amt": "Hospitalization Rs",
 "post_hosp_amt": "Post-hospitalization Rs", "total_amt": "Total Rs", "pre_hosp_days": "Pre-hospitalization days",
 "post_hosp_days": "Post-hospitalization days", "domiciliary": "Domiciliary hospitalization", "checklist": "Documents submitted",
 "pan": "PAN", "account_no": "Account number", "bank_branch": "Bank name and branch", "payable_to": "Cheque payable to", "ifsc": "IFSC",
 "h_name": "Hospital name", "h_id": "Hospital ID (from TPA)", "h_type": "Hospital type",
 "doc_surname": "Doctor surname", "doc_first": "Doctor first name", "doc_qualification": "Doctor qualification",
 "doc_reg_no": "Doctor registration no. (with state code)", "doc_phone": "Doctor / hospital phone",
 "b_pat_surname": "Patient surname", "b_pat_first": "Patient first name", "ip_no": "IP registration number",
 "b_gender": "Patient gender", "b_age_years": "Patient age - years", "b_age_months": "Patient age - months",
 "b_dob_dd": "Patient DOB - day", "b_dob_mm": "Patient DOB - month", "b_dob_yy": "Patient DOB - year (YY)",
 "b_adm_dd": "Admission - day", "b_adm_mm": "Admission - month", "b_adm_yy": "Admission - year (YY)",
 "b_adm_hh": "Admission - hour", "b_adm_min": "Admission - minute", "b_dis_dd": "Discharge - day",
 "b_dis_mm": "Discharge - month", "b_dis_yy": "Discharge - year (YY)", "b_dis_hh": "Discharge - hour",
 "b_dis_min": "Discharge - minute", "admission_type": "Type of admission", "discharge_status": "Status at discharge",
 "b_total_amt": "Total claimed amount Rs", "primary_dx_1": "Primary diagnosis (line 1)",
 "primary_dx_2": "Primary diagnosis (line 2)", "additional_dx": "Additional diagnosis",
 "preauth": "Pre-authorization obtained", "no_preauth_reason": "Reason pre-authorization not obtained",
 "injury": "Hospitalization due to injury", "b_medico_legal": "Medico legal", "b_police": "Reported to police",
 "b_checklist": "Documents submitted (hospital)", "h_address_1": "Hospital address line 1",
 "h_address_2": "Hospital address line 2", "h_city": "Hospital city", "h_state": "Hospital state",
 "h_pin": "Hospital pin code", "h_phone": "Hospital phone", "h_place": "Declaration place (hospital)",
 "decl_dd": "Declaration - day", "decl_mm": "Declaration - month", "decl_yyyy": "Declaration - year", "decl_place": "Declaration place",
}
TEXT_RIGHT = {"email": 553, "diagnosis_prev": 312, "system_of_medicine": 552, "payable_to": 313,
              "decl_place": 337, "doc_qualification": 265, "ip_no": 199, "primary_dx_1": 292, "primary_dx_2": 292,
              "additional_dx": 292, "no_preauth_reason": 561, "h_place": 195}

def group_of(pi, name, order):
    if pi == legacy.P_DECL: return "Section H - Declaration"
    if pi == legacy.P_B: return "Part B - Hospital (hospital verifies & stamps)"
    idx = order.index(name)
    for g, a, b in GROUPS:
        if order.index(a) <= idx <= order.index(b): return g
    return "Part A"

fields = []
for pi, layout in legacy.LAYOUT.items():
    order = list(layout)
    for name, sp in layout.items():
        f = {"id": name, "label": LABELS.get(name, name.replace("_", " ").capitalize()),
             "group": group_of(pi, name, order), "page": pi}
        t = sp["t"]
        if t == "boxes":
            bx = row(pi, sp["top"], sp["x"], sp.get("x_to", 9999))
            assert bx, name
            f.update(type="boxes", boxes=bx, align="right" if sp.get("right") else "left")
        elif t == "text":
            size = sp.get("size", 7.5)
            x1 = TEXT_RIGHT.get(name, min(pl.pages[pi].width - 25, sp["x"] + 200))
            f.update(type="text", rect=[sp["x"] - 2, round(sp["base"] - size - 1.2, 2), x1, round(sp["base"] + 2.2, 2)], size=size)
        else:
            opts = []
            for v, (top, x) in sp["options"].items():
                b = row(pi, top, x, x + 3)[0]
                opts.append({"value": v, "rect": b})
            f.update(type="choice", options=opts, multi=(t == "multi"))
        fields.append(f)

# Section F bills: 10 rows x 5 columns
for n, top in enumerate(legacy.BILL_ROW_TOPS, start=1):
    g = "Section F - Bills enclosed"
    tw_x = legacy.PRINTED_TOWARDS_NOS_X.get(n, legacy.BILL_COLS["towards"])
    fields += [
      {"id": f"bill{n}_no", "label": f"Bill {n} - number", "group": g, "page": 1, "type": "text",
       "rect": [legacy.BILL_COLS["bill_no"] - 2, top + 0.5, 88, top + 9.5], "size": 6.6, "upper": True},
      {"id": f"bill{n}_date", "label": f"Bill {n} - date (DDMMYY)", "group": g, "page": 1, "type": "boxes", "clear": True, "size": 7,
       "boxes": [[x, top, x + 14, top + 9.4] for x in legacy.BILL_DATE_CELLS]},
      {"id": f"bill{n}_issued_by", "label": f"Bill {n} - issued by", "group": g, "page": 1, "type": "text",
       "rect": [legacy.BILL_COLS["issued_by"] - 2, top + 0.5, 254, top + 9.5], "size": 6.6},
      {"id": f"bill{n}_towards", "label": f"Bill {n} - towards" + (" (Nos)" if n in (2, 3) else ""), "group": g, "page": 1, "type": "text",
       "rect": [tw_x - 2, top + 0.5, 445, top + 9.5], "size": 6.8},
      {"id": f"bill{n}_amount", "label": f"Bill {n} - amount Rs", "group": g, "page": 1, "type": "boxes", "align": "right", "size": 7,
       "boxes": [[x, top, x + 14, top + 9.4] for x in legacy.BILL_AMT_CELLS]},
    ]

bills = [f for f in fields if f["id"].startswith("bill")]
rest = [f for f in fields if not f["id"].startswith("bill")]
cut = next(i for i, f in enumerate(rest) if f["id"] == "pan")
fields = rest[:cut] + bills + rest[cut:]
# ---- smart features: computed fields, checks, bills table ---------------------------------------
D = lambda d, m, y: {"d": d, "m": m, "y": y}
ADM, DIS = D("adm_dd", "adm_mm", "adm_yy"), D("dis_dd", "dis_mm", "dis_yy")
DOB, DETECTED = D("pat_dob_dd", "pat_dob_mm", "pat_dob_yyyy"), D("detected_dd", "detected_mm", "detected_yyyy")
COMPUTE = {
    "total_amt": {"kind": "sum", "of": ["pre_hosp_amt", "hosp_amt", "post_hosp_amt"]},
    "pat_age_years": {"kind": "age_years", "dob": DOB, "on": ADM},
    "pat_age_months": {"kind": "age_months", "dob": DOB, "on": ADM},
    "pre_hosp_days": {"kind": "days_between", "start": DETECTED, "end": ADM},
    # Part B repeats Part A: copy so the hospital only checks it
    **{b: {"kind": "copy", "source": a} for b, a in [
        ("b_pat_surname", "pat_surname"), ("b_pat_first", "pat_first"), ("b_gender", "pat_gender"),
        ("b_age_years", "pat_age_years"), ("b_age_months", "pat_age_months"), ("b_dob_dd", "pat_dob_dd"),
        ("b_dob_mm", "pat_dob_mm"), ("b_adm_dd", "adm_dd"), ("b_adm_mm", "adm_mm"), ("b_adm_yy", "adm_yy"),
        ("b_adm_hh", "adm_hh"), ("b_adm_min", "adm_min"), ("b_dis_dd", "dis_dd"), ("b_dis_mm", "dis_mm"),
        ("b_dis_yy", "dis_yy"), ("b_dis_hh", "dis_hh"), ("b_dis_min", "dis_min"), ("b_total_amt", "total_amt"),
        ("h_name", "hospital_name")]},
}
for f in fields:
    if f["id"] in COMPUTE:
        f["compute"] = COMPUTE[f["id"]]
BILL_AMOUNTS = [f"bill{n}_amount" for n in range(1, 11)]
RULES = [
    {"kind": "equals_sum", "severity": "error", "target": "total_amt", "of": ["pre_hosp_amt", "hosp_amt", "post_hosp_amt"],
     "message": "Total must equal pre-hospitalization + hospitalization + post-hospitalization"},
    {"kind": "equals_sum", "target": "total_amt", "of": BILL_AMOUNTS,
     "message": "Bills enclosed (Section F) should add up to the total claimed"},
    {"kind": "date_order", "severity": "error", "first": ADM, "second": DIS,
     "message": "Discharge date must be on or after the admission date"},
    {"kind": "date_order", "first": DETECTED, "second": ADM, "message": "Illness is detected after admission"},
    {"kind": "date_order", "first": DOB, "second": ADM, "message": "Date of birth is after the admission date"},
    {"kind": "date_within", "dates": [{"field": f"bill{n}_date", "format": "DDMMYY"} for n in range(1, 11)],
     "start": ADM, "end": DIS, "days_before": 30, "days_after": 60,
     "message": "Bill date is outside the stay and the usual 30-day pre / 60-day post period"},
    {"kind": "same_text", "of": ["pat_surname", "b_pat_surname"], "message": "Patient surname differs between Part A and Part B"},
    {"kind": "same_text", "of": ["pat_first", "b_pat_first"], "message": "Patient first name differs between Part A and Part B"},
    {"kind": "required", "of": ["tpa_id", "ins_surname", "pat_first", "hospital_name", "adm_dd", "dis_dd", "hosp_amt",
                                "account_no", "ifsc"], "message": "Still empty"},
]
TABLES = [{"id": "bills", "label": "Bills enclosed", "date_format": "DDMMYY", "rows": [
    {"no": f"bill{n}_no", "date": f"bill{n}_date", "issuer": f"bill{n}_issued_by", "towards": f"bill{n}_towards",
     "amount": f"bill{n}_amount", **({"kind": {1: "hospital", 2: "pre", 3: "post", 4: "pharmacy"}[n]} if n <= 4 else {})}
    for n in range(1, 11)]}]

seed = {"name": "Medi Assist Reimbursement Claim Form", "fingerprint": fingerprint(pdf_path), "fields": fields,
        "rules": RULES, "tables": TABLES, "patient_name": ["pat_first", "pat_surname"]}
json.dump(seed, open("seed/medi_assist_reimbursement.json", "w"), indent=1)
print(len(fields), "fields", seed["fingerprint"])
