# Security and reliability runbooks

| Scenario | Detection | Immediate containment | Recovery |
|---|---|---|---|
| Application outage | Uptime/readiness failure | Freeze deployments; identify edge vs app vs D1 | Roll back compatible artifact or restore service; verify health and key flows |
| Elevated errors/latency | Error or p95 alert | Limit expensive traffic; isolate failing dependency | Patch or degrade safely; confirm normal metrics |
| Failed-login spike | Authentication/401 anomaly | Tighten edge challenge/rate policy; preserve source context | Review account takeover indicators and notify affected users if confirmed |
| Suspected tenant escape | Cross-tenant access evidence | Disable affected endpoint and exports immediately | Fix policy/query, analyze audit scope, rotate affected access, legal review |
| Leaked secret | Secret scan/provider alert | Revoke/rotate first; block affected integration | Replace hosted secret, redeploy only if needed, search logs/history safely |
| Malicious upload | Scanner/import alert | Quarantine object and stop processing | Delete safely, review tenant activity, patch validation, re-enable after test |
| Provider/webhook failure | Sync freshness/replay alert | Pause retries that could duplicate changes | Repair signature/idempotency logic, replay verified events only |
| Queue backlog | Oldest-job/failed-job alert | Pause producers or lower concurrency safely | Resolve dependency, drain idempotently, inspect dead letters |
| Failed deployment | Deployment terminal failure | Keep prior version serving | Correct source/migration and create a new immutable deployment |
| Backup failure | Missing/old backup alert | Protect current data and block destructive maintenance | Restore backup job, create verified point, schedule immediate restore test |
| DDoS/cost abuse | Edge/rate/storage spike | Cloudflare managed challenge, WAF, emergency limits | Tune policy, review false positives, document attack and cost |
| Domain/certificate issue | Expiry/TLS probe | Freeze DNS changes; use provider support path | Restore validated DNS/TLS configuration and verify externally |

Every incident records severity, detection and containment times, affected tenants, evidence locations, decision owners, communications, recovery validation, and follow-up actions.

