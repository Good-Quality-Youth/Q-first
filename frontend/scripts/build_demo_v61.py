"""합성 데이터셋 v6.1/v7(qfirst_dataset) → src/api/demo-data.json
사용: python3 scripts/build_demo_v61.py <v6.1 폴더>
- 시각은 데이터에 적힌 그대로 'HH:mm'로 쓴다. 평소 범위 = 정상 행(앞 900행)의 중앙값 ± 3×(1.4826×MAD).
- 목록·등급·검수 수치·이상 점수는 demo_snapshot_*.csv, LOT는 equipment_status.lot_no 그대로.
- 대표 센서: 몸체·속뚜껑 설비는 사출 압력(MPa), 뚜껑 설비는 배럴 온도, EQP-004만 스크류 회전(rpm).
"""
import csv, json, os, statistics as S, sys
src = sys.argv[1]
rd = lambda f: list(csv.DictReader(open(os.path.join(src, f), encoding='utf-8-sig')))
st = rd('equipment_status.csv'); ad = {r['equip_status_id']: r for r in rd('anomaly_detection.csv')}
reg = {r['equipment_id']: r for r in rd('equipment_registry.csv')}
by = {}
for r in st: by.setdefault(r['equipment_id'], []).append(r)
DAY = '2026-02-03T'
# (열, 이름, 단위, 배율, 임계값 하한 열, 상한 열) — 기존 알람 임계값은 equipment_registry에 있다
P = ('pressure_kpa', '사출 압력', 'MPa', 1 / 1000, 'pressure_low_limit_kpa', 'pressure_high_limit_kpa'); T = ('temperature_celsius', '배럴 온도', '℃', 1, 'temp_low_limit_c', 'temp_high_limit_c'); R = ('rotation_speed_rpm', '스크류 회전 속도', 'rpm', 1, 'rpm_low_limit', 'rpm_high_limit')
SENSOR = {'BODY': P, 'INNER_LID': P, 'CAP': T}
OVERRIDE = {'EQP-004': R}
hm = lambda s: s[11:16]

def base(rows, col, k):
    n = [float(r[col]) * k for r in rows[:900] if r['equipment_state'] == '정상']
    med = S.median(n); mad = S.median([abs(x - med) for x in n]) * 1.4826
    return med, [round(med - 3 * mad, 3), round(med + 3 * mad, 3)]

out = {'source': 'qfirst_dataset_v6.1', 'equipment': {}, 'quality': {}}
for e, rows in by.items():
    col, label, unit, k, lo_c, hi_c = OVERRIDE.get(e, SENSOR[reg[e]['part_type']])
    limits = [round(float(reg[e][lo_c]) * k, 2), round(float(reg[e][hi_c]) * k, 2)]
    med, band = base(rows, col, k)
    idx = {r['recorded_at'][:16]: i for i, r in enumerate(rows)}
    snaps = {}
    for snap, t in (('1400', '14:00'), ('1405', '14:05')):
        i = idx[DAY + t]; win = rows[i - 60:i + 1]
        vals = [round(float(r[col]) * k, 3) for r in win]
        outs = None
        for j in range(len(win)):
            if all(not band[0] <= v <= band[1] for v in vals[j:]): outs = hm(win[j]['recorded_at']); break
        alarm = next((hm(r['recorded_at']) for r in rows[max(0, i - 120):i + 1] if r['error_code'] != 'NONE'), None)
        a = ad[rows[i]['equip_status_id']]
        snaps[snap] = dict(values=vals, start=hm(win[0]['recorded_at']), end=t, outSince=outs, score=float(a['anomaly_score']), risk=a['risk_level'],
                           topFeature=a['top_feature'], alarm=alarm, errorCode=rows[i]['error_code'], lot=rows[i]['lot_no'], operation=rows[i]['operation_status'])
    eq = dict(kind='injection', label=label, unit=unit, reference=round(med, 1), threshold=None, limits=limits, target=None, median=round(med, 2), band=band, snapshots=snaps,
              no=reg[e]['equipment_name'], part=reg[e]['part_name'])
    if e == 'EQP-001':  # 함께 떨어지는 배럴 온도 (근거 경로용)
        tm, _ = base(rows, 'temperature_celsius', 1)
        eq['aux'] = dict(label='배럴 온도', reference=round(tm, 1), **{s: float(rows[idx[DAY + t]]['temperature_celsius']) for s, t in (('1400', '14:00'), ('1405', '14:05'))})
    out['equipment'][e] = eq

