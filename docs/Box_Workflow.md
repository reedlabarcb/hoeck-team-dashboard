# Box — Tenant Rep Workflow

*Guidance for the Claude Dashboard — Chapman & Hoeck Tenant Rep Team*

## Purpose of This Document

This document explains how the Chapman & Hoeck tenant rep team organizes deal files in Box and how Claude should help us navigate, retrieve, and maintain those files through the Claude Dashboard. Claude has access to our **Tenants – ChapmanHoeck** folder structure in Box and to our **TT Rep Master Client List** Excel. The goal is for Claude to act like a knowledgeable team member who already understands our folder logic, naming conventions, and recurring tasks — so we can pull files, look up critical dates, and update records with a single request instead of clicking through many layers of folders.

---

## 1. File Organization

All deal-related files live in Box, inside the parent folder **Tenants – ChapmanHoeck**. Within that, the **Clients** folder is the central hub ([Clients folder](https://cbre.box.com/s/22xo4p27i6bsrf6qhgtdbq611rsalyzf)). The Clients folder contains one subfolder per client, named after the client we worked with on a lease (or leases).

### 1.1 Client Folder Structure

Each client folder is organized in a consistent way. The first level inside a client folder is a **per-deal folder**, named using the convention:

**`YEAR – Lease Acquisition – ADDRESS`**   or   **`YEAR – Lease Disposition – ADDRESS`**

Examples:

- **`2026 – Lease Acquisition – 350 10th Ave`** — a new lease signed for Gensler in 2026 at 350 10th Ave.
- **`2026 – Lease Disposition – 350 10th Ave`** — we are helping the same client sublease that space.

Inside each per-deal folder, files are sorted into a standard set of subfolders (surveys, lease documents, tour books, proposals, financial analyses, lease abstracts, invoices, etc.). The following client folders follow this structure cleanly and are good references:

- **Luminia:** https://cbre.box.com/s/32q14xxf123h2oo0nxztinheeakp6mdn
- **Care Solace:** https://cbre.box.com/s/nkz0sxkj3e6m383otne6jo30261cw5ux
- **ASML:** https://cbre.box.com/s/pghm1hbe85dgu6wiu3rmusk8xbt322x3
- **Greenberg:** https://cbre.box.com/s/ubi08zumwphc9h8szs04gxjoy8nnar4u

### 1.2 Naming Conventions & Folder Quirks

A few rules and edge cases for Claude to keep in mind when interpreting folder names:

**Subleases shortcut to the master sublease folder.** When a deal is a sublease, the **Lease Disposition** folder is typically a shortcut to our centralized [Sublease Listings folder](https://cbre.box.com/s/8x8s1o41mb3w6ofr130sydc7qisppt0s). The Care Solace folder is a good example — clicking into *2026 – Lease Disposition* takes you to the master sublease listing for that property rather than a standalone folder.

**No address means no signed lease.** If a folder is named *YEAR – Lease Acquisition* with no address, the client engaged us but a lease was never signed. The Greenberg folder is an example — they engaged us in 2024, we put together a survey, but never negotiated with any landlord and the deal didn't move forward.

**"MT" suffix means multi-market.** Client folders ending in **MT** (for example, *Northwestern Mutual – MT*) indicate that client has multiple offices across different markets or states. Inside the MT folder, you'll see a layer organized by state or market before reaching the per-deal folders.

---

## 2. Navigation — How Claude Should Help

Our organizational structure is consistent, which makes files easy to find — but it also takes a lot of clicks to walk down the tree. The main reason Claude is plugged into Box is so we can skip those clicks. When we ask Claude for a file, Claude should walk the folder hierarchy in the background and return either the file itself, a Box link, or a clear answer about what's in the folder.

### 2.1 Example: Pulling a Specific Lease

*Request: "Please provide me with Northwestern Mutual's latest lease at Lake Oswego."*

Claude should follow this path:

```
Tenants – ChapmanHoeck
└── Clients
    └── Northwestern Mutual – MT
        └── Oregon
            └── 2018–2025 – Lease Acquisition – Lake Oswego
                └── Lease Documents
```

Inside **Lease Documents** there will typically be a few PDFs. Claude should identify the most current one based on dates and titles (e.g., the most recent amendment or fully executed lease) and return that file. If there is any ambiguity about which is "latest," Claude should briefly summarize the options and ask us to confirm before sending it along.

### 2.2 General Retrieval Guidelines

- Always confirm the client name and, if relevant, the market or address before walking the folder tree — some clients (the MT folders) have multiple deals across cities.
- When multiple matching files exist (e.g., several versions of a proposal), list them with dates so we can pick, rather than guessing.
- Prefer returning a direct Box link to the file rather than re-uploading or duplicating it, so the source of truth stays in Box.
- If a requested folder is missing or unexpectedly empty, surface that to us before assuming the deal doesn't exist — it may be filed under a different year, address spelling, or MT subfolder.

---

## 3. RFPs, Proposals & LOIs

For almost every active deal, one of the most important subfolders is **RFP, Proposal & LOI(s)**. As we negotiate deal terms, our tenant rep team trades redlined proposals back and forth with the landlord rep team. We number proposals in roughly the order they were exchanged so we can track the negotiation timeline. It is not always perfect — items occasionally get misnumbered, and there can be multiple drafts of a single round — but in general:

- Lower numbers = earlier rounds; higher numbers = more recent rounds.
- When asked for "the latest proposal," Claude should pick the highest-numbered file, but also sanity-check the file dates in case numbering is off.
- If multiple drafts exist for the same round, return the most recently modified version and call out that drafts exist.

---

## 4. New Client Workflow — (maybe defer)

*This is for early engagement.*

When we are engaged by a new client, the first thing we do is create their folder structure inside **Tenants – ChapmanHoeck → Clients**. The workflow is:

1. **Create the client folder.** Add a new folder named after the client (e.g., *Luminia*) inside **Clients**.
2. **Drop in the empty folder templates.** Copy our standard set of empty subfolder templates ([Empty Folder Templates](https://cbre.box.com/s/2vl5grcd4r0y06sjnzxmw5lb5wpcw13c)) into a subfolder called *Empty Folder Templates* inside the client's folder.
3. **Spin up the first deal folder as needed.** Pull whichever templates we need for the current stage of the engagement. For example, if Luminia just engaged us to find office space in San Diego, create *2026 – Lease Acquisition* (no address yet, since they don't have an office), and drop the *Survey(s)* folder inside it. *(Would want you to eventually edit the folder names in parallel to the existing box folders formatting.)*
4. **File deal documents as they come in.** All surveys, lease documents, tour books, proposals, financial analyses, lease abstracts, invoices, etc. go into their appropriate subfolders for that deal.

When Claude is asked to set up a new client, Claude should follow this same pattern: create the named client folder, drop in the empty templates, and confirm with us which initial deal folder(s) to spin up before doing more.

---

## 5. Master Excel — TT Rep Master Client List

In **Tenants – ChapmanHoeck** there is a critical workbook called **TT Rep Master Client List**. This Excel summarizes the critical dates for everything in the Clients folder, including:

- Upcoming lease expirations
- Renewal option windows
- Renewal option deadlines
- Termination option deadlines

### 5.1 Looking Up Critical Dates

For most date questions, the Master Excel is the fastest answer. Example request: *"When is Procopio's renewal option window or deadline at their DC office?"*

Claude should:

1. Open **TT Rep Master Client List** first.
2. Look up *Procopio (DC)* in the **Client** column.
3. Read the option date from that row (in this example, the option date closes 7/28/2026).
4. Optionally double-check against the underlying lease in Procopio's folder in Clients if anything looks off — the Excel is the source of truth for dates, but the lease itself is the ground truth.

### 5.2 Keeping the Excel Updated

Whenever a new lease is signed, two things have to happen:

1. Save the lease in the appropriate deal subfolder in Clients.
2. Update **TT Rep Master Client List** with the new critical dates.

When Claude is asked to file a new lease in Box, Claude should **always ask whether we want to also update the Master Excel**. If we say yes, Claude should attempt to pull the relevant critical dates (expiration, renewal option window, renewal option deadline, termination option deadline) directly from the lease. If any of those dates are ambiguous, missing, or worded in a way that could be read more than one way, Claude should **flag them and confirm with us** before writing to the Excel — we would rather take an extra minute than carry an incorrect option date in the master.

---

## 6. Quick Reference for Claude

A short cheat sheet of common requests and how Claude should handle them:

| Request | Action |
|---|---|
| **"Pull me [Client]'s latest lease at [Address]."** | Walk Clients → Client folder (check for MT) → market (if applicable) → YEAR – Lease Acquisition – ADDRESS → Lease Documents. Return the most recent PDF. |
| **"What's the latest proposal we sent on [Deal]?"** | Open the deal folder → RFP, Proposal & LOI(s). Return the highest-numbered (and most recently modified) draft, noting if there are multiple drafts in the same round. |
| **"When is [Client]'s renewal option deadline?"** | Check TT Rep Master Client List first; cross-check against the lease only if numbers look unusual. |
| **"Set up a new client folder for [Client]."** | Create the client folder under Clients, copy in the empty folder templates, then ask which initial deal folder(s) to spin up. |
| **"File this signed lease."** | Save it to the appropriate deal subfolder, then ask whether to update the Master Excel and confirm any uncertain critical dates before writing. |
