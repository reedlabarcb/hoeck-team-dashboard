# RealNex API — Discovery Reference

Snapshot of `https://sync.realnex.com/swagger/v1/swagger.json` taken 2026-06-17.
The raw spec is committed alongside this doc at `docs/RealNex_API_Docs/swagger.json`
(1.4 MB OpenAPI 3.0.1 JSON) — use this doc as the human-readable index; consult
the JSON when you need full schemas, param details, or response shapes.

---

## 1. Spec identity

| Field | Value |
|---|---|
| OpenAPI version | `3.0.1` |
| `info.title` | `RealNex SyncAPI Data Facade` |
| `info.version` | `1.0` |
| Total endpoints (path × method) | **164** |
| Tag count | 14 |
| Spec discovered at | `https://sync.realnex.com/swagger/v1/swagger.json` (first URL tried — no variants needed) |

## 2. Base URL

**`https://sync.realnex.com`**

Inferred. The spec has no `servers` array; all paths are absolute (e.g.
`/api/Client`, `/api/v1/Crm/company/{companyKey}`). The host is the same domain
that serves the spec itself.

> **Important** vs. earlier blind probing: we initially hit `api.realnex.com`,
> `app.realnex.com`, and `core.realnex.com` (all were guesses). None of those is
> the real host. **CBRE Zscaler also blocks `api.realnex.com` and
> `app.realnex.com` at the CONNECT layer; `sync.realnex.com` is allowed.** So
> any Phase 3 implementation calling RealNex MUST use `sync.realnex.com` as the
> base URL — both for correctness (it's the documented host) and reachability
> from the CBRE corp network.

## 3. Authentication

`components.securitySchemes`:

```json
{
  "Bearer": {
    "type": "http",
    "description": "Please enter token",
    "scheme": "bearer",
    "bearerFormat": "JWT"
  },
  "Basic": {
    "type": "http",
    "description": "Please enter credentials",
    "scheme": "basic"
  }
}
```

Top-level `security` is `[{"Bearer":[]},{"Basic":[]}]` — meaning **either**
Bearer JWT or HTTP Basic is accepted for any endpoint. We will use Bearer JWT
(the key Reed provisioned).

**Header pattern:**

```
Authorization: Bearer <jwt>
```

The Bearer's `bearerFormat: "JWT"` is informational. The JWT we received has
shape `eyJ...` with claims including `sub`, `account_key`, `user_key`, `name`,
`email`, `iat`, `exp`. `exp` is far-future (year 2038), so token rotation is not
a near-term concern.

## 4. Endpoint inventory by tag

| Tag | Count | Phase 3 relevance |
|---|---:|---|
| `Client` | 5 | **Auth/identity** — `GET /api/Client` is the closest equivalent to `/me` |
| `Crm` | 14 | **Lookup tables** — users, teams, countries, eventtypes, priorities, statuses, etc. |
| `CrmAttachment` | 6 | File attachments — deferred |
| **`CrmCompany`** | 10 | **Workflows 1, 2, 4** |
| **`CrmContact`** | 23 | **Workflows 2, 4** |
| `CrmEvent` | 13 | Calendar events — deferred |
| **`CrmHistory`** | 11 | **Workflows 2, 3, 4** (activities + per-object history) |
| `CrmLeaseComp` | 9 | Lease comps — out of scope for v1 |
| **`CrmObjectGroup`** | 9 | **Group dropdown (Workflow 2 requirement)** |
| `CrmOData` | 7 | OData wrapper — defer to v2 |
| `CrmProject` | 19 | Projects — Phase 5+? |
| `CrmProperty` | 15 | Property records — defer to v2 |
| `CrmSaleComp` | 13 | Sale comps — out of scope |
| `CrmSpace` | 10 | Lease-space records — defer to v2 |

Phase 3 needs: **Client + Crm (lookups) + CrmCompany + CrmContact + CrmHistory +
CrmObjectGroup** = 72 of the 164 endpoints.

## 5. Endpoints we'll actually use (Phase 3)

Method shapes use the spec's `operationId` and the 200-response schema.
`(no schema)` means the endpoint returns 204 No Content or has no documented
response body. All request bodies are `application/json`.

### 5.1 Client (auth / identity)

| Method | Path | operationId | Response |
|---|---|---|---|
| GET | `/api/Client` | `GetUser` | `ClientInfo` |
| GET | `/api/Client/callbacks` | `GetUserCallbacks` | `ClientCallbacks` |
| POST | `/api/Client/callbacks` | `PostUserCallbacks` | `ClientCallbacks` |
| GET | `/api/Client/retrysettings` | `GetUserRetrySettings` | `ClientRetrySettings` |
| POST | `/api/Client/retrysettings` | `PostUserRetrySettings` | `ClientRetrySettings` |

Note: all Client endpoints take an `api-version` query param (default `1.0`).
Other tags do not.

### 5.2 Crm (lookup tables — populate select dropdowns)

| Method | Path | operationId | Response |
|---|---|---|---|
| GET | `/api/v1/Crm/users` | `GetUsersAsync` | array of `User` |
| GET | `/api/v1/Crm/teams` | `GetTeamsAsync` | array of `Team` |
| GET | `/api/v1/Crm/countries` | `GetCountriesAsync` | object |
| GET | `/api/v1/Crm/timezones` | `GetTimeZonesAsync` | object |
| GET | `/api/v1/Crm/eventtypes` | `GetEventTypesAsync` | object |
| GET | `/api/v1/Crm/priorities` | `GetPrioritiesAsync` | object |
| GET | `/api/v1/Crm/historystatuses` | `GetHistoryStatusesAsync` | object |
| GET | `/api/v1/Crm/attachmenttypes` | `GetAttachmentTypesAsync` | object |
| GET | `/api/v1/Crm/propertytypes` | `GetPropertyTypesAsync` | object |
| GET | `/api/v1/Crm/projecttypes` | `GetProjectTypesAsync` | object |
| GET | `/api/v1/Crm/projectstatuses` | `GetProjectStatusesAsync` | object |
| GET | `/api/v1/Crm/projectresults` | `GetProjectResultsAsync` | object |
| GET | `/api/v1/Crm/definitions` | `GetDefinitionTablesAsync` | array |
| GET | `/api/v1/Crm/definitions/{tableName}` | `GetDefinitionsByTableAsync` | array of `FieldDefinition` |

The `definitions` endpoints surface every CRM table's field schemas — useful for
generating typed clients later.

### 5.3 CrmCompany (Workflow 1, 2, 4)

| Method | Path | operationId | Request body | Response |
|---|---|---|---|---|
| POST | `/api/v1/Crm/company` | `PostCompanyAsync` | `CreateCompany` | (no schema) |
| GET | `/api/v1/Crm/company/{companyKey}/full` | `GetCompanyAsync` | — | `Company` |
| GET | `/api/v1/Crm/company/{companyKey}` | `GetEditCompanyAsync` | — | `EditCompany` |
| PUT | `/api/v1/Crm/company/{companyKey}` | `PutEditCompanyAsync` | `EditCompany` | (no schema) |
| DELETE | `/api/v1/Crm/company/{companyKey}` | `DeleteCompanyAsync` | — | (no schema) |
| GET | `/api/v1/Crm/company/{companyKey}/notes` | `GetEditCompanyNotesAsync` | — | `EditNotes` |
| PUT | `/api/v1/Crm/company/{companyKey}/notes` | `PutCompanyNotesAsync` | `EditNotes` | (no schema) |
| GET | `/api/v1/Crm/company/{companyKey}/details` | `GetCompanyDetailsAsync` | — | `EditCompanyDetails` |
| PUT | `/api/v1/Crm/company/{companyKey}/details` | `PutCompanyDetailsAsync` | `EditCompanyDetails` | (no schema) |
| GET | `/api/v1/Crm/company/{companyKey}/contacts` | `GetCompanyContactsAsync` | — | `ContactListItemPageResponse` |

**Two read shapes:**
- `…/full` returns the rich read-only `Company` view
- `…/{key}` (no `/full`) returns an `EditCompany` shape used as the source for PUT writes

**No `/api/v1/Crm/company` GET listing endpoint** — the spec doesn't expose a
"list all companies" or "search by name" call here. Search is likely via
`CrmOData` (`/api/v1/Crm/odata/…`) or via the contact-autocomplete endpoint (§5.4).

### 5.4 CrmContact (Workflow 2, 4)

| Method | Path | operationId | Request body | Response |
|---|---|---|---|---|
| POST | `/api/v1/Crm/contact` | `PostContactAsync` | `CreateContact` | (no schema) |
| GET | `/api/v1/Crm/contact/{contactKey}/full` | `GetContactAsync` | — | `Contact` |
| GET | `/api/v1/Crm/contact/{contactKey}` | `GetEditContactAsync` | — | `EditContact` |
| PUT | `/api/v1/Crm/contact/{contactKey}` | `PutEditContactAsync` | `EditContact` | (no schema) |
| DELETE | `/api/v1/Crm/contact/{contactKey}` | `DeleteContactAsync` | — | (no schema) |
| GET | `/api/v1/Crm/contact/autocomplete` | `GetContactAutocompleteAsync` | — | array of `ContactAutocompleteItem` |
| GET | `/api/v1/Crm/contact/{contactKey}/notes` | `GetContactNotesAsync` | — | `EditNotes` |
| PUT | `/api/v1/Crm/contact/{contactKey}/notes` | `PutContactNotesAsync` | `EditNotes` | (no schema) |

**Contact sub-resources** (each pair is GET/PUT):

| Sub-resource | GET response | PUT body |
|---|---|---|
| `/personal` | `EditContactPersonal` | same |
| `/agent` | `EditContactAgent` | same |
| `/investor` | `EditContactInvestor` | same |
| `/tenant` | `EditContactTenant` | same |
| `/vendor` | `EditContactVendor` | same |
| `/address` (GET + POST) | array of `ContactAddress` | `EditAddressPrincipal` on POST |
| `/address/{addressKey}` (PUT + DELETE) | array of `ContactAddress` | `EditAddressPrincipal` on PUT |
| `/address/{addressKey}/role` (PUT) | array of `ContactAddress` | `EditAddressRole` |

**Search:** `GET /api/v1/Crm/contact/autocomplete?Term=<query>&Size=<n>` is the
documented search path. Companies don't appear to have a parallel autocomplete —
Phase 3 may need to fall back to OData for company search.

### 5.5 CrmHistory (Workflow 2, 3, 4 — activity history)

| Method | Path | operationId | Request body | Response |
|---|---|---|---|---|
| POST | `/api/v1/Crm/history` | `PostHistoryAsync` | `EditHistory` | `History` |
| GET | `/api/v1/Crm/history/{historyKey}` | `GetHistoryAsync` | — | `EditHistory` |
| PUT | `/api/v1/Crm/history/{historyKey}` | `PutHistoryAsync` | `EditHistory` | string |
| DELETE | `/api/v1/Crm/history/{historyKey}` | `DeleteHistoryAsync` | — | string |
| GET | `/api/v1/Crm/history/{historyKey}/details` | `GetHistoryDetailsAsync` | — | `HistoryDetails` |
| GET | `/api/v1/Crm/history/{historyKey}/object` | `GetHistoryObjectsAsync` | — | array of `HistoryObject` |
| POST | `/api/v1/Crm/history/{historyKey}/object` | `PostHistoryObjectsAsync` | array of `HistoryObject` | string |
| DELETE | `/api/v1/Crm/history/{historyKey}/object/{objectKey}` | `DeleteHistoryObjectsAsync` | — | string |
| GET | `/api/v1/Crm/history/{historyKey}/file` | `GetHistoryFileAsync` | — | string |
| GET | `/api/v1/Crm/object/{objectKey}/history` | `GetObjectHistoriesAsync` | — | `HistoryPageResponse` |
| POST | `/api/v1/Crm/object/{objectKey}/history` | `PostObjectHistoryAsync` | `EditHistory` | (no schema) |

**Per-object history is the key pattern:** to fetch a company's or contact's
activity feed, call `GET /api/v1/Crm/object/{objectKey}/history` with
pagination params (`Order`, `PageSize`, `PageNumber`). The `{objectKey}` is the
same GUID as the company/contact key.

### 5.6 CrmObjectGroup (Workflow 2 — Group dropdown)

| Method | Path | operationId | Request body | Response |
|---|---|---|---|---|
| GET | `/api/v1/Crm/group` | `GetObjectGroupListAsync` | — | `ObjectGroupPageResponse` |
| POST | `/api/v1/Crm/group` | `PostObjectGroupAsync` | `EditObjectGroup` | `ObjectGroup` |
| GET | `/api/v1/Crm/group/{objectGroupKey}` | `GetObjectGroupAsync` | — | `ObjectGroupDetails` |
| PUT | `/api/v1/Crm/group/{objectGroupKey}` | `PutObjectGroupAsync` | `EditObjectGroup` | `EditObjectGroup` |
| DELETE | `/api/v1/Crm/group/{objectGroupKey}` | `DeleteObjectGroupAsync` | — | (no schema) |
| GET | `/api/v1/Crm/group/{objectGroupKey}/members` | `GetObjectGroupMembersAsync` | — | `ObjectGroupMemberPageResponse` |
| POST | `/api/v1/Crm/group/{objectGroupKey}/members` | `PostObjectGroupMembersAsync` | array of `ObjectGroupMember` | string |
| DELETE | `/api/v1/Crm/group/{objectGroupKey}/members/{objectKey}` | `DeleteObjectGroupMemberAsync` | — | string |
| GET | `/api/v1/Crm/object/{objectKey}/memberof` | `GetObjectGroupListByObjectAsync` | — | array of `ObjectGroup` |

For the Workflow 2 group-dropdown requirement (BUILD_SPEC.md "Group dropdown
MUST come from `groups_mirror` or live `realnex.listGroups()`. Never free-text."),
the right endpoint is `GET /api/v1/Crm/group` (paginated list) →
`safe.ts:listGroups` will wrap this.

## 6. Gotchas / things to watch

1. **Two read shapes per entity (`/full` vs `/{key}`).** The "full" path returns
   a read-friendly composition; the no-suffix path returns the `Edit*` shape
   that round-trips through PUT. For UI display use `/full`; for "edit then
   save" flows use the Edit shape so the PUT body matches.
2. **No company-wide search endpoint** visible outside OData. Workflow 1's
   "search/create company" UX may need either:
   - the OData `/api/v1/Crm/odata/companies?$filter=…` path (in `CrmOData` tag),
   - the contact-autocomplete reach-through (find a contact, then its company),
   - a periodic nightly mirror into our own Postgres (Phase 3 nightly sync
     already intends this).
3. **History writes are scoped at the object.** Creating an activity goes via
   `POST /api/v1/Crm/object/{objectKey}/history` (preferred — auto-links to the
   parent) rather than the top-level `POST /api/v1/Crm/history` (which then
   requires a separate `POST .../object` to associate).
4. **`api-version` query param applies only to `/api/Client`** — the rest of
   the surface is implicitly v1 via the path prefix `/api/v1/`.
5. **Pagination defaults are unspecified.** `PageSize` and `PageNumber` are
   query params on list endpoints but the spec doesn't declare defaults. Treat
   missing values as undefined behavior and always pass explicit pagination.
6. **`securitySchemes` was found in `components`,** but only after we pulled the
   full 1.4 MB spec. The summarized WebFetch preview did NOT include this block,
   which is why the original WebFetch report claimed "no auth defined." Lesson:
   for spec analysis, always operate on the full local copy.
7. **JWT scope vs account.** The JWT we have is Mike Hoeck's (`name: "Mike
   Hoeck"`, `email: "mike.hoeck@cbre.com"`). All reads/writes through this
   token will be attributed to Mike in the RealNex audit log. For Phase 3
   multi-user, we'll need each team member's own JWT or a service account.

## 7. Proposed smoke test (NOT YET RUN — awaits Reed's approval)

The minimal one-call verification that the JWT works against the documented
host + auth pattern:

```http
GET https://sync.realnex.com/api/Client?api-version=1.0
Authorization: Bearer <jwt-from-.env.local>
Accept: application/json
```

- No path params, no body, single optional query param.
- Returns `ClientInfo` (a small JSON describing the authed user/account).
- Lowest blast radius of any endpoint — pure identity read, no list traversal,
  no PII leakage beyond the caller's own profile.
- Equivalent of "/users/me" from Reed's original spec.

Three possible outcomes when we eventually run it:
- **200 + valid `ClientInfo`** → JWT works, base URL works, auth header works.
  Phase 3 is unblocked.
- **401/403** → JWT is malformed, expired, or scoped to a different account
  domain. Reed would need to regenerate.
- **5xx / connection error from `sync.realnex.com`** → ops-side issue, retry
  later.

Reed approves the smoke test separately. We won't send the request until then.

## 8. Phase 3 implementation implications

Once the smoke test passes, `lib/external/realnex/safe.ts` (currently stubbed)
should allow-list exactly these methods, mirroring the BUILD_SPEC.md Phase 1
shape:

```
listCompanies / getCompany / createCompany
listContacts  / getContact  / createContact
listActivities / getActivity / createActivity    (mapped to History endpoints)
listGroups
```

Notable adjustments to BUILD_SPEC vs the actual API:

- `listCompanies` will rely on the OData path (or a Postgres mirror); no native
  company-list endpoint outside OData.
- `listActivities` maps to `GET /api/v1/Crm/object/{objectKey}/history` not a
  top-level "all recent activities" — confirm with Reed which view we want.
- `getActivity` maps to `GET /api/v1/Crm/history/{historyKey}`.
- `createActivity` maps to `POST /api/v1/Crm/object/{objectKey}/history`
  (object-scoped create — strongly preferred over the orphan-then-link path).

`safe.test.ts` must continue to assert the forbidden methods are absent
(`updateCompany`, `deleteCompany`, `updateContact`, `deleteContact`, etc.) —
those operations exist in the API (we saw PUT/DELETE above) but Phase 3 still
treats them as forbidden per the safety rule.
