import assert from "node:assert/strict";
import test from "node:test";
import { createEnvironment, createReportWorkspace, dispatch, origin, context, identityHeaders } from "./helpers/retail-worker-fixture.mjs";

async function ok(response, status = 200) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }
async function member(env, workspace, role, permissions) {
  const userId = crypto.randomUUID(), roleId = crypto.randomUUID();
  const identity = {email:`collaboration-${userId}@example.invalid`,name:"Fictional teammate"};
  await env.database.batch([
    env.database.prepare("INSERT INTO users(id,email,display_name,status,created_at,updated_at) VALUES(?,?,'Fictional teammate','active',1,1)").bind(userId,identity.email),
    env.database.prepare("INSERT INTO memberships(id,user_id,organization_id,role,status,created_at,updated_at) VALUES(?,?,?,?,'active',1,1)").bind(crypto.randomUUID(),userId,workspace.organizationId,role),
    env.database.prepare("INSERT INTO access_roles(id,organization_id,name,permissions_json,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,1,1)").bind(roleId,workspace.organizationId,`Collaboration fixture ${roleId}`,JSON.stringify(permissions),workspace.userId),
    env.database.prepare("INSERT INTO team_members(id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,primary_location_id,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,'Fictional','Teammate',?,?,?,?,'active',1,?,1,1)").bind(crypto.randomUUID(),workspace.organizationId,userId,roleId,identity.email,userId,workspace.locationId,JSON.stringify([workspace.locationId]),workspace.userId),
  ]);
  return {...identity,userId};
}

