export function documentEmailAccessKey(organization:{role?:string;permissions?:string[];scopeLabel?:string;locations?:{id:string}[];selectedLocation?:{id:string}|null}){
  return JSON.stringify([organization.role??"",[...(organization.permissions??[])].sort(),organization.scopeLabel??"",(organization.locations??[]).map(location=>location.id).sort(),organization.selectedLocation?.id??null]);
}
/** A late response from an old permission scope must never restore a private address. */
export function createDocumentEmailRequests(){
  let active:AbortController|null=null;
  return {
    begin(){active?.abort();const controller=new AbortController();active=controller;return {signal:controller.signal,current:()=>active===controller&&!controller.signal.aborted};},
    cancel(){active?.abort();active=null;},
  };
}
