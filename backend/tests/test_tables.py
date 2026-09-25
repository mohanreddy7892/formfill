"""Server bill placement: the same cases as frontend/src/util.test.mjs, so both stay in step."""
from app.models import TableSpec
from app.tables import assign_bills, iso_to_form

T = TableSpec(id="bills", rows=[{"no": f"b{n}_no", "date": f"b{n}_date", "issuer": f"b{n}_by", "towards": f"b{n}_to",
                                 "amount": f"b{n}_amt", **({"kind": "hospital"} if n == 1 else {"kind": "pre"} if n == 2 else {})}
                                for n in range(1, 6)])
MA_LIKE = TableSpec(id="bills", rows=[{**r.model_dump(), **({"kind": "pharmacy"} if i == 2 else {})} for i, r in enumerate(T.rows)])


def test_dates():
    assert (iso_to_form("2026-08-31"), iso_to_form("2026-08-31", "DDMMYYYY"), iso_to_form("bad")) == ("310826", "31082026", "")


def test_hospital_row_then_free_rows():
    u = assign_bills(T, {}, [{"bill_no": "ph 1", "date": "2026-08-31", "amount": 2644, "issuer": "Care Medicals", "kind": "pharmacy"},
                             {"bill_no": "47", "date": "2026-09-02", "amount": 5500, "issuer": "City Hospital", "kind": "hospital"},
                             {"bill_no": "LB-9", "amount": 850, "kind": "lab"}])
    up = u["updates"]
    assert (up["b1_no"], up["b1_amt"], "b1_to" in up) == ("47", "5500", False)
    assert (up["b3_no"], up["b3_to"], up["b3_date"], up["b4_to"]) == ("PH 1", "PHARMACY", "310826", "LAB INVESTIGATIONS")
    assert "b2_no" not in up and len(u["placed"]) == 3 and not u["skipped"]


def test_no_overwrite_duplicates_missing_amount():
    u = assign_bills(T, {"b3_no": "MANUAL", "b3_amt": "100"}, [{"bill_no": "MANUAL", "amount": 100, "kind": "pharmacy"},
                     {"bill_no": "X1", "amount": None, "kind": "lab"}, {"bill_no": "X2", "amount": 50, "kind": "pharmacy"}])
    assert "b3_no" not in u["updates"] and u["updates"]["b4_no"] == "X2"
    assert [s["reason"] for s in u["skipped"]] == ["already in the form", "no amount found"]


def test_printed_pharmacy_row():
    up = assign_bills(MA_LIKE, {}, [{"bill_no": "P1", "amount": 10, "kind": "pharmacy"}, {"bill_no": "P2", "amount": 20, "kind": "pharmacy"},
                                    {"bill_no": "L1", "amount": 30, "kind": "lab"}])["updates"]
    assert (up["b3_no"], "b3_to" in up, up["b4_no"], up["b4_to"], up["b5_to"]) == ("P1", False, "P2", "PHARMACY", "LAB INVESTIGATIONS")


def test_full_table():
    u = assign_bills(T, {}, [{"bill_no": f"P{i}", "amount": 10, "kind": "pharmacy"} for i in range(5)])
    assert len(u["placed"]) == 3 and sum(s["reason"] == "no free row left" for s in u["skipped"]) == 2