test("team tasks and messages enforce workspace, location, permissions, retries and concurrent updates", {timeout:120000}, async () => {
  const env = await createEnvironment();
  try {
    const a = await createReportWorkspace(env.worker,env.environment,env.database,"collaboration-a"), b = await createReportWorkspace(env.worker,env.environment,env.database,"collaboration-b");
    const extraLocation = `${a.organizationId}:second`;
    await env.database.prepare("INSERT INTO organization_locations(id,organization_id,name,status,country_code,address_line_1,locality,administrative_area,postal_code,timezone,currency,locale,validation_status,created_at,updated_at) VALUES(?,?,'Second test shop','active','CA','2 Test Avenue','Edmonton','AB','T5A 1A1','America/Edmonton','CAD','en-CA','entered',1,1)").bind(extraLocation,a.organizationId).run();
    const teammate = await member(env,a,"employee",["operations.tasks","operations.manage"]), reader = await member(env,a,"read_only",["operations.tasks"]);
    const get = (path, who=a.owner) => dispatch(env.worker,env.environment,path,who);
    const post = (path,body,key=crypto.randomUUID(),who=a.owner) => dispatch(env.worker,env.environment,path,{...who,method:"POST",body,idempotencyKey:key});
    // A verified sign-in binds the team identity before it can be assigned work.
    await ok(await get("/api/v1/tasks",teammate)); await ok(await get("/api/v1/tasks",reader));
    const key = crypto.randomUUID();
    const content = {title:"Fictional stock review",detail:"Check the source records.",priority:"high",assigneeUserId:teammate.userId,locationId:a.locationId,dueDate:"2026-10-31"};
    const task = (await ok(await post("/api/v1/tasks",content,key),201)).task;
    assert.equal(task.assigneeUserId,teammate.userId);assert.equal(task.version,1);
    assert.equal((await ok(await post("/api/v1/tasks",content,key))).task.id,task.id);
    assert.equal((await post("/api/v1/tasks",{...content,title:"Changed task"},key)).status,409);
    assert.equal((await post("/api/v1/tasks",{...content,dueDate:"2026-02-30"})).status,400);
    assert.equal((await post("/api/v1/tasks",{...content,assigneeUserId:b.userId})).status,400);
    assert.equal((await post("/api/v1/tasks",{...content,locationId:b.locationId})).status,403);
    const globalTask = (await ok(await post("/api/v1/tasks",{title:"Owner-only global task"}),201)).task;
    const limited = await ok(await get("/api/v1/tasks",teammate));assert.equal(limited.tasks.some(row=>row.id===task.id),true);assert.equal(limited.tasks.some(row=>row.id===globalTask.id),false);
    const directory = await ok(await get(`/api/v1/collaboration/members?location=${encodeURIComponent(a.locationId)}`));
    assert.equal(directory.members.some(row=>row.id===teammate.userId),true);assert.equal(JSON.stringify(directory).includes(teammate.email),false);assert.equal(directory.members.some(row=>row.id===b.userId),false);
    const changed = (await ok(await dispatch(env.worker,env.environment,"/api/v1/tasks",{...teammate,method:"PATCH",body:{id:task.id,status:"in_progress",expectedVersion:1}}))).task;
    assert.equal(changed.version,2);
    assert.equal((await dispatch(env.worker,env.environment,"/api/v1/tasks",{...a.owner,method:"PATCH",body:{id:task.id,status:"done",expectedVersion:3}})).status,409);
    assert.equal((await dispatch(env.worker,env.environment,"/api/v1/tasks",{...a.owner,method:"PATCH",body:{id:task.id,status:"done",expectedVersion:1}})).status,409);
    assert.equal((await dispatch(env.worker,env.environment,"/api/v1/tasks",{...reader,method:"PATCH",body:{id:task.id,status:"done"}})).status,403);
    const legacyUpdate = (await ok(await dispatch(env.worker,env.environment,"/api/v1/tasks",{...a.owner,method:"PATCH",body:{id:task.id,status:"done"}}))).task;
    assert.equal(legacyUpdate.version,3);
    const message = {body:"Fictional team update <script>alert(1)</script>",locationId:a.locationId,taskId:task.id}, messageKey=crypto.randomUUID();
    const sent = (await ok(await post("/api/v1/collaboration/messages",message,messageKey,teammate),201)).message;
    assert.equal(sent.body,message.body);
    assert.equal((await ok(await post("/api/v1/collaboration/messages",message,messageKey,teammate))).message.id,sent.id);
    assert.equal((await post("/api/v1/collaboration/messages",{...message,body:"Changed message"},messageKey,teammate)).status,409);
    assert.equal((await post("/api/v1/collaboration/messages",message,crypto.randomUUID(),reader)).status,403);
    assert.equal((await post("/api/v1/collaboration/messages",{body:"Foreign task",taskId:task.id},crypto.randomUUID(),b.owner)).status,404);
    assert.equal((await get(`/api/v1/collaboration/messages?task=${globalTask.id}`,teammate)).status,404);
    assert.equal((await get(`/api/v1/collaboration/messages?location=${encodeURIComponent(extraLocation)}`,teammate)).status,403);
    assert.equal((await post("/api/v1/collaboration/messages",{body:"Wrong channel",taskId:task.id,locationId:extraLocation})).status,400);
    const thread=await ok(await get(`/api/v1/collaboration/messages?task=${task.id}`,reader));assert.equal(thread.messages.length,1);assert.equal(thread.canPost,false);
    assert.equal((await ok(await get(`/api/v1/collaboration/messages?location=${encodeURIComponent(a.locationId)}`))).messages.length,0);
    assert.equal((await post("/api/v1/collaboration/messages",{body:"x".repeat(4001),locationId:a.locationId})).status,400);
    const headers={...identityHeaders(a.owner.email,a.owner.name,true),origin:"https://unrelated.example","idempotency-key":crypto.randomUUID()};
    assert.equal((await env.worker.fetch(new Request(origin+"/api/v1/collaboration/messages",{method:"POST",headers,body:JSON.stringify(message)}),env.environment,context)).status,403);
    assert.equal((await env.database.prepare("SELECT COUNT(*) total FROM collaboration_messages WHERE organization_id=?").bind(a.organizationId).first()).total,1);
  } finally {await env.dispose();}
});
