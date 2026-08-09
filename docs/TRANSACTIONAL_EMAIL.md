# Vanteloq transactional email

## Deployment status — August 9, 2026

- Cloudflare Email Routing is enabled for `vanteloq.com`; Cloudflare added and is syncing the required MX, SPF and routing DKIM records.
- No inbound alias is published yet because the monitored destination inbox still needs to be explicitly selected and verified.
- Cloudflare Email Sending is not enabled. The account requires a Workers Paid purchase before Cloudflare can send authentication email.
- The Supabase template pack is validated and deployment-ready. Hosted template activation waits on a production sender and authenticated Supabase dashboard or Management API access.

## Address policy

| Address | Use | Replies |
| --- | --- | --- |
| `noreply@vanteloq.com` | Authentication, account notices, invoices and receipts | Set `Reply-To: support@vanteloq.com` |
| `support@vanteloq.com` | Customer help and billing questions | Routes to the monitored support inbox |
| `security@vanteloq.com` | Suspicious access and account-security reports | Routes to the monitored owner/security inbox |
| `billing@vanteloq.com` | Optional public billing contact | Routes to support until a billing team exists |
| `dmarc-reports@vanteloq.com` | Automated DMARC aggregate reports | Dedicated mailbox or reporting service only |

Never send marketing campaigns from the authentication sender. Keep `noreply@vanteloq.com` transactional so password-reset and verification deliverability is not tied to campaign reputation.

## Production sender

Supabase Auth must use a custom SMTP provider or a Send Email Hook before the application accepts public signups. The shared Supabase mailer is restricted and is not a production sender.

The preferred Vanteloq headers are:

```text
From: Vanteloq <noreply@vanteloq.com>
Reply-To: Vanteloq Support <support@vanteloq.com>
```

Cloudflare Email Sending is the preferred API sender when the Cloudflare account has Workers Paid. Onboard `vanteloq.com`, publish Cloudflare's SPF and DKIM records, add DMARC, deploy a webhook-verifying Send Email Hook, and enable that hook in Supabase Auth. Until then, use a reputable SMTP provider supported by Supabase rather than the shared test mailer.

Recommended DMARC starting policy after SPF and DKIM pass:

```text
v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@vanteloq.com
```

## Templates

The thirteen branded templates in `supabase/templates` cover all current Supabase authentication emails and security notifications. `npm run email:validate` validates the pack without contacting Supabase. `npm run email:deploy` applies it through the Supabase Management API when `SUPABASE_ACCESS_TOKEN` is present.

Supabase projects created after June 3, 2026 on Free cannot customize templates while using the default mailer. Configure the production sender first, then deploy the templates.