ABN = set()
for snap in ('1400', '1405'):
    for r in rd(f'demo_snapshot_20260203_{snap}.csv'):
        out['quality'].setdefault(r['equipment_id'], {})[snap] = dict(inspected=int(r['inspected_n']), defects=int(r['defect_n']))
        ABN.add(r['equipment_id'])
        s = out['equipment'][r['equipment_id']]['snapshots'][snap]
        s['risk'] = r['risk_level']; s['score'] = float(r['anomaly_score']); s['grade'] = int(r['grade']); s['list'] = r['list']; s['firstWarning'] = r['first_warning_at']; s['firstAlarm'] = r['first_alarm_at'] or None

for e in ABN:
    q = out['equipment'][e]; last = q['snapshots']['1405']['values'][-1]
    q['threshold'] = min(q['limits'], key=lambda x: abs(x - last))

# 지난 이력: 시연 구간(02-03 13:00) 전에 끝난 점검
TITLE = {'BARREL_TEMP_DROP': '배럴 온도 저하', 'BARREL_TEMP_RISE': '배럴 온도 상승', 'BEARING_WEAR': '진동 증가(베어링)', 'PRESSURE_DROP': '사출 압력 저하', 'PRESSURE_RISE': '사출 압력 상승',
         'PRESSURE_SUDDEN_DROP': '사출 압력 급저하', 'PRESSURE_TEMP_DROP': '사출 압력·배럴 온도 저하', 'SCREW_SPEED_DROP': '스크류 회전 저하', 'SCREW_SPEED_UNSTABLE': '스크류 회전 불안정', 'SLOW_TEMP_DRIFT': '배럴 온도 서서히 상승', 'MATERIAL_CHANGE_TEMP': '배럴 온도 출렁임(일시)', 'VIBRATION_SENSOR_SPIKE': '진동 순간 튐(일시)'}
win = {(w['equipment_id'], w['start_at']): w for w in rd('windows.csv')}
mins = lambda a, b: (int(b[8:10]) * 1440 + int(b[11:13]) * 60 + int(b[14:16])) - (int(a[8:10]) * 1440 + int(a[11:13]) * 60 + int(a[14:16]))
past = []
for g in rd('inspection_guide.csv'):
    if not g['completed_dt'] or g['completed_dt'] >= DAY + '13:00': continue
    # 사건 생성 시각이 구간 시작보다 늦을 수 있어(예고 없이 알람부터) 같은 설비의 직전 구간을 찾는다
    cand = [w for (e, t), w in win.items() if e == g['equipment_id'] and t <= g['created_at']]
    w = max(cand, key=lambda w: w['start_at']) if cand else None
    d = g['created_at']
    past.append(dict(id=g['inspection_id'], date=f"{int(d[5:7])}/{int(d[8:10])}", time=hm(d), equipment=g['equipment_id'], title=TITLE.get(w['scenario_type'], w['scenario_type']) if w else g['check_items'],
                     group='emergency' if g['final_alert_kind'] == '비상' else 'warning', grade=int(g['priority_grade']), initialGrade=int(g['initial_grade']), gradeAt=hm(g['updated_at']),
                     result={'조치완료': '이상 발견', '이상없음': '이상 없음'}.get(g['inspection_result'], g['inspection_result']), action=g['action_taken'], minutes=mins(g['started_at'], g['completed_dt']),
                     assignee=g['assigned_inspector'], quality={'있음': 'CAUTION', '없음': 'NONE', '미확인': 'UNKNOWN'}[g['quality_impact']], qualityRate=g['defect_rate'], qualityN=g['inspected_n']))
out['pastHistory'] = sorted(past, key=lambda h: (h['date'], h['time']), reverse=True)
json.dump(out, open(os.path.join(os.path.dirname(__file__), '..', 'src', 'api', 'demo-data.json'), 'w'), ensure_ascii=False)
for e, q in out['equipment'].items():
    a, b = q['snapshots']['1400'], q['snapshots']['1405']
    print(e, q['label'], q['reference'], q['band'], a['values'][-1], b['values'][-1], b['outSince'], b['alarm'], b['score'], b['risk'], b['lot'], b['operation'], b.get('grade'))
print(len(past), [ (h['id'],h['result']) for h in past])
