"""Template schema. All coordinates are PDF points measured from the TOP-LEFT of the page.

Validation happens here so an invalid layout is rejected when it is saved, uploaded or loaded,
never discovered later as a crash or a silently missing value while filling.
"""
import math
import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

Rect = list[float]  # [x0, top, x1, bottom]
EDGE_TOLERANCE = 2.0  # points a rectangle may overhang the page edge (rounding, bleed)
ID_RE = re.compile(r"^[a-z0-9_]{1,64}$")


def check_rect(r: Rect, what: str) -> Rect:
    if len(r) != 4:
        raise ValueError(f"{what}: rectangle needs 4 numbers [x0, top, x1, bottom], got {len(r)}")
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in r):
        raise ValueError(f"{what}: rectangle values must be finite numbers")
    x0, top, x1, bottom = r
    if x1 - x0 < 1 or bottom - top < 1:
        raise ValueError(f"{what}: rectangle must be at least 1pt wide and tall (x1 > x0, bottom > top)")
    return r


class DateRef(BaseModel):
    """A date on the form: three separate fields (d/m/y) or one field in a fixed format."""
    d: Optional[str] = None
    m: Optional[str] = None
    y: Optional[str] = None
    field: Optional[str] = None
    format: Literal["DDMMYY", "DDMMYYYY"] = "DDMMYY"

    @model_validator(mode="after")
    def _shape(self):
        if not self.field and not (self.d and self.m and self.y):
            raise ValueError("a date needs either `field` or all of `d`, `m`, `y`")
        return self

    def ids(self) -> list[str]:
        return [self.field] if self.field else [self.d, self.m, self.y]


class Compute(BaseModel):
    """Value calculated from other fields; used only when the person leaves the field empty."""
    kind: Literal["sum", "copy", "age_years", "age_months", "days_between"]
    of: list[str] = Field(default_factory=list)       # sum
    source: Optional[str] = None                      # copy
    dob: Optional[DateRef] = None                     # age_*
    on: Optional[DateRef] = None                      # age_* (date the age is taken on)
    start: Optional[DateRef] = None                   # days_between
    end: Optional[DateRef] = None
    inclusive: bool = False

    @model_validator(mode="after")
    def _args(self):
        need = {"sum": self.of, "copy": self.source, "age_years": self.dob and self.on,
                "age_months": self.dob and self.on, "days_between": self.start and self.end}[self.kind]
        if not need:
            raise ValueError(f"compute '{self.kind}' is missing its inputs")
        return self

    def refs(self) -> list[str]:
        out = list(self.of) + ([self.source] if self.source else [])
        for d in (self.dob, self.on, self.start, self.end):
            if d:
                out += d.ids()
        return out


class Rule(BaseModel):
    """A cross-field check shown before download. Errors block filling; warnings only inform."""
    kind: Literal["equals_sum", "date_order", "date_within", "same_text", "required"]
    message: str = Field(min_length=1, max_length=300)
    severity: Literal["error", "warning"] = "warning"
    target: Optional[str] = None                      # equals_sum
    of: list[str] = Field(default_factory=list)       # equals_sum sources / same_text / required fields
    first: Optional[DateRef] = None                   # date_order
    second: Optional[DateRef] = None
    allow_equal: bool = True
    dates: list[DateRef] = Field(default_factory=list)  # date_within
    start: Optional[DateRef] = None
    end: Optional[DateRef] = None
    days_before: int = Field(default=0, ge=0, le=365)  # date_within: allowed pre-period
    days_after: int = Field(default=0, ge=0, le=365)

    @model_validator(mode="after")
    def _args(self):
        ok = {"equals_sum": self.target and self.of, "date_order": self.first and self.second,
              "date_within": self.dates and self.start and self.end, "same_text": len(self.of) >= 2,
              "required": self.of}[self.kind]
        if not ok:
            raise ValueError(f"rule '{self.kind}' is missing its inputs")
        return self

    def refs(self) -> list[str]:
        out = list(self.of) + ([self.target] if self.target else [])
        for d in [self.first, self.second, self.start, self.end, *self.dates]:
            if d:
                out += d.ids()
        return out


class TableRow(BaseModel):
    no: Optional[str] = None
    date: Optional[str] = None
    issuer: Optional[str] = None
    towards: Optional[str] = None
    amount: Optional[str] = None
    kind: Optional[Literal["hospital", "pharmacy", "pre", "post"]] = None   # row printed for a specific bill type

    def ids(self) -> list[str]:
        return [v for v in (self.no, self.date, self.issuer, self.towards, self.amount) if v]


class TableSpec(BaseModel):
    """A repeating table (e.g. bills enclosed) that scanned bills can be added into."""
    id: str
    label: str = "Bills"
    date_format: Literal["DDMMYY", "DDMMYYYY"] = "DDMMYY"
    rows: list[TableRow] = Field(min_length=1)


