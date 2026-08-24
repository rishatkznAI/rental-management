# Client master-data lifecycle

## Boundary

Client, Counterparty and Client Object cleanup is a domain operation, not a
generic CRUD delete. `server/lib/client-master-data-lifecycle.js` owns the
stable-ID reference registry and every deletion/archive decision for these
entities. Generic CRUD refuses Client and Client Object deletion and refuses a
Client Object status transition.

The lifecycle does not edit contract numbering, business number sequences,
deployment configuration or production records.

## Stable references

Only stable relation fields are used: `counterpartyId`, `clientId`, `objectId`,
`clientObjectId`, `siteId` and `objectIds`. Role-specific Counterparty fields
such as `factoryCounterpartyId`, `supplierCounterpartyId` and
`contractorCounterpartyId` are also explicit stable IDs. Editable labels,
names, phone numbers and email addresses are never ownership or deletion keys.

The registry covers rental and Gantt data, change requests, contracts,
documents, payments and allocations, deliveries, service and warranty,
CRM/debt/receivable workflows, objects, supplier/contractor domains and
domain/audit history. Audit evidence is reported but is non-blocking; durable
business and domain-history references block deletion.

## Rules

- A Client with any durable reference returns `CLIENT_HAS_HISTORY`. A Client
  without references removes only the Client projection. Its Counterparty and
  role assignments are unchanged.
- An active Client Object returns `CLIENT_OBJECT_ACTIVE` on hard-delete. It can
  be archived through the dedicated endpoint. An archived object is deleted
  only when the registry reports no blockers; otherwise the API returns
  `CLIENT_OBJECT_HAS_HISTORY` with record-level blockers.
- A Counterparty is never physically deleted. Archive is allowed only with no
  business references and atomically deactivates its assignments/profiles.
- Customer role deactivation is explicit. Other roles remain active. If
  customer is the last role and no business reference remains, the
  Counterparty is soft-archived instead.

## Scope and consistency

Mutations compare `companyId` and `tenantId` found on the entity, linked Client
and linked Counterparty. Conflicting owners, missing canonical owners and a
legacy record with either scope axis unresolved fail closed. Both `companyId`
and `tenantId` must equal the authenticated actor's axes. New master-data records inherit
server-owned actor scope when it is present, and scope fields cannot be changed
through generic PATCH.

Lifecycle state and its audit row are written in one `writeDataBatch` SQLite
transaction. Replaying an archive/deactivation already in its terminal state is
a no-op and creates no second audit row. No lifecycle batch contains business
numbering collections or cascade deletions.

## HTTP surface

- `DELETE /api/clients/:id`
- `GET /api/client_objects/:id/lifecycle`
- `POST /api/client_objects/:id/archive`
- `DELETE /api/client_objects/:id`
- `DELETE /api/counterparties/:id/roles/customer`
- `DELETE /api/counterparties/:id` (soft archive only)

The backend analysis is authoritative. The Client Detail UI uses the lifecycle
read endpoint only to present the expected action and explanation; mutation
handlers repeat every check.
