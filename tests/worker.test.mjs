import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorized, attachmentUrl, download, execute, parseOutput, safeFilename, workerModels, NeedsHuman, tick } from '../web/lib/worker.mjs';

const origin = 'https://project.supabase.co';
test('worker trigger denies missing and incorrect tokens', () => {
  assert.equal(authorized(null, undefined), false);
  assert.equal(authorized('Bearer x', 'x'), false);
  assert.equal(authorized(`Bearer ${'a'.repeat(40)}`, 'a'.repeat(40)), true);
  assert.equal(authorized(`Bearer ${'b'.repeat(40)}`, 'a'.repeat(40)), false);
});
test('sources only come from the configured public storage; no local URLs or redirects', async () => {
  for (const url of ['http://127.0.0.1/test', 'file:///C:/secrets', `${origin}/rest/v1/tasks`, 'https://other.supabase.co/storage/v1/object/public/a']) assert.throws(() => attachmentUrl(url, origin));
  await download(`${origin}/storage/v1/object/public/attachments/a`, origin, async (url, init) => {
    assert.equal(init.redirect, 'error'); return new Response('source');
  });
  await assert.rejects(download(`${origin}/storage/v1/object/public/attachments/a`, origin, async () => new Response('', { headers: { 'content-length': String(26 * 1024 * 1024) } })), NeedsHuman);
});
test('deliverables reject traversal, empty files, duplicate names and absent work', () => {
  for (const files of [[], [{name:'result.txt', content:''}]]) assert.throws(() => parseOutput(JSON.stringify({summary:'done',files})));
  // free-form names are made safe instead of failing the task: paths stripped, non-text extensions become .md, duplicates suffixed
  const out = parseOutput(JSON.stringify({summary:'done',files:[{name:'../../out.txt', content:'x'}, {name:'Assignment answers (final).docx', content:'y'}, {name:'a.txt',content:'x'}, {name:'A.txt',content:'y'}, {name:'', content:'z'}]}));
  assert.deepEqual(out.files.map(f => f.name), ['out.txt', 'Assignment answers (final).md', 'a.txt', 'A-2.txt', 'result-5.md']);
  assert.deepEqual(parseOutput('{"question":"Please attach the report"}'), {question:'Please attach the report'});
});
test('source-code deliverables preserve usable extensions and remain inert text', () => {
  const output = parseOutput(JSON.stringify({summary:'Produced Java classes',files:[{name:'HumanGame.java',content:'public class HumanGame {}'},{name:'ComputerGame.java',content:'public class ComputerGame {}'}]}));
  assert.deepEqual(output.files.map(file => [file.name, file.mime]), [['HumanGame.java','text/plain'],['ComputerGame.java','text/plain']]);
  assert.equal(safeFilename('results.exe'), 'results.md');
  assert.equal(safeFilename('preview.html'), 'preview.html');
});
test('model candidates respect explicit order, capability, and empty fallback configuration', () => {
  assert.deepEqual(workerModels({}), ['qwen3.8-27b','qwen3.8-27b-sglang','qwen3.8-27b-vision']);
  assert.deepEqual(workerModels({LLM_MODEL:'custom-chat'}), ['custom-chat']);
  assert.deepEqual(workerModels({LLM_FALLBACK_MODELS:''}), ['qwen3.8-27b']);
  assert.deepEqual(workerModels({LLM_MODELS:'a, qwen3-embeddings, b, a'}), ['a','b']);
  assert.deepEqual(workerModels({LLM_MODELS:'text-a,text-b'},true), ['qwen3.8-27b-vision']);
  assert.deepEqual(workerModels({LLM_VISION_MODEL:'vision-a',LLM_VISION_FALLBACK_MODELS:'vision-b,qwen3-embeddings,qwen3.8-27b,qwen3.8-27b-sglang,vision-a'},true), ['vision-a','vision-b']);
  assert.deepEqual(workerModels({LLM_MODELS:'qwen3-embeddings'}), []);
});
test('PDF summary uses source content and produces the actual file', async () => {
  const calls = [];
  const result = await execute({title:'Give me summary',attachments:[{url:`${origin}/storage/v1/object/public/attachments/a.pdf`,name:'a.pdf'}]}, [], {
    env:{NEXT_PUBLIC_SUPABASE_URL:origin,LLM_API_KEY:'test'},
    extractPdf:async () => 'The project reduces review time by testing Figma changes.',
    fetcher:async (url, init) => {
      if (!init.body) return new Response('fake pdf');
      const body = JSON.parse(init.body); calls.push(body);
      return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'Prepared summary',files:[{name:'summary.md',content:'# Summary\nTests Figma changes to reduce review time.'}]})}}]});
    },
  });
  assert.equal(result.files[0].name,'summary.md');
  assert.ok(JSON.stringify(calls[0].messages).includes('reduces review time'));
  assert.equal(calls[0].chat_template_kwargs.enable_thinking,false);
});
test('image transcription uses vision and embeds the attached image', async () => {
  const result = await execute({title:'Transcribe',context:'put in txt',attachments:[{url:`${origin}/storage/v1/object/public/crops/a.png`,mime:'image/png',name:'a.png'}]}, [], {
    env:{NEXT_PUBLIC_SUPABASE_URL:origin,LLM_API_KEY:'test'},extractPdf:async()=>'',
    fetcher:async (url,init) => {
      if (!init.body) return new Response('pixels');
      const body=JSON.parse(init.body); assert.equal(body.model,'qwen3.8-27b-vision');
      assert.ok(body.messages[1].content.some(p=>p.type==='image_url'));
      return Response.json({choices:[{message:{content:'{"summary":"Transcribed","files":[{"name":"capture.txt","content":"visible words"}]}'}}]});
    },
  });
  assert.equal(result.files[0].content,'visible words');
});
test('truncated model output never becomes done', async () => {
  await assert.rejects(execute({title:'Task'}, [], {env:{LLM_API_KEY:'x'},fetcher:async()=>Response.json({choices:[{finish_reason:'length'}]})}), NeedsHuman);
});
const completed = () => Response.json({choices:[{message:{content:'{"summary":"Finished","files":[{"name":"result.txt","content":"Actual work"}]}'}}]});
test('provider failures switch to the next backend without losing source instructions', async () => {
  const calls=[], progress=[];
  const result=await execute({title:'Do the assignment',context:'Produce Java code'}, ['Use arrays'], {
    env:{LLM_API_KEY:'x'},progress:async message=>progress.push(message),
    fetcher:async(url,init)=>{const body=JSON.parse(init.body);calls.push(body);return calls.length===1?new Response('',{status:503}):completed();},
  });
  assert.equal(result.model,'qwen3.8-27b-sglang');
  assert.deepEqual(calls.map(call=>call.model),['qwen3.8-27b','qwen3.8-27b-sglang']);
  assert.deepEqual(calls[0].messages,calls[1].messages);
  assert.ok(progress.some(message=>message.includes('Switching from qwen3.8-27b to qwen3.8-27b-sglang: HTTP 503')));
});
test('a stalled model is aborted before switching to a healthy candidate', async () => {
  let firstSignal; const calls=[];
  const result=await execute({title:'Write a result'}, [], {
    env:{LLM_API_KEY:'x'},attemptTimeoutMs:15,budgetMs:1000,
    fetcher:async(url,init)=>{calls.push(JSON.parse(init.body).model);if(calls.length===1){firstSignal=init.signal;return new Promise(()=>{});}return completed();},
  });
  assert.equal(firstSignal.aborted,true);
  assert.equal(result.model,'qwen3.8-27b-sglang');
  assert.equal(calls.length,2);
});
test('the total deadline bounds stalled fetches including a stalled response body', async () => {
  const signals=[];
  const start=performance.now();
  await assert.rejects(execute({title:'Work'}, [], {
    env:{LLM_API_KEY:'x'},attemptTimeoutMs:1000,budgetMs:20,
    fetcher:async(url,init)=>{signals.push(init.signal);return {ok:true,json:async()=>new Promise(()=>{})};},
  }), /execution time budget exhausted/);
  assert.equal(signals.length,1);
  assert.equal(signals[0].aborted,true);
  assert.ok(performance.now()-start<1000);
});
test('source downloads share the whole execution deadline', async () => {
  let sourceSignal;
  await assert.rejects(execute({title:'Read',attachments:[{name:'input.txt',url:`${origin}/storage/v1/object/public/attachments/a.txt`}]}, [], {
    env:{LLM_API_KEY:'x',NEXT_PUBLIC_SUPABASE_URL:origin},budgetMs:20,
    fetcher:async(url,init)=>{sourceSignal=init.signal;return new Promise(()=>{});},
  }), /timed out/);
  assert.equal(sourceSignal.aborted,true);
});
test('malformed output is repaired once before a clean model switch', async () => {
  const calls=[];
  const result=await execute({title:'Work'}, [], {
    env:{LLM_API_KEY:'x'},fetcher:async(url,init)=>{const body=JSON.parse(init.body);calls.push(body);return body.model==='qwen3.8-27b'?Response.json({choices:[{message:{content:'not JSON'}}]}):completed();},
  });
  assert.deepEqual(calls.map(call=>call.model),['qwen3.8-27b','qwen3.8-27b','qwen3.8-27b-sglang']);
  assert.equal(calls[1].messages.length,4);assert.equal(calls[2].messages.length,2);
  assert.equal(result.files.length,1);
});
test('image failover never drops the source or routes to a text-only candidate', async () => {
  const calls=[];
  const result=await execute({title:'Read screenshot',crop_url:`${origin}/storage/v1/object/public/crops/a.png`}, [], {
    env:{NEXT_PUBLIC_SUPABASE_URL:origin,LLM_API_KEY:'x',LLM_MODELS:'text-a,text-b,qwen3-embeddings',LLM_VISION_FALLBACK_MODELS:'vision-backup'},
    fetcher:async(url,init)=>{if(!init.body)return new Response('pixels');const body=JSON.parse(init.body);calls.push(body);return calls.length===1?new Response('',{status:429}):completed();},
  });
  assert.deepEqual(calls.map(call=>call.model),['qwen3.8-27b-vision','vision-backup']);
  assert.ok(calls.every(call=>call.messages[1].content.some(part=>part.type==='image_url')));
  assert.equal(result.model,'vision-backup');
});
test('authentication failures do not cycle through models with the same rejected key', async () => {
  let calls=0;
  await assert.rejects(execute({title:'Task'}, [], {env:{LLM_API_KEY:'x'},fetcher:async()=>{calls++;return new Response('',{status:401});}}), /check LLM_API_KEY/);
  assert.equal(calls,1);
});
// Stateful query fake tests lifecycle and competing tick calls, not just generated JSON.
function database(seed = {}) {
  const state={workers:[],tasks:[],events:[],uploads:[],...seed};
  const db={from(table){
    let action='read', values, filters=[], selected=false, single=false, limit=Infinity, ignore=false;
    const q={ select(){selected=true;return q;}, single(){single=true;return q;}, eq(k,v){filters.push(r=>r[k]===v);return q;}, in(k,v){filters.push(r=>v.includes(r[k]));return q;}, order(){return q;},limit(n){limit=n;return q;},
      update(v){action='update';values=v;return q;},insert(v){action='insert';values=v;return q;},upsert(v,o){action='upsert';values=v;ignore=o.ignoreDuplicates;return q;},
      then(resolve,reject){return Promise.resolve().then(()=>{
        let rows=state[table].filter(r=>filters.every(f=>f(r))).slice(0,limit);
        if(action==='upsert'){let old=state[table].find(r=>r.id===values.id);if(!old){old={last_seen:'2026-01-01T00:00:00Z',...values};state[table].push(old);}else if(!ignore)Object.assign(old,values);rows=[old];}
        if(action==='insert'){const row={id:state[table].length+1,...values};state[table].push(row);rows=[row];}
        if(action==='update')rows.forEach(r=>Object.assign(r,values));
        return {data:structuredClone(single?rows[0]:rows),error:null};
      }).then(resolve,reject);}
    };return q;
  },async rpc(name,{p_worker}){const task=state.tasks.find(t=>t.status==='open');if(task)Object.assign(task,{status:'claimed',worker_id:p_worker});return {data:structuredClone(task||null),error:null};},
  storage:{from(){return {async upload(path,bytes){state.uploads.push({path,text:bytes.toString()});return {error:null};},getPublicUrl(path){return {data:{publicUrl:`${origin}/${path}`}};}};}}};
  return {db,state};
}
const workerId='01234567-89ab-4cde-8f01-234567890abc';
const options={workerId,env:{LLM_API_KEY:'x'},fetcher:async()=>Response.json({choices:[{message:{content:'{"summary":"Finished","files":[{"name":"result.txt","content":"Actual work"}]}'}}]})};
test('atomic worker reservation, claim, upload and completion', async()=>{
  const {db,state}=database({tasks:[{id:'t1',title:'Write something',status:'open'}]});
  const results=await Promise.all([tick(db,options),tick(db,options)]);
  assert.equal(results.filter(r=>r.status==='done').length,1);
  assert.equal(state.uploads.length,1);assert.equal(state.tasks[0].status,'done');
  assert.equal(state.tasks[0].result.files[0].name,'result.txt');assert.equal(state.workers[0].status,'idle');
});
test('fallback delivers once and later ticks leave completed tasks alone', async()=>{
  const {db,state}=database({tasks:[{id:'t1',title:'Work',status:'open'}]});
  let calls=0;
  const result=await tick(db,{...options,fetcher:async()=>++calls===1?new Response('',{status:503}):completed()});
  assert.equal(result.status,'done');assert.equal(state.tasks[0].result.model,'qwen3.8-27b-sglang');
  assert.equal(state.uploads.length,1);assert.equal(state.events.filter(event=>event.kind==='done').length,1);
  assert.equal(state.events.filter(event=>event.kind==='failed').length,0);
  assert.equal((await tick(db,options)).status,'idle');assert.equal(state.uploads.length,1);
});
test('human question yields queue and only a later answer resumes work',async()=>{
  const {db,state}=database({tasks:[{id:'t1',title:'Missing input',status:'open'}]});
  await tick(db,{...options,fetcher:async()=>Response.json({choices:[{message:{content:'{"question":"Which topic?"}'}}]})});
  assert.equal(state.tasks[0].status,'needs-human');assert.equal((await tick(db,options)).status,'idle');
  state.events.push({id:100,task_id:'t1',kind:'human-answer',payload:{text:'Weather'}});
  assert.equal((await tick(db,options)).status,'done');
});
test('provider failures release claim and stop after three attempts',async()=>{
  const {db,state}=database({tasks:[{id:'t1',title:'Work',status:'open'}]});
  const failing={...options,fetcher:async()=>new Response('',{status:503})};
  assert.equal((await tick(db,failing)).status,'retrying');assert.equal(state.tasks[0].worker_id,null);
  await tick(db,failing);assert.equal((await tick(db,failing)).status,'failed');
  assert.equal(state.tasks[0].retries,3);assert.equal(state.uploads.length,0);
});
