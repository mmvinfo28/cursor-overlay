import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorized, attachmentUrl, download, execute, parseOutput, NeedsHuman, tick } from '../web/lib/worker.mjs';

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
