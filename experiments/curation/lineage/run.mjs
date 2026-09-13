// One small, synthetic, explicitly invoked model probe. Never touches Wiki state.
import { readFile, writeFile, open } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
const root = new URL('./', import.meta.url);
const env = parseEnv(await readFile('.env.local', 'utf8'));
const prompt = await readFile(new URL('prompt.txt', root), 'utf8');
const input = await readFile(new URL('input.json', root), 'utf8');
const expected = JSON.parse(await readFile(new URL('expected.json', root), 'utf8'));
const natural = process.argv.includes('--thinking-high');
const roomy = natural || process.argv.includes('--thinking-4096');
const thinking = roomy || process.argv.includes('--thinking');
const budget = roomy ? 4096 : 1024;
const marker = await open(new URL(natural ? 'thinking-high.attempt' : roomy ? 'thinking-4096.attempt' : thinking ? 'thinking.attempt' : 'attempt', root), 'wx'); await marker.close();
const body = { model: env.DASHSCOPE_MODEL, enable_thinking: thinking, ...(natural ? {reasoning_effort:"high"} : thinking ? {thinking_budget:budget} : {}), max_completion_tokens: roomy ? 8192 : 4096, response_format: { type: 'json_object' }, messages: [{role:'system',content:prompt},{role:'user',content:input}] };
const result = { model: body.model, expected, settings: { enable_thinking:thinking, thinking_budget:natural?null:thinking?budget:null, ...(natural?{reasoning_effort:"high"}:{}), max_completion_tokens:roomy?8192:4096 }, startedAt: new Date().toISOString(), inputHash: createHash('sha256').update(prompt+input).digest('hex'), calls: 1 };
const start = performance.now();
try {
  const response = await fetch(env.DASHSCOPE_BASE_URL.replace(/\/$/, '') + '/chat/completions', { method: 'POST', redirect:'error', headers: { authorization: 'Bearer '+env.DASHSCOPE_API_KEY, 'content-type':'application/json' }, body:JSON.stringify(body), signal:AbortSignal.timeout(120000) });
  result.httpStatus = response.status;
  if (!response.ok) throw Error('HTTP_'+response.status);
  const data = await response.json();
  result.usage = data.usage;
  result.finishReason = data.choices?.[0]?.finish_reason;
  result.output = JSON.parse(data.choices?.[0]?.message?.content ?? '');
  result.status = 'responded';
} catch (error) { result.status = 'failed'; result.error = error.name; }
result.ms = Math.round(performance.now()-start);
await writeFile(new URL(natural ? 'result-thinking-high.json' : roomy ? 'result-thinking-4096.json' : thinking ? 'result-thinking.json' : 'result.json', root), JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,output:undefined,expected:undefined}));
