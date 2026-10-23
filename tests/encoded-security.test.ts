import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../backend/server.js';

test('Encoded API prefixes/segments cannot bypass snapshot, lifecycle or monitoring authentication',async context=>{
  const app=await createServer();context.after(()=>app.close());
  for(const url of ['/%61pi/snapshot','/api/%73napshot','/api%2fsnapshot','/%61pi/lifecycle','/%61pi/stream','/api/%73tream','/api/%6cifecycle']) {
    const response=await app.inject({url,headers:{host:'127.0.0.1'}});
    assert.equal(response.statusCode,401,url);assert.equal(response.headers['cache-control'],'no-store');
    const cross=await app.inject({url,headers:{host:'127.0.0.1','sec-fetch-site':'cross-site'}});assert.equal(cross.statusCode,403,url);
  }
});
test('Only matched minimal identity/bootstrap routes are public; encoded snapshots accept valid sessions',async context=>{
  const app=await createServer();context.after(()=>app.close());
  const headers={host:'127.0.0.1'};
  const bootstrap=await app.inject({url:'/%61pi/session',headers});assert.equal(bootstrap.statusCode,200);
  const cookie=String(bootstrap.headers['set-cookie']).split(';')[0]!;
  assert.equal((await app.inject({url:'/%61pi/snapshot',headers:{...headers,cookie}})).statusCode,200);
  assert.equal((await app.inject({url:'/%61pi/health',headers})).statusCode,200);
  assert.equal((await app.inject({url:'/%61pi/no-such-route',headers})).statusCode,401);
});
