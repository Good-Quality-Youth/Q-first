"""Retrospective v8 development evaluation, NOT a held-out generalization test.

Labels are evaluation-only. Count warning openings over the entire scored timeline,
including transient tails; never give the detector credit for external alarms.
"""
import argparse
import csv
import json
import statistics
import sys
from datetime import datetime, timedelta
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from qfirst_agent.data import Data, source_time, iso
from qfirst_agent.detector import Detector, PROFILE, THRESHOLD
from qfirst_agent.detector_v1 import Detector as LegacyDetector, PROFILE as LEGACY_PROFILE


def warning_openings(rows):
    active, clear, previous = False, 0, None
    openings = []
    for r in rows:
        if previous is not None and r['at'] - previous != timedelta(minutes=1):
            active, clear = False, 0
        previous = r['at']
        if r['confirmed'] and not active:
            openings.append(r); active, clear = True, 0
        if active:
            clear = clear + 1 if r['score'] < THRESHOLD else 0
            if clear >= 15: active, clear = False, 0
    return openings


def evaluate(detector, windows, profile):
    opened = {eq: warning_openings(rows) for eq, rows in detector.scored.items()}
    details = []
    for w in windows:
        end = w['end'] + (timedelta(minutes=10) if not w['label'] else timedelta())
        hits = [r for r in opened[w['equipment_id']] if w['start'] <= r['at'] < end]
        first = hits[0]['at'] if hits else None
        details.append(dict(equipmentId=w['equipment_id'], scenario=w['scenario_type'], label=w['label'],
                            demo=w['demo'], startAt=iso(w['start']), endAt=iso(w['end']),
                            firstWarningAt=iso(first) if first else None,
                            alarmAt=iso(w['alarm']) if w['alarm'] else None,
                            leadMinutes=(w['alarm']-first).total_seconds()/60 if first and w['alarm'] else None,
                            warningOpenings=len(hits)))
    events = []
    for eq, rows in opened.items():
        for row in rows:
            fault = next((w for w in windows if w['equipment_id']==eq and w['label'] and w['start']<=row['at']<w['end']), None)
            normal = next((w for w in windows if w['equipment_id']==eq and not w['label'] and w['start']<=row['at']<w['end']+timedelta(minutes=10)), None)
            events.append(dict(equipmentId=eq, at=iso(row['at']),
                               classification='fault' if fault else 'normal_transient' if normal else 'other_outside_fault',
                               scenario=(fault or normal or {}).get('scenario_type')))
    faults = [d for d in details if d['label']]
    evaluation_faults = [d for d in faults if not d['demo']]
    alarm_faults = [d for d in evaluation_faults if d['alarmAt']]
    leads = [d['leadMinutes'] for d in alarm_faults if d['leadMinutes'] is not None]
    summary = dict(profile=profile, normalTransientWindows=sum(not d['label'] for d in details),
                   normalTransientWindowsWithWarning=sum(bool(d['firstWarningAt']) for d in details if not d['label']),
                   totalWarningEvents=len(events), eventsOutsideFaultWindows=sum(e['classification']!='fault' for e in events),
                   scoredSamples=sum(len(r) for r in detector.scored.values()),
                   faultWindows=len(faults), faultWindowsDetected=sum(bool(d['firstWarningAt']) for d in faults),
                   nonDemoFaultWindows=len(evaluation_faults), nonDemoFaultWindowsDetected=sum(bool(d['firstWarningAt']) for d in evaluation_faults),
                   nonDemoAlarmWindows=len(alarm_faults), nonDemoBeforeAlarm=sum(x>0 for x in leads),
                   nonDemoLeadMedianMinutes=statistics.median(leads) if leads else None,
                   nonDemoWithoutAlarmDetected=sum(bool(d['firstWarningAt']) for d in evaluation_faults if not d['alarmAt']))
    return dict(summary=summary, windows=details, events=events)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--dataset',type=Path,default=Path(__file__).resolve().parents[3]/'qfirst-local/data/qfirst_dataset_v8')
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'var/detector-comparison.json')
    args=parser.parse_args()
    data=Data(args.dataset);windows=data.read('windows.csv')
    for w in windows:
        w['start']=source_time(w['start_at']);w['end']=w['start']+timedelta(minutes=int(w['minutes']))
        w['alarm']=source_time(w['first_alarm_at']);w['label']=int(w['label']);w['demo']=bool(int(w['demo']))
    old=evaluate(LegacyDetector(data),windows,LEGACY_PROFILE)
    new=evaluate(Detector(data),windows,PROFILE)
    comparison=[]
    for a,b in zip(old['windows'],new['windows']):
        delay=(datetime.fromisoformat(b['firstWarningAt'])-datetime.fromisoformat(a['firstWarningAt'])).total_seconds()/60 if a['firstWarningAt'] and b['firstWarningAt'] else None
        comparison.append(dict(equipmentId=a['equipmentId'],scenario=a['scenario'],label=a['label'],demo=a['demo'],
                               startAt=a['startAt'],before=a['firstWarningAt'],after=b['firstWarningAt'],
                               leadBefore=a['leadMinutes'],leadAfter=b['leadMinutes'],delayMinutes=delay))
    report=dict(before=old,after=new,comparison=comparison,limitations=[
        'Synthetic v8 was examined during tuning; this is a development comparison, not held-out or field accuracy.',
        'Four demo windows were engineered for a previous model; non-demo results are reported separately.',
        'Five narrow negative patterns do not cover longer benign changes. Short genuine faults can also be suppressed.',
        'Existing alarms bypass the warning gate. They are excluded from detector-only metrics.',
        'First 240 samples per equipment calibrate the baseline and are excluded from evaluation.',
        '0-100 score is not a probability. Only causal sensors enter detection. Labels enter this offline evaluator only.',
        'All unmatched warning openings are counted; the 10-minute negative tail only identifies their likely source.'
    ])
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    with args.output.with_suffix('.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(comparison[0]));writer.writeheader();writer.writerows(comparison)
    print(json.dumps({'before':old['summary'],'after':new['summary']},ensure_ascii=False,indent=2))
    print('Report:',args.output)


if __name__=='__main__':main()
