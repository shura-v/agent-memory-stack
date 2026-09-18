import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setupServer } from '../dist/setup/server.js';
import { createTargetStore } from '../dist/setup/targets.js';
import { runtimeFor } from '../dist/runtime/compose.js';
import { runProcess } from '../dist/runtime/process.js';
import { encodeEnv, readEnv } from '../dist/config/files.js';
import { resolveDeployment } from '../dist/deployment/model.js';
import { listConnectionKeys, readConnectionKey } from '../dist/runtime/connection-keys.js';

// Integration test: temporary state and synthetic keys only. No provider login
// or model request. Real LLM semantics are a separate acceptance stage.
const enabled=process.env.AMS_RUNTIME_SMOKE === '1';
const engine=process.env.AMS_CONTAINER_ENGINE??'podman';
const provider=process.env.AMS_COMPOSE_PROVIDER??'uvx-podman-compose';
const manifestPath=resolve(process.env.AMS_IMAGE_MANIFEST??'artifacts/images/images.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test('installed service lifecycle, loopback boundary and cold credential restore', {skip:!enabled,timeout:360000}, async t=>{
 const dir=await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'ams-runtime-'));
 const project=`ams-${createHash('sha256').update(dir).digest('hex').slice(0,10)}`;
 const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
 await mkdir(join(dir,'.ams'));
 await writeFile(join(dir,'.ams/images.json'),JSON.stringify(manifest));
 let admin; // Capture the generated key without writing it outside Core.
 const answers={directory:dir,provider,
   MEMORY_PROXY_PUBLIC_URL:'https://models.synthetic.invalid',KNOWLEDGE_PUBLIC_URL:'https://wiki.synthetic.invalid',PANEL_PUBLIC_URL:'https://panel.synthetic.invalid',
   MEMORY_PROXY_PORT:'18096',KNOWLEDGE_PORT:'18422',KNOWLEDGE_TOOLS_PUBLIC_ENABLED:'true',PANEL_PORT:'18123',MCP_PORT:'18425',LLM_BASE_URL:'http://127.0.0.1:9/v1',LLM_API_KEY:'synthetic-provider-key',MEMORY_LLM_MODEL:'memory-fixture',KNOWLEDGE_LLM_MODEL:'wiki-fixture'};
 // Advanced network settings are configured through .env, not wizard answers.
 await writeFile(join(dir,'.env'),encodeEnv(Object.fromEntries(Object.entries(answers).filter(([name])=>/_PORT$|_PUBLIC_URL$/.test(name)||name==='KNOWLEDGE_TOOLS_PUBLIC_ENABLED'))),{mode:0o600});
 const command=provider==='uvx-podman-compose'?'uvx':provider;
 const prefix=provider==='uvx-podman-compose'?['podman-compose']:['docker','podman'].includes(provider)?['compose']:[];
 const compose=args=>runProcess({command,args:[...prefix,'--project-name',project,'--env-file',join(dir,'.ams/compose.env'),'-f',join(dir,'compose.yaml'),...args],cwd:dir});
 t.after(async()=>{await compose(['down']);});
 t.diagnostic(`Isolated installation: ${dir}`);
 const ui={async multiselect(_id,_message,_options,initial){return initial;},async text(q){const value=answers[q.id]??q.initial;assert.equal(typeof value,'string',q.id);return value;},async select(id,message,options,initial){return answers[id]??initial;},async confirm(id,message,initial){return id==='apply'?true:initial;},note(){},async handoff(key){admin=key;}};
 // Exercise real initialization; account-provider login belongs to separate acceptance.
 await setupServer(ui, { runtime: (...args) => ({ ...runtimeFor(...args), hasProviderAuthorization: async () => true }), targets: createTargetStore(join(dir, 'targets.json')) });
 assert.ok(typeof admin==='string'&&/^sk-ams-admin-[a-f0-9]{64}$/.test(admin),'setup hands off the generated administrator key before authentication');
 const connectionKeys=await listConnectionKeys(dir,provider);
 assert.equal(connectionKeys.length,1);
 assert.equal(connectionKeys[0].userType,'system_admin');
 assert.ok(!JSON.stringify(connectionKeys).includes(admin),'metadata listing does not reveal the key');
 assert.ok(await readConnectionKey(dir,provider,connectionKeys[0].keyId)===admin,'explicit lookup returns the handed-off key');
 const env=await readEnv(join(dir,'.env'));
 const interfaces=resolveDeployment(env).interfaces;
 const proxyOrigin=`http://127.0.0.1:${env.MEMORY_PROXY_PORT}`;
 const knowledgeOrigin=`http://127.0.0.1:${env.KNOWLEDGE_PORT}`;
 async function healthy() {
   for(const {port} of interfaces) {
     let ok=false;
     for(let attempt=0;attempt<60;attempt++){try{ok=(await fetch(`http://127.0.0.1:${port}/health`)).ok;}catch{}if(ok)break;await sleep(1000);}
     assert.ok(ok,`health ${port}`);
   }
 }
 await healthy();
 for(const path of ['/direct/v1/chat/completions','/v3/instance/proxy-destroy','/v0/management/auth-files']) {
   const response=await fetch(proxyOrigin+path,{method:'POST'});assert.equal(response.status,404,path);
 }
 assert.equal((await fetch(proxyOrigin+'/codex/ams/v1/responses',{method:'POST',body:'{}'})).status,401);
 assert.equal((await fetch(knowledgeOrigin+'/v3/tools/list',{method:'POST',headers:{'x-tdai-service-id':'ams','Content-Type':'application/json'},body:'{}'})).status,401);
 const ids=execFileSync(engine,['ps','-aq','--filter',`label=com.docker.compose.project=${project}`],{encoding:'utf8'}).trim().split('\n');
 const containers=JSON.parse(execFileSync(engine,['inspect',...ids],{encoding:'utf8'}));
 let bound=0;
 for(const container of containers) {
   for(const bindings of Object.values(container.HostConfig?.PortBindings??{})) for(const binding of bindings??[]){assert.equal(binding.HostIp,'127.0.0.1');bound++;}
   const logs=execFileSync(engine,['logs',container.Id],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
   assert.ok(!logs.includes(admin),'administrator secret absent from routine logs');
 }
 assert.equal(bound,interfaces.length);
 const bootstrap=async(directory,key)=>{
   const input=JSON.stringify({adminKey:key});
   return runProcess({command:engine,args:['run','--rm','-i','--network',project+'_stack','-v',`${directory}/generated:/config:ro`,'-e','AMS_ENV_FILE=/config/bootstrap-env.json',manifest.images.runtime.id,'--import','/app/runtime/environment.js','/app/runtime/bootstrap.js','initialize'],input});
 };
 const identity=JSON.parse(await bootstrap(dir,admin));
 await runtimeFor(dir,provider).apply();
 await healthy();
 const repeated=JSON.parse(await bootstrap(dir,admin));
 assert.equal(repeated.userId,identity.userId);assert.equal(repeated.created,false);
 assert.equal((await readEnv(join(dir,'.env'))).CORE_API_KEY,env.CORE_API_KEY);
 // Cold snapshot of authoritative data + persistent configuration. Stop all
 // writers, including the only OAuth refresher, before copying.
 await compose(['stop']);
 const backup=join(dir,'backups');await mkdir(backup,{mode:0o700});
 await runProcess({command:engine,args:['run','--rm','--network','none','--user','0:0','--entrypoint','tar',
   '-v',`${dir}/data:/data:ro`,'-v',`${dir}:/state:ro`,'-v',`${backup}:/out`,manifest.images.runtime.id,
   '-cf','/out/cold.tar','-C','/','data','-C','/state','.env','.ams/images.json','.ams/compose.env','.ams/runtime.json','compose.yaml']});
 await chmod(join(backup,'cold.tar'),0o600);
 const restored=join(dir,'restored');await mkdir(restored,{mode:0o700});
 await runProcess({command:engine,args:['run','--rm','--network','none','--user','0:0','--entrypoint','tar',
   '-v',`${backup}:/backup:ro`,'-v',`${restored}:/restore`,manifest.images.runtime.id,'-xf','/backup/cold.tar','-C','/restore']});
 // Restore into the same compose identity with isolated data/config mount paths.
 // No second account refresher is started by this Core-only recovery check.
 const restoredProject=project+'-restore';
 const restoreCompose=args=>runProcess({command,args:[...prefix,'--project-name',restoredProject,'--env-file',join(restored,'.ams/compose.env'),'-f',join(restored,'compose.yaml'),...args],cwd:restored});
 t.after(async()=>{await restoreCompose(['down']);});
 await restoreCompose(['run','--rm','--no-deps','config']);
 await restoreCompose(['up','-d','--no-deps','core']);
 let verified;
 for(let attempt=0;attempt<60;attempt++){
   try{verified=JSON.parse(await runProcess({command:engine,args:['run','--rm','-i','--network',restoredProject+'_stack','-v',`${restored}/generated:/config:ro`,'-e','AMS_ENV_FILE=/config/bootstrap-env.json',manifest.images.runtime.id,'/app/runtime/bootstrap.js','initialize'],input:JSON.stringify({adminKey:admin})}));break;}catch{await sleep(1000);}
 }
 assert.equal(verified?.userId,identity.userId);assert.equal(verified?.created,false);
 await writeFile(join(dir,'validation.json'),JSON.stringify({platform:manifest.images.core.platform,loopbackPorts:interfaces.length,administrator:identity.userId,recreate:true,coldCredentialRestore:true,modelAuthorization:'unverified',L0:'unverified',L1L2L3:'unverified',Wiki:'unverified'},null,2));
 t.diagnostic('Local lifecycle and cold credential restore passed; model, L0 and Wiki checks remain separate.');
});
