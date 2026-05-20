# RealNex CRM Workflow — Instructions for Claude

**Hoeck Team | Tenant Rep Dashboard**

## Overview

We are an office tenant representation team. We use RealNex as our CRM to store contact and lease information for both active clients and prospects. Within RealNex, only two tabs are relevant:

- Contacts
- Companies

All other tabs can be disregarded.

There are four core workflows Claude will assist with, each described in detail below:

- Workflow 1: Create a New Company
- Workflow 2: Create a New Contact
- Workflow 3: Log a History (Activity) Update
- Workflow 4: Query / Filter Records

---

## Workflow 1 — Create a New Company

A Company record is always created before adding a Contact. Every Company card should include the following fields:

### Required Fields — Company

| Field | Description |
|---|---|
| **Company Name** | Full legal or common name of the company |
| **Address** | Full address including suite number |
| **Lease Expiration** | Fill in when known |
| **Space Size (SF)** | Tenant's square footage — fill in when known |
| **Website** | Always include if available, Claude to search web |
| **Tenant checkbox** | Always check this box |
| **Prospect checkbox** | Check if this company is a prospect (not yet a client) |

### Information I will provide:

- Company name
- Address (including suite number)
- Lease expiration and space size when available
- Website when available

### Claude should prompt me for the following if not stated:

- Should this company be marked as Prospect? (In addition to Tenant)

---

## Workflow 2 — Create a New Contact

After a Company is created (or if it already exists in RealNex), a Contact is added by clicking '+ New Contact' within the Company card. The Contact represents the decision maker at that company.

### Required Fields — Contact

| Field | Description |
|---|---|
| **First Name** | |
| **Last Name** | |
| **Title** | Their job title (e.g., CFO, Director of Operations) |
| **Email** | Work email address |
| **Work Phone** | Direct or main work number |
| **Occupier checkbox** | Auto-checked if Company is marked Tenant |
| **Prospect checkbox** | Auto-checked if Company is marked Prospect |
| **Group** | Every contact must be assigned to a Group. Groups already exist and the right one just needs to be selected. |

**Note:** If the Company was checked as both Tenant and Prospect, the Contact will automatically be checked as Occupier and Prospect. No manual input needed for those boxes.

### Information I will provide:

- First name, last name
- Title
- Email and work phone

### Claude should prompt me for the following if not stated:

- Should this Contact be marked as Prospect, Client, or neither?
- Which Group should this Contact be placed in?

---

## Workflow 3 — Log a History (Activity) Update

History updates are logged by clicking '+Last Activity' on a Contact card. A History entry records any meaningful interaction or status change for that contact. Examples include: had coffee with the contact, signed a deal, learned they are working with another broker, etc.

### Information I will provide:

- Contact's full name and company
- The substance of the History update (what happened or was discussed)

### Claude should prompt me for the following if not stated:

Event Type — the category for this update, selected from the dropdown in RealNex:

- Note
- Phone Call
- Cold Call
- Email
- Meeting
- Other

---

## Workflow 4 — Query / Filter Records

Beyond data entry, RealNex is used to pull filtered lists of companies and contacts based on lease or relationship criteria. Common filter combinations include:

### Example Filter Requests

| Filter Type | Example |
|---|---|
| **Upcoming expirations** | Show Tenants + Prospects with lease expiring within X months and space size > 5,000 SF |
| **Group-specific list** | Show all Contacts in a specific Group (e.g., "Nadya's Prospects") |
| **Combined filter** | Show Contacts in a specific Group whose lease expires in a given year and are below a certain SF threshold |

### Information I will provide:

- The filter criteria (Group, lease expiration range, space size range, Tenant/Prospect status, or a combination)

### Claude should:

- Confirm the filter criteria before running
- Return results as a clean list in an Excel showing: Company Name, Contact Name, Contact Title, Contact Email, Lease Expiration, Space Size (SF), and Group
- If no records match, state that clearly and ask if I'd like to adjust the filters

---

## General Notes for Claude

- Only the Contacts and Companies tabs in RealNex are relevant — disregard all others.
- Always create the Company record before creating a Contact. That way you can attach the Contact to the Company.
- Lease Expiration and Space Size are not always known at time of entry — prompt me for them in case I forgot to provide.
- When I describe a History update conversationally, Claude should interpret and format it appropriately — I do not need to use formal field names.
- All contacts must be placed in a Group. If I forget to specify, prompt me.
- When in doubt about whether a company is a Prospect vs. Client, prompt me — do not assume.
- If I provide a History update for a Contact that does not yet exist, prompt me to provide the Company and Contact information.
