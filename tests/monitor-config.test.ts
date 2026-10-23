import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENV_PREFIX } from '../shared/config.js';
import { runtimeOptions } from '../backend/runtime.js';

test('M1 cadence/staleness configuration and Worker paths are validated without exposing values',()=>{
  const configured=runtimeOptions({[`${ENV_PREFIX}_SAMPLE_MS`]:'500',[`${ENV_PREFIX}_TASK_SAMPLE_MS`]:'1000',[`${ENV_PREFIX}_WORKER_STALE_MS`]:'120000'},[]);
  assert.equal(configured.sampleMs,500);assert.equal(configured.taskSampleMs,1000);assert.equal(configured.staleMs,120000);
  for(const [key,value] of [['SAMPLE_MS','0'],['TASK_SAMPLE_MS','-1'],['WORKER_STALE_MS','100'],['SAMPLE_MS','nope'],['WORKER_STATE_DIR',''],['WORKER_STATE_DIR','bad\0path']]) {
    assert.throws(()=>runtimeOptions({[`${ENV_PREFIX}_${key}`]:value},[]));
  }
});
