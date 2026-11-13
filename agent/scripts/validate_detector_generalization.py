"""Frozen-detector synthetic challenge, independent of v8 files and labels.

This is a stress test, not evidence of field accuracy or an untouched real test set.
The manifest is written BEFORE scoring; neither detector is fitted/tuned here.
"""
import argparse
import csv
import hashlib
import json
import statistics
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from qfirst_agent.data import SENSORS
from qfirst_agent.detector import Detector
from qfirst_agent.detector_v1 import Detector as LegacyDetector
from compare_detectors import warning_openings

BASELINE = 240
PRE = 60
TAIL = 60
ONSET = BASELINE + PRE
BACKGROUNDS = ('iid', 'ar07', 'heavy_tail_t3')


def specs():
    normal = [dict(name='steady', kind='steady', label=0, duration=60, amplitude=0)]
    for duration in (1, 3, 6, 9, 15):
        for amplitude in (5, 8):
            normal.append(dict(name=f'normal_pulse_{duration}m_{amplitude}sd',
                               kind='pulse', label=0, duration=duration, amplitude=amplitude))
    normal += [
        dict(name='approved_ramp_60m', kind='benign_ramp', label=0, duration=60, amplitude=5),
        dict(name='approved_step_60m', kind='step', label=0, duration=60, amplitude=5),
        dict(name='normal_variance_x2', kind='variance', label=0, duration=60, amplitude=2),
        dict(name='normal_rotating_sensors', kind='rotating', label=0, duration=30, amplitude=6),
    ]
    faults = []
    for amplitude in (3.5, 5, 8):
        faults.append(dict(name=f'fault_step_{amplitude}sd', kind='step', label=1,
                           duration=60, amplitude=amplitude))
    for slope in (.08, .2, .5):
        faults.append(dict(name=f'fault_ramp_{slope}sd_per_min', kind='ramp', label=1,
                           duration=180, amplitude=12, slope=slope))
    for duration in (3, 6, 9):
        faults.append(dict(name=f'fault_short_{duration}m', kind='pulse', label=1,
                           duration=duration, amplitude=8))
    for on, off in ((3, 3), (7, 3)):
        faults.append(dict(name=f'fault_intermittent_{on}on_{off}off', kind='intermittent',
                           label=1, duration=90, amplitude=6, on=on, off=off))
    faults += [
        dict(name='fault_oscillating', kind='oscillation', label=1, duration=90, amplitude=6),
        dict(name='fault_multi_sensor_3sd', kind='multi', label=1, duration=90, amplitude=3),
    ]
    return normal + faults


def make_data(spec, background, seed):
    """Physical-looking values, randomized target/sign; no label enters input rows."""
    rng = np.random.default_rng(seed)
    n = ONSET + spec['duration'] + TAIL
    if background == 'heavy_tail_t3':
        noise = rng.standard_t(3, (n, 5)) / np.sqrt(3)
    elif background == 'ar07':
        noise = rng.normal(size=(n, 5))
        for i in range(1, n):
            noise[i] = .7 * noise[i-1] + np.sqrt(1-.7**2) * noise[i]
    else:
        noise = rng.normal(size=(n, 5))
    target = int(rng.integers(5))
    sign = int(rng.choice((-1, 1)))
    duration, amp, kind = spec['duration'], spec['amplitude'], spec['kind']
    signal = np.zeros((n, 5))
    wave = np.zeros(duration)
    if kind in ('pulse', 'step'):
        wave[:] = amp
    elif kind == 'ramp':
        wave = np.minimum(np.arange(duration) * spec['slope'], amp)
    elif kind == 'benign_ramp':
        wave = amp * (1 - np.abs(np.linspace(-1, 1, duration)))
    elif kind == 'intermittent':
        wave = amp * (np.arange(duration) % (spec['on'] + spec['off']) < spec['on'])
    elif kind == 'oscillation':
        wave = amp * np.sin(2*np.pi*np.arange(duration)/10)
    elif kind == 'variance':
        noise[ONSET:ONSET+duration] *= amp
    elif kind == 'rotating':
        for i in range(duration):
            signal[ONSET+i, (target+i) % 5] = sign * amp
    elif kind == 'multi':
        for j in range(3):
            signal[ONSET:ONSET+duration, (target+j) % 5] = sign * amp
    signal[ONSET:ONSET+duration, target] += sign * wave
    centers = np.array([80000., 200., 100., 20., 30.])
    scales = np.array([300., 1., 2., .5, .3])
    values = centers + (noise+signal)*scales
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    rows = [dict(zip(SENSORS, map(float, values[i])), at=start+timedelta(minutes=i),
                 equip_status_id=f'SYN-{seed}-{i}', equipment_id='SYN', error_code='NONE')
            for i in range(n)]
    # Synthetic reference ONLY: noise-free fault ramp reaches 8 baseline SD.
    # Never passed to Detector, not a measured factory alarm or v8 threshold.
    crossing = np.flatnonzero(wave >= 8) if kind == 'ramp' else []
    alarm_offset = int(crossing[0]) if len(crossing) else None
    return SimpleNamespace(rows={'SYN': rows}), target, alarm_offset


