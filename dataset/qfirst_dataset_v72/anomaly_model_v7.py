"""Q-First 장비 이상 탐지 모델 (qfirst_dataset_v7 기준).

후보
  B1   로버스트 Z-점수(설비별 중앙값·MAD) 최댓값 → 최근 평균 + 지속성
  B1+  B1 + 센서별 EWMA(작게 쌓이는 변화)
  M1   로버스트 Z 벡터의 Mahalanobis 거리 → 최근 평균 + 지속성
  IF   Isolation Forest (Z와 최근 5분 평균 Z, 10차원)
  AE   오토인코더(MLP, 10→6→3→6→10) 복원 오차
모든 후보는 설비별 정규화 값을 쓰는 모델 1개이고, 40점(예고) = 학습 정상 점수의 백분위.
입력은 센서 5개뿐이고, 라벨은 학습 구간에서 이상 행을 빼는 데만 쓴다.

학습: 사이클 1~3000 정상 행 / 시험: 3001~5000 / 평가: windows.csv의 이상 구간(시연 4개 제외)

사용: python3 anomaly_model_v7.py <qfirst_dataset_v7 폴더> <출력 폴더>
numpy, pandas, scikit-learn 필요.
"""
import json

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.neural_network import MLPRegressor

SENSORS = ["vibration_level", "temperature_celsius", "pressure_kpa", "motor_current_amp", "rotation_speed_rpm"]
N = 5000
TRAIN_END = 3000
WARN = 40
EVENT_GAP = 10
QUANTILES = (0.99, 0.995, 0.997, 0.998, 0.999)
FALSE_BUDGET_PER_EQ_DAY = 0.5
PRECISION_TARGET = 0.8
T0 = pd.Timestamp("2026-02-02T00:00:00Z")


