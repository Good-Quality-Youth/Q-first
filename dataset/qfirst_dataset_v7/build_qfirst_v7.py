"""Q-First 사출 PoC 시나리오(사출기 10대, 화장품 크림 용기) 합성 데이터 v7 생성.

v6 대비
- 기존 센서 알람을 값 기준으로 바꿈: 설비별 평소 값 대비 압력 ±10%, 배럴 온도 ±5℃(KAMP 실측 분석),
  스크류 RPM ±15%(가정값)을 넘는 분에 error_code가 켜진다. 진동·모터 전류는 기존 알람이 없다.
- 정상 배럴 온도 흔들림을 실측 수준으로 줄임(표준편차 0.35℃, 99%가 ±1℃ 안)
- 알람까지 가지 않는 이상 2개, 라벨은 정상인 짧은 변동(오경보 후보) 5개 추가
- EQP-003 표면결함 1건 추가(14:09 생산분) → 14:15에도 품질 영향 있음
- 불량 유형을 샘플 5종(치수불량·색상편차·강도부족·중량편차·표면결함)으로
- 샘플 스키마 열 추가(operator_id, shift, operation_time_hr, last/next_maintenance_dt, process_id, inspector_id,
  defect_count, total_produced, LOT cpk_value), 점검 이력에 initial/final_alert_kind

사용: python3 build_qfirst_v7.py <출력 폴더>
Python 표준 라이브러리만 사용, 시드 20261113.
"""
import csv
import math
import random
import statistics as st
import sys
from datetime import datetime, timedelta
from pathlib import Path

SEED = 20261113
N = 5000
T0 = datetime(2026, 2, 2)
TAIL = 8
WARN = 40
EVENT_GAP = 10
LOT_SIZE = 125
ANOMALY_ROWS = 1410
DEFECT_ROWS = 575
CAUTION_ROWS = 835
MULTIPLIER = 9

rng = random.Random(SEED)


def idx(day, h, m):
    return day * 1440 + h * 60 + m


def ts(i):
    return (T0 + timedelta(minutes=i)).strftime("%Y-%m-%dT%H:%M:%SZ")


def hm(i):
    return ts(i)[11:16]


# ---------------------------------------------------------------- 부품·설비
PARTS = {   # 부품: (한글 이름, LOT 접두어, 핵심 치수, 기준값 mm, 공차 ±mm, 검수 방식)
    "BODY": ("용기 몸체", "BD", "벽 두께", 2.00, 0.10, "묶음"),
    "INNER_LID": ("속뚜껑", "IL", "외경", 58.00, 0.15, "인라인2"),
    "CAP": ("뚜껑", "CP", "높이", 18.00, 0.12, "인라인1"),
}
MACHINES = [   # 설비, 부품, 금형, 평소 값(진동 지수, 배럴 온도 ℃, 사출 압력 kPa, 모터 전류 A, 스크류 RPM)
    ("EQP-001", "BODY", "MOLD-BD1", (12.0, 205.0, 89000, 34.0, 95.0)),
    ("EQP-002", "INNER_LID", "MOLD-IL1", (11.5, 201.0, 82400, 31.0, 89.0)),
    ("EQP-003", "CAP", "MOLD-CP1", (12.8, 209.0, 88000, 34.5, 96.0)),
    ("EQP-004", "INNER_LID", "MOLD-IL2", (11.6, 201.5, 82800, 31.2, 89.5)),
    ("EQP-005", "BODY", "MOLD-BD2", (12.1, 205.5, 89400, 34.2, 95.5)),
    ("EQP-006", "BODY", "MOLD-BD3", (11.9, 204.5, 88600, 33.8, 94.6)),
    ("EQP-007", "CAP", "MOLD-CP2", (12.6, 208.5, 87600, 34.3, 95.6)),
    ("EQP-008", "INNER_LID", "MOLD-IL3", (11.4, 200.5, 82100, 30.8, 88.6)),
    ("EQP-009", "CAP", "MOLD-CP3", (12.9, 209.5, 88300, 34.7, 96.4)),
    ("EQP-010", "CAP", "MOLD-CP4", (12.7, 208.0, 87800, 34.4, 95.8)),
]
EQS = [m[0] for m in MACHINES]
PART_OF = {m[0]: m[1] for m in MACHINES}
COLS = ["vibration_level", "temperature_celsius", "pressure_kpa", "motor_current_amp", "rotation_speed_rpm"]
DECIMALS = {"vibration_level": 2, "temperature_celsius": 2, "pressure_kpa": 1, "motor_current_amp": 2, "rotation_speed_rpm": 1}
# 정상 흔들림(표준편차). 배럴 온도는 KAMP 실측처럼 99%가 ±1℃ 안에 들도록 0.35℃, 압력은 평소 값의 0.95%
NOISE = {"vibration_level": 0.90, "temperature_celsius": 0.35, "pressure_kpa": 0.0095, "motor_current_amp": 1.08,
         "rotation_speed_rpm": 2.35}
# 기존 센서 알람 임계값(평소 값 대비). 압력·온도는 KAMP 실측 분석, RPM은 가정값. 진동·전류는 알람 없음
THRESHOLD = {"pressure_kpa": ("pct", 10.0), "temperature_celsius": ("abs", 5.0), "rotation_speed_rpm": ("pct", 15.0)}


def limits(base):
    out = {}
    for c, (kind, v) in THRESHOLD.items():
        b = base[c]
        out[c] = (b * (1 - v / 100), b * (1 + v / 100)) if kind == "pct" else (b - v, b + v)
    return out


def alarm_code(c, low):
    return {"pressure_kpa": "PRESSURE_LOW" if low else "PRESSURE_HIGH", "temperature_celsius": "TEMP_LIMIT",
            "rotation_speed_rpm": "SCREW_SPEED_LIMIT"}[c]


