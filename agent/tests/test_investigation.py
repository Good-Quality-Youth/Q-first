import copy
import unittest
from pathlib import Path
from types import SimpleNamespace
from qfirst_agent.data import Data, utc
from qfirst_agent.detector import Detector
from qfirst_agent.investigation import Request, Choice, Conclusion, build_graph
from qfirst_agent.tools import Tools

ROOT=Path(__file__).resolve().parents[3]/'qfirst-local/data/qfirst_dataset_v8'

def request(at='2026-02-03T05:00:00Z'):
    return Request(id='test-job',incidentId='test-event',equipmentId='EQP-003',trigger='newWarning',
        asOf=at,detectedAt='2026-02-03T04:43:00Z',judgmentRevision=1,topSensor='temperature_celsius')

class FakeLLM:
    """Test double only. The application always uses local Ollama."""
    model='test-double'
    def __init__(self,invalid=False): self.invalid=invalid
    async def structured(self,system,payload,schema):
        if schema is Choice: return Choice(tool='finish'),{}
        ids=[e['id'] for e in payload['evidence'] if e['id'].startswith(('CMP-','LOT-CHECK-'))]
        if self.invalid: ids.append('MADE-UP-EVIDENCE')
        return Conclusion(checkCode=payload['checkCode'],focus='measurement',evidenceIds=ids),{}

class ContractTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.data=Data(ROOT);cls.detector=Detector(cls.data);cls.tools=Tools(cls.data,cls.detector)

    def test_future_sensor_changes_do_not_change_past_detection(self):
        cutoff=utc('2026-02-03T05:00:00Z')
        changed=copy.deepcopy(self.data.rows)
        for rows in changed.values():
            for row in rows:
                if row['at']>cutoff: row['temperature_celsius']=999999
        other=Detector(SimpleNamespace(rows=changed))
        self.assertEqual(self.detector.result(str(cutoff),'2026-02-03T04:00:00Z'),
                         other.result(str(cutoff),'2026-02-03T04:00:00Z'))

    def test_actual_warning_and_no_future_quality(self):
        before=self.detector.result('2026-02-03T04:41:00Z','2026-02-03T04:00:00Z')
        self.assertNotIn('EQP-003',[e['equipmentId'] for e in before['events']])
        after=self.detector.result('2026-02-03T05:00:00Z','2026-02-03T04:00:00Z')
        event=next(e for e in after['events'] if e['equipmentId']=='EQP-003')
        self.assertEqual(event['firstWarningAt'],'2026-02-03T04:43:00Z')
        inspected=self.data.inspected('EQP-003',request().detectedAt,request().asOf)
        self.assertEqual((len(inspected),sum(int(r['defect_count']) for r in inspected)),(17,0))
        for tool in ('sensor_comparison','lot_inspections','maintenance_history','equipment_logs','inspection_guidance'):
            evidence=self.tools.execute(tool,request())
            self.assertTrue(all(utc(e['observedAt'])<=request().asOf for e in evidence))

    async def test_valid_graph_retains_evidence_and_no_priority_output(self):
        result=(await build_graph(self.tools,FakeLLM()).ainvoke({'request':request()}))['result']
        self.assertNotIn('grade',result)
        self.assertIn('검사 17개, 불량 0개',result['checklist'][0]['label'])
        known={e['id'] for e in result['evidence']}
        self.assertTrue(set(result['checklist'][0]['evidenceIds'])<=known)

    async def test_hallucinated_evidence_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'ungrounded'):
            await build_graph(self.tools,FakeLLM(invalid=True)).ainvoke({'request':request()})

    async def test_job_replay_and_conflicting_payload(self):
        from tempfile import TemporaryDirectory
        from unittest.mock import patch
        from fastapi import HTTPException
        from qfirst_agent.app import Jobs
        with TemporaryDirectory() as folder, patch('qfirst_agent.app.VAR',Path(folder)):
            jobs=Jobs(build_graph(self.tools,FakeLLM()))
            first=jobs.submit(request());second=jobs.submit(request())
            self.assertIs(first,second);self.assertEqual(jobs.queue.qsize(),1)
            with self.assertRaises(HTTPException) as error:
                jobs.submit(request('2026-02-03T05:05:00Z'))
            self.assertEqual(error.exception.status_code,409)

    async def test_llm_unavailable_fails_without_fabricated_result(self):
        import asyncio
        import httpx
        from tempfile import TemporaryDirectory
        from unittest.mock import patch
        from qfirst_agent.app import Jobs
        class BrokenLLM(FakeLLM):
            async def structured(self,*args): raise httpx.ConnectError('offline')
        with TemporaryDirectory() as folder, patch('qfirst_agent.app.VAR',Path(folder)):
            jobs=Jobs(build_graph(self.tools,BrokenLLM()))
            jobs.submit(request()); worker=asyncio.create_task(jobs.worker())
            await asyncio.wait_for(jobs.queue.join(),5)
            self.assertEqual(jobs.entries['test-job']['status'],'failed')
            self.assertEqual(jobs.entries['test-job']['failureCode'],'SERVICE_UNAVAILABLE')
            self.assertIsNone(jobs.entries['test-job']['result'])
            worker.cancel()
            try: await worker
            except asyncio.CancelledError: pass

if __name__=='__main__': unittest.main()