def minute(ts):
    return int((pd.Timestamp(ts) - T0).total_seconds() // 60)


# ---------------------------------------------------------------- 데이터
def load(src):
    es = pd.read_csv(src / "equipment_status.csv")
    eqs = sorted(es["equipment_id"].unique())
    data = {}
    for eq in eqs:
        d = es[es["equipment_id"] == eq].sort_values("recorded_at")
        data[eq] = {"x": d[SENSORS].to_numpy(float), "label": (d["equipment_state"] != "정상").to_numpy(),
                    "err": (d["error_code"] != "NONE").to_numpy(), "sid": d["equip_status_id"].to_numpy()}
    win = pd.read_csv(src / "windows.csv")
    windows = [{"eq": r.equipment_id, "s": minute(r.start_at), "L": int(r.minutes), "type": r.scenario_type,
                "label": int(r.label), "alarm": minute(r.first_alarm_at) if isinstance(r.first_alarm_at, str) else None,
                "demo": int(r.demo)} for r in win.itertuples()]
    return eqs, data, windows


# ---------------------------------------------------------------- 공통 계산
def rolling_mean(a, k):
    c = np.cumsum(np.insert(a, 0, 0.0))
    out = np.empty_like(a, dtype=float)
    for i in range(len(a)):
        lo = max(0, i - k + 1)
        out[i] = (c[i + 1] - c[lo]) / (i + 1 - lo)
    return out


def smooth_persist(d, recent, weight, thr):
    return rolling_mean(d, recent) + weight * rolling_mean((d >= thr).astype(float), 7)


def to_score(raw, q):
    raw = np.asarray(raw, float)
    return np.where(raw <= q, 40.0 * raw / q, 40.0 + 60.0 * (1 - np.exp(-(raw - q) / q)))


class AnomalyModel:
    """설비별 기준(중앙값·MAD)과 후보별 설정·학습 결과를 담는다. raw()는 설비 하나의 5,000분 원점수."""

    def __init__(self, kind, params):
        self.kind, self.params = kind, params
        self.base, self.cov_inv, self.estimator, self.cal = {}, {}, None, None

    def fit(self, eqs, data):
        feats = []
        for eq in eqs:
            x, mask = data[eq]["x"], self.train_mask(data[eq])
            med = np.median(x[mask], axis=0)
            mad = np.median(np.abs(x[mask] - med), axis=0) * 1.4826
            self.base[eq] = (med, mad)
            z = (x - med) / mad
            if self.kind == "M1":
                cov = np.cov(z[mask].T) + np.eye(len(SENSORS)) * 1e-6
                self.cov_inv[eq] = np.linalg.inv(cov)
            feats.append(self.features(z)[mask])
        if self.kind in ("IF", "AE"):
            f = np.vstack(feats)
            rng = np.random.default_rng(7)
            f = f[rng.choice(len(f), size=min(len(f), 20000), replace=False)]
            if self.kind == "IF":
                self.estimator = IsolationForest(n_estimators=200, random_state=7).fit(f)
            else:
                self.mu, self.sd = f.mean(axis=0), f.std(axis=0) + 1e-9
                self.estimator = MLPRegressor(hidden_layer_sizes=(6, 3, 6), max_iter=300, random_state=7)
                self.estimator.fit((f - self.mu) / self.sd, (f - self.mu) / self.sd)
        normal = np.concatenate([self.raw(eq, data[eq]["x"])[self.train_mask(data[eq])] for eq in eqs])
        self.cal = float(np.quantile(normal, self.params["q"]))
        return self

    @staticmethod
    def train_mask(d):
        """학습 구간의 정상 행. 이상 구간 바로 뒤 8분(회복 중)은 깨끗한 정상이 아니라서 뺀다."""
        lab = d["label"]
        m = ~lab
        for i in np.flatnonzero(lab):
            m[i + 1:i + 9] = False
        m[TRAIN_END:] = False
        return m

    @staticmethod
    def features(z):
        rm = np.vstack([rolling_mean(z[:, j], 5) for j in range(z.shape[1])]).T
        return np.hstack([z, rm])

    def z(self, eq, x):
        med, mad = self.base[eq]
        return (x - med) / mad

    def raw(self, eq, x):
        z = self.z(eq, x)
        p = self.params
        if self.kind in ("B1", "B1+"):
            raw = smooth_persist(np.abs(z).max(axis=1), p["recent"], p["weight"], 3.0)
            if self.kind == "B1+":
                lam, e = p["lam"], np.zeros(z.shape[1])
                norm = np.sqrt(lam / (2 - lam))
                ew = np.empty(len(z))
                for i in range(len(z)):
                    e = lam * z[i] + (1 - lam) * e
                    ew[i] = np.abs(e).max() / norm
                raw = np.maximum(raw, p["ew_weight"] * ew)
            return raw
        if self.kind == "M1":
            ci = self.cov_inv[eq]
            d = np.sqrt(np.einsum("ij,jk,ik->i", z, ci, z) / z.shape[1])
            return smooth_persist(d, p["recent"], p["weight"], 2.0)
        f = self.features(z)
        if self.kind == "IF":
            point = -self.estimator.score_samples(f)
        else:
            fz = (f - self.mu) / self.sd
            point = ((self.estimator.predict(fz) - fz) ** 2).mean(axis=1)
        return rolling_mean(point, p["recent"])

    def score(self, eq, x):
        return to_score(self.raw(eq, x), self.cal)

    def top_feature(self, eq, x):
        return np.array(SENSORS)[np.abs(self.z(eq, x)).argmax(axis=1)]


# ---------------------------------------------------------------- 평가
def episodes(active):
    out, i = [], 0
    while i < len(active):
        if not active[i]:
            i += 1
            continue
        s, last, j = i, i, i
        while j < len(active) and j - last <= EVENT_GAP:
            if active[j]:
                last = j
            j += 1
        out.append((s, last))
        i = last + EVENT_GAP + 1
    return out


def evaluate(eqs, data, windows, scores):
    rows, false_train, false_test, true_ev_train, true_ev_test = [], 0, 0, 0, 0
    for eq in eqs:
        sc, lab = scores[eq], data[eq]["label"]
        for w in windows:
            if w["eq"] != eq or w["label"] != 1 or w["demo"]:
                continue
            s, e = w["s"], w["s"] + w["L"]
            first = next((i for i in range(s, e) if sc[i] >= WARN), None)
            rows.append({"equipment_id": eq, "scenario": w["type"], "start": w["s"], "split": "train" if s < TRAIN_END else "test",
                         "alarm_expected": w["alarm"] is not None, "detected": first is not None,
                         "warn_offset": None if first is None else first - s,
                         "lead_min": None if first is None or w["alarm"] is None else w["alarm"] - first})
        near = np.zeros(N, bool)
        for w in windows:
            if w["eq"] == eq and w["label"] == 1:
                near[max(0, w["s"] - 5):w["s"] + w["L"] + 15] = True
        for s, e in episodes((sc >= WARN) & ~near):
            if s < TRAIN_END:
                false_train += 1
            else:
                false_test += 1
    return rows, false_train, false_test


def summarize(rows, ft, fte, n_eq):
    def part(rs, f):
        det = sum(r["detected"] for r in rs)
        leads = [r["lead_min"] for r in rs if r["lead_min"] is not None]
        free = [r for r in rs if not r["alarm_expected"]]
        return {"windows": len(rs), "detected": det, "alarm_free_detected": f"{sum(r['detected'] for r in free)}/{len(free)}",
                "lead_mean": round(float(np.mean(leads)), 1) if leads else None,
                "lead_median": float(np.median(leads)) if leads else None, "lead_min": min(leads) if leads else None,
                "false_alarms": f, "precision": round(det / (det + f), 3) if det + f else None}
    tr = [r for r in rows if r["split"] == "train"]
    te = [r for r in rows if r["split"] == "test"]
    allp = part(rows, ft + fte)
    allp["false_per_eq_day"] = round((ft + fte) / (n_eq * N / 1440), 3)
    return {"train": part(tr, ft), "test": part(te, fte), "all": allp}


# ---------------------------------------------------------------- 실행
def grid():
    for q in QUANTILES:
        for r in (3, 5):
            for w in (2.0, 3.0, 4.0):
                yield "B1", {"recent": r, "weight": w, "q": q}
        for lam in (0.1, 0.2):
            for ew in (0.5, 1.0):
                yield "B1+", {"recent": 3, "weight": 3.0, "lam": lam, "ew_weight": ew, "q": q}
        for r in (3, 5):
            for w in (2.0, 3.0):
                yield "M1", {"recent": r, "weight": w, "q": q}
        for r in (3, 5):
            yield "IF", {"recent": r, "q": q}
            yield "AE", {"recent": r, "q": q}


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    eqs, data, windows = load(src)
    budget = FALSE_BUDGET_PER_EQ_DAY * len(eqs) * TRAIN_END / 1440
    fitted_cache, log, best = {}, [], {}
    for kind, params in grid():
        key = (kind, tuple((k, v) for k, v in params.items() if k != "q"))
        if kind in ("IF", "AE") and key in fitted_cache:      # 학습은 한 번, 백분위만 바꿈
            m = fitted_cache[key]
            m = AnomalyModel(kind, params)
            src_m = fitted_cache[key]
            m.base, m.estimator = src_m.base, src_m.estimator
            if kind == "AE":
                m.mu, m.sd = src_m.mu, src_m.sd
            normal = np.concatenate([m.raw(eq, data[eq]["x"])[AnomalyModel.train_mask(data[eq])] for eq in eqs])
            m.cal = float(np.quantile(normal, params["q"]))
        else:
            m = AnomalyModel(kind, params).fit(eqs, data)
            fitted_cache[key] = m
        scores = {eq: m.score(eq, data[eq]["x"]) for eq in eqs}
        rows, ft, fte = evaluate(eqs, data, windows, scores)
        s = summarize(rows, ft, fte, len(eqs))
        tr = s["train"]
        ok = ft <= budget and (tr["precision"] or 0) >= PRECISION_TARGET
        key_sel = (ok, tr["detected"], int(tr["alarm_free_detected"].split("/")[0]), tr["lead_mean"] or -99, -ft)
        log.append({"model": kind, **params, "ok_train": ok, "det_train": tr["detected"], "lead_train": tr["lead_mean"],
                    "false_train": ft, "prec_train": tr["precision"], "det_test": s["test"]["detected"],
                    "false_test": fte, "prec_all": s["all"]["precision"], "lead_all": s["all"]["lead_mean"]})
        if kind not in best or key_sel > best[kind][0]:
            best[kind] = (key_sel, m, s, rows)
        print(kind, params, "train", tr, "test", s["test"]["detected"], fte)
    pd.DataFrame(log).to_csv(out / "grid_search.csv", index=False, encoding="utf-8-sig")
    summary = {k: {"params": v[1].params, **v[2]} for k, v in best.items()}
    chosen = max(best, key=lambda k: best[k][0])
    print("\nchosen:", chosen, summary[chosen])
    for k in best:
        print(k, best[k][1].params, best[k][2]["all"])
    model = best[chosen][1]
    # 학습은 결정적(random_state 고정)이라, 선택한 종류·설정만 저장하고 다시 학습해 같은 모델을 만든다
    (out / "model_choice.json").write_text(json.dumps({"kind": chosen, "params": model.params, "cal_raw_at_40": model.cal,
                                                       "baselines": {eq: {"median": model.base[eq][0].round(4).tolist(),
                                                                          "mad": model.base[eq][1].round(4).tolist()}
                                                                     for eq in eqs}, "sensors": SENSORS},
                                                      ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "model_summary.json").write_text(json.dumps({"chosen": chosen, "candidates": summary}, ensure_ascii=False, indent=2,
                                                        default=str), encoding="utf-8")
    ev = []
    for k, v in best.items():
        for r in v[3]:
            ev.append({"model": k, **r})
    pd.DataFrame(ev).to_csv(out / "evaluation_windows.csv", index=False, encoding="utf-8-sig")


if __name__ == "__main__":
    main()
