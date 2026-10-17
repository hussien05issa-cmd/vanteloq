import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { inventoryWorkflowAccess, mutateInventoryWorkflow, readInventoryWorkflowHistory, readInventoryWorkflows } from "../../../../server/workflow-inventory";
import { InventoryWorkflowError } from "../../../../domain/workflow-inventory";
import { recordAudit } from "../../../../server/audit";

export async function GET(request:Request) {
  return handleApi(request,async()=>{
    const access=await inventoryWorkflowAccess(request),params=new URL(request.url).searchParams;
    await enforceRateLimit("inventory-workflows:read",access.context.userId,90,60);
    const history=params.get("history");if(history)return jsonResponse(await readInventoryWorkflowHistory(access.actor,history));
    const locationId=params.get("locationId")||access.locations[0]?.id;
    if(!locationId)return jsonResponse({locations:access.locations,location:null,positions:[],records:[],receipts:[],orders:[],lots:[],movements:[],permissions:{stockWrite:false,receive:false,kinds:[],editableKinds:[]}});
    return jsonResponse({...await readInventoryWorkflows(access.actor,locationId),locations:access.locations.map(l=>({id:l.id,name:l.name,currency:l.currency,timezone:l.timezone}))});
  });
}
export async function POST(request:Request) {
  return handleApi(request,async({requestId})=>{
    requireSameOrigin(request);const access=await inventoryWorkflowAccess(request);
    await enforceRateLimit("inventory-workflows:write",access.context.userId,90,3600);
    const body=await readJsonObject(request,120_000);
    try {
      const result=await mutateInventoryWorkflow(access.actor,body);
      await recordAudit({request,requestId,organizationId:access.context.organizationId,actorUserId:access.context.userId,action:`inventory.workflow.${String(body.action)}`,resourceType:"inventory_workflow",resourceId:result.id,details:{locationId:String(body.locationId),replayed:result.replayed===true}});
      return jsonResponse(result);
    } catch(error) {if(error instanceof InventoryWorkflowError)throw new ApiError(400,"INVENTORY_WORKFLOW_INPUT",error.message);throw error;}
  });
}
