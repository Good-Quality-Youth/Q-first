"""v7 데이터에 고정한 장비 이상 모델을 적용하고, 시연 4대의 시연 구간 센서만 문서 조건에 맞게 다시 맞춰 v7.1을 만든다.

- 모델은 anomaly_model_v7.py에서 성능으로 고른 종류·설정(model_choice.json)을 v7 학습 구간 정상 행으로 다시 학습해 고정한다.
  시연 구간은 이상 라벨이라 학습에 쓰이지 않으므로, 시연 구간 센서를 바꿔도 모델은 그대로다.
- 바꾸는 것: EQP-001·002·003·004의 시연 구간(02-03) 센서값과 그에 따른 error_code·장비 상태.
  이상 구간의 시작·길이(라벨 행 수), 품질 데이터, LOT, 다른 설비의 센서는 v7 그대로다.
- 다시 계산하는 것: anomaly_detection(모델 점수), 알림 사건, 점검 이력, 운영 상태, 정비일, 시연 스냅숏, 검사.

사용: python3 retune_demo_v71.py <qfirst_dataset_v7 폴더> <model_choice.json> <출력 폴더>
"""
import csv
import json
import math
import random
import shutil
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import anomaly_model_v7 as am  # noqa: E402

SEED = 20261114
N, TAIL, WARN, GAP = 5000, 8, 40, 10
T0 = datetime(2026, 2, 2)
SENS = am.SENSORS
NOISE = {"vibration_level": 0.90, "temperature_celsius": 0.35, "pressure_kpa": 0.0095, "motor_current_amp": 1.08,
         "rotation_speed_rpm": 2.35}
rng = random.Random(SEED)
nrng = np.random.default_rng(SEED)


def idx(d, h, m):
    return d * 1440 + h * 60 + m


def ts(i):
    return (T0 + timedelta(minutes=int(i))).strftime("%Y-%m-%dT%H:%M:%SZ")


def hm(i):
    return ts(i)[11:16]


D = 1
T_001, T_001_ALARM, T_001_INSPECT = idx(D, 13, 25), idx(D, 13, 33), idx(D, 13, 58)
T_001_WARN = idx(D, 13, 26)           # v7 몸체 묶음 검수 시각(:21~:50 → :51~:57)과 맞물려 14:00에 25개가 되도록
T_003_WARN, T_003_ALARM = idx(D, 13, 41), idx(D, 14, 15)
T_0024 = idx(D, 14, 4)
T_1400, T_1405, T_1415 = idx(D, 14, 0), idx(D, 14, 5), idx(D, 14, 15)
QUIET = (idx(D, 10, 0), idx(D, 16, 30))
DEMO_REGION = (idx(D, 12, 0), idx(D, 16, 0))


def read(path):
    return pd.read_csv(path, dtype=str, keep_default_na=False)


