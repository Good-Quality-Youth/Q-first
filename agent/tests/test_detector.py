"""Causal warning confirmation, independent of the hand-authored v8 labels."""
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from qfirst_agent.data import SENSORS, iso
from qfirst_agent.detector import Detector, confirmation_candidates
from qfirst_agent.detector_v1 import Detector as LegacyDetector


def synthetic(z_rows, alarm=False, gap_at=None):
    start=datetime(2026,1,1,tzinfo=timezone.utc)
    rows=[]
    for i in range(240+len(z_rows)):
        values=[1 if i%2 else -1]*5 if i<240 else [z*1.4826 for z in z_rows[i-240]]
        minute=i+(10 if gap_at is not None and i>=240+gap_at else 0)
        rows.append(dict(zip(SENSORS,values), at=start+timedelta(minutes=minute),
                         equip_status_id=f'ES-{i}', equipment_id='EQP-X',
                         error_code='TEMP_LIMIT' if alarm and i==240 else 'NONE'))
    return SimpleNamespace(rows={'EQP-X':rows})


class ConfirmationTests(unittest.TestCase):
    def test_short_pulses_and_their_smoothed_tails_do_not_open_warning(self):
        for duration in (1,3,6):
            with self.subTest(duration=duration):
                data=synthetic([[0,0,0,12,0]]*duration+[[0]*5]*20)
                self.assertFalse(any(r['confirmed'] for r in Detector(data).scored['EQP-X']))
                if duration>=3:self.assertTrue(any(r['confirmed'] for r in LegacyDetector(data).scored['EQP-X']))

    def test_different_sensors_cannot_accumulate_each_others_evidence(self):
        wave=[[8 if j==i%5 else 0 for j in range(5)] for i in range(20)]
        self.assertFalse(any(r['confirmed'] for r in Detector(synthetic(wave)).scored['EQP-X']))

    def test_persistent_sensor_wins_over_unrelated_instant_peak(self):
        wave=[[5,0,0,0,0]]*6+[[5,0,0,12,0]]
        row=Detector(synthetic(wave)).scored['EQP-X'][-1]
        self.assertTrue(row['confirmed']);self.assertEqual(row['top'],0)

    def test_current_recovery_blocks_old_history_and_small_gaps_are_tolerated(self):
        wave=[[0,2.5,0,0,0]]*6+[[0]*5]*2+[[0,4,0,0,0]]
        self.assertEqual(confirmation_candidates(wave,3),[1])
        wave[-1]=[0]*5
        self.assertEqual(confirmation_candidates(wave,10),[])

    def test_external_alarm_bypasses_warning_wait(self):
        data=synthetic([[0,10,0,0,0]],alarm=True)
        at=iso(data.rows['EQP-X'][-1]['at'])
        event=Detector(data).result(at,at)['events'][0]
        self.assertEqual(event['alarmAt'],at);self.assertIsNone(event['firstWarningAt'])

    def test_missing_time_resets_accumulated_evidence(self):
        data=synthetic([[5,0,0,0,0]]*8,gap_at=4)
        self.assertFalse(any(r['confirmed'] for r in Detector(data).scored['EQP-X']))


if __name__=='__main__':unittest.main()
