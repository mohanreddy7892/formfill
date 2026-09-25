"""Regression checks for validation, document identity, and async responsiveness.
Use bundled demo PDFs; no external services or real patient data are needed.
"""
import asyncio
import json
import threading

import pytest
from app import main, ocr, rules, tables
from app.models import Template, TableSpec
from conftest import upload


def required_template():
    return Template(form_id='test', name='Test', fingerprint='test',
                    pages=[{'width':600,'height':800}],
                    fields=[{'id':'consent','type':'checkbox','page':0,'rect':[10,10,20,20]},
                            {'id':'choice','type':'choice','multi':True,'page':0,
                             'options':[{'value':'A','rect':[30,10,40,20]}]}],
                    rules=[{'kind':'required','of':['consent','choice'],'severity':'error','message':'Required'}])


@pytest.mark.parametrize('value', [False, [], None, '', 'false', 'no', 0])
def test_required_checkbox_rejects_unchecked(value):
    assert rules.check(required_template(), {'consent':value, 'choice':['A']})


def test_required_choice_and_valid_consent():
    assert rules.check(required_template(), {'consent':True, 'choice':[]})
    assert not rules.check(required_template(), {'consent':True, 'choice':['A']})


def test_patient_requires_entire_name():
    assert ocr.name_check(['MOHAN REDDY'], 'Patient name: SURESH REDDY')['status'] == 'not_found'
    assert ocr.name_check(['MOHAN REDDY'], 'Patient name: MOHAN REDDY')['status'] == 'match'
    assert ocr.name_check(['LI WU'], 'Patient name: LI WU')['status'] == 'match'


def test_decimal_bill_not_silently_rounded():
    assert ocr.parse_bill('Hospital cash bill\nGrand total 1234.56')['amount'] == 1234.56
    table = TableSpec(id='bills', rows=[{'amount':'amount'}])
    result = tables.assign_bills(table, {}, [{'amount':1234.56}])
    assert result['updates'] == {} and len(result['skipped']) == 1


def test_pack_and_fill_share_blocking_rules(client):
    fid = upload(client, '3_line_style_travel_claim.pdf')['form_id']
    tpl = client.get(f'/api/forms/{fid}/template').json()
    tpl['fields'] = [{'id':'name','type':'text','page':0,'rect':[10,10,100,20]}]
    tpl['rules'] = [{'kind':'required','of':['name'],'severity':'error','message':'Name required'}]
    assert client.put(f'/api/forms/{fid}/template', json=tpl).status_code == 200
    for values in [{}, {'name':''}]:
        assert client.post(f'/api/forms/{fid}/fill', json={'values':values}).status_code == 422
        r = client.post(f'/api/forms/{fid}/pack', data={'values':json.dumps(values), 'categories':'[]'})
        assert r.status_code == 422 and 'Name required' in r.json()['detail']
    assert client.post(f'/api/forms/{fid}/pack', data={'values':'{"name":"Test"}', 'categories':'[]'}).status_code == 200
    # Document-only packs do not validate fields of a form that is not included.
    assert client.post(f'/api/forms/{fid}/pack', data={'include_form':'false', 'values':'{}', 'categories':'[]'}).status_code == 200


def test_document_workers_leave_event_loop_responsive():
    started, release = threading.Event(), threading.Event()
    def work():
        started.set()
        assert release.wait(3), 'event loop blocked by document work'
        return 42
    async def scenario():
        task = asyncio.create_task(main.document_work(work))
        try:
            async with asyncio.timeout(2):
                while not started.is_set():
                    await asyncio.sleep(0.01)
                await asyncio.sleep(0)
                release.set()
                assert await task == 42
        finally:
            release.set()
    asyncio.run(scenario())


def test_pack_reports_unverified_patient_names():
    from app import pack
    docs = [pack.Doc('bill.pdf', b'', 'hospital_bill',
                     {'status':'not_found', 'missing':['MOHAN'], 'variants':[]})]
    report = pack.report(docs, True)
    assert report['name_unverified'][0]['file'] == 'bill.pdf'


def test_template_mutations_reject_forged_tokens(token_client):
    h = {'X-FormFill-Token':'test-token'}
    fid = upload(token_client, '3_line_style_travel_claim.pdf', headers=h)['form_id']
    tpl = token_client.get(f'/api/forms/{fid}/template', headers=h).json()
    forged = {'X-FormFill-Token':'forged'}
    assert token_client.put(f'/api/forms/{fid}/template', json=tpl, headers=forged).status_code == 401
    assert token_client.delete(f'/api/forms/{fid}', headers=forged).status_code == 401
