"use client";
import { useState } from "react";
import Link from "next/link";
import { PLANS } from "../server/entitlements/catalog";
import { planForCapacity } from "../domain/public-journey";
export default function PlanFit() {
  const [locations,setLocations]=useState(1),[users,setUsers]=useState(1);
  const key=planForCapacity(locations,users),plan=key ? PLANS[key] : null;
  return <section className="plan-fit" aria-labelledby="plan-fit-title"><div><p className="demo-eyebrow">FIND YOUR STARTING POINT</p><h2 id="plan-fit-title">How big is your team?</h2><p>Match your capacity, then compare the features below.</p></div><div className="plan-fit-inputs"><label>Locations<select value={locations} onChange={e=>setLocations(Number(e.target.value))}>{[1,2,3,4,5,6,7,8,9,10,11].map(n=><option key={n} value={n}>{n===11?"11 or more":n}</option>)}</select></label><label>Team members<select value={users} onChange={e=>setUsers(Number(e.target.value))}>{[1,2,3,5,10,15,20,25,26].map(n=><option key={n} value={n}>{n===26?"26 or more":n}</option>)}</select></label></div><div className="plan-fit-result" role="status" aria-live="polite"><span>{plan ? "Capacity match" : "Let’s discuss your needs"}</span><strong>{plan ? plan.displayName : "Custom plan"}</strong><Link href={plan ? "#plan-"+plan.key : "/custom-plan"}>{plan ? "Review this plan" : "Request a custom plan"} →</Link></div></section>;
}
