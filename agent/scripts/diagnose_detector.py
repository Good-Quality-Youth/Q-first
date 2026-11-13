"""Offline false-warning diagnosis and ablations; does not change the serving detector.
Labels are used for retrospective evaluation only, never as decision inputs.
All ablations reuse v8: these are exploratory results, not held-out performance.
"""
import json, sys
from pathlib import Path
from datetime import timedelta
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from qfirst_agent.data import Data, SENSORS, source_time, KST, iso
from qfirst_agent.detector_v1 import Detector

ROOT=Path(__file__).resolve().parents[3]
d=Data(ROOT/'qfirst-local/data/qfirst_dataset_v8');det=Detector(d)
windows=d.read('windows.csv')
for w in windows:
    w['start']=source_time(w['start_at']); w['end']=w['start']+timedelta(minutes=int(w['minutes']))
    w['alarm']=source_time(w['first_alarm_at']);w['label']=int(w['label'])
def local(t): return t.astimezone(KST).isoformat() if t else None
report={'normalWindows':[], 'profiles':[], 'baselines':{}, 'events':[]}
for eq,(c,s,end) in det.baselines.items():
    report['baselines'][eq]={'end':local(end),'center':c.tolist(),'scale':s.tolist()}
for w in windows:
    if w['label']:continue
    eq=w['equipment_id']; c,s,_=det.baselines[eq]
    rows=[r for r in det.scored[eq] if w['start']-timedelta(minutes=2)<=r['at']<w['end']+timedelta(minutes=10)]
    trace=[]
    for r in rows:
        z=(np.array([r[k] for k in SENSORS])-c)/s
        trace.append({'at':local(r['at']), 'topSensor':SENSORS[r['top']], 'values':[r[k] for k in SENSORS],
                      'z':np.round(z,2).tolist(),'score':r['score'],'streak':r['streak'],'confirmed':r['confirmed']})
    item={'eq':eq,'scenario':w['scenario_type'],'start':local(w['start']),'endExclusive':local(w['end']),'trace':trace}
    report['normalWindows'].append(item)

# Ablations only; the application's detector is unchanged. All candidates use past/current sensors.
for name,n,raw_n in [('current',3,0),('score5',5,0),('score7',7,0),('raw3_score3',3,3),('raw7_score3',3,7)]:
    scored={};events=[]
    for eq,rows in det.scored.items():
        c,s,_=det.baselines[eq]; streak=0; per_sensor=np.zeros(5,dtype=int);active=False;clear=0;previous=None;out=[]
        for r in rows:
            if previous and r['at']-previous!=timedelta(minutes=1):
                streak=0;per_sensor[:]=0;active=False;clear=0
            previous=r['at']; z=np.abs((np.array([r[k] for k in SENSORS])-c)/s)
            per_sensor=np.where(z>=3,per_sensor+1,0)
            streak=streak+1 if r['score']>=40 else 0
            flag=streak>=n and (not raw_n or max(per_sensor)>=raw_n)
            out.append((r['at'],flag))
            if flag and not active:
                matches=[w for w in windows if w['equipment_id']==eq and w['start']<=r['at']<w['end']]
                nearby=[w for w in windows if w['equipment_id']==eq and w['end']<=r['at']<w['end']+timedelta(minutes=10)]
                events.append({'eq':eq,'at':local(r['at']), 'label':max((w['label'] for w in matches),default=None),
                               'scenario':','.join(w['scenario_type'] for w in matches),
                               'afterWindow':','.join(w['scenario_type'] for w in nearby)})
                active=True;clear=0
            if active:
                clear=clear+1 if r['score']<40 else 0
                if clear>=15:active=False;clear=0
        scored[eq]=out
    details=[]
    for w in windows:
        # Normal transient attribution includes the tail; positive detection only within the fault.
        end=w['end'] if w['label'] else w['end']+timedelta(minutes=10)
        first=next((t for t,f in scored[w['equipment_id']] if w['start']<=t<end and f),None)
        details.append({'eq':w['equipment_id'],'scenario':w['scenario_type'],'label':w['label'],'demo':w['demo'],
                        'start':local(w['start']),'first':local(first),
                        'lead':(w['alarm']-first).total_seconds()/60 if w['alarm'] and first else None})
    positives=[x for x in details if x['label']];negatives=[x for x in details if not x['label']]
    result={'name':name,'faultHits':sum(bool(x['first']) for x in positives),'normalIncludingTail':sum(bool(x['first']) for x in negatives),
            'positiveLead':sum(x['lead'] is not None and x['lead']>0 for x in positives),
            'demo003':next(x for x in positives if x['eq']=='EQP-003' and x['demo']=='1'),
            'eventsTotal':len(events),'eventsInsideFault':sum(e['label']==1 for e in events),
            'details':details,'events':events}
    report['profiles'].append(result)
path=ROOT/'Q-first/agent/var/detector-diagnosis.json';path.write_text(json.dumps(report,ensure_ascii=False,indent=2))
for item in report['normalWindows']:
    print('\n', item['eq'],item['scenario'],item['start'],'end',item['endExclusive'])
    for r in item['trace']:print(r['at'][11:16],r['topSensor'],r['z'],r['score'],r['streak'])
for p in report['profiles']:
    print('\nPROFILE',json.dumps({k:v for k,v in p.items() if k not in ('details','events')},ensure_ascii=False))
    if p['name']=='current':print('EVENTS OUTSIDE FAULT',json.dumps([e for e in p['events'] if e['label']!=1],ensure_ascii=False))
print(path)
