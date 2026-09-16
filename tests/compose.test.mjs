import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runtimeFor, integrationConfig } from '../dist/runtime/compose.js';
import { composeDocument, renderCompose } from '../dist/runtime/render-compose.js';
import { parse } from 'yaml';
import { resolveDeployment, serviceNames } from '../dist/deployment/model.js';
import { validateEnv } from '../dist/config/settings.js';
import { encodeEnv } from '../dist/config/files.js';
import { imageServices } from '../dist/build/images.js';
const base = { LLM_BASE_URL:'https://provider.test.invalid/v1', LLM_API_KEY:'synthetic-provider', MEMORY_LLM_MODEL:'memory', KNOWLEDGE_LLM_MODEL:'wiki', CORE_API_KEY:'synthetic-core', CLIPROXY_API_KEY:'synthetic-model' };
const manifest = { schemaVersion:1, images:Object.fromEntries(imageServices.map((s,i)=>[s,{id:'sha256:'+String(i+1).repeat(64),tag:`${s}:test`,platform:'linux/arm64',repoDigests:[]}])) };
async function fixture(t, input=base) {
 const dir=await mkdtemp(join(tmpdir(),'ams-compose-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(join(dir,'.ams'));const settings=validateEnv(input);
 await writeFile(join(dir,'.env'),encodeEnv(settings));await writeFile(join(dir,'.ams/images.json'),JSON.stringify(manifest));
 return {dir,settings,project:`ams-${createHash('sha256').update(dir).digest('hex').slice(0,10)}`};
}
function runner(project,{pending=[],fatal,owned=[]}={}) {
 const commands=[];
 return {commands,async run(c){
  commands.push(c);
  if(c.args[0]==='run'&&c.args.includes('--stdin'))return JSON.stringify(fatal?{pending:[],error:fatal}:{pending});
  if(c.args[0]==='info')return JSON.stringify({host:{arch:'arm64'}});
  if(c.args[0]==='image')return JSON.stringify([{Id:c.args.at(-1),Os:'linux',Architecture:'arm64'}]);
  if(c.args[0]==='ps')return c.args.some(x=>x.startsWith('label=com.docker.compose.service='))?c.args.at(-1).split('=').at(-1):owned.map(x=>x.id).join('\n');
  if(c.args[0]==='inspect') {
   if(owned.some(x=>c.args.includes(x.id)))return JSON.stringify(owned.map(x=>({Id:x.id,Config:{Labels:{'com.docker.compose.project':x.project??project,'com.docker.compose.service':x.service}}})));
   return JSON.stringify([{State:c.args.at(-1)==='bootstrap'?{Status:'exited',ExitCode:0}:{Status:'running',Health:{Status:'healthy'}}}]);
  }
  return '';
 }};
}
test('all explicit service subsets render exactly their local applications and loopback bindings',()=>{
 for(let mask=1;mask<32;mask++) {
  const selected=serviceNames.filter((_,i)=>mask&(1<<i));
  const env=validateEnv({...base,AMS_DEPLOYMENT_VERSION:'1',AMS_SERVICES:selected.join(','),REMOTE_CORE_URL:'http://core.remote',REMOTE_CORE_API_KEY:'remote-core',REMOTE_PANEL_URL:'http://panel.remote',REMOTE_MODEL_BASE_URL:'http://models.remote/v1',REMOTE_MODEL_API_KEY:'remote-model'});
  const doc=composeDocument(env), plan=resolveDeployment(env);
  const rendered=renderCompose(env);
  assert.deepEqual(parse(rendered,{version:'1.1'}),doc,'YAML 1.1 Compose providers preserve scalar types');
  assert.deepEqual(parse(rendered),doc,'YAML 1.2 preserves scalar types');
  assert.deepEqual(Object.keys(doc.services).filter(x=>serviceNames.includes(x)).sort(),[...selected].sort());
  assert.deepEqual(Object.keys(doc.services).sort(),[...plan.containers].sort());
  for(const service of Object.values(doc.services)) {
   for(const binding of service.ports??[])assert.match(binding,/^127\.0\.0\.1:/);
   for(const dependency of Object.keys(service.depends_on??{}))assert.ok(doc.services[dependency]);
  }
  assert.equal(JSON.stringify(doc).includes('ADMIN_KEY'),false);
 }
 const all=composeDocument(validateEnv(base));assert.equal(Object.values(all.services).flatMap(x=>x.ports??[]).length,2);
});
test('initialization remains stdin-only and explicit readiness never starts native dependencies',async t=>{
 const {dir,project}=await fixture(t);const r=runner(project);const runtime=runtimeFor(dir,'uvx-podman-compose',r.run);
 const secret='private-admin-$literal';await runtime.apply(secret);
 const init=r.commands.find(c=>c.args.includes('initialize'));assert.equal(JSON.parse(init.input).adminKey,secret);
 assert.ok(!r.commands.some(c=>JSON.stringify(c.args).includes(secret)||JSON.stringify(c.env??{}).includes(secret)));
 for(const c of r.commands.filter(c=>c.args.includes('up'))) { assert.ok(c.args.includes('--no-deps')); assert.equal(c.classifyPortConflict,true); }
 assert.ok(r.commands.filter(c=>c.command==='uvx'&&!c.args.includes('up')).every(c=>c.classifyPortConflict===false));
 r.commands.length=0;await runtime.apply();assert.ok(!r.commands.some(c=>c.args.includes('initialize')));
 const inventory=JSON.parse(await readFile(join(dir,'.ams/applied.json'),'utf8'));assert.ok(inventory.services.includes('knowledge-service'));
});
test('existing application detection requires every configured service in this project, regardless of state',async t=>{
 const {dir,project}=await fixture(t);
 const complete=serviceNames.map(service=>({id:`old-${service}`,service}));
 const all=runner(project,{owned:complete});
 assert.equal(await runtimeFor(dir,'podman-compose',all.run).hasApplicationContainers(),true);
 assert.ok(all.commands.every(c=>['ps','inspect'].includes(c.args[0])));
 for(const owned of [complete.slice(1),complete.map(item=>({...item,project:'unrelated'})),[]]) {
  const partial=runner(project,{owned});
  assert.equal(await runtimeFor(dir,'podman-compose',partial.run).hasApplicationContainers(),false);
 }
});
test('CLI-only preflight inspects required images and apply removes only this project containers without volumes',async t=>{
 const {dir,settings,project}=await fixture(t,{AMS_DEPLOYMENT_VERSION:'1',AMS_SERVICES:'cli-proxy-api',CLIPROXY_API_KEY:'local-key'});
 const r=runner(project,{owned:[{id:'old-core',service:'core'},{id:'old-cli',service:'cli-proxy-api'},{id:'user-container',service:'core',project:'unrelated'}]});
 const runtime=runtimeFor(dir,'podman-compose',r.run);
 const subset={schemaVersion:1,images:{'cli-proxy-api':manifest.images['cli-proxy-api'],runtime:manifest.images.runtime}};
 await runtime.preflight(subset,settings);assert.equal(r.commands.filter(c=>c.args[0]==='image').length,2);
 await runtime.apply();
 const remove=r.commands.find(c=>c.args[0]==='rm');assert.deepEqual(remove.args,['rm','old-core']);
 assert.ok(!r.commands.some(c=>['stop','rm'].includes(c.args[0])&&c.args.includes('user-container')));
 assert.ok(!r.commands.some(c=>c.args.includes('-v')||c.args.includes('--volumes')||c.args.includes('initialize')));
 assert.ok(!r.commands.some(c=>c.args.includes('up')&&c.args.includes('core')));
});
test('remote probes use consuming network and pending differs from rejected authentication',async t=>{
 const {dir,settings,project}=await fixture(t,{AMS_DEPLOYMENT_VERSION:'1',AMS_SERVICES:'memory-proxy',REMOTE_CORE_URL:'http://core.remote',REMOTE_CORE_API_KEY:'remote-core',REMOTE_MODEL_BASE_URL:'http://models.remote/v1',REMOTE_MODEL_API_KEY:'remote-model'});
 const plan=resolveDeployment(settings);assert.deepEqual(integrationConfig(plan,'preflight').checks.map(x=>x.kind),['core','model']);
 const r=runner(project,{pending:['core']});const runtime=runtimeFor(dir,'podman-compose',r.run);
 assert.deepEqual(await runtime.preflight(manifest,settings),{pending:['core']});
 const probe=r.commands.find(c=>c.args.includes('--stdin'));assert.equal(probe.args[probe.args.indexOf('--network')+1],`${project}_stack`);
 await assert.rejects(runtime.apply(),/Integration is pending/);assert.deepEqual(await runtime.apply(undefined,{allowPending:true}),{pending:['core']});
 const denied=runner(project,{fatal:'Core authentication rejected'});
 await assert.rejects(runtimeFor(dir,'podman-compose',denied.run).preflight(manifest,settings),/Core authentication rejected/);
 assert.ok(!denied.commands.some(c=>c.args.includes('stop')));
});
test('device login owns only the selected local refresher and restarts after failure',async t=>{
 const {dir,project}=await fixture(t,{AMS_DEPLOYMENT_VERSION:'1',AMS_SERVICES:'cli-proxy-api',CLIPROXY_API_KEY:'local-key'});
 const r=runner(project);const runtime=runtimeFor(dir,'podman-compose',async c=>{if(c.args.includes('-codex-device-login')){r.commands.push(c);throw new Error('login failed');}return r.run(c);});
 await assert.rejects(runtime.login('codex'),/login failed/);assert.ok(r.commands[0].args.includes('stop'));assert.ok(r.commands.at(-1).args.includes('up'));
 const login=r.commands.find(c=>c.args.includes('-codex-device-login'));assert.ok(login.args.includes('-no-browser'));assert.equal(login.interactive,true);
});
test('Claude login uses the headless provider flag and no published callback port',async t=>{
 const {dir,project}=await fixture(t,{AMS_DEPLOYMENT_VERSION:'1',AMS_SERVICES:'cli-proxy-api',CLIPROXY_API_KEY:'local-key',CLIPROXY_AUTH_PROVIDER:'claude'});
 const r=runner(project);await runtimeFor(dir,'podman-compose',r.run).login('claude');
 const login=r.commands.find(c=>c.args.includes('-claude-login'));
 assert.ok(login.args.includes('-no-browser'));assert.equal(login.interactive,true);
 assert.ok(!login.args.includes('--service-ports'));assert.ok(!login.args.includes('-codex-device-login'));
});
test('saved authorization probe mounts only auth data read-only and asks for the selected provider',async t=>{
 const {dir}=await fixture(t,{AMS_DEPLOYMENT_VERSION:'1',AMS_SERVICES:'cli-proxy-api',CLIPROXY_API_KEY:'local-key'});
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