def measure(detector, data, spec, alarm_offset):
    rows = detector.scored['SYN']
    origin = data.rows['SYN'][0]['at']
    opened = [int((r['at']-origin).total_seconds()/60) for r in warning_openings(rows)]
    end = ONSET + spec['duration']
    hits = [t for t in opened if ONSET <= t < end]
    delay = hits[0]-ONSET if hits else None
    return dict(events=len(opened), anyWarning=bool(opened),
                preEvents=sum(t<ONSET for t in opened),
                challengeWarning=any(ONSET<=t<end+10 for t in opened),
                detected=delay is not None, delayMinutes=delay,
                lateOnly=not hits and any(end<=t<end+10 for t in opened),
                leadMinutes=alarm_offset-delay if alarm_offset is not None and delay is not None else None,
                scoredHours=len(rows)/60, openingOffsets=[t-ONSET for t in opened])


def med(values):
    v = [x for x in values if x is not None]
    return round(statistics.median(v), 3) if v else None


def aggregate(records):
    summary = dict(trials=len(records), normalTrials=sum(not r['label'] for r in records),
                   faultTrials=sum(r['label'] for r in records))
    for version in ('v1', 'v2'):
        normal = [r[version] for r in records if not r['label']]
        faults = [r[version] for r in records if r['label']]
        ramp = [r[version] for r in records if r['label'] and r['alarmOffset'] is not None]
        summary[version] = dict(
            normalRunsWithWarning=sum(r['anyWarning'] for r in normal),
            normalChallengeWarnings=sum(r['challengeWarning'] for r in normal),
            normalEvents=sum(r['events'] for r in normal),
            normalEventsPer100Hours=round(100*sum(r['events'] for r in normal)/sum(r['scoredHours'] for r in normal), 3) if normal else None,
            faultsDetected=sum(r['detected'] for r in faults),
            faultRunsWithPreWarning=sum(r['preEvents']>0 for r in faults),
            faultsDetectedOnlyAfterEnd=sum(r['lateOnly'] for r in faults),
            detectionDelayMedian=med(r['delayMinutes'] for r in faults),
            referenceAlarmTrials=len(ramp), beforeReferenceAlarm=sum(r['leadMinutes'] is not None and r['leadMinutes']>0 for r in ramp),
            referenceLeadMedian=med(r['leadMinutes'] for r in ramp))
    faults = [r for r in records if r['label']]
    paired = [r for r in faults if r['v1']['detected'] and r['v2']['detected']]
    summary['paired'] = dict(bothDetected=len(paired),
        lostByV2=sum(r['v1']['detected'] and not r['v2']['detected'] for r in faults),
        gainedByV2=sum(not r['v1']['detected'] and r['v2']['detected'] for r in faults),
        bothMissed=sum(not r['v1']['detected'] and not r['v2']['detected'] for r in faults),
        addedDelayMedian=med(r['v2']['delayMinutes']-r['v1']['delayMinutes'] for r in paired),
        addedDelayMax=max((r['v2']['delayMinutes']-r['v1']['delayMinutes'] for r in paired), default=None))
    return summary


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repeats', type=int, default=30)
    parser.add_argument('--seed', type=int, default=20261114)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1]/'var/generalization')
    args = parser.parse_args()
    if args.repeats < 1:
        parser.error('repeats must be positive')
    args.output.mkdir(parents=True, exist_ok=True)
    root = Path(__file__).resolve().parents[1]
    code = [root/'qfirst_agent/detector.py', root/'qfirst_agent/detector_v1.py',
            Path(__file__), Path(__file__).with_name('compare_detectors.py')]
    hashes = {str(p.relative_to(root)): sha(p) for p in code}
    manifest = dict(createdAt=datetime.now(timezone.utc).isoformat(), seed=args.seed,
                    repeats=args.repeats, backgrounds=BACKGROUNDS, scenarios=specs(),
                    detectorAndEvaluatorHashes=hashes, baselineRows=BASELINE,
                    preEventMinutes=PRE, tailMinutes=TAIL,
                    numpyVersion=np.__version__, pythonVersion=sys.version,
                    protocol='No v8 read, no detector tuning. All scenarios and seeds fixed before scoring.',
                    limitations=[
                        'Synthetic challenge designed after inspecting v8; not independent real-world validation.',
                        'Normal transient / approved operating change labels are scenario assumptions, not sensor-observable truth.',
                        'Fault recall requires a NEW warning opening inside the fault interval; pre-existing warnings are not credited.',
                        'After-recovery warnings are not credited as successful fault detection.',
                        'One-minute sampling and first 240 clean stationary samples assumed; cold start and contaminated calibration not tested.',
                        'The 8-SD ramp reference is artificial, not a real PLC/SCADA alarm.',
                        'Scenario-weighted totals are NOT factory prevalence or a production false-alarm rate.',
                        'Multiple stochastic seeds test variation under this generator, not new factories.'
                    ])
    (args.output/'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    records = []
    for index, spec in enumerate(specs()):
        for bidx, background in enumerate(BACKGROUNDS):
            for repeat in range(args.repeats):
                seed = args.seed + index*10000 + bidx*1000 + repeat
                data, target, alarm_offset = make_data(spec, background, seed)
                record = dict(scenario=spec['name'], label=spec['label'], background=background,
                              seed=seed, targetSensor=SENSORS[target], alarmOffset=alarm_offset)
                for version, cls in (('v1', LegacyDetector), ('v2', Detector)):
                    record[version] = measure(cls(data), data, spec, alarm_offset)
                records.append(record)
        print(f"Scored {spec['name']}: {len(records)} trials", flush=True)
    assert hashes == {str(p.relative_to(root)): sha(p) for p in code}, 'Frozen code changed during validation'
    report = dict(summary=aggregate(records),
                  byScenario={s['name']:aggregate([r for r in records if r['scenario']==s['name']]) for s in specs()},
                  byBackground={b:aggregate([r for r in records if r['background']==b]) for b in BACKGROUNDS},
                  byScenarioBackground={f"{s['name']}/{b}":aggregate([r for r in records if r['scenario']==s['name'] and r['background']==b]) for s in specs() for b in BACKGROUNDS},
                  records=records)
    (args.output/'results.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
    flat = []
    for r in records:
        row = {k:v for k,v in r.items() if k not in ('v1','v2')}
        for version in ('v1','v2'):
            row.update({version+'_'+k:json.dumps(v) if isinstance(v,list) else v for k,v in r[version].items()})
        flat.append(row)
    with (args.output/'trials.csv').open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=list(flat[0]));writer.writeheader();writer.writerows(flat)
    print(json.dumps(report['summary'], indent=2))


if __name__ == '__main__':
    main()
