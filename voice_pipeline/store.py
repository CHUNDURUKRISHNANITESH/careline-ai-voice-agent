from datetime import date,timedelta
import re
DOCTORS=[('Dr. Meera Rao','Cardiology'),('Dr. Arjun Patel','General Medicine'),('Dr. Priya Shah','Dermatology')]
SLOTS=[]
BOOKINGS=[]
for offset in range(7):
    for name,specialty in DOCTORS:
        for time in ('09:00','10:30','14:00','16:00'):
            SLOTS.append(dict(slot_id=len(SLOTS)+1,name=name,specialty=specialty,day=str(date.today()+timedelta(days=offset)),time=time))
def availability(doctor='',day=''):
    busy={a['slot_id'] for a in BOOKINGS if a['status']=='booked'}
    return [dict(s) for s in SLOTS if s['slot_id'] not in busy and s['day']>=str(date.today()) and (not day or s['day']==day) and (doctor.lower() in s['name'].lower() or doctor.lower() in s['specialty'].lower())]
def phone_number(phone):
    p=re.sub(r'\D','',phone)
    if len(p)==12 and p.startswith('91'): p=p[2:]
    if len(p)!=10: raise ValueError('Please confirm a 10 digit phone number')
    return p
def book(slot_id,phone):
    phone=phone_number(phone)
    slot=next((s for s in availability() if s['slot_id']==slot_id),None)
    if not slot: return {'error':'Slot unavailable; check availability again'}
    a=dict(slot,id=len(BOOKINGS)+1,phone=phone,status='booked'); BOOKINGS.append(a)
    return dict(appointment_id=a['id'],status='booked',day=a['day'],time=a['time'])
def appointments(phone=None):
    return [dict(a) for a in reversed(BOOKINGS) if phone is None or a['phone']==phone]
def cancel(phone,appointment_id=0):
    phone=phone_number(phone)
    rows=[a for a in BOOKINGS if a['phone']==phone and a['status']=='booked' and (not appointment_id or a['id']==appointment_id)]
    if len(rows)!=1: return {'error':'Multiple bookings; ask which appointment' if rows else 'No matching booking','appointments':appointments(phone)}
    rows[0]['status']='cancelled'; return {'status':'cancelled','appointment_id':rows[0]['id']}
def dashboard():
    rows=appointments()
    for a in rows: a['phone']='••••••'+a['phone'][-4:]
    return {'type':'dashboard','slots':availability(),'appointments':rows}
