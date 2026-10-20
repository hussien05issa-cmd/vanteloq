import { getD1,getR2 } from "../../../../../db";
import { businessClock } from "../../../../../domain/intraday-sales";
import { csvCell } from "../../../../../domain/csv";
import { ApiError,enforceRateLimit,handleApi,jsonResponse,readJsonObject,requireSameOrigin } from "../../../../../server/api";
import { requireAccess } from "../../../../../server/authorization";
import { requireAddon } from "../../../../../server/entitlements/engine";
import { requireOrganizationWideLocationAccess } from "../../../../../server/location-access";
import { effectivePermissions,requirePermission } from "../../../../../server/permissions";
import { requireBookLoQPermission } from "../../../../../server/bookloq";
import { idempotencyKey } from "../../../../../server/validation";
import { statementAccounts } from "../../../../../server/bank-statement";
import { visibleBookLoQTransaction } from "../../../../../server/bookloq-visibility";
import { archiveUnpostedBankCsv,bankAccounting,bankConfiguration,bankMatchCandidates,bankReconciliationPreview,bankSources,commitBankCsv,previewBankCsv,reopenBankReconciliation,completeBankReconciliation } from "../../../../../server/bank-workflows";
const readers=["owner","admin","manager","employee","read_only"] as const;
async function access(request:Request) {
  const context=await requireAccess(request,readers,"bookloq.transactions");await requireAddon(context,"bookloq");await requireOrganizationWideLocationAccess(context);
  for(const p of ["finance.bank_transactions","finance.bank_balances","finance.statements","finance.reconcile","payroll.totals"] as const)await requirePermission(context,p);
  return context;
}
export async function GET(request:Request) {
  return handleApi(request,async()=>{
    const context=await access(request),db=getD1(),q=new URL(request.url).searchParams,permissions=await effectivePermissions(context),identity=permissions.includes("customers.identity");
    await enforceRateLimit("bookloq:bank-workflows:read",context.userId,120,60);
    if(q.get("historyTransactionId")) {
      const id=q.get("historyTransactionId");if(!await db.prepare("SELECT id FROM financial_transactions WHERE organization_id=? AND id=?").bind(context.organizationId,id).first())throw new ApiError(404,"BANK_TRANSACTION","The bank movement is unavailable.");
      const events=await db.prepare("SELECT e.id,e.event_type eventType,e.event_date eventDate,e.amount_cents amountCents,e.journal_entry_id journalEntryId,e.reason,(SELECT r.id FROM bank_accounting_events r WHERE r.organization_id=e.organization_id AND r.reversal_of_event_id=e.id) reversedByEventId FROM bank_accounting_events e WHERE e.organization_id=? AND e.transaction_id=? ORDER BY e.created_at,e.rowid LIMIT 1001").bind(context.organizationId,id).all<{id:string;eventType:string;eventDate:string;amountCents:number;journalEntryId:string;reason:string;reversedByEventId:string|null}>();
      if((events.results??[]).length>1000)throw new ApiError(409,"BANK_HISTORY_LIMIT","This movement exceeds the supported complete history view.");
      return jsonResponse({events:(events.results??[]).map(e=>({...e,reason:identity?e.reason:""}))});
    }
    if(q.get("original")) {
      await requirePermission(context,"documents.view");
      await requirePermission(context,"customers.identity");
      const source=await db.prepare("SELECT object_key objectKey,source_digest sourceDigest,file_name fileName FROM bank_csv_imports WHERE organization_id=? AND id=? AND status='approved'").bind(context.organizationId,q.get("original")).first<{objectKey:string;sourceDigest:string;fileName:string}>();
      if(!source)throw new ApiError(404,"BANK_CSV_SOURCE","The retained CSV source is unavailable.");
      const file=await getR2().get(source.objectKey);if(!file||file.customMetadata?.organizationId!==context.organizationId||file.customMetadata?.sourceDigest!==source.sourceDigest)throw new ApiError(409,"BANK_CSV_SOURCE","The original CSV evidence is unavailable.");
      return new Response(file.body,{headers:{"Content-Type":"text/plain; charset=utf-8","Content-Disposition":`attachment; filename="${source.fileName.replace(/[^a-zA-Z0-9._-]/g,'_')}.txt"`,"X-Content-Type-Options":"nosniff","Cache-Control":"no-store","Content-Security-Policy":"default-src 'none'; sandbox"}});
    }
    if(q.get("transactionId")){const candidates=await bankMatchCandidates(db,context.organizationId,q.get("transactionId")!);return jsonResponse({candidates:candidates.map(c=>({...c,memo:identity&&permissions.includes("payroll.individual")?c.memo:""}))});}
    if(q.get("sourceId")) {
      const preview=await bankReconciliationPreview(db,context.organizationId,q.get("sourceType"),q.get("sourceId"));
      const visibleRows=preview.rows.map(r=>visibleBookLoQTransaction({...r,originalDescription:r.description},identity));
      if(q.get("export")==="csv") {
        await requirePermission(context,"finance.export");requireBookLoQPermission(context.role,"export_data");
        const content=[["Import","Source row","Bank date","Description","Amount cents","Currency","Ledger journal ID","Reconciliation state"],...visibleRows.map(r=>[preview.source.id,r.sourceRowNumber,r.postingDate,r.description,r.amountCents,r.currency,r.journalEntryId??"",r.reconciliationStatus])].map(r=>r.map(csvCell).join(",")).join("\r\n");
        return new Response(content,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=bookloq-bank-links.csv","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
      }
      const {snapshotJson:_snapshot,cashLines:_cashLines,...publicPreview}=preview;
      return jsonResponse({...publicPreview,rows:visibleRows,source:{...preview.source,fileName:identity&&permissions.includes("documents.view")?preview.source.fileName:"Bank statement evidence"},uncleared:preview.uncleared.map(l=>({...l,memo:identity&&permissions.includes("payroll.individual")?l.memo:""}))});
    }
    const config=await bankConfiguration(db,context.organizationId);
    const archived=await db.prepare("SELECT s.id,s.file_name fileName,s.start_date startDate,s.end_date endDate,v.reason FROM bank_csv_void_events v JOIN bank_csv_imports s ON s.id=v.import_id AND s.organization_id=v.organization_id WHERE v.organization_id=? ORDER BY v.created_at DESC LIMIT 100").bind(context.organizationId).all<{id:string;fileName:string;startDate:string;endDate:string;reason:string}>();
    return jsonResponse({currency:config.currency,today:businessClock(new Date(),context.organization.timezone)!.date,accounts:await statementAccounts(db,context.organizationId,config.currency,false),sources:(await bankSources(db,context.organizationId)).map(s=>({...s,fileName:identity&&permissions.includes("documents.view")?s.fileName:"Bank statement evidence"})),archivedSources:(archived.results??[]).map(s=>({...s,fileName:identity&&permissions.includes("documents.view")?s.fileName:"Bank statement evidence",reason:identity?s.reason:""}))});
  });
}
export async function POST(request:Request) {
  return handleApi(request,async({requestId})=>{
    requireSameOrigin(request);const context=await access(request),db=getD1();await enforceRateLimit("bookloq:bank-workflows:write",context.userId,60,3600);
    const body=await readJsonObject(request,450_000),ctx={organizationId:context.organizationId,actorUserId:context.userId,today:businessClock(new Date(),context.organization.timezone)!.date,request,requestId,key:""};
    if(body.action==="csv_preview"||body.action==="csv_import") {
      await requirePermission(context,"documents.view");await requirePermission(context,"documents.review");await requirePermission(context,"documents.upload");requireBookLoQPermission(context.role,"reconcile_accounts");
      if(body.action==="csv_preview"){const p=await previewBankCsv(db,body,ctx);return jsonResponse({preview:p.input.statement,previewFingerprint:p.input.fingerprint,sourceDigest:p.input.sourceDigest,replayed:!!p.previous});}
      return jsonResponse(await commitBankCsv(db,getR2(),body,ctx),{status:201});
    }
    if(body.action==="complete"){requireBookLoQPermission(context.role,"reconcile_accounts");return jsonResponse(await completeBankReconciliation(db,body,ctx));}
    if(body.action==="archive_csv"){await requirePermission(context,"documents.review");requireBookLoQPermission(context.role,"reconcile_accounts");return jsonResponse(await archiveUnpostedBankCsv(db,body,ctx));}
    if(body.action==="reopen"){requireBookLoQPermission(context.role,"reconcile_accounts");return jsonResponse(await reopenBankReconciliation(db,body,ctx));}
    await requirePermission(context,"finance.journal_post");requireBookLoQPermission(context.role,"post_journals");ctx.key=idempotencyKey(request);
    return jsonResponse(await bankAccounting(db,body,ctx),{status:201});
  });
}
