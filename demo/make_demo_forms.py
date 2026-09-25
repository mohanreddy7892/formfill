"""Create 5 dummy blank forms of different formats."""
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.colors import black, HexColor
W,H=A4
GREY=HexColor('#888888')
def header(c,title,sub):
    c.setFillColor(HexColor('#1f2733')); c.rect(0,H-70,W,70,fill=1,stroke=0)
    c.setFillColorRGB(1,1,1); c.setFont('Helvetica-Bold',17); c.drawString(40,H-40,title)
    c.setFont('Helvetica',9.5); c.drawString(40,H-56,sub)
    c.setFillColor(black)
def boxes(c,x,y,n,w=13,h=15,gap=1.5):
    for i in range(n): c.rect(x+i*(w+gap),y,w,h)
    return x+n*(w+gap)
def cb(c,x,y,label,s=10):
    c.rect(x,y,s,s); c.setFont('Helvetica',9.5); c.drawString(x+s+4,y+1.5,label); return x+s+10+c.stringWidth(label,'Helvetica',9.5)+14

# 1 BOX STYLE ---------------------------------------------------------------
c=canvas.Canvas('1_box_style_kyc.pdf',pagesize=A4)
header(c,'Employee KYC Update Form','ACME Technologies Pvt Ltd  |  Fill in BLOCK LETTERS, one letter per box')
c.setLineWidth(0.7); y=H-120
def lab(t,y): c.setFont('Helvetica',10); c.drawString(40,y+4,t)
lab('Employee ID',y); boxes(c,160,y,8); y-=34
lab('Surname',y); boxes(c,160,y,20); y-=34
lab('First name',y); boxes(c,160,y,20); y-=34
lab('Date of birth',y); x=boxes(c,160,y,2); c.drawString(x+2,y+4,'/'); x=boxes(c,x+10,y,2); c.drawString(x+2,y+4,'/'); boxes(c,x+10,y,4)
c.setFont('Helvetica',7); c.setFillColor(GREY); c.drawString(160,y-10,'DD            MM             YYYY'); c.setFillColor(black); y-=40
lab('Gender',y); x=cb(c,160,y+2,'Male'); x=cb(c,x,y+2,'Female'); cb(c,x,y+2,'Other'); y-=34
lab('Marital status',y); x=cb(c,160,y+2,'Single'); x=cb(c,x,y+2,'Married'); cb(c,x,y+2,'Other'); y-=34
lab('PAN',y); boxes(c,160,y,10); y-=34
lab('Mobile',y); boxes(c,160,y,10); y-=34
lab('PIN code',y); boxes(c,160,y,6); y-=50
c.setFont('Helvetica',9); c.drawString(40,y,'I confirm the above details are correct.'); c.line(380,y-30,540,y-30); c.drawString(380,y-42,'Signature')
c.save()

# 2 FILLABLE (AcroForm) --------------------------------------------------------
c=canvas.Canvas('2_fillable_leave_application.pdf',pagesize=A4)
header(c,'Leave Application','ACME Technologies Pvt Ltd  |  Fillable PDF: click a field to type')
f=c.acroForm; y=H-125
def tf(name,label,y,w=300):
    c.setFont('Helvetica',10); c.drawString(40,y+6,label)
    f.textfield(name=name,x=170,y=y,width=w,height=20,borderColor=HexColor('#8899bb'),fillColor=HexColor('#eef2fb'),textColor=black,fontSize=10,borderWidth=0.8)
tf('emp_name','Employee name',y); y-=38
tf('emp_id','Employee ID',y,150); y-=38
tf('manager','Reporting manager',y); y-=38
c.drawString(40,y+6,'Leave type')
for i,(n,l) in enumerate((('casual','Casual'),('sick','Sick'),('earned','Earned'))):
    f.checkbox(name=f'type_{n}',x=170+i*100,y=y+2,size=14,borderColor=HexColor('#8899bb'),fillColor=HexColor('#eef2fb'),buttonStyle='check')
    c.drawString(190+i*100,y+5,l)
y-=38
tf('from_date','From date',y,120); c.drawString(310,y+6,'To date'); f.textfield(name='to_date',x=360,y=y,width=110,height=20,borderColor=HexColor('#8899bb'),fillColor=HexColor('#eef2fb'),fontSize=10,borderWidth=0.8); y-=38
tf('days','Number of days',y,60); y-=38
tf('reason','Reason',y,340); y-=38
tf('contact','Contact during leave',y,200)
c.save()

# 3 LINES / UNDERLINES ---------------------------------------------------------
c=canvas.Canvas('3_line_style_travel_claim.pdf',pagesize=A4)
header(c,'Travel Expense Claim','ACME Technologies Pvt Ltd  |  Write on the lines')
y=H-120; c.setFont('Helvetica',10.5); c.setLineWidth(0.6)
LINES=[('Name of employee',175,540),('Department',175,360),('Purpose of travel',175,540),('From (city)',175,330),('To (city)',390,540),
       ('Travel date',175,330),('Return date',420,540),('Mode of travel',175,540),('Total amount (Rs)',175,330)]
for lbl,x0,x1 in LINES:
    if lbl in ('To (city)','Return date'):
        c.drawString(x0-60 if lbl=='To (city)' else x0-85,y+38+4,lbl); c.line(x0,y+38,x1,y+38); continue
    c.drawString(40,y+4,lbl); c.line(x0,y,x1,y); y-=38
c.drawString(40,y-10,'Approved by: ____________________        Date: ______________')
c.save()

# 4 TABLE -------------------------------------------------------------------
c=canvas.Canvas('4_table_expense_statement.pdf',pagesize=A4)
header(c,'Monthly Expense Statement','ACME Technologies Pvt Ltd  |  One expense per row')
c.setFont('Helvetica',10); c.drawString(40,H-105,'Employee: ____________________________      Month: _______________')
cols=[40,70,160,390,470,555]; heads=['#','Date','Description','Category','Amount (Rs)']
top=H-130; rh=24; rows=10
c.setFillColor(HexColor('#e6eaf2')); c.rect(cols[0],top-rh,cols[-1]-cols[0],rh,fill=1,stroke=0); c.setFillColor(black)
c.setFont('Helvetica-Bold',9.5)
for i,hd in enumerate(heads): c.drawString(cols[i]+5,top-16,hd)
c.setFont('Helvetica',9.5); c.setLineWidth(0.6)
for r in range(rows+2): c.line(cols[0],top-r*rh,cols[-1],top-r*rh)
for x in cols: c.line(x,top,x,top-(rows+1)*rh)
for r in range(rows): c.drawString(cols[0]+8,top-(r+2)*rh+8,str(r+1))
c.setFont('Helvetica-Bold',10); c.drawString(cols[3]+5,top-(rows+1)*rh-18,'Total'); c.rect(cols[4],top-(rows+1)*rh-24,cols[5]-cols[4],24)
c.save()
print('forms ok')
