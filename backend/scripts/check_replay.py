"""Live detector + local LLM integration smoke. Use a fresh Spring instance."""
import argparse
import json
import time
from pathlib import Path
OUTPUT=Path(__file__).resolve().parents[1]/'var/live-scenes'
OUTPUT.mkdir(parents=True,exist_ok=True)
def capture(name,board):
    (OUTPUT/(name+'.json')).write_text(json.dumps(board,ensure_ascii=False,indent=2))
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler
parser=argparse.ArgumentParser()
parser.add_argument('--base-url',default='http://127.0.0.1:18092/api/v1')
url=parser.parse_args().base_url.rstrip('/')
http=build_opener(ProxyHandler({}))
def send(path,body=None,key=None):
    options={} if body is None else {'data':json.dumps(body).encode(),'headers':{'Content-Type':'application/json','Idempotency-Key':key}}
    try:
        with http.open(Request(url+path,**options),timeout=15) as r:return r.status,json.load(r)
    except HTTPError as e:return e.code,json.load(e)
def all_cards(b):return b['emergency']+b['warning']
def eq3(b):return next(c for c in all_cards(b) if c['equipment']['id']=='EQP-003')
def settled():
    for _ in range(90):
        b=send('/board')[1]
        if all(c['investigation']['status']!='running' for c in all_cards(b)):return b
        time.sleep(1)
    raise AssertionError('investigation timed out')
old_detail=None
for step,expected in enumerate([None,(4,0,17,212.42),(3,1,22,212.54),(1,2,32,214.27)],1):
    status,b=send('/board')
    assert status==200 and b['replay']['step']==step
    capture(['1341','1400','1405','1415-running'][step-1],b)
    if expected is None:assert not any(c['equipment']['id']=='EQP-003' for c in all_cards(b))
    else:
        c=eq3(b)
        assert (c['grade'],c['quality']['defects'],c['quality']['inspected'],c['signal']['value'])==expected
        assert c['detectedAt']=='2026-02-03T04:43:00Z'
        status,d=send('/incidents/'+c['incidentId']+'?revision='+str(c['revision']))
        assert status==200 and all(e['observedAt']<=b['asOf'] for e in d['evidence'])
        if step==2:old_detail=d
        if step==4:
            assert c['investigation']['status']=='running'
            assert c['investigation']['trigger']=='emergencyAlarm'
            assert all(x['source']=='baseline' for x in d['checklist'])
            ranks=[(x['incidentId'],x['grade'],x['rank']) for x in all_cards(b)]
            done=settled(); final=eq3(done)
            capture('1415-completed',done)
            assert final['investigation']['status']=='completed',final['investigation']
            assert ranks==[(x['incidentId'],x['grade'],x['rank']) for x in all_cards(done)]
            detail=send('/incidents/'+final['incidentId'])[1]
            capture('1415-EQP003-detail',detail)
            assert {'baseline','investigation'}=={x['source'] for x in detail['checklist']}
            refined=next(x for x in detail['checklist'] if x['source']=='investigation')
            assert '214.27' in refined['label'] and '검사 32개, 불량 2개' in refined['label']
            assert set(refined['evidenceIds'])<={e['id'] for e in detail['evidence']}
            assert send('/incidents/'+old_detail['incidentId']+'?revision='+str(old_detail['judgment']['revision']))[1]['judgment']==old_detail['judgment']
            assert send('/equipment/EQP-003/series?asOf=2026-02-03T05:15:00Z')[1]['values'][-1]==214.27
            assert send('/equipment/EQP-003/series?asOf=2026-02-03T06:00:00Z')[0]==422
            print('Real investigation completed; grades unchanged; baseline/refined guide and evidence verified.')
    print('scene',step,expected,flush=True)
    body={'boardId':b['boardId'],'expectedStep':step}
    status,response=send('/demo/replay/next',body,'test-'+str(step))
    if step==4:assert status==409;break
    assert status==200
    assert send('/demo/replay/next',body,'test-'+str(step))==(status,response)
    assert send('/demo/replay/next',body,'stale-'+str(step))[1]['error']['code']=='REPLAY_STEP_CONFLICT'
    assert send('/demo/replay/next',{**body,'expectedStep':step+1},'test-'+str(step))[1]['error']['code']=='IDEMPOTENCY_KEY_REUSED'
status,n=send('/notifications?after=N-0')
assert [(x['at'],x['toGrade']) for x in n['items'] if x['incidentId']==eq3(b)['incidentId']]==[
 ('2026-02-03T04:43:00Z',4),('2026-02-03T05:04:00Z',3),('2026-02-03T05:15:00Z',1)]
print('API: real detector, replay, quality transition, alarm promotion, async investigation and idempotency OK.')
