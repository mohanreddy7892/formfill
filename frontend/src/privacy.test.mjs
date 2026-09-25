import { test } from 'node:test';
import assert from 'node:assert/strict';

test('session clear rotates identity, revokes previews and does not use browser storage', async () => {
  const events = new Map(), calls = [], revoked = [];
  globalThis.window = {addEventListener: (event, fn) => events.set(event, fn), prompt: () => 'test-token'};
  Object.defineProperty(globalThis, 'sessionStorage', {configurable:true, get(){throw Error('Persistent storage accessed');}});
  Object.defineProperty(globalThis, 'localStorage', {configurable:true, get(){throw Error('Persistent storage accessed');}});
  const originalFetch = globalThis.fetch;
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  let count=0;
  URL.createObjectURL = () => 'blob:temporary-preview';
  URL.revokeObjectURL = (url) => revoked.push(url);
  globalThis.fetch = async (path, options) => {
    calls.push({path,...options});
    if (++count === 1) return new Response('{}',{status:401});
    return new Response(path.endsWith('.png') ? 'PNG' : '{}');
  };
  try {
    const {api,clearSession} = await import('./api.js?privacy-basic');
    await api.templates();
    const oldSession=calls[1].headers['X-FormFill-Session'];
    assert.equal(calls[1].headers['X-FormFill-Token'],'test-token');
    await api.pageImage('test',0);
    assert.equal(await clearSession(),true);
    await api.templates();
    assert.notEqual(calls.at(-1).headers['X-FormFill-Session'],oldSession);
    assert.equal(calls.at(-1).headers['X-FormFill-Token'],undefined);
    assert.deepEqual(revoked,['blob:temporary-preview']);
    assert(calls.every(c=>c.cache==='no-store'));
    assert(events.has('pagehide') && events.has('pageshow'));
  } finally {
    globalThis.fetch=originalFetch; URL.createObjectURL=originalCreate; URL.revokeObjectURL=originalRevoke;
    delete globalThis.sessionStorage; delete globalThis.localStorage;
  }
});

test('a late result from a cleared session cannot be downloaded', async () => {
  globalThis.window={addEventListener(){},prompt(){throw Error('Unexpected prompt');}};
  const originalFetch=globalThis.fetch;
  let release, signal;
  globalThis.fetch=async (path,options) => {
    if(path==='/api/session/clear') return new Response('{}');
    signal=options.signal;
    return await new Promise(resolve=>{release=()=>resolve(new Response('%PDF-private'));});
  };
  try {
    const {api,clearSession}=await import('./api.js?privacy-late');
    const pending=api.fill('example',{});
    const rejected=assert.rejects(pending,{name:'AbortError'});
    await clearSession();
    assert.equal(signal.aborted,true);
    release();
    await rejected;
  } finally {globalThis.fetch=originalFetch;}
});
