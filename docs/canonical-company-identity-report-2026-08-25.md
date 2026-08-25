# Canonical Company identity report

Date: 2026-08-25

Scope: offline code and plan preparation only. No production connection, Company creation, Membership creation, remediation write, cleanup, migration execution, or deployment was performed.

Superseded for Head Office, Membership, branch-authority, smoke-account, and fresh-production status by [`final-production-remediation-preapproval-2026-08-25.md`](./final-production-remediation-preapproval-2026-08-25.md). This document remains the derivation record for the canonical Company ID.

## Verdict

`CANONICAL COMPANY ID READY — BOOTSTRAP NOT AUTHORIZED`

The authoritative legal identity is sufficient to freeze the immutable Company/Tenant ID. The full bootstrap remains blocked by the unresolved Head Office and authorization inputs, the backup gate, and the absence of explicit production approval.

## Authoritative legal identity

- Legal name: `ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "СКАЙТЕХ КОМПАНИ"`
- Short name: `ООО "СКАЙТЕХ КОМПАНИ"`
- Jurisdiction: `RU`
- INN: `1660217548`
- KPP: `165501001`
- OGRN: `1141690077814`
- Legal address: `420107, Республика Татарстан, г. Казань, ул. Островского, д. 107, помещ. 49`
- Timezone: `Europe/Moscow`

## Deterministic derivation

Canonical identity key:

`rentcore:company:v1|jurisdiction=RU|registry=INN|value=1660217548`

Algorithm:

1. Encode the exact canonical identity key as UTF-8.
2. Calculate SHA-256.
3. Encode the 32 digest bytes as RFC 4648 Base32 using `A-Z2-7`, without `=` padding.
4. Prefix the encoded digest with `cmp_`.

Derivation evidence:

- SHA-256: `f9026198f378c197e6a565035b0299cac846c58ae97e6fa6209c2c3ca4e6c419`
- Base32: `7EBGDGHTPDAZPZVFMUBVWAUZZLEENRMK5F7G7JRATQWDZJHGYQMQ`
- `companyId`: `cmp_7EBGDGHTPDAZPZVFMUBVWAUZZLEENRMK5F7G7JRATQWDZJHGYQMQ`
- `tenantId`: `cmp_7EBGDGHTPDAZPZVFMUBVWAUZZLEENRMK5F7G7JRATQWDZJHGYQMQ`

This identity depends only on jurisdiction, registry, and authoritative INN. Changes to legal name, short name, KPP, address, or branding do not change the ID. After Company creation, the ID is immutable and must not be recomputed from mutable fields.

## Explicit business mappings

The following approved business records carry the proposed exact scope in the offline remediation plan:

| Collection | Stable record ID | Proposed action | companyId / tenantId |
|---|---|---|---|
| `counterparties` | `CP-1787305873918-cb43be` | `UPDATE_SCOPE` | canonical ID above |
| `counterparty_role_assignments` | `CPRA-19e67e15a554df5b2d434852` | `UPDATE_SCOPE` | canonical ID above |
| `clients` | `C-1787305873917-d5aa12` | `UPDATE_SCOPE` | canonical ID above |
| `client_objects` | `CO-1787567881301-0301ec` | `UPDATE_SCOPE` | canonical ID above |

The three approved business-user candidates reference the same proposed Company/Tenant scope, but their Membership actions remain `UNRESOLVED` until role templates/capabilities and branch authority are approved.

## Explicit exclusions

`production-smoke-admin` has no proposed Company scope or Membership. The following smoke/historical records remain `UNRESOLVED` with null `companyId` and `tenantId` and require a separately approved cleanup:

- `CP-1787585239479-4a34e4`
- `CPRA-206c0cc4343e162cbfd7dcf6`
- `CO-1787567867426-2c27d0`
- `CO-1787585252222-35e4d5`

## Remaining bootstrap blockers

- authoritative Head Office display name and actual address, or explicit confirmation that the legal address is the actual Head Office;
- approved role-template and capability set for each business user;
- approved branch authority for each business user;
- explicit production smoke-account disposition and any cleanup approval;
- fresh coherent verified backup and rollback evidence;
- explicit production apply approval.

Production writes: **NONE**.

Deploy: **NOT PERFORMED**.
