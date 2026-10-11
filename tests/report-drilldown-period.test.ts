import assert from "node:assert/strict";
import test from "node:test";
import { commerceDrilldownPeriod } from "../domain/report-drilldown-period";

test("catalogue drilldown retains explicit boundaries and fills only reviewed resolved boundaries", () => {
  assert.deepEqual(commerceDrilldownPeriod({from:"2026-09-03",to:"2026-09-28"},{from:"2026-09-01",to:"2026-09-30"}),{from:"2026-09-01",to:"2026-09-30"});
  assert.deepEqual(commerceDrilldownPeriod({from:"2026-09-03",to:"2026-09-28"},{from:"",to:"2026-09-30"}),{from:"2026-09-03",to:"2026-09-30"});
  assert.deepEqual(commerceDrilldownPeriod({from:"2026-09-03",to:"2026-09-28"},{from:"",to:""}),{from:"2026-09-03",to:"2026-09-28"});
});

test("empty or invalid ranges cannot silently become the latest 30 days", () => {
  for (const requested of [{from:"",to:"2026-09-30"},{from:"2026-09-01",to:""},{from:"",to:""},{from:"2026-02-30",to:"2026-03-01"},{from:"2026-10-01",to:"2026-09-30"}])
    assert.equal(commerceDrilldownPeriod({from:null,to:null},requested),null);
});
