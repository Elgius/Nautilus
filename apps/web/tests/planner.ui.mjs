// Isolated browser/API fixture: no workspace database or live models.
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const baseUrl = 'http://localhost:3101';
const tasks = [], schedules = [];
const room = { id: 'room', name: 'Launch room', agents: [{ agent: { id: 'agent', name: 'Maya' } }] };
const organization = { id: 'org', name: 'Test workspace', slug: 'org' };
const server = http.createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost');
  const send = (data,status=200) => { res.writeHead(status,{'Content-Type':'application/json'}); res.end(JSON.stringify(data)); };
  let raw=''; for await(const part of req) raw+=part;
  const body=raw?JSON.parse(raw):{};
  if(url.pathname==='/api/me') return send({ user:{id:'user',name:'Test User',email:'test@example.com',emailVerified:true,platformRole:'user'}, memberships:[{organizationId:'org',role:'owner',organization}], activeOrganization:organization,needsOrganizationSelection:false });
  if(url.pathname.endsWith('/rooms/planner')) return send({rooms:[room]});
  if(url.pathname.endsWith('/rooms')) return send({rooms:[]});
  if(url.pathname.endsWith('/work')) return send({locked:false,queued:0,activities:[],expiresAt:null});
  if(url.pathname.endsWith('/tasks')) {
    if(req.method==='POST') { const existing=tasks.find(t=>t.id===body.id); if(!existing) tasks.push({...body,roomId:'room',revision:1}); return send({task:existing||tasks.at(-1)},201); }
    return send({tasks,nextCursor:null});
  }
  if(url.pathname.includes('/tasks/')) {
    const task=tasks.find(t=>url.pathname.endsWith('/'+t.id)); if(!task)return send({error:'Task not found'},404);
    if(req.method==='GET')return send({task:{...task,changes:[]}});
    if(body.expectedRevision!==task.revision)return send({error:'Task changed. Reload it before editing.'},409);
    if(req.method==='DELETE') { tasks.splice(tasks.indexOf(task),1); return send({task}); }
    Object.assign(task,body,{revision:task.revision+1}); return send({task});
  }
  if(url.pathname.endsWith('/schedules')) {
    if(req.method==='POST') { assert.ok(body.scheduledAt.endsWith('Z')); schedules.push({id:crypto.randomUUID(),scheduledAt:body.scheduledAt,state:'pending',event:body,deliveries:[{id:crypto.randomUUID(),agentId:'agent',state:'pending',executionState:null,result:null,executionError:null,lastError:null}]}); return send(schedules.at(-1),201); }
    return send({schedules,nextCursor:null});
  }
  if(url.pathname.includes('/schedules/')) { const schedule=schedules.find(s=>url.pathname.endsWith('/'+s.id)); if(!schedule)return send({error:'Schedule not found'},404); if(req.method==='DELETE')schedule.state='cancelled'; else schedule.scheduledAt=body.scheduledAt; return send(schedule); }
  send({error:'Unexpected path '+url.pathname},404);
});
let nextServer, browser, logs='';
try {
  await new Promise(resolve=>server.listen(8791,'127.0.0.1',resolve));
  nextServer=spawn(process.execPath,[fileURLToPath(import.meta.resolve('next/dist/bin/next')),'start','--port','3101'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,API_ORIGIN:'http://127.0.0.1:8791'},stdio:['ignore','pipe','pipe']});
  nextServer.stdout.on('data',d=>logs+=d);nextServer.stderr.on('data',d=>logs+=d);
  for(let i=0;i<100;i++){try{await fetch(baseUrl+'/login');break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
  browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.context().addCookies([{name:'test-session',value:'test',url:baseUrl}]);
  await page.goto(baseUrl+'/kanban');
  await page.getByRole('button',{name:'Add task',exact:true}).first().click();
  await page.getByLabel('Title',{exact:true}).fill('Prepare launch report');
  await page.getByLabel('Maya',{exact:true}).check();
  const now=new Date();const date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  await page.getByLabel('Due date',{exact:true}).fill(date);
  await page.getByRole('button',{name:'Save task',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Prepare launch report',exact:true}).click();
  await page.getByLabel('Scheduled instruction').fill('Prepare a report and leave it for review.');
  await page.getByLabel('Execution time').fill(date+'T23:59');
  await page.getByRole('button',{name:'Schedule assigned agents'}).click();
  await page.getByRole('button',{name:'Cancel schedule',exact:true}).waitFor();
  assert.equal(schedules.length,1);assert.equal(tasks.length,1);assert.equal(schedules[0].event.taskId,tasks[0].id);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('link',{name:'Calendar',exact:true}).click();
  await page.getByRole('button',{name:/Run .*Prepare launch report/}).waitFor();
  await page.getByRole('button',{name:/Run .*Prepare launch report/}).click();
  await page.getByRole('button',{name:'Cancel schedule',exact:true}).click();
  await page.getByText('cancelled',{exact:false}).first().waitFor();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.reload();
  await page.getByRole('button',{name:'Prepare launch report',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:/Run .*Prepare launch report/}).count(),0);
  await page.getByRole('button',{name:'Prepare launch report',exact:true}).click();
  await page.getByLabel('Title',{exact:true}).fill('A stale edit');
  tasks[0].revision++;tasks[0].title='Updated elsewhere';
  await page.getByRole('button',{name:'Save task',exact:true}).click();
  await page.getByRole('dialog').getByRole('alert').filter({hasText:'Task changed'}).waitFor();
  assert.equal(tasks[0].title,'Updated elsewhere');
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'/tmp/nautilus-planner.png',fullPage:true});
  console.log('PASS browser task creation, assignment, shared persistence, scheduler payload, calendar execution entry, cancellation, reload and stale-edit protection.');
} catch(error) { console.error(logs); throw error; }
finally { await browser?.close();nextServer?.kill();await new Promise(resolve=>server.close(resolve)); }
