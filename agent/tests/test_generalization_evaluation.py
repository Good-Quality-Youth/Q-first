"""Check experiment validity rather than hard-coding favorable detector metrics."""
import copy
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from validate_detector_generalization import make_data, measure, ONSET, specs
from qfirst_agent.data import SENSORS
from qfirst_agent.detector import Detector
from qfirst_agent.detector_v1 import Detector as LegacyDetector


class GeneralizationEvaluationTests(unittest.TestCase):
    def test_labels_are_not_inputs_and_identical_signals_are_indistinguishable(self):
        normal = dict(name='approved', kind='step', duration=60, amplitude=5, label=0)
        fault = {**normal, 'name':'fault', 'label':1}
        a, _, _ = make_data(normal, 'iid', 771)
        b, _, _ = make_data(fault, 'iid', 771)
        self.assertEqual(a.rows, b.rows)
        self.assertNotIn('label', a.rows['SYN'][0])
        for cls in (LegacyDetector, Detector):
            self.assertEqual(cls(a).scored, cls(b).scored)

    def test_seed_reproducibility_and_external_alarm_disabled(self):
        for background in ('iid', 'ar07', 'heavy_tail_t3'):
            spec = specs()[-1]
            a, target, _ = make_data(spec, background, 998)
            b, other, _ = make_data(spec, background, 998)
            self.assertEqual(a.rows, b.rows)
            self.assertEqual(target, other)
            self.assertTrue(all(r['error_code']=='NONE' for r in a.rows['SYN']))

    def test_future_samples_do_not_change_past_decisions(self):
        spec = next(s for s in specs() if s['kind']=='ramp')
        original, _, _ = make_data(spec, 'ar07', 553)
        changed = copy.deepcopy(original)
        cutoff = ONSET+20
        for row in changed.rows['SYN'][cutoff+1:]:
            for key in SENSORS:
                row[key] += 1e9
        for cls in (LegacyDetector, Detector):
            before, after = cls(original), cls(changed)
            end = original.rows['SYN'][cutoff]['at']
            self.assertEqual([r for r in before.scored['SYN'] if r['at']<=end],
                             [r for r in after.scored['SYN'] if r['at']<=end])

    def test_preexisting_or_recovery_warning_is_not_credited_as_detection(self):
        spec = dict(name='short_fault', kind='pulse', duration=3, amplitude=8, label=1)
        data, _, _ = make_data(spec, 'iid', 997)
        # Exactly one new warning immediately after the labeled fault interval.
        rows = [{**r, 'score':80 if i==ONSET+3 else 0, 'confirmed':i==ONSET+3}
                for i,r in enumerate(data.rows['SYN'])][240:]
        result = measure(SimpleNamespace(scored={'SYN':rows}), data, spec, None)
        self.assertFalse(result['detected']);self.assertTrue(result['lateOnly'])
        # An earlier false warning held active into the fault is not a fresh hit.
        rows = [{**r, 'score':80, 'confirmed':True}
                for r in data.rows['SYN'][240:]]
        result = measure(SimpleNamespace(scored={'SYN':rows}), data, spec, None)
        self.assertFalse(result['detected']);self.assertEqual(result['preEvents'],1)


if __name__ == '__main__':
    unittest.main()
