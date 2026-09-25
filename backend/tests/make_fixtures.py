"""Generate fictional bill images/PDFs in common Indian hospital-bill layouts (for OCR tests)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib.pagesizes import A5, landscape
from reportlab.pdfgen import canvas

OUT = Path(__file__).parent / "fixtures"
F = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"; FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
font = lambda s, b=False: ImageFont.truetype(FB if b else F, s)


def pharmacy(path, photo=False):
    im = Image.new("RGB", (1500, 1000), "white"); d = ImageDraw.Draw(im)
    d.rectangle([40, 40, 1460, 960], outline="black", width=3)
    d.text((700, 60), "TAX INVOICE", font=font(24), fill="black")
    d.text((600, 100), "CARE MEDICALS", font=font(40, True), fill="black")
    d.text((180, 160), "MAIN ROAD, NEAR BUS STAND, HYDERABAD - 500081", font=font(24), fill="black")
    d.text((60, 205), "D.L. No: 20:TS/01/2019-123456      GSTIN: 36ABCDE1234F1Z5", font=font(22), fill="black")
    d.text((60, 250), "To :  S.ANANYA", font=font(26, True), fill="black")
    d.text((800, 250), "BILL NO  :  PH 3342", font=font(26), fill="black")
    d.text((60, 295), "Dr Name  DR.K.RAO MD(PAED)", font=font(24), fill="black")
    d.text((800, 295), "BILL DATE :  14-Aug-26", font=font(26), fill="black")
    d.line([40, 340, 1460, 340], fill="black", width=2)
    d.text((60, 350), "Description            Batch      Exp    Qty    Rate     Amount", font=font(24, True), fill="black")
    rows = [("PARACETAMOL SYRUP", "PL2291", "May/27", "1", "45.00", "45.00"), ("ORS SACHET", "OR1102", "Apr/27", "6", "22.50", "135.00"),
            ("ZINC SYRUP", "ZN5541", "Aug/27", "1", "95.00", "95.00"), ("PROBIOTIC SACHET", "PB7781", "Jan/27", "10", "112.50", "1125.00")]
    y = 400
    for r in rows:
        d.text((60, y), f"{r[0]:<20} {r[1]:<9} {r[2]:<7} {r[3]:>3}  {r[4]:>7}  {r[5]:>9}", font=font(24), fill="black"); y += 44
    d.text((60, 860), "in words: Rupees One Thousand Four Hundred Only", font=font(22), fill="black")
    d.text((980, 900), "Net Amount :   1,400.00", font=font(28, True), fill="black")
    if photo:
        im = im.rotate(2.2, expand=True, fillcolor=(235, 232, 225)).filter(ImageFilter.GaussianBlur(1.1))
        shade = Image.linear_gradient("L").resize(im.size).point(lambda p: 255 - p // 6)
        im = Image.composite(im, Image.new("RGB", im.size, (200, 196, 188)), shade)
    im.save(path, quality=85)


def lab_bill_pdf(path):
    c = canvas.Canvas(str(path), pagesize=landscape(A5)); W, H = landscape(A5)
    c.setFont("Helvetica-Bold", 16); c.drawCentredString(W / 2, H - 40, "CITY CARE CHILDRENS HOSPITAL")
    c.setFont("Helvetica", 10); c.drawCentredString(W / 2, H - 56, "PLOT 45, HITECH CITY MAIN ROAD, HYDERABAD")
    c.setFont("Helvetica-Bold", 11); c.drawCentredString(W / 2, H - 76, "INVESTIGATION BILL")
    c.setFont("Helvetica", 10)
    c.drawString(40, H - 100, "Bill No. : LB-0456"); c.drawString(400, H - 100, "Date : 12-08-2026")
    c.drawString(40, H - 116, "Name : S.ANANYA"); c.drawString(400, H - 116, "Age : 5 Y")
    y = H - 150
    for t, a in (("CBP", "250.00"), ("CRP", "300.00"), ("DENGUE NS1", "850.00"), ("ELECTROLYTES", "400.00")):
        c.drawString(60, y, t); c.drawRightString(W - 60, y, a); y -= 16
    c.setFont("Helvetica-Bold", 11); c.drawString(300, y - 10, "BILL AMOUNT :"); c.drawRightString(W - 60, y - 10, "1,800.00")
    c.save()


def lab_report(path):
    im = Image.new("RGB", (1200, 900), "white"); d = ImageDraw.Draw(im)
    d.text((300, 40), "CITY CARE CHILDRENS HOSPITAL", font=font(36, True), fill="black")
    d.text((420, 100), "Department of Laboratory", font=font(26), fill="black")
    d.text((60, 160), "Patient Name : S.ANANAYA", font=font(26), fill="black")   # misspelt on purpose
    d.text((60, 200), "TEST              RESULT     UNIT      NORMAL RANGE", font=font(24, True), fill="black")
    d.text((60, 250), "Platelet Count    0.85       Lakhs     1.5-4.0", font=font(24), fill="black")
    im.save(path)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    pharmacy(OUT / "pharmacy_scan.png")
    pharmacy(OUT / "pharmacy_photo.jpg", photo=True)
    lab_bill_pdf(OUT / "lab_bill.pdf")
    lab_report(OUT / "lab_report.png")
    print("fixtures written")
