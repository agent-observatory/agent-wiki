import { readFile, writeFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Tiktoken } from 'js-tiktoken/lite';
import ranks from 'js-tiktoken/ranks/o200k_base';
const root='experiments/curation/model-selection/';
const sha=s=>createHash('sha256').update(s).digest('hex');
const fixturesText=await readFile(root+'cases.json','utf8'), prompt=await readFile(root+'prompt.txt','utf8');
const fixtures=JSON.parse(fixturesText), plan=JSON.parse(await readFile(root+'plan.json','utf8'));
const env=Object.fromEntries((await readFile('.env.local','utf8')).split('\n').filter(l=>/^DASHSCOPE_[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]}));
const endpoint=new URL(env.DASHSCOPE_BASE_URL);
if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.ap-southeast-1.maas.aliyuncs.com')||!env.DASHSCOPE_API_KEY) throw Error('Singapore credentials required');
const model=process.argv[2], variant=process.argv[3]??'small';
if(!plan.models.includes(model)||!['small','large'].includes(variant)) throw Error('Unsupported selection');
const lock=await open(root+`${model}-${variant}.attempt`,'wx'); await lock.close();
let report;try {report=JSON.parse(await readFile(root+'results.json','utf8'));} catch {report={startedAt:new Date().toISOString(),promptHash:sha(prompt),casesHash:sha(fixturesText),runs:[]};}
if(report.promptHash!==sha(prompt)||report.casesHash!==sha(fixturesText)) throw Error('Frozen inputs changed');
if(report.runs.length>=plan.maxTotalCalls||report.runs.reduce((s,r)=>s+(r.usage?.total_tokens??0),0)>=plan.maxReportedTokens) throw Error('Evaluation budget reached');
if(variant==='large'&&report.runs.filter(r=>r.variant==='large').length>=2) throw Error('Two long probes maximum');
const cases=fixtures.map(({expected,...x})=>x), tokenizer=new Tiktoken(ranks);
const tokenCount=s=>tokenizer.encode(s,[],[]).length;
let user=JSON.stringify({cases});
if(variant==='large') {
 const reference=[];
 // Deterministic unrelated project records, including stale proposals, code and
 // negation. Not a long-context claim extraction gold set.
 for(let n=0;;n++) {
  const next={session:`unrelated-${n}`,role:n%3?'user':'assistant',text:`독립 프로젝트 ${n}: 로컬에서는 SQLite, 배포에서는 PostgreSQL을 검토했다. 아직 도입 확정은 아니며 취소된 실험도 있다. 연결 점검은 SELECT ${n} AS sample; 결과를 읽을 뿐이다. 이 프로젝트 결정은 Agent Wiki에 적용하지 않는다. 임시 기록 ${n%17}.`};
  reference.push(next);
  const candidate=JSON.stringify({reference,cases});
  if(tokenCount(prompt)+tokenCount(candidate)+128>30000){reference.pop();break;}
 }
 user=JSON.stringify({reference,cases});
}
const body={model,enable_thinking:false,max_tokens:plan.maxOutputTokens,...(variant==='large'?{response_format:{type:'json_object'}}:{}),messages:[{role:'system',content:prompt},{role:'user',content:user}]};
const inputId=variant==='small'?'input-small.json':'input-large.json';
await writeFile(root+inputId,JSON.stringify({messages:body.messages},null,2)+'\n');
const run={model,variant,startedAt:new Date().toISOString(),inputHash:sha(user),estimatedInputTokens:tokenCount(prompt)+tokenCount(user)+128,requestBytes:Buffer.byteLength(JSON.stringify(body)),settings:{enable_thinking:false,max_tokens:plan.maxOutputTokens,...(variant==='large'?{response_format:{type:'json_object'}}:{})},status:'started'};
report.runs.push(run);await writeFile(root+'results.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({event:'started',...run}));
const begin=performance.now();
try {
 const response=await fetch(env.DASHSCOPE_BASE_URL.replace(/\/$/,'')+'/chat/completions',{method:'POST',redirect:'error',headers:{authorization:'Bearer '+env.DASHSCOPE_API_KEY,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(plan.timeoutMs)});
 run.httpStatus=response.status;
 if(!response.ok) {
  let error;try{error=await response.json()}catch{}
  run.error=String(error?.error?.code??error?.code??('HTTP_'+response.status)).slice(0,120);
  throw Error('provider_error');
 }
 const data=await response.json();
 run.usage=data.usage;run.returnedModel=data.model;run.finishReason=data.choices?.[0]?.finish_reason;
 run.content=data.choices?.[0]?.message?.content;
 // Never persist reasoning_content; only synthetic final output and usage.
 const out=JSON.parse(run.content);run.output=out;
 const fields=['id','action','target','verified','preservePrior','statement','evidence','reason'].sort();
 const results=out.results;
 run.schema=Array.isArray(results)&&results.length===fixtures.length&&Object.keys(out).join()==='results'&&new Set(results.map(o=>o.id)).size===fixtures.length&&results.every(o=>JSON.stringify(Object.keys(o).sort())===JSON.stringify(fields)&&typeof o.statement==='string'&&typeof o.reason==='string'&&typeof o.verified==='boolean'&&typeof o.preservePrior==='boolean'&&Array.isArray(o.evidence)&&o.evidence.every(e=>typeof e.sourceId==='string'&&typeof e.quote==='string'&&e.quote.length>0&&Object.keys(e).sort().join()==='quote,sourceId'));
 run.checks=fixtures.map(c=>{
  const o=results?.find(x=>x.id===c.id), sources=[c.incoming,c.prior.source,...(c.observations??[])], e=o?.evidence;
  const exact=Array.isArray(e)&&e.length>0&&e.every(q=>sources.some(s=>s.id===q.sourceId&&typeof q.quote==='string'&&q.quote.length>0&&s.text.includes(q.quote)));
  const coverage=Array.isArray(e)&&c.expected.requiredSources.every(id=>e.some(q=>q.sourceId===id));
  return {id:c.id,action:o?.action===c.expected.action,target:o?.target===c.expected.target,verification:o?.verified===c.expected.verified,preservePrior:o?.preservePrior===c.expected.preservePrior,exactEvidence:exact,sourceCoverage:coverage};
 });
 run.status='completed';
} catch(e) {run.status='failed';run.error??=e.name;}
run.ms=Math.round(performance.now()-begin);run.finishedAt=new Date().toISOString();
await writeFile(root+'results.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...run,content:undefined,output:undefined}));
