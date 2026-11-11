"""v7 품질 데이터를 무작위 없이 센서 편차로만 다시 정한다(v7.2용 입력 폴더를 만든다).

- 제품마다 품질 위험 = sqrt(Zp² + (Zt/4)² + 0.5·Zr²). Z는 그 제품을 만든 분의 압력·배럴 온도·RPM이
  설비 평소 값에서 정상 흔들림 몇 배만큼 벗어났는지(압력 0.95%, 온도 0.35℃, RPM 2.35rpm 기준).
- 장비 이상 구간과 정상 구간 각각에서 품질 위험이 가장 큰 제품부터 불량, 그다음을 주의로 정한다.
  개수는 v7과 같다(불량 575, 주의 835, 이상 구간의 품질 이상 비율은 정상 구간의 9배).
- 시연 날 11:00~16:30 제품은 시연 장면(검수 25개 중 3건, 24개 중 1건 등)을 위해 v7 값을 그대로 둔다.
- 불량 유형도 가장 크게 벗어난 센서와 방향으로 정한다. 측정값만 규격 관계(불량 규격 밖, 주의 공차 80% 초과)를 지키는 범위에서 고정 시드로 뽑는다.

사용: python3 make_quality_v72.py <qfirst_dataset_v7 폴더> <출력 폴더>
"""
import random
import shutil
import sys
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 20261115
TARGET = {"anomaly": {"불량": 119, "주의": 173}, "normal": {"불량": 456, "주의": 662}}
PROTECT = ("2026-02-03T11:00:00Z", "2026-02-03T16:30:00Z")
PARTS = {"BODY": (2.00, 0.10), "INNER_LID": (58.00, 0.15), "CAP": (18.00, 0.12)}
LOW = {"BODY": "중량편차", "INNER_LID": "치수불량", "CAP": "치수불량"}


