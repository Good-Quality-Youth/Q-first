"""Local v8 source adapter. The source's misleading Z suffix represents KST."""
import csv
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

KST = ZoneInfo('Asia/Seoul')
SENSORS = ('pressure_kpa', 'temperature_celsius', 'rotation_speed_rpm', 'vibration_level', 'motor_current_amp')
LABELS = ('사출 압력', '배럴 온도', '스크류 회전수', '진동 지수', '모터 전류')
METRICS = ('injectionPressure', 'barrelTemperature', 'screwSpeed', 'vibration', 'motorCurrent')
UNITS = ('kPa', '°C', 'rpm', 'index', 'A')


def source_time(s):
    return datetime.fromisoformat(s.removesuffix('Z')).replace(tzinfo=KST).astimezone(timezone.utc) if s else None


def iso(t):
    return t.isoformat().replace('+00:00', 'Z')


def utc(s):
    t = datetime.fromisoformat(s.replace('Z', '+00:00'))
    if t.tzinfo is None:
        raise ValueError('offset required')
    return t.astimezone(timezone.utc)


class Data:
    def __init__(self, root):
        self.root = Path(root)
        self.registry = {r['equipment_id']: r for r in self.read('equipment_registry.csv')}
        self.rows = {eq: [] for eq in self.registry}
        for r in self.read('equipment_status.csv'):
            # Explicit whitelist: labels, precomputed scores and future outcomes never enter detection.
            row = {k: r[k] for k in ('equip_status_id', 'equipment_id', 'process_id', 'lot_no', 'cycle_id', 'error_code')}
            row.update({k: float(r[k]) for k in SENSORS})
            row['at'] = source_time(r['recorded_at'])
            self.rows[r['equipment_id']].append(row)
        for rows in self.rows.values():
            rows.sort(key=lambda r: r['at'])
        self.lots = {r['lot_no']: r for r in self.read('lot_history.csv')}
        self.inspections = {}
        for r in self.read('lot_inspection_feed.csv'):
            lot = self.lots[r['lot_no']]
            r['at'] = source_time(r['inspected_at'])
            # v8 contract: exactly one piece per minute. Not a general MES assumption.
            r['produced'] = source_time(lot['production_start']) + timedelta(minutes=int(r['lot_seq'])-1)
            self.inspections.setdefault(r['lot_no'], []).append(r)
        self.maintenance = self.read('inspection_guide.csv')

    def read(self, name):
        with (self.root / name).open(encoding='utf-8-sig') as f:
            return list(csv.DictReader(f))

    def before(self, eq, at):
        return [r for r in self.rows[eq] if r['at'] <= at]

    def inspected(self, eq, start, at):
        lot_ids = {r['lot_no'] for r in self.before(eq, at) if r['at'] >= start}
        return sorted([r for lot in lot_ids for r in self.inspections.get(lot, [])
                       if start <= r['produced'] <= at and r['at'] <= at], key=lambda r: (r['at'], r['inspection_record_id']))
