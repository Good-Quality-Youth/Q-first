import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
from hashlib import sha256
import json
import os
from pathlib import Path

# Project evidence stays local, including tracing.
os.environ['LANGSMITH_TRACING']='false'
os.environ['LANGCHAIN_TRACING_V2']='false'
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import httpx
from .data import Data, utc
from .detector import Detector, PROFILE
from .tools import Tools
from .investigation import Request, Ollama, build_graph

ROOT=Path(__file__).resolve().parents[1]
DATA=Path(os.getenv('QFIRST_DATASET',str(ROOT.parent.parent/'qfirst-local/data/qfirst_dataset_v8')))
VAR=Path(os.getenv('QFIRST_AGENT_VAR',str(ROOT/'var')))


class Jobs:
    def __init__(self, graph):
        self.graph=graph; self.entries={}; self.queue=asyncio.Queue(maxsize=32)
        VAR.mkdir(parents=True,exist_ok=True)

    def save(self,entry):
        target=VAR/(entry['id']+'.json'); tmp=target.with_suffix('.tmp')
        tmp.write_text(json.dumps(entry,ensure_ascii=False,indent=2)); tmp.replace(target)

    def submit(self,request):
        payload=request.model_dump(mode='json')
        fingerprint=sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()
        old=self.entries.get(request.id)
        if old:
            if old['fingerprint']!=fingerprint: raise HTTPException(409,'JOB_ID_CONFLICT')
            return old
        if self.queue.full(): raise HTTPException(429,'QUEUE_FULL')
        entry={'id':request.id,'status':'running','failureCode':None,'request':payload,
               'fingerprint':fingerprint,'result':None}
        self.entries[request.id]=entry;self.save(entry);self.queue.put_nowait(request)
        return entry

    async def worker(self):
        while True:
            req=await self.queue.get();entry=self.entries[req.id]
            try:
                result=await asyncio.wait_for(self.graph.ainvoke({'request':req},config={'recursion_limit':12}),timeout=150)
                entry.update(status='completed',result=result['result'])
            except (TimeoutError,httpx.TimeoutException):
                entry.update(status='failed',failureCode='TIMEOUT')
            except (httpx.HTTPError,ConnectionError):
                entry.update(status='failed',failureCode='SERVICE_UNAVAILABLE')
            except Exception as e:
                entry.update(status='failed',failureCode='INVALID_RESULT',errorType=type(e).__name__)
            finally:
                self.save(entry);self.queue.task_done()


@asynccontextmanager
async def lifespan(app):
    data=Data(DATA);detector=Detector(data)
    app.state.data=data;app.state.detector=detector
    app.state.graph=build_graph(Tools(data,detector),Ollama())
    app.state.jobs=Jobs(app.state.graph)
    worker=None if os.getenv('QFIRST_DURABLE_WORKER')=='1' else asyncio.create_task(app.state.jobs.worker())
    yield
    if worker is not None:
        worker.cancel()
        try: await worker
        except asyncio.CancelledError: pass

app=FastAPI(title='Q-First local detector and investigation',lifespan=lifespan)

class DetectionRequest(BaseModel):
    asOf: str
    sessionStart: str

@app.get('/health')
def health(): return {'status':'ok','detector':PROFILE,'llm':'local-ollama','model':os.getenv('QFIRST_MODEL','qwen3:4b')}

@app.post('/detect')
def detect(request:DetectionRequest):
    try:
        if utc(request.asOf)<utc(request.sessionStart): raise ValueError()
        return app.state.detector.result(request.asOf,request.sessionStart)
    except (ValueError,KeyError): raise HTTPException(422,'INVALID_TIME_RANGE')

@app.post('/investigations',status_code=202)
async def investigate(request:Request):
    if os.getenv("QFIRST_DURABLE_WORKER")=="1": raise HTTPException(410,"USE_SPRING_DURABLE_QUEUE")
    if request.equipmentId not in app.state.data.registry or request.detectedAt>request.asOf:
        raise HTTPException(422,'INVALID_SCOPE')
    result=app.state.jobs.submit(request)
    return {k:result[k] for k in ('id','status','failureCode')}

@app.get('/investigations/{job_id}')
def job(job_id:str):
    entry=app.state.jobs.entries.get(job_id)
    if not entry: raise HTTPException(404,'JOB_NOT_FOUND')
    return {k:entry[k] for k in ('id','status','failureCode','result')}


@app.post('/investigations/run')
async def run_investigation(request:Request):
    """Synchronous execution endpoint; Spring owns the durable queue and retries."""
    if request.equipmentId not in app.state.data.registry or request.detectedAt>request.asOf:
        raise HTTPException(422,'INVALID_SCOPE')
    try:
        result=await asyncio.wait_for(app.state.graph.ainvoke({'request':request},
            config={'recursion_limit':12}),timeout=150)
        return result['result']
    except (TimeoutError,httpx.TimeoutException): raise HTTPException(504,'TIMEOUT')
    except httpx.HTTPError: raise HTTPException(503,'LLM_UNAVAILABLE')
    except (ValueError,KeyError): raise HTTPException(422,'INVALID_RESULT')