def defect_type(part, zp, zt, zr):
    """가장 크게 벗어난 센서와 방향 → 샘플 불량 유형 5종."""
    k = max((abs(zp), "p"), (abs(zt) / 4, "t"), (abs(zr), "r"))[1]
    if k == "p":
        return "치수불량" if zp > 0 else LOW[part]
    if k == "t":
        if zt < 0:
            return LOW[part]
        return "색상편차" if part == "CAP" and abs(zt) / 4 < 2.5 else "표면결함"
    return "강도부족"


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(src, out)
    rng = random.Random(SEED)
    es = pd.read_csv(src / "equipment_status.csv", dtype=str, keep_default_na=False)
    reg = pd.read_csv(src / "equipment_registry.csv").set_index("equipment_id")
    qm = pd.read_csv(src / "quality_metrics.csv", dtype=str, keep_default_na=False)
    d = qm.merge(es[["equip_status_id", "equipment_state", "pressure_kpa", "temperature_celsius", "rotation_speed_rpm", "recorded_at"]],
                 on="equip_status_id")
    bp = d["equipment_id"].map(reg["baseline_pressure_kpa"]).astype(float)
    bt = d["equipment_id"].map(reg["baseline_temp_c"]).astype(float)
    br = d["equipment_id"].map(reg["baseline_rpm"]).astype(float)
    zp = (d["pressure_kpa"].astype(float) - bp) / (0.0095 * bp)
    zt = (d["temperature_celsius"].astype(float) - bt) / 0.35
    zr = (d["rotation_speed_rpm"].astype(float) - br) / 2.35
    d["risk"] = np.sqrt(zp ** 2 + (zt / 4) ** 2 + 0.5 * zr ** 2)
    d["zp"], d["zt"], d["zr"] = zp, zt, zr
    d["protected"] = (d["recorded_at"] >= PROTECT[0]) & (d["recorded_at"] < PROTECT[1])
    d["stratum"] = np.where(d["equipment_state"] != "정상", "anomaly", "normal")

    new_status = d["quality_status"].copy()
    new_type = d["defect_type"].copy()
    free = ~d["protected"]
    new_status[free] = "정상"
    new_type[free] = "NONE"
    for s in ("anomaly", "normal"):
        have = d.loc[d["protected"] & (d["stratum"] == s), "quality_status"].value_counts()
        need_d = TARGET[s]["불량"] - int(have.get("불량", 0))
        need_c = TARGET[s]["주의"] - int(have.get("주의", 0))
        cand = d[free & (d["stratum"] == s)].sort_values("risk", ascending=False).index
        new_status[cand[:need_d]] = "불량"
        new_status[cand[need_d:need_d + need_c]] = "주의"
        print(s, "불량 기준 위험 ≥", round(float(d.loc[cand[need_d - 1], "risk"]), 2),
              "주의 기준 ≥", round(float(d.loc[cand[need_d + need_c - 1], "risk"]), 2))
    for i in d.index[free & (new_status == "불량")]:
        new_type[i] = defect_type(d.at[i, "part_type"], d.at[i, "zp"], d.at[i, "zt"], d.at[i, "zr"])

    # 측정값: 상태와 규격 관계를 지키는 범위에서 다시 뽑는다(보호 구간은 그대로)
    mv = d["measurement_value"].astype(float).copy()
    for i in d.index[free]:
        nominal, tol = PARTS[d.at[i, "part_type"]]
        sign = 1 if d.at[i, "zp"] > 0 else -1
        st = new_status[i]
        if st == "정상":
            dev = max(-0.79, min(0.79, rng.gauss(0, 0.3))) * tol
        elif st == "주의":
            dev = sign * rng.uniform(0.81, 0.99) * tol
        elif new_type[i] == "치수불량":
            dev = sign * rng.uniform(1.02, 1.35) * tol
        else:
            dev = max(-0.79, min(0.79, rng.gauss(0, 0.4))) * tol
        mv[i] = round(nominal + dev, 3)

    qm2 = qm.copy()
    qm2["quality_status"] = new_status.values
    qm2["defect_type"] = new_type.values
    qm2["defect_count"] = (new_status == "불량").astype(int).astype(str).values
    qm2["measurement_value"] = [f"{v:.3f}".rstrip("0").rstrip(".") if "." in f"{v:.3f}" else f"{v:.3f}" for v in mv]
    qm2.to_csv(out / "quality_metrics.csv", index=False, encoding="utf-8-sig")

    key = qm2.set_index(["lot_no", "lot_seq"])
    feed = pd.read_csv(src / "lot_inspection_feed.csv", dtype=str, keep_default_na=False)
    for c in ("measurement_value", "defect_count", "quality_status", "defect_type"):
        feed[c] = [key.at[(l, s), c] for l, s in zip(feed["lot_no"], feed["lot_seq"])]
    feed.to_csv(out / "lot_inspection_feed.csv", index=False, encoding="utf-8-sig")

    lots = pd.read_csv(src / "quality_lot_summary.csv", dtype=str, keep_default_na=False)
    g = qm2.assign(mvf=qm2["measurement_value"].astype(float)).groupby("lot_no")
    for i, r in lots.iterrows():
        part = g.get_group(r["lot_no"])
        dcnt = int((part["quality_status"] == "불량").sum())
        mu, sd = part["mvf"].mean(), part["mvf"].std(ddof=0)
        nominal, tol = PARTS[r["part_type"]]
        cpk = min(nominal + tol - mu, mu - nominal + tol) / (3 * sd) if sd else float("nan")
        lots.loc[i, ["defect_count", "caution_count", "defect_rate", "cpk_value", "quality_status"]] = [
            str(dcnt), str(int((part["quality_status"] == "주의").sum())), str(round(dcnt / 125, 4)), str(round(cpk, 3)),
            "불량" if dcnt / 125 >= 0.08 else "주의" if dcnt / 125 >= 0.03 else "정상"]
    lots.to_csv(out / "quality_lot_summary.csv", index=False, encoding="utf-8-sig")

    print("불량", int((new_status == "불량").sum()), "주의", int((new_status == "주의").sum()))
    print("이상/정상 구간 불량률", {s: round(float((new_status[d["stratum"] == s] == "불량").mean()), 4) for s in ("anomaly", "normal")})
    print("불량 유형", new_type[new_status == "불량"].value_counts().to_dict())
    changed = (new_status != d["quality_status"]).sum()
    print("v7 대비 상태가 바뀐 제품", int(changed), "/ 시연 보호 구간 변경", int((new_status != d["quality_status"])[d["protected"]].sum()))


if __name__ == "__main__":
    main()
