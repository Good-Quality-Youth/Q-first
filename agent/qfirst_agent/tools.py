from datetime import timedelta
from .data import SENSORS, LABELS, UNITS, KST, iso, source_time

GUIDES = {
 'pressure_kpa': ('PRESSURE_CHECK', '압력 센서 표시와 설정 압력을 대조하고 유압 회로의 누유 여부를 확인하세요.'),
 'temperature_celsius': ('BARREL_HEATING', '배럴 온도 표시와 설정값을 대조하고 히터·열전대 상태를 확인하세요.'),
 'rotation_speed_rpm': ('SCREW_DRIVE', '스크류 RPM 설정값과 구동부 표시를 대조하세요.'),
 'vibration_level': ('VIBRATION_CHECK', '진동 센서 고정 상태와 동일 운전 조건의 진동 추이를 확인하세요.'),
 'motor_current_amp': ('MOTOR_CHECK', '모터 전류 표시와 부하 조건을 대조하세요.'),
}
# Development-only guide options: the LLM can select among these, never invent control instructions.
GUIDE_OPTIONS = {
 'pressure_kpa': {
  'measurement': '압력 표시와 설정 압력을 대조하고 압력 센서 측정 상태를 먼저 확인하세요.',
  'control': '동일 운전 조건에서 압력 추이를 대조한 뒤 유압 회로의 누유·밸브 상태를 확인하세요.',
  'lot_trace': '압력 이탈 구간의 생산 LOT와 검사 표본을 대조해 추가 확인할 생산분을 정리하세요.'},
 'temperature_celsius': {
  'measurement': '배럴 온도 표시와 설정값을 대조하고 열전대 측정 상태를 먼저 확인하세요.',
  'control': '온도 상승 구간의 설정값과 히터 제어 상태를 확인하고 열전대 상태를 대조하세요.',
  'lot_trace': '온도 상승 이후 생산 LOT의 표면결함 기록과 해당 생산 구간을 대조하세요.'},
 'rotation_speed_rpm': {
  'measurement': '스크류 RPM 표시와 설정값을 대조하고 속도 측정 상태를 확인하세요.',
  'control': '동일 운전 조건에서 RPM과 모터 전류를 대조한 뒤 구동부 점검 항목을 확인하세요.',
  'lot_trace': 'RPM 이탈 구간의 생산 LOT와 검사 표본을 대조하세요.'},
 'vibration_level': {
  'measurement': '진동 센서 고정 상태와 측정 상태를 먼저 확인하세요.',
  'control': '동일 운전 조건에서 진동과 RPM 추이를 대조하세요.',
  'lot_trace': '진동 변화 구간의 생산 LOT와 검사 표본을 대조하세요.'},
 'motor_current_amp': {
  'measurement': '모터 전류 표시와 측정 상태를 먼저 확인하세요.',
  'control': '모터 전류 변화와 부하·구동 조건을 대조하세요.',
  'lot_trace': '전류 변화 구간의 생산 LOT와 검사 표본을 대조하세요.'},
}
HISTORY_TERMS = {
 'pressure_kpa': ('압력','유압','밸브'), 'temperature_celsius': ('온도','열전대','히터'),
 'rotation_speed_rpm': ('스크류','RPM','구동'), 'vibration_level': ('진동','베어링'),
 'motor_current_amp': ('전류','모터','부하'),
}
TOOL_NAMES = ('sensor_comparison','lot_inspections','maintenance_history','equipment_logs','inspection_guidance')


def evidence(id, kind, basis, title, detail, at):
    return dict(id=id, kind=kind, basis=basis, title=title, detail=detail, observedAt=iso(at))


