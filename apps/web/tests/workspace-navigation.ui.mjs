// Run via `bun run --filter @nautilus/web test:workspace-navigation`.
// Uses an isolated fixture API; never connects to an actual workspace database.
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const baseUrl = 'http://localhost:3100';
let nextServer;
let browser;
let serverLogs = '';

const counts={}; let releaseRooms; let blockRooms=true; let failDocuments=false; let org='org-a'; let created=[];
const roomsReady=new Promise(r=>releaseRooms=r);
const room=(id='room-1',name='Launch room')=>({id,name,description:'Plan the launch',category:'General',color:'green',status:'READY',lastActivityAt:'2026-11-08T12:00:00Z',agents:[],members:[],stars:[],documents:[],_count:{documents:55}});
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'); counts[url.pathname]=(counts[url.pathname]||0)+1;
 const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(url.pathname==='/api/me'){const organization={id:org,name:org==='org-a'?'Test workspace':'Other workspace',slug:org};return send({user:{id:'user',name:'Test User',email:'test@example.com',emailVerified:true,platformRole:'user'},memberships:[{organizationId:org,role:'owner',organization}],activeOrganization:organization,needsOrganizationSelection:false});}
 if(url.pathname.endsWith('/rooms')){
  if(req.method==='POST'){let body='';for await(const c of req)body+=c;const data=JSON.parse(body);const saved=room('created',data.name);created.push(saved);return send({room:saved});}
  if(blockRooms) await roomsReady;return send({rooms:[room(),...created]});
 }
 if(url.pathname.endsWith('/agents'))return send({agents:[]});
 if(url.pathname.endsWith('/documents')){
  if(failDocuments)return send({error:'Unavailable'},503);
  let docs=Array.from({length:55},(_,i)=>({id:'doc-'+String(i).padStart(3,'0'),title:`${org} Document ${i}`,kind:'DOCUMENT',status:'DRAFT',updatedAt:'2026-11-08',room:{id:'room-1',name:'Launch room'}}));
  const q=url.searchParams.get('q');if(q)docs=docs.filter(d=>d.title.toLowerCase().includes(q.toLowerCase()));
  const cursor=url.searchParams.get('cursor');if(cursor)docs=docs.filter(d=>d.id>cursor);
  return send({documents:docs.slice(0,50),nextCursor:docs.length>50?docs[49].id:null});
 }
 send({error:'unexpected '+url.pathname},404);
});
(async()=>{
 await new Promise(r=>server.listen(8791,'127.0.0.1',r));
 nextServer = spawn(process.execPath, [fileURLToPath(import.meta.resolve('next/dist/bin/next')), 'start', '--port', '3100'], {
   cwd: fileURLToPath(new URL('..', import.meta.url)),
   env: { ...process.env, API_ORIGIN: 'http://127.0.0.1:8791' }, stdio: ['ignore', 'pipe', 'pipe'],
 });
 nextServer.stdout.on('data', data => { serverLogs += data; });
 nextServer.stderr.on('data', data => { serverLogs += data; });
 let ready = false;
 for (let attempt = 0; attempt < 100; attempt++) {
   if (nextServer.exitCode !== null) throw new Error(serverLogs);
   try { await fetch(`${baseUrl}/login`); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
 }
 if (!ready) throw new Error('Test server did not start: ' + serverLogs);
 browser=await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}), headless:true });
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.setDefaultTimeout(12000);const errors=[];let navigations=0;
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===page.mainFrame())navigations++;});
 await page.context().addCookies([{name:'test-session',value:'test',url:baseUrl}]);
 try{
  await page.goto(`${baseUrl}/?view=Knowledge`);
  await page.getByRole('heading',{name:'Good work starts with good context.'}).waitFor();
  assert.equal(counts['/api/organizations/org-a/agents']||0,0);
  await page.evaluate(()=>window.savedShell=document.querySelector('.workspace-shell'));
  const shell=async()=>assert.ok(await page.evaluate(()=>window.savedShell===document.querySelector('.workspace-shell')),'workspace shell was replaced');
  async function nav(label,heading){await page.getByRole('link',{name:label,exact:true}).click();if(heading)await page.getByRole('heading',{name:heading,exact:true}).waitFor();await shell();}
  await nav('Activity','Workspace timeline');
  await nav('Documents','Your room documents');
  await page.getByRole('heading',{name:'org-a Document 0',exact:true}).waitFor();
  assert.equal(await page.locator('.document-card').count(),50);
  await page.getByRole('button',{name:'Load more documents'}).click();
  await page.getByRole('heading',{name:'org-a Document 54',exact:true}).waitFor();
  assert.equal(await page.locator('.document-card').count(),55);
  await page.getByLabel('Search documents').fill('Document 54');
  await page.waitForFunction(()=>document.querySelectorAll('.document-card').length===1);
  await page.getByLabel('Search documents').fill('');
  await page.getByRole('heading',{name:'org-a Document 0',exact:true}).waitFor();
  const documentCalls=counts['/api/organizations/org-a/documents'];
  await nav('Knowledge','Good work starts with good context.');
  await nav('Documents','Your room documents');
  await page.getByRole('heading',{name:'org-a Document 0',exact:true}).waitFor();
  assert.equal(counts['/api/organizations/org-a/documents'],documentCalls,'cached docs unexpectedly refetched');
  await nav('Kanban','Your team’s work.');
  await nav('Calendar','Your team’s calendar.');
  await page.goBack();await page.getByRole('heading',{name:'Your team’s work.'}).waitFor();await shell();
  await page.goForward();await page.getByRole('heading',{name:'Your team’s calendar.'}).waitFor();await shell();
  assert.equal(counts['/api/me'],1,'session refetched during tab navigation');
  assert.equal(navigations,1,'sidebar triggered document navigation');
  assert.equal(counts['/api/organizations/org-a/rooms'],1);
  // Create while the original summary request is still pending: its late response must not erase the mutation.
  await nav('Knowledge','Good work starts with good context.');
  await page.getByRole('button',{name:'Create a room with a brief',exact:true}).click();
  await page.getByLabel('Room name').fill('New launch room');
  await page.getByRole('button',{name:'Create room',exact:true}).last().click();
  await page.getByText('New launch room',{exact:true}).first().waitFor();
  blockRooms=false;releaseRooms();
  await page.getByText('Launch room',{exact:true}).first().waitFor();
  await nav('Activity','Workspace timeline');await page.getByText('New launch room',{exact:true}).waitFor();
  await nav('Rooms');await page.getByText('New launch room',{exact:true}).first().waitFor();
  await nav('Documents','Your room documents');
  failDocuments=true;await page.getByLabel('Search documents').fill('failure');
  await page.getByRole('button',{name:'Retry documents'}).waitFor();await shell();
  await nav('Knowledge','Good work starts with good context.');
  await nav('Documents','Your room documents');
  await page.getByLabel('Search documents').fill('failure');
  await page.getByRole('button',{name:'Retry documents'}).waitFor();
  failDocuments=false;await page.getByRole('button',{name:'Retry documents'}).click();
  await page.getByText('No matching documents.',{exact:true}).waitFor();
  await page.getByLabel('Search documents').fill('');
  await page.getByRole('heading',{name:'org-a Document 0',exact:true}).waitFor();
  org='org-b';await page.reload();
  await page.getByRole('heading',{name:'org-b Document 0',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'org-a Document 0',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS persistent shell, no repeated session/room loads on tab switches, slow-request isolation, cache reuse, pagination/search, task routes, history, mutation persistence, local retry, and organization isolation.');console.log(JSON.stringify(counts));
 }finally{releaseRooms();await browser.close();nextServer.kill();server.close();}
})().catch(async e=>{console.error(e); console.error(serverLogs); releaseRooms(); await browser?.close(); nextServer?.kill();server.close();process.exitCode=1});