class Option(BaseModel):
    value: str = Field(min_length=1, max_length=64)
    rect: Rect

    @field_validator("rect")
    @classmethod
    def _rect(cls, r):
        return check_rect(r, "option")


class FieldSpec(BaseModel):
    id: str
    label: str = ""
    group: str = "General"
    page: int = Field(ge=0)                              # 0-based page index
    type: Literal["boxes", "text", "checkbox", "choice", "acro"]
    boxes: list[Rect] = Field(default_factory=list)      # type=boxes
    rect: Optional[Rect] = None                          # type=text / checkbox (and acro, for preview)
    options: list[Option] = Field(default_factory=list)  # type=choice
    multi: bool = False                                  # choice: allow several ticks
    acro_name: Optional[str] = None                      # type=acro, or a native PDF checkbox
    align: Literal["left", "right"] = "left"
    upper: bool = True
    size: Optional[float] = Field(default=None, ge=3, le=30)
    clear: bool = False
    hint: str = ""
    compute: Optional[Compute] = None

    @field_validator("id")
    @classmethod
    def _id(cls, v):
        if not ID_RE.match(v):
            raise ValueError(f"field id '{v}' must be 1-64 characters: lowercase letters, digits, underscore")
        return v

    @model_validator(mode="after")
    def _type_requirements(self):
        name = f"field '{self.id}'"
        if self.type == "boxes":
            if not self.boxes:
                raise ValueError(f"{name}: a box field needs at least one box")
            for i, b in enumerate(self.boxes):
                check_rect(b, f"{name} box {i + 1}")
        elif self.type in ("text", "checkbox"):
            if self.rect is None:
                raise ValueError(f"{name}: a {self.type} field needs a rect")
            check_rect(self.rect, name)
        elif self.type == "choice":
            if len(self.options) < 1:
                raise ValueError(f"{name}: a choice field needs at least one option")
            values = [o.value.upper() for o in self.options]
            if len(values) != len(set(values)):
                raise ValueError(f"{name}: option values must be unique")
        elif self.type == "acro":
            if not self.acro_name:
                raise ValueError(f"{name}: a fillable-PDF field needs acro_name")
            if self.rect is not None:
                check_rect(self.rect, name)
        return self

    def rects(self) -> list[Rect]:
        if self.type == "boxes":
            return self.boxes
        if self.type == "choice":
            return [o.rect for o in self.options]
        return [self.rect] if self.rect else []


class PageInfo(BaseModel):
    width: float = Field(gt=0)
    height: float = Field(gt=0)


class Template(BaseModel):
    form_id: str
    name: str = Field(min_length=1, max_length=200)
    fingerprint: str
    pages: list[PageInfo] = Field(min_length=1)
    fields: list[FieldSpec] = Field(default_factory=list)
    rules: list[Rule] = Field(default_factory=list)
    tables: list[TableSpec] = Field(default_factory=list)
    patient_name: list[str] = Field(default_factory=list)   # fields holding the patient's name (document check)
    version: int = 1

    @model_validator(mode="after")
    def _references_exist(self):
        ids = {f.id for f in self.fields}
        refs = [("patient_name", r) for r in self.patient_name]
        refs += [(f"compute of '{f.id}'", r) for f in self.fields if f.compute for r in f.compute.refs()]
        refs += [(f"rule '{ru.message[:40]}'", r) for ru in self.rules for r in ru.refs()]
        refs += [(f"table '{t.id}'", r) for t in self.tables for row in t.rows for r in row.ids()]
        missing = sorted({f"{where}: '{r}'" for where, r in refs if r not in ids})
        if missing:
            raise ValueError("references to fields that don't exist: " + "; ".join(missing[:5]))
        for f in self.fields:
            if f.compute and f.id in f.compute.refs():
                raise ValueError(f"field '{f.id}' cannot be computed from itself")
        return self

    @model_validator(mode="after")
    def _fields_fit_the_form(self):
        seen = set()
        for f in self.fields:
            if f.id in seen:
                raise ValueError(f"duplicate field id '{f.id}'")
            seen.add(f.id)
            if f.page >= len(self.pages):
                raise ValueError(f"field '{f.id}' is on page {f.page + 1}, but the form has {len(self.pages)} page(s)")
            pg, t = self.pages[f.page], EDGE_TOLERANCE
            for r in f.rects():
                if r[0] < -t or r[1] < -t or r[2] > pg.width + t or r[3] > pg.height + t:
                    raise ValueError(f"field '{f.id}' extends outside page {f.page + 1} "
                                     f"({pg.width:.0f} x {pg.height:.0f} pt)")
        return self


class FillRequest(BaseModel):
    values: dict[str, object]