class Tools:
    def __init__(self,data,detector): self.data,self.detector=data,detector

    def execute(self, name, request):
        if name not in TOOL_NAMES: raise ValueError('tool not allowed')
        eq, at, start = request.equipmentId, request.asOf, request.detectedAt
        # All queries are server-scoped. The model cannot change equipment, cutoff or SQL.
        rows = self.data.before(eq,at)
        if not rows: raise ValueError('no sensor evidence')
        sensor=request.topSensor
        i=SENSORS.index(sensor)
        if name=='sensor_comparison':
            selected=[r for r in self.detector.scored[eq] if start<=r['at']<=at]
            row=rows[-1]; center,_,baseline_at=self.detector.baselines[eq]
            scale=0.001 if sensor=='pressure_kpa' else 1
            unit='MPa' if sensor=='pressure_kpa' else UNITS[i]
            value=row[sensor]*scale; reference=float(center[i])*scale
            deviation=value-reference
            detail=f"{at.astimezone(KST).strftime('%H:%M')} {LABELS[i]} {value:.2f}{unit}, 과거 기준 {reference:.2f}{unit} 대비 {deviation:+.2f}{unit}. 관측 구간 {len(selected)}사이클, 점수 40 이상 {sum(r['score']>=40 for r in selected)}사이클."
            return [evidence(row['equip_status_id'],'sensor','record',LABELS[i]+' 실측',f"{value:.2f}{unit}",row['at']),
                    evidence('CMP-'+row['equip_status_id'],'comparison','compare','정상 기준과 관측 구간 대조',detail,at)]
        if name=='lot_inspections':
            inspected=self.data.inspected(eq,start,at)
            lots=sorted({r['lot_no'] for r in inspected})
            defects=[r for r in inspected if int(r['defect_count'])>0]
            desc=(f"LOT {', '.join(lots)}: 예고 이후 생산분 중 검사 {len(inspected)}개, 불량 {len(defects)}개. "
                  '시간·LOT 연관이며 설비 원인 확정은 아님.') if inspected else '예고 이후 생산분의 검사 결과가 아직 없습니다. 품질 영향 미확인입니다.'
            result=[evidence('LOT-CHECK-'+request.id,'inspection','derived','LOT 검사 대조',desc,at)]
            for r in defects[-3:]:
                result.append(evidence(r['inspection_record_id'],'inspection','record',r['defect_type'],
                                       f"LOT {r['lot_no']}, 순번 {r['lot_seq']}, 불량 1건",r['at']))
            return result
        if name=='maintenance_history':
            history=[r for r in self.data.maintenance if r['equipment_id']==eq and r['completed_dt']
                     and source_time(r['completed_dt'])<=at and source_time(r['created_at'])<start
                     and any(t in (r['check_items']+' '+r['action_taken']) for t in HISTORY_TERMS[sensor])]
            history=sorted(history,key=lambda r:r['completed_dt'])[-2:]
            if not history:
                return [evidence('HISTORY-NONE-'+request.id,'analysis','derived','과거 점검 이력 조회','해당 시점까지 완료된 동일 설비·관련 부위 점검 이력을 찾지 못했습니다.',at)]
            return [evidence('HIST-'+r['inspection_id'],'analysis','record','과거 완료 점검',
                             f"{r['check_items']} / {r['inspection_result']} / {r['action_taken']}. 과거 사례이며 현재 원인 확정은 아님.",source_time(r['completed_dt'])) for r in history]
        if name=='equipment_logs':
            # Available source has alarm/mold/LOT only, no setpoint-change or start/stop log.
            changes=[]
            subset=[r for r in rows if r['at']>=start-timedelta(minutes=10)]
            for prev,cur in zip(subset,subset[1:]):
                fields=[f"{k}: {prev[k]} → {cur[k]}" for k in ('error_code','process_id','lot_no') if prev[k]!=cur[k]]
                if fields: changes.append(evidence('LOG-'+cur['equip_status_id'],'analysis','record','설비 기록 변화',', '.join(fields),cur['at']))
            changes=changes[-3:]
            changes.append(evidence('LOG-LIMIT-'+request.id,'analysis','derived','조회 범위의 한계',
                                    '알람·금형·LOT 변화만 조회 가능합니다. 설정값 변경·기동/정지 로그는 제공되지 않아 원인 배제에 사용할 수 없습니다.',at))
            return changes
        code,_=GUIDES[sensor]
        return [evidence(f'GUIDE-{code}-{option}-v1','analysis','derived',f'PoC 점검 지침 v1 · {option}',
                         guide+' 실제 제조사 승인 지침이 아닌 개발용 점검 후보입니다. 정비·설비 제어는 담당자가 결정합니다.',at)
                for option,guide in GUIDE_OPTIONS[sensor].items()]
