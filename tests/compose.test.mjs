import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runtimeFor } from '../dist/runtime/compose.js';
import { ProcessFailure } from '../dist/runtime/process.js';
import { composeDocument, renderCompose } from '../dist/runtime/render-compose.js';
import { parse } from 'yaml';
import { resolveDeployment, serviceNames } from '../dist/deployment/model.js';
import { resolveSettings } from '../dist/config/settings.js';
import { encodeEnv } from '../dist/config/files.js';
import { imageServices } from '../dist/build/images.js';
const base = { LLM_BASE_URL:'https://provider.test.invalid/v1', LLM_API_KEY:'synthetic-provider', MEMORY_LLM_MODEL:'memory', KNOWLEDGE_LLM_MODEL:'wiki', CORE_API_KEY:'synthetic-core', CLIPROXY_API_KEY:'synthetic-model' };
const manifest = { schemaVersion:1, images:Object.fromEntries(imageServices.map((s,i)=>[s,{id:'sha256:'+String(i+1).repeat(64),tag:`${s}:test`,platform:'linux/arm64',repoDigests:[]}])) };
async function fixture(t, input=base) {
 const dir=await mkdtemp(join(tmpdir(),'ams-compose-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(join(dir,'.ams'));const settings=resolveSettings(input);
 await writeFile(join(dir,'.env'),encodeEnv(settings));await writeFile(join(dir,'.ams/images.json'),JSON.stringify(manifest));
 return {dir,settings,project:`ams-${createHash('sha256').update(dir).digest('hex').slice(0,10)}`};
}
function runner(project,{pending=[],fatal,owned=[],bootstrapFailure,connectionKeys=[],adminKey='synthetic-existing-admin'}={}) {
 const commands=[];
 return {commands,async run(c){
  commands.push(c);
  if(bootstrapFailure && c.args.includes('run') && c.args.includes('bootstrap') && !c.args.includes('initialize')) throw bootstrapFailure;
  if(c.args[0]==='run'&&c.args.includes('--stdin'))return JSON.stringify(fatal?{pending:[],error:fatal}:{pending});
  if(c.args[0]==='info')return JSON.stringify({host:{arch:'arm64'}});
  if(c.args[0]==='image')return JSON.stringify([{Id:c.args.at(-1),Os:'linux',Architecture:'arm64'}]);
  if(c.args[0]==='exec')return JSON.stringify(JSON.parse(c.input).operation==='list'?connectionKeys:adminKey);
  if(c.args[0]==='ps'&&c.args.includes('--no-trunc'))return 'a'.repeat(64);
  if(c.args[0]==='ps')return c.args.some(x=>x.startsWith('label=com.docker.compose.service='))?c.args.at(-1).split('=').at(-1):owned.map(x=>x.id).join('\n');
  if(c.args[0]==='inspect') {
   if(c.args[1]==='a'.repeat(64))return JSON.stringify([{Id:c.args[1],State:{Running:true},Config:{Labels:{'com.docker.compose.project':project,'com.docker.compose.service':'core'}}}]);
   if(owned.some(x=>c.args.includes(x.id)))return JSON.stringify(owned.map(x=>({Id:x.id,Config:{Labels:{'com.docker.compose.project':x.project??project,'com.docker.compose.service':x.service}}})));
   return JSON.stringify([{State:c.args.at(-1)==='bootstrap'?{Status:'exited',ExitCode:0}:{Status:'running',Health:{Status:'healthy'}}}]);
  }
  return '';
 }};
}
test('full stack Compose preserves all applications and optional loopback bindings',()=>{
 for(const internalSource of ['external', 'cliproxy']) {
  const env=resolveSettings({...base,INTERNAL_LLM_SOURCE:internalSource});
  const doc=composeDocument(env), plan=resolveDeployment(env), rendered=renderCompose(env);
  assert.deepEqual(parse(rendered,{version:'1.1'}),doc);
  assert.deepEqual(parse(rendered),doc);
  assert.deepEqual(Object.keys(doc.services).filter(x=>serviceNames.includes(x)).sort(),[...serviceNames].sort());
  assert.deepEqual(Object.keys(doc.services).sort(),[...plan.containers].sort());
  for(const service of Object.values(doc.services)) {
   for(const binding of service.ports??[])assert.match(binding,/^127\.0\.0\.1:/);
   for(const dependency of Object.keys(service.depends_on??{}))assert.ok(doc.services[dependency]);
  }
  assert.equal(JSON.stringify(doc).includes('ADMIN_KEY'),false);
 }
 const all=composeDocument(resolveSettings(base));assert.equal(Object.values(all.services).flatMap(x=>x.ports??[]).length,3);
});
test('initialization remains stdin-only and explicit readiness never starts native dependencies',async t=>{
 const {dir,project}=await fixture(t);const r=runner(project);const runtime=runtimeFor(dir,'uvx-podman-compose',r.run);
 const secret='private-admin-$literal';await runtime.apply(secret);
 const init=r.commands.find(c=>c.args.includes('initialize'));assert.equal(JSON.parse(init.input).adminKey,secret);
 assert.equal(init.safeErrorPrefix,'Bootstrap failed: ');
 assert.ok(r.commands.filter(c=>c!==init).every(c=>c.safeErrorPrefix===undefined));
 assert.ok(!r.commands.some(c=>JSON.stringify(c.args).includes(secret)||JSON.stringify(c.env??{}).includes(secret)));
 for(const c of r.commands.filter(c=>c.args.includes('up'))) { assert.ok(c.args.includes('--no-deps')); assert.equal(c.classifyPortConflict,true); }
 assert.ok(r.commands.filter(c=>c.command==='uvx'&&!c.args.includes('up')).every(c=>c.classifyPortConflict===false));
 r.commands.length=0;await runtime.apply();assert.ok(!r.commands.some(c=>c.args.includes('initialize')));
 const inventory=JSON.parse(await readFile(join(dir,'.ams/applied.json'),'utf8'));assert.ok(inventory.services.includes('knowledge'));
});
test('partial administrator initialization resumes with its existing credential before starting dependent services',async t=>{
 const {dir,project}=await fixture(t);
 const existingKey='synthetic-existing-admin';
 const r=runner(project,{owned:[{id:'old-core',service:'core'}],adminKey:existingKey,
  connectionKeys:[{userId:'user-1',username:'admin',userType:'system_admin',keyId:'key-1',name:'admin',suffix:'dmin'}]});
 await runtimeFor(dir,'podman-compose',r.run).apply(undefined,{createAdminKey:async()=>assert.fail('existing admin must be preserved')});
 assert.ok(r.commands.some(c=>c.args.includes('run')&&c.args.includes('bootstrap')));
 const initialization=r.commands.findIndex(c=>c.args.includes('initialize'));
 assert.deepEqual(JSON.parse(r.commands[initialization].input),{adminKey:existingKey});
 assert.ok(!r.commands.some(c=>JSON.stringify(c.args).includes(existingKey)||JSON.stringify(c.env??{}).includes(existingKey)));
 assert.ok(initialization<r.commands.findIndex(c=>c.args.includes('up')&&c.args.includes('knowledge')));
 assert.ok(r.commands.some(c=>c.args.includes('up')&&c.args.includes('cli-proxy-api')));
});
test('completed installation needs no administrator key lookup or repair',async t=>{
 const {dir,project}=await fixture(t);
 await writeFile(join(dir,'.ams/applied.json'),JSON.stringify({version:1,services:['core','bootstrap','config']}));
 const r=runner(project);
 await runtimeFor(dir,'podman-compose',r.run).apply(undefined,{createAdminKey:async()=>assert.fail('no generation')});
 assert.ok(!r.commands.some(c=>c.args.includes('initialize')||c.args[0]==='exec'));
});
test('partial installation without an active administrator key fails without generating or replacing one',async t=>{
 const {dir,project}=await fixture(t);const r=runner(project);
 await assert.rejects(runtimeFor(dir,'podman-compose',r.run).apply(undefined,{createAdminKey:async()=>assert.fail('no replacement key')}),/no active administrator key/);
 assert.ok(!r.commands.some(c=>c.args.includes('initialize')||c.args.includes('up')&&c.args.includes('knowledge')));
});
test('failed default entity repair leaves no successful applied inventory',async t=>{
 const {dir,project}=await fixture(t);
 const r=runner(project,{connectionKeys:[{userId:'user-1',username:'admin',userType:'system_admin',keyId:'key-1',name:'admin',suffix:'dmin'}]});
 const failure=new ProcessFailure('Bootstrap failed: Default agent is unavailable',1);
 const run=async c=>{const output=await r.run(c);if(c.args.includes('initialize'))throw failure;return output;};
 await assert.rejects(runtimeFor(dir,'podman-compose',run).apply(undefined,{createAdminKey:async()=>assert.fail('preserve original key')}),error=>error===failure);
 await assert.rejects(readFile(join(dir,'.ams/applied.json')),{code:'ENOENT'});
 assert.ok(!r.commands.some(c=>c.args.includes('up')&&c.args.includes('knowledge')));
});
test('interrupted reinitialization invalidates old Core completion and retries with the same saved key',async t=>{
 const {dir,project}=await fixture(t);
 const oldInventory={version:1,services:['core','bootstrap','config','knowledge']};
 const inventoryPath=join(dir,'.ams/applied.json');
 await writeFile(inventoryPath,JSON.stringify(oldInventory));
 const key='synthetic-regenerated-admin';
 const initial=runner(project,{bootstrapFailure:new ProcessFailure('Administrator missing',2)});
 const failed=new ProcessFailure('Default agent creation failed',1);
 const run=async c=>{
  const output=await initial.run(c);
  if(c.args.includes('initialize')) {
   assert.deepEqual(JSON.parse(await readFile(inventoryPath,'utf8')),{...oldInventory,coreInitialized:false});
   throw failed;
  }
  return output;
 };
 await assert.rejects(runtimeFor(dir,'podman-compose',run).apply(undefined,{createAdminKey:async()=>key}),error=>error===failed);
 const retry=runner(project,{adminKey:key,connectionKeys:[{userId:'user-1',username:'admin',userType:'system_admin',keyId:'key-1',name:'admin',suffix:'dmin'}]});
 await runtimeFor(dir,'podman-compose',retry.run).apply(undefined,{createAdminKey:async()=>assert.fail('reuse administrator created by failed apply')});
 assert.deepEqual(JSON.parse(retry.commands.find(c=>c.args.includes('initialize')).input),{adminKey:key});
 const completed=JSON.parse(await readFile(inventoryPath,'utf8'));
 assert.ok(completed.services.includes('core'));
 assert.notEqual(completed.coreInitialized,false);
});
test('fresh Core requests the generated key only after its missing-admin check',async t=>{
 const {dir,project}=await fixture(t);
 const r=runner(project,{bootstrapFailure:new ProcessFailure('No active administrator',2)});
 let requested=0;
 await runtimeFor(dir,'podman-compose',r.run).apply(undefined,{createAdminKey:async()=>{
  requested++;
  assert.ok(r.commands.some(c=>c.args.includes('inspect')&&c.args.at(-1)==='core'));
  assert.ok(r.commands.at(-1).args.includes('bootstrap'));
  assert.ok(!r.commands.some(c=>c.args.includes('initialize')));
  return 'synthetic-generated-admin';
 }});
 assert.equal(requested,1);
 const init=r.commands.find(c=>c.args.includes('initialize'));
 assert.deepEqual(JSON.parse(init.input),{adminKey:'synthetic-generated-admin'});
 assert.ok(!JSON.stringify(init.args).includes('synthetic-generated-admin'));
});
test('Core check failures never generate a key or attempt initialization',async t=>{
 const {dir,project}=await fixture(t);
 for(const bootstrapFailure of [new ProcessFailure('Core authentication failed',1),new ProcessFailure('Compose unavailable',125),new Error('Unknown check failure')]) {
  const r=runner(project,{bootstrapFailure});
  await assert.rejects(runtimeFor(dir,'podman-compose',r.run).apply(undefined,{createAdminKey:async()=>assert.fail('no generation after failed check')}),error=>error===bootstrapFailure);
  assert.ok(!r.commands.some(c=>c.args.includes('initialize')));
 }
});
test('cancelled key handoff leaves Core uninitialized',async t=>{
 const {dir,project}=await fixture(t);
 const r=runner(project,{bootstrapFailure:new ProcessFailure('No active administrator',2)});
 const cancelled=new Error('handoff cancelled');
 await assert.rejects(runtimeFor(dir,'podman-compose',r.run).apply(undefined,{createAdminKey:async()=>{throw cancelled;}}),error=>error===cancelled);
 assert.ok(!r.commands.some(c=>c.args.includes('initialize')));
});
test('full-stack preflight inspects all images and apply touches only its project containers',async t=>{
 const {dir,settings,project}=await fixture(t);
 const r=runner(project,{owned:[{id:'old-core',service:'core'},{id:'old-cli',service:'cli-proxy-api'},{id:'user-container',service:'core',project:'unrelated'}]});
 const runtime=runtimeFor(dir,'podman-compose',r.run);
 await runtime.preflight(manifest,settings);assert.equal(r.commands.filter(c=>c.args[0]==='image').length,7);
 await runtime.apply();
 assert.ok(!r.commands.some(c=>c.args[0]==='rm'));
 assert.ok(!r.commands.some(c=>['stop','rm'].includes(c.args[0])&&c.args.includes('user-container')));
 assert.ok(!r.commands.some(c=>c.args.includes('--volumes')||c.args.includes('initialize')));
 assert.ok(r.commands.some(c=>c.args.includes('up')&&c.args.includes('core')));
});
test('readiness uses container health without requiring patched TDAI APIs', async t => {
 const {dir,settings,project}=await fixture(t);
 const r=runner(project);const runtime=runtimeFor(dir,'podman-compose',r.run);
 await runtime.preflight(manifest,settings);
 await runtime.apply();
 assert.ok(!r.commands.some(c=>c.args.includes('--stdin') || JSON.stringify(c).includes('/ams/identity')));
 const failure=async c=>c.args[0]==='inspect'&&c.args.at(-1)==='knowledge'
   ? JSON.stringify([{State:{Status:'exited',ExitCode:1}}]) : r.run(c);
 await assert.rejects(runtimeFor(dir,'podman-compose',failure).apply(), /knowledge exited before readiness/);
});
test('device login owns only the local refresher and restarts after failure',async t=>{
 const {dir,project}=await fixture(t,base);
 const r=runner(project);const runtime=runtimeFor(dir,'podman-compose',async c=>{if(c.args.includes('-codex-device-login')){r.commands.push(c);throw new Error('login failed');}return r.run(c);});
 await assert.rejects(runtime.login('codex'),/login failed/);assert.ok(r.commands[0].args.includes('stop'));assert.ok(r.commands.at(-1).args.includes('up'));
 const login=r.commands.find(c=>c.args.includes('-codex-device-login'));assert.ok(login.args.includes('-no-browser'));assert.equal(login.interactive,true);
});
test('Claude login uses the headless provider flag and no published callback port',async t=>{
 const {dir,project}=await fixture(t,{...base,CLIPROXY_AUTH_PROVIDER:'claude'});
 const r=runner(project);await runtimeFor(dir,'podman-compose',r.run).login('claude');
 const login=r.commands.find(c=>c.args.includes('-claude-login'));
 assert.ok(login.args.includes('-no-browser'));assert.equal(login.interactive,true);
 assert.ok(!login.args.includes('--service-ports'));assert.ok(!login.args.includes('-codex-device-login'));
});
test('saved authorization probe mounts only auth data read-only and asks for the selected provider',async t=>{
 const {dir}=await fixture(t,base);
 const commands=[];
 const runtime=runtimeFor(dir,'podman',async c=>{commands.push(c);return c.args.at(-1)==='codex'?'true\n':'false\n';});
 assert.equal(await runtime.hasProviderAuthorization('codex'),true);
 assert.equal(await runtime.hasProviderAuthorization('claude'),false);
 for(const c of commands){
  assert.equal(c.args[c.args.indexOf('--network')+1],'none');
  assert.equal(c.args[c.args.indexOf('-v')+1],`${dir}/data/cli-proxy-api/auth:/auth:ro`);
  assert.equal(c.timeoutMs,15000);assert.equal(c.input,undefined);
 }
});


test('MCP uses only generated configuration and starts after protected Knowledge access', () => {
 const doc=composeDocument(resolveSettings(base));
 assert.deepEqual(doc.services.mcp.volumes, ['./generated/mcp.json:/config/mcp.json:ro']);
 assert.deepEqual(doc.services.mcp.ports, ['127.0.0.1:8425:8425']);
 assert.deepEqual(doc.services.mcp.depends_on.access, {condition:'service_healthy'});
 assert.equal(doc.services.access.ports, undefined);

});