# 이상 유형: 센서별 최대 변화(압력·RPM·진동·전류는 평소 대비 %, 온도는 ℃), 진행 방식, 알람이 나는지
TYPES = {
    "PRESSURE_RISE": ({"pressure_kpa": 14, "vibration_level": 35, "motor_current_amp": 8}, "ramp", True),
    "PRESSURE_DROP": ({"pressure_kpa": -14, "motor_current_amp": -5}, "ramp", True),
    "PRESSURE_SUDDEN_DROP": ({"pressure_kpa": -13, "motor_current_amp": -4}, "step", True),
    "BARREL_TEMP_RISE": ({"temperature_celsius": 8, "motor_current_amp": -3}, "ramp", True),
    "BARREL_TEMP_DROP": ({"temperature_celsius": -8, "motor_current_amp": 5}, "ramp", True),
    "SCREW_SPEED_UNSTABLE": ({"rotation_speed_rpm": 22, "vibration_level": 25}, "wobble", True),
    "SCREW_SPEED_DROP": ({"rotation_speed_rpm": -22, "vibration_level": 40, "motor_current_amp": 9}, "ramp", True),
    "PRESSURE_TEMP_DROP": ({"pressure_kpa": -14, "temperature_celsius": -7}, "ramp", True),
    "BEARING_WEAR": ({"vibration_level": 60, "motor_current_amp": 6}, "ramp", False),        # 알람 없는 이상
    "SLOW_TEMP_DRIFT": ({"temperature_celsius": 3.5}, "ramp", False),                        # 알람 없는 이상
}
OTHER_TYPES = ["PRESSURE_RISE", "SCREW_SPEED_DROP", "PRESSURE_DROP", "BARREL_TEMP_RISE", "PRESSURE_SUDDEN_DROP",
               "BEARING_WEAR", "BARREL_TEMP_DROP", "SCREW_SPEED_UNSTABLE", "PRESSURE_TEMP_DROP", "PRESSURE_RISE",
               "SLOW_TEMP_DRIFT", "PRESSURE_DROP", "SCREW_SPEED_DROP", "BARREL_TEMP_RISE", "PRESSURE_SUDDEN_DROP",
               "BARREL_TEMP_DROP", "SCREW_SPEED_UNSTABLE", "PRESSURE_TEMP_DROP", "PRESSURE_RISE", "PRESSURE_DROP",
               "BARREL_TEMP_RISE", "SCREW_SPEED_DROP", "PRESSURE_SUDDEN_DROP", "BARREL_TEMP_DROP"]
TRANSIENTS = 5      # 라벨은 정상인 짧은 변동(원료 교체 직후 온도 출렁임, 진동 센서 순간 튐)

D = 1
T_001_START, T_001_ALARM, T_001_INSPECT = idx(D, 13, 25), idx(D, 13, 33), idx(D, 13, 58)
T_003_WARN, T_003_ALARM = idx(D, 13, 41), idx(D, 14, 15)
T_0024 = idx(D, 14, 4)
T_1400, T_1405, T_1415 = idx(D, 14, 0), idx(D, 14, 5), idx(D, 14, 15)
QUIET = (idx(D, 10, 0), idx(D, 16, 30))
CLUSTER_SIZES = [3, 3, 3, 2, 2]
SINGLES = 11
BODY_OFFSET = 20        # 몸체 30분 묶음의 시작 분(:20, :50). 시연 맞춤 뒤 정해진다


