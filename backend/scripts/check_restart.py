"""Local Compose restart test. Restarts backend/agent, preserves PostgreSQL and input files."""
import json
import subprocess
import time
from urllib.request import Request, build_opener, ProxyHandler
from pathlib import Path
root=Path(__file__).resolve().parents[2]
http=build_opener(ProxyHandler({}))
base='http://127.0.0.1:18095/api/v1'
def call(path,body=None,key=None):
    request=Request(base+path,data=None if body is None else json.dumps(body).encode(),headers={
        'Content-Type':'application/json','Idempotency-Key':key or ''})
    with http.open(request,timeout=10) as response:return json.load(response)
before=call('/board')
assert before['replay']['step']==4,'Run check_replay.py against a fresh database first'
assert all(c['investigation']['status']=='completed' for c in before['emergency']+before['warning'])
old_response=call('/demo/replay/next',{'boardId':before['boardId'],'expectedStep':1},'test-1')
subprocess.run(['docker','compose','restart','backend','agent'],cwd=root,check=True)
for _ in range(45):
    try:
        after=call('/board');break
    except Exception:time.sleep(1)
else:raise AssertionError('Restart did not recover')
assert after==before,'Persisted board or versions changed after restart'
assert call('/demo/replay/next',{'boardId':before['boardId'],'expectedStep':1},'test-1')==old_response
for card in after['emergency']+after['warning']:
    detail=call('/incidents/'+card['incidentId'])
    assert detail['investigation']['status']=='completed'
    assert any(c['source']=='investigation' for c in detail['checklist'])
print('PASS: board, replay time, judgments, investigation evidence and idempotent response survived restart')
