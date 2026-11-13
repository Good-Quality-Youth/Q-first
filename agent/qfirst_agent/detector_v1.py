"""Causal robust baseline detector. No anomaly_detection/inspection_guide labels."""
from collections import deque
from datetime import timedelta
from math import exp
import numpy as np
from .data import SENSORS, iso, utc

PROFILE = 'robust-mad-persistence-v1'
THRESHOLD = 40.0
CONSECUTIVE = 3
BASELINE_ROWS = 240


class Detector:
    def __init__(self, data):
        self.data = data
        self.scored = {}
        self.baselines = {}
        for eq, rows in data.rows.items():
            initial = np.asarray([[r[k] for k in SENSORS] for r in rows[:BASELINE_ROWS]])
            center = np.median(initial, axis=0)
            scale = np.maximum(1.4826 * np.median(np.abs(initial-center), axis=0), 1e-6)
            self.baselines[eq] = (center, scale, rows[BASELINE_ROWS-1]['at'])
            peaks, scores = deque(maxlen=7), []
            streak = 0
            previous = None
            for row in rows[BASELINE_ROWS:]:
                if previous is not None and row['at'] - previous != timedelta(minutes=1):
                    peaks.clear(); streak = 0
                previous = row['at']
                z = [(row[k]-float(center[i]))/float(scale[i]) for i,k in enumerate(SENSORS)]
                peaks.append(max(map(abs,z)))
                raw = sum(list(peaks)[-3:])/min(3,len(peaks)) + 3*sum(p>=3 for p in peaks)/len(peaks)
                score = round(100*(1-exp(-max(0,raw-2)/6)),2)
                streak = streak+1 if score>=THRESHOLD else 0
                top = max(range(len(z)), key=lambda i: abs(z[i]))
                scores.append({**row, 'score':score, 'risk':3 if score>=75 else 2 if score>=50 else 1 if score>=25 else 0,
                               'top':top, 'reference':float(center[top]), 'robustZ':round(z[top],3),
                               'streak':streak, 'confirmed':streak>=CONSECUTIVE})
            self.scored[eq] = scores

    def result(self, as_of, session_start):
        at, start = utc(as_of), utc(session_start)
        events, current = [], []
        for eq, all_rows in self.scored.items():
            rows = [r for r in all_rows if start <= r['at'] <= at]
            active, clear, alarm_at = None, 0, None
            for row in rows:
                alarm = row['error_code'] != 'NONE'  # separate external alarm input, NOT detector feature
                if active is None and (row['confirmed'] or alarm):
                    active = {'id':f"EV-{eq}-{row['at'].strftime('%Y%m%dT%H%M%SZ')}", 'equipmentId':eq,
                              'detectedAt':iso(row['at']), 'firstWarningAt':iso(row['at']) if row['confirmed'] and not alarm else None,
                              'evidenceRecordIds':[r['equip_status_id'] for r in rows if row['at']-timedelta(minutes=2)<=r['at']<=row['at']],
                              'topSensor':SENSORS[row['top']], 'detectionScore':row['score']}
                    clear = 0
                if active:
                    if alarm and alarm_at is None:
                        alarm_at = iso(row['at'])
                    clear = clear+1 if not alarm and row['score']<THRESHOLD else 0
                    if clear>=15:
                        active, alarm_at = None, None
            if rows:
                row = rows[-1]
                current.append({'equipmentId':eq,'recordId':row['equip_status_id'],'score':row['score'],
                                'risk':row['risk'],'topSensor':SENSORS[row['top']],'streak':row['streak']})
                if active:
                    events.append({**active,'alarmAt':alarm_at if row['error_code']!='NONE' else None,
                                   'score':row['score'],'risk':row['risk']})
        return {'asOf':iso(at),'profileVersion':PROFILE,'threshold':THRESHOLD,'consecutive':CONSECUTIVE,
                'events':events,'assessments':current}