def inspected_at(part, i):
    kind = PARTS[part][5]
    if kind == "인라인1":
        return i + 1
    if kind == "인라인2":
        return i + 2
    block = i - ((i - BODY_OFFSET) % 30)
    return block + 30 + min(6, (i - block) * 6 // 29)     # 묶음이 끝난 뒤 7분 동안 순서대로 검수


# ---------------------------------------------------------------- 센서
def new_series():
    series = {}
    for eq, part, mold, base in MACHINES:
        b = dict(zip(COLS, base))
        sd = {c: NOISE[c] * (b[c] if c == "pressure_kpa" else 1) for c in COLS}
        series[eq] = {"base": b, "sd": sd, "lim": limits(b),
                      "noise": {c: [rng.gauss(0, sd[c]) for _ in range(N)] for c in COLS},
                      "add": {c: [0.0] * N for c in COLS}, "label": [0] * N, "scenario": ["NORMAL"] * N}
    return series


def to_unit(sr, c, v):
    """프로파일 값(%, ℃)을 센서 단위 편차로."""
    return v if c == "temperature_celsius" else sr["base"][c] * v / 100


def clear(sr, a, b):
    for i in range(max(0, a), min(N, b)):
        for c in COLS:
            sr["add"][c][i] = 0.0
        sr["label"][i], sr["scenario"][i] = 0, "NORMAL"


def put(sr, start, L, ty, curve, label=True):
    """curve(o) -> {센서: 변화(%, ℃)}. 구간 뒤 TAIL분은 40%에서 0으로 회복(알람 임계값보다 충분히 아래)."""
    clear(sr, start, start + L + TAIL)
    last = curve(L - 1)
    for o in range(L + TAIL):
        i = start + o
        if i >= N:
            break
        d = curve(o) if o < L else {c: v * 0.4 * (L + TAIL - o) / (TAIL + 1) for c, v in last.items()}
        if TYPES.get(ty, (0, "", 0))[1] == "wobble" and o >= L:
            d = {}
        for c, v in d.items():
            sr["add"][c][i] = to_unit(sr, c, v)
        if o < L and label:
            sr["label"][i], sr["scenario"][i] = 1, ty


def standard_curve(ty, L, scale=1.0):
    dev, mode, _ = TYPES[ty]

    def f(o):
        if mode == "step":
            k = 1.0
        elif mode == "wobble":
            k = (0.85 + 0.15 * o / max(1, L - 1)) * (1 if o % 2 == 0 else -1)
        else:
            k = (o / max(1, L - 1)) ** 1.0
        return {c: v * scale * k for c, v in dev.items()}
    return f


def values(sr, c):
    return [sr["base"][c] + n + a for n, a in zip(sr["noise"][c], sr["add"][c])]


def alarms(sr):
    """임계값을 넘는 분에 알람 코드. 여러 센서가 넘으면 압력 → 온도 → RPM 순."""
    vals = {c: values(sr, c) for c in THRESHOLD}
    out = ["NONE"] * N
    for i in range(N):
        for c in ("pressure_kpa", "temperature_celsius", "rotation_speed_rpm"):
            lo, hi = sr["lim"][c]
            v = vals[c][i]
            if v < lo or v > hi:
                out[i] = alarm_code(c, v < lo)
                break
    return out


# ---------------------------------------------------------------- 임시 이상 점수
def scores_for(sr):
    vals = {c: values(sr, c) for c in COLS}
    base = {}
    for c in COLS:
        xs = sorted(vals[c][:3000])
        med = xs[len(xs) // 2]
        base[c] = (med, sorted(abs(x - med) for x in xs)[len(xs) // 2] * 1.4826)
    d, top = [], []
    for i in range(N):
        z = {c: abs(vals[c][i] - base[c][0]) / base[c][1] for c in COLS}
        c = max(z, key=z.get)
        d.append(z[c])
        top.append(c)
    out = []
    for i in range(N):
        raw = st.mean(d[max(0, i - 2):i + 1]) + 3 * sum(x >= 3 for x in d[max(0, i - 6):i + 1]) / 7
        out.append((round(100 * (1 - math.exp(-max(0.0, raw - 2) / 6)), 1), top[i]))
    return out


def risk_level(s):
    return "LOW" if s < 25 else "MEDIUM" if s < 50 else "HIGH" if s < 75 else "CRITICAL"


def first(seq, a, b, cond):
    return next((i for i in range(a, b) if cond(seq[i])), None)


# ---------------------------------------------------------------- 시연 4대 맞추기
def tune_demo(series):
    global BODY_OFFSET
    log = {}
    # EQP-001: 13:25 압력·배럴 온도 동시 저하 시작, 13:25~13:27에 예고, 13:33에 처음 압력 하한(−10%) 이탈
    sr = series["EQP-001"]
    done = False
    for p0 in (-5, -6, -7, -8):
        for p1 in (-13, -14, -15, -16):
            for t0 in (-2.5, -3.0, -3.5):
                for t1 in (-4.0, -4.3):
                    L = 50

                    def curve(o, p0=p0, p1=p1, t0=t0, t1=t1):
                        k = o / (L - 1)
                        return {"pressure_kpa": p0 + (p1 - p0) * k, "temperature_celsius": t0 + (t1 - t0) * k,
                                "motor_current_amp": -3 * k}
                    clear(sr, idx(D, 12, 0), idx(D, 16, 0))
                    put(sr, T_001_START, L, "PRESSURE_TEMP_DROP", curve)
                    sc, al = scores_for(sr), alarms(sr)
                    s = first(sc, idx(D, 10, 0), T_001_START + 10, lambda x: x[0] >= WARN)
                    a = first(al, idx(D, 10, 0), T_001_START + 20, lambda x: x != "NONE")
                    if s is not None and T_001_START <= s <= T_001_START + 2 and a == T_001_ALARM and al[a] == "PRESSURE_LOW":
                        log["EQP-001"] = f"압력 {p0}%→{p1}%, 배럴 온도 {t0}℃→{t1}℃, 예고 {hm(s)}"
                        BODY_OFFSET = (s - 5) % 30
                        done = True
                        break
                if done:
                    break
            if done:
                break
        if done:
            break
    if not done:
        raise RuntimeError("EQP-001 tuning failed")
    # EQP-003: 배럴 온도 서서히 상승. 13:41 첫 예고, 14:00 HIGH 이상, 14:15에 처음 +5℃ 이탈
    sr = series["EQP-003"]
    done = False
    # 온도 정상 흔들림(0.35℃) 때문에 +5℃를 처음 넘는 분이 우연히 앞당겨질 수 있어, 곡선은 그대로 두고
    # 14:01~14:18의 무작위 노이즈만 다시 뽑아 첫 이탈이 14:15가 되는 경우를 쓴다(14:00까지의 값은 바뀌지 않음).
    temp_noise = sr["noise"]["temperature_celsius"]
    for start in range(T_003_WARN - 45, T_003_WARN - 5):
        La = T_003_ALARM - start
        L = La + 20
        for power in (1.4, 1.8, 2.2, 2.6):
            for a_val in (5.2, 5.4, 5.6):
                def curve(o, La=La, power=power, a_val=a_val):
                    if o <= La:
                        t = a_val * (o / La) ** power
                    else:
                        t = a_val + (8.0 - a_val) * (o - La) / 20
                    return {"temperature_celsius": t, "motor_current_amp": -3 * min(1, o / La)}
                clear(sr, idx(D, 12, 0), idx(D, 16, 0))
                put(sr, start, L, "BARREL_TEMP_RISE", curve)
                sc = scores_for(sr)
                w = first(sc, idx(D, 10, 0), T_1405, lambda x: x[0] >= WARN)
                if w != T_003_WARN or sc[T_1400][0] < 50:
                    continue
                for _ in range(300):
                    al = alarms(sr)
                    a = first(al, idx(D, 10, 0), T_003_ALARM + 10, lambda x: x != "NONE")
                    if a == T_003_ALARM:
                        sc = scores_for(sr)
                        if (first(sc, idx(D, 10, 0), T_1405, lambda x: x[0] >= WARN) == T_003_WARN
                                and all(sc[i][0] >= WARN for i in range(T_003_WARN, T_1415 + 1))):
                            done = True
                            break
                    for i in range(T_1400 + 1, T_003_ALARM + 4):
                        temp_noise[i] = rng.gauss(0, sr["sd"]["temperature_celsius"])
                if done:
                    log["EQP-003"] = f"시작 {hm(start)}, 진행 지수 {power}, 14:15 온도 +{a_val}℃, 14:00 점수 {sc[T_1400][0]}"
                    break
            if done:
                break
        if done:
            break
    if not done:
        raise RuntimeError("EQP-003 tuning failed")
    # EQP-002 압력 급저하 / EQP-004 스크류 회전 불안정: 14:04 시작·이탈, 14:05 위험도 같고 점수 002 > 004
    s2, s4 = series["EQP-002"], series["EQP-004"]
    done = False
    for k2 in (12, 13, 14, 15, 16, 18):
        put(s2, T_0024, 40, "PRESSURE_SUDDEN_DROP", lambda o, k2=k2: {"pressure_kpa": -k2, "motor_current_amp": -4})
        sc2, al2 = scores_for(s2), alarms(s2)
        a = sc2[T_1405][0]
        if al2[T_0024] != "PRESSURE_LOW" or any(x != "NONE" for x in al2[idx(D, 10, 0):T_0024]):
            continue
        for k in range(16, 45):
            put(s4, T_0024, 35, "SCREW_SPEED_UNSTABLE", standard_curve("SCREW_SPEED_UNSTABLE", 35, scale=k / 22))
            sc4, al4 = scores_for(s4), alarms(s4)
            b = sc4[T_1405][0]
            if (al4[T_0024] == "SCREW_SPEED_LIMIT" and not any(x != "NONE" for x in al4[idx(D, 10, 0):T_0024])
                    and risk_level(a) == risk_level(b) and a - b >= 2):
                log["EQP-002/004"] = f"14:05 점수 002 {a} / 004 {b} ({risk_level(a)}), 002 압력 −{k2}%, 004 RPM ±{k}%"
                done = True
                break
        if done:
            break
    if not done:
        raise RuntimeError("EQP-002/004 tuning failed")
    return log


# ---------------------------------------------------------------- 나머지 구간·짧은 변동
def plan_other(series, demo_windows):
    remaining = ANOMALY_ROWS - sum(L for _, _, L, _ in demo_windows)
    n = sum(CLUSTER_SIZES) + SINGLES
    lengths = [rng.randint(35, 65) for _ in range(n)]
    diff, k = remaining - sum(lengths), 0
    while diff:
        step = 1 if diff > 0 else -1
        if 30 <= lengths[k % n] + step <= 70:
            lengths[k % n] += step
            diff -= step
        k += 1
    rng.shuffle(lengths)
    busy = {eq: [] for eq in EQS}
    for eq, s, L, _ in demo_windows:
        busy[eq].append((s - 60, s + L + TAIL + 60))
    taken = [(s, s + L) for _, s, L, _ in demo_windows]
    types = iter(OTHER_TYPES)

    def free(eq, s, L):
        a, b = s, s + L + TAIL
        if a < 60 or b >= N - 120 or not (b + 150 < QUIET[0] or a > QUIET[1]):
            return False
        return all(b + 60 <= x or a >= y for x, y in busy[eq])

    def far(a, b, gap):
        return all(b + gap <= x or a >= y + gap for x, y in taken)

    out, li = [], 0
    for size in CLUSTER_SIZES:
        for _ in range(5000):
            t = rng.randint(120, N - 400)
            group = []
            for j, eq in enumerate(rng.sample(EQS, size)):
                L = lengths[li + j]
                if j:
                    t = group[-1][1] + group[-1][2] - rng.randint(10, 20)
                if not free(eq, t, L):
                    break
                group.append((eq, t, L))
            if len(group) == size and far(group[0][1], max(s + L for _, s, L in group), 90):
                break
        else:
            raise RuntimeError("cluster placement failed")
        li += size
        for eq, s, L in group:
            busy[eq].append((s, s + L + TAIL))
            out.append((eq, s, L, next(types)))
        taken.append((group[0][1], max(s + L for _, s, L in group)))
    for _ in range(SINGLES):
        L = lengths[li]
        li += 1
        for _ in range(5000):
            eq = rng.choice(EQS)
            s = rng.randint(120, N - L - 130)
            if free(eq, s, L) and far(s, s + L, 90):
                break
        else:
            raise RuntimeError("single placement failed")
        busy[eq].append((s, s + L + TAIL))
        taken.append((s, s + L))
        out.append((eq, s, L, next(types)))
    for eq, s, L, ty in out:
        put(series[eq], s, L, ty, standard_curve(ty, L))
    # 라벨은 정상인 짧은 변동: 원료 교체 직후 배럴 온도 출렁임(+2.5℃, 6분) 3개, 진동 센서 순간 튐(+70%, 3분) 2개
    trans = []
    kinds = ["MATERIAL_CHANGE_TEMP"] * 3 + ["VIBRATION_SENSOR_SPIKE"] * 2
    for kind in kinds:
        L = 6 if kind == "MATERIAL_CHANGE_TEMP" else 3
        for _ in range(5000):
            eq = rng.choice(EQS)
            s = rng.randint(200, N - 200)
            if free(eq, s, L + 20) and far(s, s + L, 120):
                break
        else:
            raise RuntimeError("transient placement failed")
        busy[eq].append((s, s + L + 20))
        taken.append((s, s + L))
        sr = series[eq]
        for o in range(L):
            if kind == "MATERIAL_CHANGE_TEMP":
                sr["add"]["temperature_celsius"][s + o] = 2.5 * math.sin(math.pi * (o + 1) / (L + 1))
            else:
                sr["add"]["vibration_level"][s + o] = sr["base"]["vibration_level"] * 0.7
        trans.append((eq, s, L, kind))
    return out, trans


# ---------------------------------------------------------------- 사건·품질
def find_events(series, scores, err):
    events = []
    for eq in EQS:
        sc = scores[eq]
        active = [sc[i][0] >= WARN or err[eq][i] != "NONE" for i in range(N)]
        i = 0
        while i < N:
            if not active[i]:
                i += 1
                continue
            start, last, j = i, i, i
            while j < N and j - last <= EVENT_GAP:
                if active[j]:
                    last = j
                j += 1
            events.append({"eq": eq, "start": start, "end": last})
            i = last + EVENT_GAP + 1
    return sorted(events, key=lambda e: (e["start"], e["eq"]))


SAMPLE_DEFECTS = ["치수불량", "색상편차", "강도부족", "중량편차", "표면결함"]
DEFECT_BY_CAUSE = {   # 부품별 원인 → 샘플 불량 유형
    "BODY": {"low": "중량편차", "high_p": "치수불량", "high_t": "표면결함", "rpm": "강도부족", "none": "치수불량"},
    "INNER_LID": {"low": "치수불량", "high_p": "치수불량", "high_t": "표면결함", "rpm": "강도부족", "none": "중량편차"},
    "CAP": {"low": "치수불량", "high_p": "치수불량", "high_t": "색상편차", "rpm": "강도부족", "none": "표면결함"},
}


def defect_type(part, z, i):
    zp, zt, zr = z["pressure_kpa"][i], z["temperature_celsius"][i] / 4, z["rotation_speed_rpm"][i]
    biggest = max((abs(zp), "p"), (abs(zt), "t"), (abs(zr), "r"))
    table = DEFECT_BY_CAUSE[part]
    if biggest[0] < 2.0:
        return rng.choice([table["none"], table["none"], table["low"], table["high_t"]])
    if biggest[1] == "p":
        return table["high_p"] if zp > 0 else table["low"]
    if biggest[1] == "t":
        return (rng.choice(["표면결함", "색상편차"]) if part == "CAP" else table["high_t"]) if zt > 0 else table["low"]
    return table["rpm"]


def measurement(part, status, dtype, zp):
    _, _, _, nominal, tol, _ = PARTS[part]
    sign = (1 if zp > 0 else -1) if abs(zp) > 0.5 else rng.choice([1, -1])
    if status == "정상":
        dev = max(-0.79, min(0.79, rng.gauss(0, 0.3))) * tol
    elif status == "주의":
        dev = sign * rng.uniform(0.81, 0.99) * tol
    elif dtype == "치수불량":
        dev = sign * rng.uniform(1.02, 1.35) * tol
    else:
        dev = max(-0.79, min(0.79, rng.gauss(0, 0.4))) * tol
    return round(nominal + dev, 3), round(nominal + tol, 3), round(nominal - tol, 3)


def shift_of(i):
    h = (i // 60) % 24
    return "주간" if 6 <= h < 14 else "야간" if 14 <= h < 22 else "새벽"


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    series = new_series()
    tune_log = tune_demo(series)
    demo = []
    for eq in ("EQP-001", "EQP-002", "EQP-003", "EQP-004"):
        lab = series[eq]["label"]
        s = next(i for i in range(idx(D, 12, 0), idx(D, 16, 0)) if lab[i])
        e = s
        while lab[e]:
            e += 1
        demo.append((eq, s, e - s, series[eq]["scenario"][s]))
    other, trans = plan_other(series, demo)
    windows = demo + other
    err = {eq: alarms(series[eq]) for eq in EQS}
    scores = {eq: scores_for(series[eq]) for eq in EQS}
    # 장비 상태: 구간 안 첫 알람부터 구간 끝까지 위험, 그 전은 주의
    state = {eq: ["정상"] * N for eq in EQS}
    for eq, s, L, ty in windows:
        a = next((i for i in range(s, s + L) if err[eq][i] != "NONE"), None)
        for i in range(s, s + L):
            state[eq][i] = "위험" if a is not None and i >= a else "주의"
    events = find_events(series, scores, err)

    # 점검: 시연 4대는 문서 시각, 나머지는 알림 뒤 착수·구간 뒤 완료
    for e in events:
        alarm = next((i for i in range(e["start"], e["end"] + 1) if err[e["eq"]][i] != "NONE"), None)
        if e["eq"] == "EQP-001" and e["start"] <= T_1400 <= e["end"]:
            e["started"] = T_001_INSPECT
        elif QUIET[0] <= e["start"] <= QUIET[1]:
            e["started"] = max(e["end"], T_003_ALARM if e["eq"] == "EQP-003" else e["start"]) + rng.randint(10, 20)
        else:
            e["started"] = (alarm if alarm is not None else e["start"]) + rng.randint(10, 30)
        e["completed"] = max(e["end"], e["started"]) + rng.randint(20, 50)
        e["true"] = any(series[e["eq"]]["label"][i] for i in range(e["start"], e["end"] + 1))
    op = {eq: ["가동"] * N for eq in EQS}
    for eq in EQS:
        for i in range(N):
            if err[eq][i] != "NONE":
                op[eq][i] = "이상감지"
    for e in events:
        for i in range(e["started"], min(N, e["completed"])):
            op[e["eq"]][i] = "점검중"

    # 품질
    q = {eq: ["정상"] * N for eq in EQS}
    dtype = {eq: ["NONE"] * N for eq in EQS}
    latent = {}
    for eq in EQS:
        sr = series[eq]
        z = {c: [(n + a) / sr["sd"][c] for n, a in zip(sr["noise"][c], sr["add"][c])] for c in COLS}
        sr["z"] = z
        latent[eq] = [math.sqrt(z["pressure_kpa"][i] ** 2 + (z["temperature_celsius"][i] / 4) ** 2 + 0.5 * z["rotation_speed_rpm"][i] ** 2)
                      + rng.gauss(0, 1.0) for i in range(N)]
    ev_by = {}
    for e in events:
        ev_by.setdefault(e["eq"], []).append(e)
    e001 = next(e for e in ev_by["EQP-001"] if e["start"] <= T_1400 <= e["end"])
    e003 = next(e for e in ev_by["EQP-003"] if e["start"] <= T_1405 <= e["end"])
    fixed = {}
    batch = [i for i in range(e001["start"], T_1400) if inspected_at("BODY", i) <= T_1400]
    for frac in (0.2, 0.55, 0.85):
        fixed[("EQP-001", batch[round(frac * (len(batch) - 1))])] = ("불량", "치수불량")
    fixed[("EQP-003", T_1405 - 2)] = ("불량", "표면결함")      # 14:03 생산 → 14:04 검수
    fixed[("EQP-003", idx(D, 14, 9))] = ("불량", "표면결함")    # 14:09 생산 → 14:10 검수
    protected = {(eq, i) for eq in EQS for i in range(idx(D, 11, 0), QUIET[1])}
    for (eq, i), v in fixed.items():
        q[eq][i], dtype[eq][i] = v
    rows_a = [(eq, i) for eq in EQS for i in range(N) if series[eq]["label"][i]]
    rows_n = [(eq, i) for eq in EQS for i in range(N) if not series[eq]["label"][i]]
    na, nn = len(rows_a), len(rows_n)
    tgt_a = {k: round(MULTIPLIER * v / (MULTIPLIER * na + nn) * na) for k, v in (("불량", DEFECT_ROWS), ("주의", CAUTION_ROWS))}
    targets = {"anomaly": tgt_a, "normal": {"불량": DEFECT_ROWS - tgt_a["불량"], "주의": CAUTION_ROWS - tgt_a["주의"]}}
    for name, rows in (("anomaly", rows_a), ("normal", rows_n)):
        have = {k: sum(q[eq][i] == k for eq, i in rows) for k in ("불량", "주의")}
        need_d = targets[name]["불량"] - have["불량"]
        need_c = targets[name]["주의"] - have["주의"]
        pool = sorted((p for p in rows if p not in protected and q[p[0]][p[1]] == "정상"), key=lambda p: -latent[p[0]][p[1]])
        top = pool[:3 * (need_d + need_c)]
        top.sort(key=lambda p: -(latent[p[0]][p[1]] + rng.gauss(0, 0.8)))
        for eq, i in top[:need_d]:
            q[eq][i] = "불량"
        for eq, i in top[need_d:need_d + need_c]:
            q[eq][i] = "주의"
    for eq in EQS:
        for i in range(N):
            if q[eq][i] == "불량" and dtype[eq][i] == "NONE":
                dtype[eq][i] = defect_type(PART_OF[eq], series[eq]["z"], i)

    # LOT 번호: 부품별로 생산 시작 순서대로 매겨 설비가 드러나지 않게 한다
    lot_no, counter = {}, {p: 0 for p in PARTS}
    for start, _, eq in sorted(((k * LOT_SIZE, n, eq) for n, eq in enumerate(EQS) for k in range(N // LOT_SIZE)),
                               key=lambda x: (x[0], rng.random())):
        counter[PART_OF[eq]] += 1
        lot_no[(eq, start // LOT_SIZE)] = f"{PARTS[PART_OF[eq]][1]}-{counter[PART_OF[eq]]:04d}"

    # ------------------------------------------------------------ 판정(문서 규칙)
    def impact(eq, s, t):
        done = [q[eq][i] for i in range(s, t + 1) if inspected_at(PART_OF[eq], i) <= t]
        if not done:
            return None, 0, 0
        return done.count("불량") / len(done), len(done), done.count("불량")

    def grade(e, t):
        eq = e["eq"]
        emergency = any(err[eq][i] != "NONE" for i in range(e["start"], t + 1))
        rate, n, d = impact(eq, e["start"], t)
        has = rate is not None and rate >= 0.03
        s = scores[eq][t][0]
        g = (1 if has else 2) if emergency else 3 if has else 4 if s >= 50 else 5
        return {"grade": g, "kind": "비상" if emergency else "예고", "rate": rate, "n": n, "defects": d, "score": s}

    def qstate(rate):
        return "미확인" if rate is None else "있음" if rate >= 0.03 else "없음"

    def snapshot(t):
        rows = []
        for e in events:
            if e["start"] <= t < e["completed"]:
                g = grade(e, t)
                rows.append({"equipment_id": e["eq"], "part": PARTS[PART_OF[e["eq"]]][0], "list": g["kind"], "grade": g["grade"],
                             "quality_impact": qstate(g["rate"]), "inspected_n": g["n"], "defect_n": g["defects"],
                             "defect_rate": "" if g["rate"] is None else round(g["rate"], 4),
                             "risk_level": risk_level(g["score"]), "anomaly_score": g["score"], "operation_status": op[e["eq"]][t],
                             "first_warning_at": hm(e["start"]),
                             "first_alarm_at": next((hm(i) for i in range(e["start"], t + 1) if err[e["eq"]][i] != "NONE"), "")})
        order = {"CRITICAL": 3, "HIGH": 2, "MEDIUM": 1, "LOW": 0}
        rows.sort(key=lambda r: (r["grade"], -(r["defect_rate"] or 0), -order[r["risk_level"]], -r["anomaly_score"], r["equipment_id"]))
        for kind in ("비상", "예고"):
            for k, r in enumerate([r for r in rows if r["list"] == kind], start=1):
                r["rank_in_list"] = k
        return rows

    snaps = {t: snapshot(t) for t in (T_1400, T_1405, T_1415)}

    # ------------------------------------------------------------ 자동 검사
    checks = []

    def check(name, ok, detail=""):
        checks.append({"check": name, "result": "PASS" if ok else "FAIL", "detail": detail})

    def find(t, eq):
        return next((r for r in snaps[t] if r["equipment_id"] == eq), None)

    r = find(T_1400, "EQP-001")
    check("14:00 EQP-001 비상 1등급, 점검중", bool(r) and r["list"] == "비상" and r["grade"] == 1 and r["operation_status"] == "점검중",
          str(r and (r["grade"], r["inspected_n"], r["defect_n"], r["operation_status"])))
    r = find(T_1400, "EQP-003")
    check("14:00 EQP-003 예고 4등급, 불량 0건, HIGH 이상, 가동",
          bool(r) and r["list"] == "예고" and r["grade"] == 4 and r["defect_n"] == 0 and r["risk_level"] in ("HIGH", "CRITICAL")
          and r["operation_status"] == "가동", str(r and (r["grade"], r["inspected_n"], r["defect_n"], r["risk_level"], r["operation_status"])))
    check("14:00 목록은 EQP-001·003뿐", sorted(r["equipment_id"] for r in snaps[T_1400]) == ["EQP-001", "EQP-003"],
          str([r["equipment_id"] for r in snaps[T_1400]]))
    o5 = [(r["equipment_id"], r["grade"]) for r in snaps[T_1405] if r["list"] == "비상"]
    check("14:05 비상 001(1) → 002(2) → 004(2)", o5 == [("EQP-001", 1), ("EQP-002", 2), ("EQP-004", 2)], str(o5))
    r2, r4 = find(T_1405, "EQP-002"), find(T_1405, "EQP-004")
    check("14:05 002·004 미확인, 위험도 같음, 점수 002 > 004, 이상감지",
          bool(r2 and r4) and r2["quality_impact"] == r4["quality_impact"] == "미확인" and r2["risk_level"] == r4["risk_level"]
          and r2["anomaly_score"] > r4["anomaly_score"] and r2["operation_status"] == r4["operation_status"] == "이상감지",
          str(r2 and r4 and (r2["risk_level"], r2["anomaly_score"], r4["risk_level"], r4["anomaly_score"])))
    r = find(T_1405, "EQP-003")
    check("14:05 EQP-003 예고 3등급, 24개 중 1건, 가동, 예고 목록 유일",
          bool(r) and r["list"] == "예고" and r["grade"] == 3 and (r["inspected_n"], r["defect_n"]) == (24, 1) and r["operation_status"] == "가동"
          and [x["equipment_id"] for x in snaps[T_1405] if x["list"] == "예고"] == ["EQP-003"],
          str(r and (r["grade"], r["inspected_n"], r["defect_n"], r["defect_rate"], r["operation_status"])))
    check("EQP-003 예고 첫 등재 13:41, 첫 알람 14:15", hm(e003["start"]) == "13:41" and
          hm(next(i for i in range(e003["start"], N) if err["EQP-003"][i] != "NONE")) == "14:15", hm(e003["start"]))
    check("EQP-003 14:15 전까지 가동", all(op["EQP-003"][i] == "가동" for i in range(idx(D, 12, 0), T_003_ALARM)))
    r = find(T_1415, "EQP-003")
    check("14:15 EQP-003 품질 영향 있음(34개 중 2건)", bool(r) and r["quality_impact"] == "있음" and (r["inspected_n"], r["defect_n"]) == (34, 2),
          str(r and (r["inspected_n"], r["defect_n"], r["defect_rate"])))
    check("EQP-001 13:33 첫 알람(PRESSURE_LOW), 13:58 점검중",
          hm(next(i for i in range(e001["start"], N) if err["EQP-001"][i] != "NONE")) == "13:33" and op["EQP-001"][T_001_INSPECT] == "점검중")
    r = find(T_1400, "EQP-001")
    check("14:00 EQP-001 몸체 검수 25개 중 3건(12%)", bool(r) and (r["inspected_n"], r["defect_n"]) == (25, 3), str(r and (r["inspected_n"], r["defect_n"])))
    check("EQP-002·004 14:04 첫 알람", err["EQP-002"][T_0024] == "PRESSURE_LOW" and err["EQP-004"][T_0024] == "SCREW_SPEED_LIMIT"
          and all(err[eq][i] == "NONE" for eq in ("EQP-002", "EQP-004") for i in range(idx(D, 10, 0), T_0024)))
    check("14:04 뚜껑 검수 불량 LOT → EQP-003", lot_no[("EQP-003", (T_1405 - 2) // LOT_SIZE)].startswith("CP-"),
          lot_no[("EQP-003", (T_1405 - 2) // LOT_SIZE)])
    check("시연 날 10:00~16:30 EQP-005~010 정상·가동",
          all(not series[eq]["label"][i] and err[eq][i] == "NONE" and op[eq][i] == "가동" for eq in EQS[4:] for i in range(QUIET[0], QUIET[1])))
    ns = sum(1 for eq in EQS for x in state[eq] if x != "정상")
    check("장비 이상(주의+위험) 2.82%", ns == ANOMALY_ROWS, f"{ns}/{N * 10}")
    nd = sum(x == "불량" for eq in EQS for x in q[eq])
    nc = sum(x == "주의" for eq in EQS for x in q[eq])
    check("품질 불량 1.15%, 주의+불량 2.82%", nd == DEFECT_ROWS and nd + nc == ANOMALY_ROWS, f"불량 {nd}, 주의 {nc}")
    # 새 검사
    bad = []
    for eq in EQS:
        sr = series[eq]
        vals = {c: values(sr, c) for c in THRESHOLD}
        for i in range(N):
            beyond = any(not (sr["lim"][c][0] <= vals[c][i] <= sr["lim"][c][1]) for c in THRESHOLD)
            if beyond != (err[eq][i] != "NONE"):
                bad.append((eq, i))
    check("알람은 임계값을 넘는 분에만 켜짐", not bad, f"불일치 {len(bad)}")
    outside = [(eq, i) for eq in EQS for i in range(N) if err[eq][i] != "NONE" and not series[eq]["label"][i]]
    check("정상 라벨 구간에는 알람 없음", not outside, f"{len(outside)}행")
    alarm_free = [(eq, hm(s), ty) for eq, s, L, ty in windows if all(err[eq][i] == "NONE" for i in range(s, s + L))]
    missing = [(eq, ty) for eq, s, L, ty in windows if TYPES[ty][2] and all(err[eq][i] == "NONE" for i in range(s, s + L))]
    check("알람 없는 이상 구간 1~2개, 알람형 구간은 모두 알람", 1 <= len(alarm_free) <= 2 and not missing, f"{alarm_free} / 누락 {missing}")
    fa = [e for e in events if not e["true"]]
    check("오경보 3~6건", 3 <= len(fa) <= 6, f"{len(fa)}건: {[(e['eq'], ts(e['start'])[5:16]) for e in fa]}")
    types_used = {dtype[eq][i] for eq in EQS for i in range(N) if q[eq][i] == "불량"}
    check("불량 유형은 샘플 5종 안", types_used <= set(SAMPLE_DEFECTS), str(sorted(types_used)))

    # ------------------------------------------------------------ 운영 부가 정보(샘플 스키마)
    operators = {"주간": ["OP-001", "OP-002"], "야간": ["OP-003", "OP-004"], "새벽": ["OP-005", "OP-006"]}
    inspectors = {"주간": "QC-01", "야간": "QC-02", "새벽": "QC-03"}
    maint = {}
    for n, eq in enumerate(EQS):
        last = datetime(2026, 1, 8) + timedelta(days=rng.randint(0, 20))
        hours = round(rng.uniform(1200, 3200), 1)
        done_at = sorted((e["completed"], e["true"]) for e in ev_by.get(eq, []))
        maint[eq] = {"last": [], "hours": []}
        k = 0
        for i in range(N):
            while k < len(done_at) and done_at[k][0] <= i:
                if done_at[k][1]:
                    last = T0 + timedelta(minutes=done_at[k][0])
                k += 1
            if op[eq][i] != "점검중":
                hours += 1 / 60
            maint[eq]["last"].append(last)
            maint[eq]["hours"].append(round(hours, 1))

    # ------------------------------------------------------------ 저장
    def save(name, fields, rows):
        with open(out / f"{name}.csv", "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n", extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)

    reg = []
    for n, (eq, part, mold, base) in enumerate(MACHINES):
        lim = series[eq]["lim"]
        reg.append({"equipment_id": eq, "equipment_name": f"사출기 {n + 1}", "equipment_type": "INJECTION", "part_type": part,
                    "part_name": PARTS[part][0], "process_id": mold, "dimension_name": PARTS[part][2],
                    "dimension_nominal_mm": PARTS[part][3], "dimension_tolerance_mm": PARTS[part][4],
                    "inspection_method": {"묶음": "30분 묶음 검수", "인라인1": "생산 1분 뒤 검수", "인라인2": "생산 2분 뒤 검수"}[PARTS[part][5]],
                    "baseline_pressure_kpa": base[2], "pressure_low_limit_kpa": round(lim["pressure_kpa"][0], 1),
                    "pressure_high_limit_kpa": round(lim["pressure_kpa"][1], 1), "baseline_temp_c": base[1],
                    "temp_low_limit_c": round(lim["temperature_celsius"][0], 1), "temp_high_limit_c": round(lim["temperature_celsius"][1], 1),
                    "baseline_rpm": base[4], "rpm_low_limit": round(lim["rotation_speed_rpm"][0], 1),
                    "rpm_high_limit": round(lim["rotation_speed_rpm"][1], 1),
                    "scenario_role": {"EQP-001": "비상 1등급", "EQP-002": "비상 2등급(점수 1위)", "EQP-003": "예고 4→3등급",
                                      "EQP-004": "비상 2등급(점수 2위)"}.get(eq, "정상 대조군")})
    save("equipment_registry", list(reg[0]), reg)
    status_rows, quality_rows, feed_rows, ad_rows, lot_rows, hist_rows = [], [], [], [], [], []
    for n, (eq, part, mold, _) in enumerate(MACHINES):
        sr = series[eq]
        vals = {c: values(sr, c) for c in COLS}
        for i in range(N):
            sid = f"ES-{n * N + i + 1:06d}"
            ln = lot_no[(eq, i // LOT_SIZE)]
            sh = shift_of(i)
            last = maint[eq]["last"][i]
            row = {"equip_status_id": sid, "equipment_id": eq, "process_id": mold, "part_type": part, "lot_no": ln,
                   "cycle_id": f"{eq}-C{i + 1:05d}", "operator_id": operators[sh][n % 2], "shift": sh, "recorded_at": ts(i),
                   "operation_status": op[eq][i], "error_code": err[eq][i], "operation_time_hr": maint[eq]["hours"][i],
                   "last_maintenance_dt": last.strftime("%Y-%m-%d"), "next_maintenance_dt": (last + timedelta(days=30)).strftime("%Y-%m-%d"),
                   "equipment_state": state[eq][i], "scenario_type": sr["scenario"][i]}
            for c in COLS:
                row[c] = f"{vals[c][i]:.{DECIMALS[c]}f}"
            status_rows.append(row)
            s, top = scores[eq][i]
            ad_rows.append({"anomaly_id": f"AD-{n * N + i + 1:06d}", "equip_status_id": sid,
                            "anomaly_type": {"vibration_level": "VIBRATION", "temperature_celsius": "TEMPERATURE_DEVIATION",
                                             "pressure_kpa": "PRESSURE_DEVIATION", "motor_current_amp": "CURRENT_DEVIATION",
                                             "rotation_speed_rpm": "SPEED_DEVIATION"}[top] if s >= 25 else "NONE",
                            "anomaly_score": s, "risk_level": risk_level(s), "top_feature": top if s >= 25 else "",
                            "detected_at": ts(i), "confirmed_yn": "N"})
            mv, usl, lsl = measurement(part, q[eq][i], dtype[eq][i], sr["z"]["pressure_kpa"][i])
            ia = inspected_at(part, i)
            common = {"lot_no": ln, "lot_seq": i % LOT_SIZE + 1, "part_type": part, "inspected_at": ts(ia),
                      "inspector_id": inspectors[shift_of(ia)], "measurement_value": mv, "upper_spec_limit": usl,
                      "lower_spec_limit": lsl, "defect_count": int(q[eq][i] == "불량"), "total_produced": 1,
                      "quality_status": q[eq][i], "defect_type": dtype[eq][i]}
            quality_rows.append({"quality_id": f"QM-{n * N + i + 1:06d}", "equip_status_id": sid, "equipment_id": eq,
                                 "process_id": mold, "cycle_id": row["cycle_id"], "produced_at": ts(i), **common})
            if ia < N:
                feed_rows.append({"inspection_record_id": None, **common})
        for k in range(N // LOT_SIZE):
            seg = range(k * LOT_SIZE, (k + 1) * LOT_SIZE)
            d = sum(q[eq][i] == "불량" for i in seg)
            ms = [float(quality_rows[n * N + i]["measurement_value"]) for i in seg]
            mu, sd = st.mean(ms), st.pstdev(ms)
            _, _, _, nominal, tol, _ = PARTS[part]
            cpk = min(nominal + tol - mu, mu - nominal + tol) / (3 * sd) if sd else ""
            hist_rows.append({"lot_no": lot_no[(eq, k)], "equipment_id": eq, "part_type": part, "process_id": mold,
                              "production_start": ts(k * LOT_SIZE), "production_end": ts((k + 1) * LOT_SIZE - 1), "quantity": LOT_SIZE})
            lot_rows.append({"lot_no": lot_no[(eq, k)], "part_type": part, "process_id": mold, "total_produced": LOT_SIZE,
                             "defect_count": d, "caution_count": sum(q[eq][i] == "주의" for i in seg), "defect_rate": round(d / LOT_SIZE, 4),
                             "cpk_value": round(cpk, 3) if cpk != "" else "",
                             "quality_status": "불량" if d / LOT_SIZE >= 0.08 else "주의" if d / LOT_SIZE >= 0.03 else "정상"})
    feed_rows.sort(key=lambda r: (r["inspected_at"], r["lot_no"], r["lot_seq"]))
    for k, r in enumerate(feed_rows, start=1):
        r["inspection_record_id"] = f"IR-{k:06d}"
    hist_rows.sort(key=lambda r: (r["part_type"], r["lot_no"]))
    lot_rows.sort(key=lambda r: (r["part_type"], r["lot_no"]))

    checks_text = {"PRESSURE_DEVIATION": "사출 압력·유압 회로·체크 링 점검", "TEMPERATURE_DEVIATION": "배럴 히터·열전대 점검",
                   "SPEED_DEVIATION": "스크류 구동부·모터 점검", "VIBRATION": "베어링·체결 볼트 점검", "CURRENT_DEVIATION": "모터 부하·전원 점검"}
    ftype = {"vibration_level": "VIBRATION", "temperature_celsius": "TEMPERATURE_DEVIATION", "pressure_kpa": "PRESSURE_DEVIATION",
             "motor_current_amp": "CURRENT_DEVIATION", "rotation_speed_rpm": "SPEED_DEVIATION"}
    actions = {"PRESSURE_RISE": "유압 밸브 씰 교체, 사출 압력 재설정", "PRESSURE_DROP": "체크 링 교체, 사출 압력 복구",
               "PRESSURE_SUDDEN_DROP": "노즐·체크 링 교체", "BARREL_TEMP_RISE": "배럴 온도 제어기·열전대 교체",
               "BARREL_TEMP_DROP": "배럴 히터 밴드 교체", "SCREW_SPEED_UNSTABLE": "스크류 구동 인버터 점검·조정",
               "SCREW_SPEED_DROP": "스크류 구동부 정비", "BEARING_WEAR": "베어링 교체", "PRESSURE_TEMP_DROP": "히터 밴드·체크 링 교체",
               "SLOW_TEMP_DRIFT": "배럴 온도 제어기 보정"}
    guide = []
    for k, e in enumerate(events, start=1):
        sr = series[e["eq"]]
        true = [i for i in range(e["start"], e["end"] + 1) if sr["label"][i]]
        done = e["completed"] < N
        horizon = e["completed"] if done else N - 1
        g0 = grade(e, e["start"])
        best, best_t = g0, e["start"]
        for t in range(e["start"] + 1, horizon + 1):
            g = grade(e, t)
            if g["grade"] < best["grade"]:
                best, best_t = g, t
        peak = max(range(e["start"], e["end"] + 1), key=lambda i: scores[e["eq"]][i][0])
        guide.append({"inspection_id": f"IG-{k:04d}", "anomaly_id": f"AD-{EQS.index(e['eq']) * N + e['start'] + 1:06d}",
                      "equipment_id": e["eq"], "initial_alert_kind": g0["kind"], "final_alert_kind": grade(e, horizon)["kind"],
                      "initial_grade": g0["grade"], "priority_grade": best["grade"],
                      "urgency": {1: "즉시", 2: "즉시", 3: "금일내", 4: "금일내", 5: "관찰"}[best["grade"]],
                      "quality_impact": qstate(best["rate"]), "inspected_n": best["n"], "defect_n": best["defects"],
                      "defect_rate": "" if best["rate"] is None else round(best["rate"], 4),
                      "check_items": checks_text[ftype[scores[e["eq"]][peak][1]]],
                      "assigned_inspector": ["OP-001", "OP-002", "OP-003", "OP-004", "OP-005", "OP-006"][k % 6],
                      "created_at": ts(e["start"]), "updated_at": ts(best_t),
                      "started_at": ts(e["started"]) if e["started"] < N else "", "completed_dt": ts(e["completed"]) if done else "",
                      "inspection_result": ("조치완료" if true else "이상없음") if done else ("점검중" if e["started"] < N else "대기"),
                      "action_taken": (actions[sr["scenario"][true[0]]] if true else "이상 없음 확인(일시 변동)") if done else ""})

    sensor_fields = (["equip_status_id", "equipment_id", "process_id", "part_type", "lot_no", "cycle_id", "operator_id", "shift",
                      "recorded_at", "operation_status", "error_code"] + COLS +
                     ["operation_time_hr", "last_maintenance_dt", "next_maintenance_dt", "equipment_state", "scenario_type"])
    save("equipment_status", sensor_fields, status_rows)
    save("quality_metrics", list(quality_rows[0]), quality_rows)
    save("lot_inspection_feed", list(feed_rows[0]), feed_rows)
    save("lot_history", list(hist_rows[0]), hist_rows)
    save("quality_lot_summary", list(lot_rows[0]), lot_rows)
    save("anomaly_detection", list(ad_rows[0]), ad_rows)
    save("inspection_guide", list(guide[0]), guide)
    snap_fields = ["list", "rank_in_list", "equipment_id", "part", "grade", "operation_status", "first_warning_at", "first_alarm_at",
                   "quality_impact", "inspected_n", "defect_n", "defect_rate", "risk_level", "anomaly_score"]
    for t in (T_1400, T_1405, T_1415):
        save(f"demo_snapshot_20260203_{hm(t).replace(':', '')}", snap_fields, snaps[t])
    save("scenario_checks", ["check", "result", "detail"], checks)
    with open(out / "windows.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["equipment_id", "start_at", "minutes", "scenario_type", "label", "alarm_expected", "first_alarm_at", "demo"])
        for eq, s, L, ty in sorted(windows, key=lambda x: x[1]):
            a = next((i for i in range(s, s + L) if err[eq][i] != "NONE"), None)
            w.writerow([eq, ts(s), L, ty, 1, int(TYPES[ty][2]), ts(a) if a is not None else "",
                        int((eq, s) in {(d[0], d[1]) for d in demo})])
        for eq, s, L, kind in sorted(trans, key=lambda x: x[1]):
            w.writerow([eq, ts(s), L, kind, 0, 0, "", 0])
    print("tuning:", tune_log, "BODY_OFFSET", BODY_OFFSET)
    print("events", len(events), "false", len([e for e in events if not e["true"]]), "targets", targets)
    for c in checks:
        print(c["result"], c["check"], c["detail"])


if __name__ == "__main__":
    main()