def main():
    src, choice_path, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    choice = json.loads(choice_path.read_text(encoding="utf-8"))
    eqs, data, windows = am.load(src)
    model = am.AnomalyModel(choice["kind"], choice["params"]).fit(eqs, data)
    assert abs(model.cal - choice["cal_raw_at_40"]) < 1e-9, "모델 재학습 결과가 다릅니다"

    es = read(src / "equipment_status.csv")
    reg = read(src / "equipment_registry.csv").set_index("equipment_id")
    qm = read(src / "quality_metrics.csv")
    base = {eq: {"vibration_level": None, "temperature_celsius": float(reg.loc[eq, "baseline_temp_c"]),
                 "pressure_kpa": float(reg.loc[eq, "baseline_pressure_kpa"]), "rotation_speed_rpm": float(reg.loc[eq, "baseline_rpm"])}
            for eq in eqs}
    lim = {eq: {"pressure_kpa": (float(reg.loc[eq, "pressure_low_limit_kpa"]), float(reg.loc[eq, "pressure_high_limit_kpa"])),
                "temperature_celsius": (float(reg.loc[eq, "temp_low_limit_c"]), float(reg.loc[eq, "temp_high_limit_c"])),
                "rotation_speed_rpm": (float(reg.loc[eq, "rpm_low_limit"]), float(reg.loc[eq, "rpm_high_limit"]))} for eq in eqs}
    rows = {eq: es[es["equipment_id"] == eq].sort_values("recorded_at").reset_index(drop=True) for eq in eqs}
    x = {eq: data[eq]["x"].copy() for eq in eqs}
    # 진동·전류 평소 값은 v7 학습 구간 정상 행 중앙값으로 둔다(레지스트리에 없음)
    for eq in eqs:
        m = am.AnomalyModel.train_mask(data[eq])
        base[eq]["vibration_level"] = float(np.median(x[eq][m, 0]))
        base[eq]["motor_current_amp"] = float(np.median(x[eq][m, 3]))
    demo_w = {w["eq"]: w for w in windows if w["demo"]}

    def alarms(eq):
        v = x[eq]
        out = np.array(["NONE"] * N, dtype=object)
        for i in range(N):
            for c, code_lo, code_hi in (("pressure_kpa", "PRESSURE_LOW", "PRESSURE_HIGH"),
                                        ("temperature_celsius", "TEMP_LIMIT", "TEMP_LIMIT"),
                                        ("rotation_speed_rpm", "SCREW_SPEED_LIMIT", "SCREW_SPEED_LIMIT")):
                lo, hi = lim[eq][c]
                val = v[i, SENS.index(c)]
                if val < lo or val > hi:
                    out[i] = code_lo if val < lo else code_hi
                    break
        return out

    def rewrite(eq, curve, L, start):
        """시연 구간과 회복 TAIL을 평소 값 + 새 노이즈 + 곡선으로 다시 쓴다(%·℃ 단위 곡선)."""
        b = base[eq]
        last = curve(L - 1)
        for o in range(L + TAIL):
            i = start + o
            d = curve(o) if o < L else {c: v * 0.4 * (L + TAIL - o) / (TAIL + 1) for c, v in last.items()}
            if eq == "EQP-004" and o >= L:
                d = {}
            for j, c in enumerate(SENS):
                sd = NOISE[c] * (b[c] if c == "pressure_kpa" else 1)
                add = d.get(c, 0.0)
                add = add if c == "temperature_celsius" else b[c] * add / 100
                x[eq][i, j] = b[c] + nrng.normal(0, sd) + add

    def score(eq):
        return model.score(eq, x[eq])

    def first(arr, a, b, cond):
        return next((i for i in range(a, b) if cond(arr[i])), None)

    log = {}
    # EQP-001: 13:25 압력·배럴 온도 동시 저하, 13:26 예고, 13:33 첫 압력 하한 이탈
    w = demo_w["EQP-001"]
    done = False
    # 압력은 시작 p0%에서 8분 뒤(13:33) 하한 바로 밖(−10.4%)까지 내려간 뒤 p1%로, 배럴 온도는 t0℃에서 t1℃로 내려간다
    def p_curve(o, p0, p1):
        return p0 + (-10.4 - p0) * o / 8 if o <= 8 else -10.4 + (p1 + 10.4) * (o - 8) / (w["L"] - 9)
    for p0 in (-3, -4, -5, -6, -7):
        for p1 in (-14, -16):
            for t0 in (-0.5, -1.0, -1.5, -2.0):
                for t1 in (-4.0, -4.3):
                    for _ in range(6):
                        rewrite("EQP-001", lambda o, p0=p0, p1=p1, t0=t0, t1=t1: {
                            "pressure_kpa": p_curve(o, p0, p1), "temperature_celsius": t0 + (t1 - t0) * o / (w["L"] - 1),
                            "motor_current_amp": -3 * o / (w["L"] - 1)}, w["L"], w["s"])
                        sc, al = score("EQP-001"), alarms("EQP-001")
                        if (first(sc, QUIET[0], T_001 + 10, lambda v: v >= WARN) == T_001_WARN
                                and first(al, QUIET[0], T_001 + 20, lambda v: v != "NONE") == T_001_ALARM and al[T_001_ALARM] == "PRESSURE_LOW"):
                            log["EQP-001"] = f"압력 {p0}%→{p1}%, 배럴 온도 {t0}→{t1}℃"
                            done = True
                            break
                    if done:
                        break
                if done:
                    break
            if done:
                break
        if done:
            break
    if not done:
        raise RuntimeError("EQP-001")
    # EQP-003: 13:11 시작(길이 v7 그대로), 13:41 첫 예고, 14:00 HIGH 이상, 14:15 첫 +5℃ 이탈
    w = demo_w["EQP-003"]
    La = T_003_ALARM - w["s"]
    done = False
    for power in (1.9, 2.0, 2.1, 2.2, 2.3, 2.4):
        for a_val in (5.2, 5.4, 5.6):
            def curve(o, power=power, a_val=a_val):
                t = a_val * (o / La) ** power if o <= La else a_val + (8.0 - a_val) * (o - La) / (w["L"] - La)
                return {"temperature_celsius": t, "motor_current_amp": -3 * min(1, o / La)}
            for _ in range(40):
                rewrite("EQP-003", curve, w["L"], w["s"])
                sc, al = score("EQP-003"), alarms("EQP-003")
                # 예고 첫 등재 13:41, 14:00 HIGH 이상, 14:15 첫 알람, 그리고 13:41~14:15가 끊기지 않는 한 사건(10분 규칙)
                one_event = any(s <= T_003_WARN and e >= T_1415 for s, e in am.episodes((sc >= WARN) | (al != "NONE")))
                if (first(sc, QUIET[0], T_1405, lambda v: v >= WARN) == T_003_WARN and sc[T_1400] >= 50
                        and first(al, QUIET[0], T_003_ALARM + 10, lambda v: v != "NONE") == T_003_ALARM and one_event):
                    log["EQP-003"] = f"진행 지수 {power}, 14:15 +{a_val}℃, 14:00 점수 {sc[T_1400]:.1f}"
                    done = True
                    break
            if done:
                break
        if done:
            break
    if not done:
        raise RuntimeError("EQP-003")
    # EQP-002 압력 급저하 / EQP-004 스크류 회전 불안정: 14:04 시작·이탈, 14:05 위험도 같고 점수 002 > 004
    w2, w4 = demo_w["EQP-002"], demo_w["EQP-004"]
    done = False
    for k2 in (12, 14, 16, 18, 20, 24):
        rewrite("EQP-002", lambda o, k2=k2: {"pressure_kpa": -k2, "motor_current_amp": -4}, w2["L"], w2["s"])
        sc2, al2 = score("EQP-002"), alarms("EQP-002")
        if al2[T_0024] != "PRESSURE_LOW" or any(v != "NONE" for v in al2[QUIET[0]:T_0024]):
            continue
        a = sc2[T_1405]
        for k4 in range(17, 60):
            for _ in range(3):
                rewrite("EQP-004", lambda o, k4=k4: {"rotation_speed_rpm": k4 * (0.85 + 0.15 * o / (w4["L"] - 1)) * (1 if o % 2 == 0 else -1),
                                                     "vibration_level": 25}, w4["L"], w4["s"])
                sc4, al4 = score("EQP-004"), alarms("EQP-004")
                b = sc4[T_1405]
                if (al4[T_0024] == al4[T_1405] == "SCREW_SPEED_LIMIT" and al2[T_1405] == "PRESSURE_LOW"
                        and not any(v != "NONE" for v in al4[QUIET[0]:T_0024])
                        and am_risk(a) == am_risk(b) and a - b >= 1):
                    log["EQP-002/004"] = f"002 압력 −{k2}% 점수 {a:.1f} / 004 RPM ±{k4}% 점수 {b:.1f} ({am_risk(a)})"
                    done = True
                    break
            if done:
                break
        if done:
            break
    if not done:
        raise RuntimeError("EQP-002/004")

    # ------------------------------------------------------------ 다시 계산
    err = {eq: alarms(eq) for eq in eqs}
    scores = {eq: score(eq) for eq in eqs}
    tops = {eq: model.top_feature(eq, x[eq]) for eq in eqs}
    label = {eq: data[eq]["label"] for eq in eqs}
    state = {eq: rows[eq]["equipment_state"].to_numpy(dtype=object).copy() for eq in eqs}
    for eq, w in demo_w.items():
        a = next((i for i in range(w["s"], w["s"] + w["L"]) if err[eq][i] != "NONE"), None)
        for i in range(w["s"], w["s"] + w["L"]):
            state[eq][i] = "위험" if a is not None and i >= a else "주의"

    events = []
    for eq in eqs:
        for s, e in am.episodes((scores[eq] >= WARN) | (err[eq] != "NONE")):
            events.append({"eq": eq, "start": s, "end": e, "true": bool(label[eq][s:e + 1].any())})
    events.sort(key=lambda e: (e["start"], e["eq"]))
    for e in events:
        alarm = next((i for i in range(e["start"], e["end"] + 1) if err[e["eq"]][i] != "NONE"), None)
        if e["eq"] == "EQP-001" and e["start"] <= T_1400 <= e["end"]:
            e["started"] = T_001_INSPECT
        elif QUIET[0] <= e["start"] <= QUIET[1]:
            e["started"] = max(e["end"], T_003_ALARM if e["eq"] == "EQP-003" else e["start"]) + rng.randint(10, 20)
        else:
            e["started"] = (alarm if alarm is not None else e["start"]) + rng.randint(10, 30)
        e["completed"] = max(e["end"], e["started"]) + rng.randint(20, 50)
    op = {eq: np.where(err[eq] != "NONE", "이상감지", "가동").astype(object) for eq in eqs}
    for e in events:
        op[e["eq"]][e["started"]:min(N, e["completed"])] = "점검중"

    # 품질(v7 그대로): 설비별 사이클 순서의 상태와 검수 시각
    qby = {eq: qm[qm["equipment_id"] == eq].sort_values("produced_at").reset_index(drop=True) for eq in eqs}
    qstat = {eq: qby[eq]["quality_status"].to_numpy() for eq in eqs}
    qinsp = {eq: np.array([int((datetime.strptime(t, "%Y-%m-%dT%H:%M:%SZ") - T0).total_seconds() // 60)
                           for t in qby[eq]["inspected_at"]]) for eq in eqs}

    def impact(eq, s, t):
        sel = [qstat[eq][i] for i in range(s, t + 1) if qinsp[eq][i] <= t]
        if not sel:
            return None, 0, 0
        d = sel.count("불량")
        return d / len(sel), len(sel), d

    def grade(e, t):
        eq = e["eq"]
        emergency = bool((err[eq][e["start"]:t + 1] != "NONE").any())
        rate, n, d = impact(eq, e["start"], t)
        has = rate is not None and rate >= 0.03
        s = float(scores[eq][t])
        g = (1 if has else 2) if emergency else 3 if has else 4 if s >= 50 else 5
        return {"grade": g, "kind": "비상" if emergency else "예고", "rate": rate, "n": n, "defects": d, "score": round(s, 1)}

    def qs(rate):
        return "미확인" if rate is None else "있음" if rate >= 0.03 else "없음"

    def snapshot(t):
        out_rows = []
        for e in events:
            if e["start"] <= t < e["completed"]:
                g = grade(e, t)
                out_rows.append({"equipment_id": e["eq"], "part": reg.loc[e["eq"], "part_name"], "list": g["kind"], "grade": g["grade"],
                                 "operation_status": op[e["eq"]][t], "first_warning_at": hm(e["start"]),
                                 "first_alarm_at": next((hm(i) for i in range(e["start"], t + 1) if err[e["eq"]][i] != "NONE"), ""),
                                 "quality_impact": qs(g["rate"]), "inspected_n": g["n"], "defect_n": g["defects"],
                                 "defect_rate": "" if g["rate"] is None else round(g["rate"], 4),
                                 "risk_level": am_risk(g["score"]), "anomaly_score": g["score"]})
        order = {"CRITICAL": 3, "HIGH": 2, "MEDIUM": 1, "LOW": 0}
        out_rows.sort(key=lambda r: (r["grade"], -(r["defect_rate"] or 0), -order[r["risk_level"]], -r["anomaly_score"], r["equipment_id"]))
        for kind in ("비상", "예고"):
            for k, r in enumerate([r for r in out_rows if r["list"] == kind], start=1):
                r["rank_in_list"] = k
        return out_rows

    snaps = {t: snapshot(t) for t in (T_1400, T_1405, T_1415)}

    # ------------------------------------------------------------ 검사(v7과 같은 항목 + 모델 지표)
    checks = []

    def check(name, ok, detail=""):
        checks.append({"check": name, "result": "PASS" if ok else "FAIL", "detail": detail})

    def find(t, eq):
        return next((r for r in snaps[t] if r["equipment_id"] == eq), None)

    e001 = next(e for e in events if e["eq"] == "EQP-001" and e["start"] <= T_1400 <= e["end"])
    e003 = next(e for e in events if e["eq"] == "EQP-003" and e["start"] <= T_1405 <= e["end"])
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
          and [z["equipment_id"] for z in snaps[T_1405] if z["list"] == "예고"] == ["EQP-003"],
          str(r and (r["grade"], r["inspected_n"], r["defect_n"], r["defect_rate"], r["operation_status"])))
    check("EQP-003 예고 첫 등재 13:41, 첫 알람 14:15", hm(e003["start"]) == "13:41"
          and hm(next(i for i in range(e003["start"], N) if err["EQP-003"][i] != "NONE")) == "14:15", hm(e003["start"]))
    check("EQP-003 14:15 전까지 가동", all(op["EQP-003"][i] == "가동" for i in range(idx(D, 12, 0), T_003_ALARM)))
    r = find(T_1415, "EQP-003")
    check("14:15 EQP-003 품질 영향 있음(34개 중 2건)", bool(r) and r["quality_impact"] == "있음" and (r["inspected_n"], r["defect_n"]) == (34, 2),
          str(r and (r["inspected_n"], r["defect_n"], r["defect_rate"])))
    check("EQP-001 13:33 첫 알람(PRESSURE_LOW), 13:58 점검중",
          hm(next(i for i in range(e001["start"], N) if err["EQP-001"][i] != "NONE")) == "13:33" and op["EQP-001"][T_001_INSPECT] == "점검중")
    r = find(T_1400, "EQP-001")
    check("14:00 EQP-001 몸체 검수 25개 중 3건(12%)", bool(r) and (r["inspected_n"], r["defect_n"]) == (25, 3), str(r and (r["inspected_n"], r["defect_n"])))
    check("EQP-002·004 14:04 첫 알람", err["EQP-002"][T_0024] == "PRESSURE_LOW" and err["EQP-004"][T_0024] == "SCREW_SPEED_LIMIT"
          and all(err[eq][i] == "NONE" for eq in ("EQP-002", "EQP-004") for i in range(QUIET[0], T_0024)))
    lot003 = rows["EQP-003"].loc[T_1405 - 2, "lot_no"]
    hist = read(src / "lot_history.csv").set_index("lot_no")
    check("14:04 뚜껑 검수 불량 LOT → EQP-003", hist.loc[lot003, "equipment_id"] == "EQP-003", lot003)
    check("시연 날 10:00~16:30 EQP-005~010 정상·가동",
          all(not label[eq][i] and err[eq][i] == "NONE" and op[eq][i] == "가동" for eq in eqs[4:] for i in range(QUIET[0], QUIET[1])))
    ns = sum(int((state[eq] != "정상").sum()) for eq in eqs)
    check("장비 이상(주의+위험) 2.82%", ns == 1410, f"{ns}/50000")
    nd = int((qm["quality_status"] == "불량").sum())
    nc = int((qm["quality_status"] == "주의").sum())
    check("품질 불량 1.15%, 주의+불량 2.82%", nd == 575 and nd + nc == 1410, f"불량 {nd}, 주의 {nc}")
    def beyond(eq):
        v, lm = x[eq], lim[eq]
        return ((v[:, 2] < lm["pressure_kpa"][0]) | (v[:, 2] > lm["pressure_kpa"][1])
                | (v[:, 1] < lm["temperature_celsius"][0]) | (v[:, 1] > lm["temperature_celsius"][1])
                | (v[:, 4] < lm["rotation_speed_rpm"][0]) | (v[:, 4] > lm["rotation_speed_rpm"][1]))
    bad = sum(int((beyond(eq) != (err[eq] != "NONE")).sum()) for eq in eqs)
    check("알람은 임계값을 넘는 분에만 켜짐", bad == 0, f"불일치 {bad}")
    outside = sum(int(((err[eq] != "NONE") & ~label[eq]).sum()) for eq in eqs)
    check("정상 라벨 구간에는 알람 없음", outside == 0, f"{outside}행")
    free = [w for w in windows if w["label"] == 1 and all(err[w["eq"]][i] == "NONE" for i in range(w["s"], w["s"] + w["L"]))]
    check("알람 없는 이상 구간 2개", len(free) == 2, str([(w["eq"], w["type"]) for w in free]))
    check("라벨이 정상인 짧은 변동 5개(오경보 후보)", sum(1 for w in windows if w["label"] == 0) == 5)
    types_used = set(qm.loc[qm["quality_status"] == "불량", "defect_type"])
    check("불량 유형은 샘플 5종 안", types_used <= {"치수불량", "색상편차", "강도부족", "중량편차", "표면결함"}, str(sorted(types_used)))

    # ------------------------------------------------------------ 저장
    out_status = es.copy()
    for eq in eqs:
        idxs = out_status.index[out_status["equipment_id"] == eq]
        order = out_status.loc[idxs].sort_values("recorded_at").index
        dec = {"vibration_level": 2, "temperature_celsius": 2, "pressure_kpa": 1, "motor_current_amp": 2, "rotation_speed_rpm": 1}
        for j, c in enumerate(SENS):
            out_status.loc[order, c] = [f"{v:.{dec[c]}f}" for v in x[eq][:, j]]
        out_status.loc[order, "error_code"] = err[eq]
        out_status.loc[order, "operation_status"] = op[eq]
        out_status.loc[order, "equipment_state"] = state[eq]
        # 정비일·누적 가동 시간: 조치완료된 점검이 끝날 때 갱신, 점검중에는 가동 시간이 늘지 않음
        r0 = rows[eq].iloc[0]
        last = datetime.strptime(r0["last_maintenance_dt"], "%Y-%m-%d")
        hours = float(r0["operation_time_hr"])
        done_list = sorted((e["completed"], e["true"]) for e in events if e["eq"] == eq)
        lasts, hrs, k = [], [], 0
        for i in range(N):
            while k < len(done_list) and done_list[k][0] <= i:
                if done_list[k][1]:
                    last = T0 + timedelta(minutes=done_list[k][0])
                k += 1
            if i and op[eq][i] != "점검중":
                hours += 1 / 60
            lasts.append(last)
            hrs.append(round(hours, 1))
        out_status.loc[order, "operation_time_hr"] = [f"{h:.1f}" for h in hrs]
        out_status.loc[order, "last_maintenance_dt"] = [d.strftime("%Y-%m-%d") for d in lasts]
        out_status.loc[order, "next_maintenance_dt"] = [(d + timedelta(days=30)).strftime("%Y-%m-%d") for d in lasts]
    out_status.to_csv(out / "equipment_status.csv", index=False, encoding="utf-8-sig")

    ad = []
    ftype = {"vibration_level": "VIBRATION", "temperature_celsius": "TEMPERATURE_DEVIATION", "pressure_kpa": "PRESSURE_DEVIATION",
             "motor_current_amp": "CURRENT_DEVIATION", "rotation_speed_rpm": "SPEED_DEVIATION"}
    for eq in eqs:
        sids = rows[eq]["equip_status_id"]
        for i in range(N):
            s = round(float(scores[eq][i]), 1)
            ad.append({"anomaly_id": "AD" + sids[i][2:], "equip_status_id": sids[i], "anomaly_type": ftype[tops[eq][i]] if s >= 25 else "NONE",
                       "anomaly_score": s, "risk_level": am_risk(s), "top_feature": tops[eq][i] if s >= 25 else "",
                       "detected_at": rows[eq].loc[i, "recorded_at"], "confirmed_yn": "N"})
    pd.DataFrame(ad).to_csv(out / "anomaly_detection.csv", index=False, encoding="utf-8-sig")

    checks_text = {"PRESSURE_DEVIATION": "사출 압력·유압 회로·체크 링 점검", "TEMPERATURE_DEVIATION": "배럴 히터·열전대 점검",
                   "SPEED_DEVIATION": "스크류 구동부·모터 점검", "VIBRATION": "베어링·체결 볼트 점검", "CURRENT_DEVIATION": "모터 부하·전원 점검"}
    actions = {"PRESSURE_RISE": "유압 밸브 씰 교체, 사출 압력 재설정", "PRESSURE_DROP": "체크 링 교체, 사출 압력 복구",
               "PRESSURE_SUDDEN_DROP": "노즐·체크 링 교체", "BARREL_TEMP_RISE": "배럴 온도 제어기·열전대 교체",
               "BARREL_TEMP_DROP": "배럴 히터 밴드 교체", "SCREW_SPEED_UNSTABLE": "스크류 구동 인버터 점검·조정",
               "SCREW_SPEED_DROP": "스크류 구동부 정비", "BEARING_WEAR": "베어링 교체", "PRESSURE_TEMP_DROP": "히터 밴드·체크 링 교체",
               "SLOW_TEMP_DRIFT": "배럴 온도 제어기 보정"}
    scen = {eq: rows[eq]["scenario_type"].to_numpy() for eq in eqs}
    guide = []
    for k, e in enumerate(events, start=1):
        eq = e["eq"]
        done = e["completed"] < N
        horizon = e["completed"] if done else N - 1
        g0 = grade(e, e["start"])
        best, best_t = g0, e["start"]
        for t in range(e["start"] + 1, horizon + 1):
            g = grade(e, t)
            if g["grade"] < best["grade"]:
                best, best_t = g, t
        peak = max(range(e["start"], e["end"] + 1), key=lambda i: scores[eq][i])
        true_rows = [i for i in range(e["start"], e["end"] + 1) if label[eq][i]]
        guide.append({"inspection_id": f"IG-{k:04d}", "anomaly_id": "AD" + rows[eq].loc[e["start"], "equip_status_id"][2:], "equipment_id": eq,
                      "initial_alert_kind": g0["kind"], "final_alert_kind": grade(e, horizon)["kind"], "initial_grade": g0["grade"],
                      "priority_grade": best["grade"], "urgency": {1: "즉시", 2: "즉시", 3: "금일내", 4: "금일내", 5: "관찰"}[best["grade"]],
                      "quality_impact": qs(best["rate"]), "inspected_n": best["n"], "defect_n": best["defects"],
                      "defect_rate": "" if best["rate"] is None else round(best["rate"], 4),
                      "check_items": checks_text[ftype[tops[eq][peak]]],
                      "assigned_inspector": ["OP-001", "OP-002", "OP-003", "OP-004", "OP-005", "OP-006"][k % 6],
                      "created_at": ts(e["start"]), "updated_at": ts(best_t), "started_at": ts(e["started"]) if e["started"] < N else "",
                      "completed_dt": ts(e["completed"]) if done else "",
                      "inspection_result": ("조치완료" if true_rows else "이상없음") if done else ("점검중" if e["started"] < N else "대기"),
                      "action_taken": (actions[scen[eq][true_rows[0]]] if true_rows else "이상 없음 확인(일시 변동)") if done else ""})
    pd.DataFrame(guide).to_csv(out / "inspection_guide.csv", index=False, encoding="utf-8-sig")
    snap_fields = ["list", "rank_in_list", "equipment_id", "part", "grade", "operation_status", "first_warning_at", "first_alarm_at",
                   "quality_impact", "inspected_n", "defect_n", "defect_rate", "risk_level", "anomaly_score"]
    for t, rws in snaps.items():
        pd.DataFrame(rws, columns=snap_fields).to_csv(out / f"demo_snapshot_20260203_{hm(t).replace(':', '')}.csv", index=False, encoding="utf-8-sig")
    pd.DataFrame(checks).to_csv(out / "scenario_checks.csv", index=False, encoding="utf-8-sig")
    # 바뀌지 않는 파일은 그대로 복사, windows.csv는 시연 구간 첫 알람 시각만 갱신
    for f in ("equipment_registry.csv", "quality_metrics.csv", "lot_inspection_feed.csv", "lot_history.csv", "quality_lot_summary.csv"):
        shutil.copy(src / f, out / f)
    win = read(src / "windows.csv")
    for i, r in win.iterrows():
        if r["demo"] == "1":
            s = am.minute(r["start_at"])
            a = next((j for j in range(s, s + int(r["minutes"])) if err[r["equipment_id"]][j] != "NONE"), None)
            win.loc[i, "first_alarm_at"] = ts(a) if a is not None else ""
    win.to_csv(out / "windows.csv", index=False, encoding="utf-8-sig")

    fa = [e for e in events if not e["true"]]
    print("tuning:", log)
    print("events", len(events), "true", len(events) - len(fa), "false", len(fa))
    for c in checks:
        print(c["result"], c["check"], c["detail"])


def am_risk(s):
    return "LOW" if s < 25 else "MEDIUM" if s < 50 else "HIGH" if s < 75 else "CRITICAL"


if __name__ == "__main__":
    main()
