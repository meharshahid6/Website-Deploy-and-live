# Custom domains and Hostinger

The free `pages.dev` address is sufficient. A custom domain is optional and has its normal registrar purchase/renewal cost. LaunchDock does not purchase or renew domains.

## Safe order

1. Publish the website and obtain a successful Pages deployment first.
2. Open the project’s **Deployments → Connect domain**.
3. Enter the domain or subdomain, or load your Hostinger domain portfolio if connected.
4. Select **Check domain**. LaunchDock uses the Public Suffix List to distinguish `shop.example.co.uk` from the apex `example.co.uk`. Private suffixes such as `github.io` are rejected.
5. An accessible Cloudflare zone is reused. If no accessible zone exists, **Create free zone** asks for confirmation. It will not modify another account’s zone. If you already own a zone in another account, connect that account instead.
6. Review the assigned Cloudflare nameservers and the current public delegation.
7. Copy your full current DNS zone into Cloudflare, including MX, SPF, DKIM, DMARC and unrelated subdomains. The wizard’s record list shows only the requested hostname; it is not a complete zone backup. Verify DNSSEC/DS configuration with Hostinger before changing delegation. Do not blindly remove DNSSEC or unrelated records.
8. Confirm that you reviewed DNS. Use the Hostinger API update if authorized, or the manual instructions below.
9. **Attach to Pages** asks for confirmation and attaches exactly the requested hostname. LaunchDock adds the matching CNAME to `<project>.pages.dev`. Existing conflicting A, AAAA or CNAME records cause a refusal; no records are replaced or deleted.
10. Leave the wizard open. It checks Cloudflare zone state, public NS answers, Pages custom-domain state and SSL validation every 30 seconds. The final live link appears only after Pages reports an active custom domain. Both delegation and Pages state must be checked; neither alone proves the whole migration is finished.

## One-time manual Hostinger nameserver change

This is fully supported if the API is unavailable. No Hostinger login automation is used.

1. Open https://hpanel.hostinger.com/domains and sign in directly.
2. Open **Domains → Domain portfolio → Manage** for the apex domain.
3. Open **DNS / Nameservers → Change nameservers**.
4. Choose the option to use your own/custom nameservers.
5. In LaunchDock, use the **Copy** buttons for the assigned Cloudflare nameservers. Paste the exact values into Hostinger and remove only the old nameserver values being replaced.
6. Save in Hostinger and return to LaunchDock. Select **Check again**, or wait for automatic checks while the wizard is open.

Menu labels can vary by account language and hPanel layout. Hostinger’s own guide: https://www.hostinger.com/support/1696789-how-to-change-nameservers-at-hostinger/.

Hostinger is the registrar. Website files are hosted only on Cloudflare Pages. Changing nameservers does not transfer ownership of the domain or cancel its renewal.

## API update

The verified official endpoint is `PUT https://developers.hostinger.com/api/domains/v1/portfolio/{apex}/nameservers`, with `ns1` and `ns2`. A connected Hostinger account must own/manage the selected domain. LaunchDock displays old and new values, requires a DNS review checkbox and an explicit confirmation, and rechecks delegation before mutation. If permissions or account capabilities prevent the operation, use the manual wizard. Provider passwords are never requested or stored.

Reference: https://developers.hostinger.com/#tag/domains-portfolio.

## Troubleshooting

- **Domain already points elsewhere:** inspect Cloudflare’s existing record and the other service’s custom-domain settings. LaunchDock will not replace unrelated records. Decide explicitly which service should host that hostname before making a manual change.
- **Pending delegation:** check that Hostinger saved the exact assigned values, then allow cached NS records to expire. Public DNS may still show old values while registrar changes propagate.
- **Zone active but Pages pending:** confirm the domain was attached through Pages, not merely a DNS record. CAA, DNSSEC or another service’s domain association can prevent certificate issuance.
- **Subdomain:** the apex owns the zone and delegation. `portfolio.example.com` still uses the `example.com` zone; do not enter nameservers for a fictitious `portfolio.example.com` zone.
- **Need another hostname:** this version stores one primary custom domain per project. Attaching a new hostname does not remove the old attachment. Remove obsolete domains yourself in Cloudflare only after verifying they are no longer needed.

Cloudflare guide: https://developers.cloudflare.com/pages/configuration/custom-domains/.
