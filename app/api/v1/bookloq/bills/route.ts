import { getD1 } from "../../../../../db";
import { businessClock } from "../../../../../domain/intraday-sales";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../server/api";
import { requireAccess } from "../../../../../server/authorization";
import { requireBookLoQPermission } from "../../../../../server/bookloq";
import { requireAddon } from "../../../../../server/entitlements/engine";
import { requireOrganizationWideLocationAccess } from "../../../../../server/location-access";
import { effectivePermissions, requirePermission } from "../../../../../server/permissions";
import { supplierBillAccounting, supplierBillHistory } from "../../../../../server/supplier-bill-accounting";
import { idempotencyKey } from "../../../../../server/validation";

const readers=["owner","admin","manager","employee","read_only"] as const;
async function access(request:Request) {
  const context=await requireAccess(request,readers,"bookloq.ap");
  await requireAddon(context,"bookloq");await requireOrganizationWideLocationAccess(context);
  await requirePermission(context,"finance.ap_ar");await requirePermission(context,"finance.costs");await requirePermission(context,"customers.identity");
  return context;
}
export async function GET(request:Request) {
  return handleApi(request,async()=>{
    const context=await access(request),db=getD1(),id=new URL(request.url).searchParams.get("billId");
    const today=businessClock(new Date(),context.organization.timezone)!.date;
    if(id){if(id.length>80)throw new ApiError(400,"BILL_INPUT","Select a valid bill.");const history=await supplierBillHistory(db,context.organizationId,id),banking=(await effectivePermissions(context)).includes("finance.bank_transactions");return jsonResponse({...history,events:history.events.map(event=>({...event,sourceTransactionId:banking?event.sourceTransactionId:null})),today});}
    const canViewOrders=(await effectivePermissions(context)).includes("purchasing.view");
    const orders=canViewOrders?(await db.prepare("SELECT id,order_number orderNumber,supplier_name supplierName,delivery_location_id locationRef,subtotal_cents subtotalCents,tax_cents taxCents,total_cents totalCents,currency,status FROM purchase_orders WHERE organization_id=? AND status IN ('received','partially_received') ORDER BY order_date DESC,id LIMIT 101").bind(context.organizationId).all()).results??[]:[];
    return jsonResponse({orders:orders.slice(0,100),truncated:orders.length>100,today,boundary:"Whole-order bills require complete accepted receiving and exact supplier, currency, location and totals. Partial or disputed orders require a separate allocation review."});
  });
}
export async function POST(request:Request) {
  return handleApi(request,async({requestId})=>{
    requireSameOrigin(request);const context=await access(request);await enforceRateLimit("bookloq:bills:accounting",context.userId,45,3600);
    const body=await readJsonObject(request,16000),action=String(body.action);
    requireBookLoQPermission(context.role,action==="create"?"edit_drafts":action==="approve"?"approve_bills":"post_journals");
    if(!["create","approve"].includes(action))await requirePermission(context,"finance.journal_post");
    if(body.purchaseOrderId)await requirePermission(context,"purchasing.view");
    if(["approve","post","void"].includes(action)&&typeof body.billId==="string"){
      const linked=await getD1().prepare("SELECT purchase_order_ref id FROM supplier_bills WHERE organization_id=? AND id=?").bind(context.organizationId,body.billId).first<{id:string|null}>();
      if(linked?.id)await requirePermission(context,"purchasing.view");
    }
    if(action==="payment"||action==="reverse_payment"){await requirePermission(context,"finance.bank_balances");await requirePermission(context,"finance.bank_transactions");}
    const result=await supplierBillAccounting(getD1(),body,{organizationId:context.organizationId,actorUserId:context.userId,key:idempotencyKey(request),today:businessClock(new Date(),context.organization.timezone)!.date,request,requestId});
    return jsonResponse({event:result.event,replayed:result.replayed},{status:result.replayed?200:201});
  });
}
