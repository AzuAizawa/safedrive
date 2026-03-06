# SafeDrive — Capstone Defense: Design Justifications & Legal Basis

> **Purpose**: This document provides ready-made answers for capstone defense panel questions about SafeDrive's architecture, security, and compliance decisions. Each section follows a **Question → Answer → Why Not Alternatives → Legal Basis** format.

---

## Table of Contents

1. [User Account Model — Single Email, Dual Role](#1-user-account-model)
2. [Admin Account Creation & Management](#2-admin-account-management)
3. [Identity Verification Process](#3-identity-verification)
4. [What Happens When an Admin Account Is Compromised](#4-admin-compromise)
5. [Why Client-Side + Server-Side Validation](#5-validation-strategy)
6. [Role-Based Access Control (RBAC)](#6-rbac)
7. [Data Privacy & Philippine Law Compliance](#7-data-privacy)
8. [Why Supabase Over Custom Backend](#8-why-supabase)
9. [Why Row Level Security (RLS) Over API Middleware](#9-why-rls)
10. [Security Logging & Audit Trail](#10-audit-trail)
19. [Plate Number Validation & LTO Number Coding](#11-plate-number)
20. [Centralized Input Validation Architecture](#12-input-validation)
21. [Vehicle Listing Workflow & Admin Approval](#13-listing-workflow)
22. [Agreement Document (Rental Terms & Conditions)](#14-agreement-document)
23. [Admin Session Isolation & Refresh Stability](#15-session-isolation)
24. [Backend Architecture & Payment Security](#16-backend-architecture)

---

## 1. User Account Model — Single Email, Dual Role {#1-user-account-model}

### Panelist Question
> *"Why does a user only have one account? What if someone wants to both rent AND list a car? Why not separate accounts?"*

### Answer
SafeDrive uses the **Airbnb/Turo model**: one email = one account that can serve both as a renter (vehicle lister) and a rentee (vehicle renter). This is an industry-standard pattern used by the largest P2P marketplace platforms in the world.

### Industry Precedent

| Platform | Model | Same email for multiple roles? |
|----------|-------|-------------------------------|
| **Airbnb** | Host + Guest | ✅ One account, switch roles in-app |
| **Turo** | Host + Guest | ✅ One account, dual capability |
| **Grab** | Driver + Rider | ✅ Same email, but **separate apps** |
| **Uber** | Driver + Rider | ❌ Different accounts (but same company) |

### Why This Is Best for SafeDrive

1. **Single web application** — Unlike Grab/Uber which have separate driver and rider apps, SafeDrive is one web app. Creating separate login systems would fragment the user experience.
2. **Real-world behavior** — A car owner who lists their vehicle will also need to rent a car when theirs is rented out. Forcing them to create two accounts is poor UX.
3. **Verified once, trusted everywhere** — A user who passes identity verification (2 IDs + selfie) is trusted across all platform roles. Duplicating verification for separate accounts wastes time and resources.
4. **Database simplicity** — One `profiles` table with a `role` column is simpler, more maintainable, and more auditable than multiple user tables.

### Why NOT Separate Accounts

- **User friction**: Requiring two sign-ups means two email verifications, two identity verifications, two passwords to remember
- **Data duplication**: Reviews, ratings, and trust scores would be split across accounts
- **Security risk**: More accounts = more attack surface and more credentials to manage
- **Industry consensus**: Airbnb, the world's largest P2P rental platform, uses the single-account model for this exact reason

### Legal Basis
- **Republic Act No. 10173 (Data Privacy Act of 2012), Section 11(c) — Proportionality**: Personal data collected should be *"adequate, relevant, and not excessive"* in relation to the purpose. Creating duplicate accounts would require collecting the same personal data twice, violating the proportionality principle.
- **GDPR Article 5(1)(c) — Data Minimization**: Even under international standards, collecting duplicate user data across two accounts would violate data minimization principles.

---

## 2. Admin Account Management {#2-admin-account-management}

### Panelist Question
> *"How are admin accounts created? Can anyone register as admin? What prevents abuse?"*

### Answer
Admin accounts are **never created through self-registration**. The process is:

1. **First admin**: Created manually by the system administrator via the Supabase database dashboard (SQL Editor). This is industry standard for bootstrapping admin access.
2. **Subsequent admins**: Only existing admins can promote a verified user to admin via the Admin Panel's role management feature.
3. **No admin option on registration**: The registration page only shows "Rent a Car" (rentee) and "List My Car" (renter) — there is no admin selection.

### Why This Is Best

| Approach | Used by | Why we chose/rejected |
|----------|---------|----------------------|
| **Database-seeded first admin** ✅ | Most startups, Laravel, Django | Simple, secure, industry standard |
| Self-registration with admin option | Nobody reputable | ❌ Anyone could make themselves admin |
| Email-based admin invite | Enterprise SaaS | Overkill for a capstone project |
| CLI/terminal creation | AWS, GCP | Requires terminal access in production |

### Security Controls on Admin Accounts

1. **Minimum 2 admin accounts** — Prevents single point of failure
2. **Admins cannot change their own role** — Prevents accidental self-demotion
3. **All admin actions are logged** in the `security_audit_logs` table with timestamp, user ID, and action type
4. **Admin actions are logged in `verification_logs`** — When an admin approves or rejects a user, this creates an immutable audit trail

### Legal Basis
- **ISO/IEC 27001:2022, Control A.9.2.3 — Management of Privileged Access Rights**: *"The allocation and use of privileged access rights shall be restricted and controlled."* Our approach restricts admin creation to database-level operations and existing admin promotion only.
- **ISO/IEC 27001:2022, Control A.6.1.2 — Segregation of Duties**: Admin creation is segregated from normal user registration to prevent unauthorized privilege escalation.

---

## 3. Identity Verification Process {#3-identity-verification}

### Panelist Question
> *"Why do users need to submit 2 IDs and a selfie? Is this legally required? Why not just email verification?"*

### Answer
SafeDrive requires **government-issued ID verification** because it is a **vehicle rental platform** — users are entrusting personal property worth hundreds of thousands of pesos to strangers. Email verification alone is insufficient for this level of trust.

### What We Require

| Document | Purpose | Legal Basis |
|----------|---------|-------------|
| **Government ID (front + back)** | Identity verification, age confirmation | RA 10173 §12(a) — lawful processing for contract performance |
| **Second ID** | Cross-reference verification, fraud prevention | BSP (Bangko Sentral) KYC requirements as industry standard |
| **Selfie photo** | Face matching with ID, liveness check | Anti-Money Laundering Act (RA 9160) KYC principles |

### Real-World Precedent

| Platform | ID Required? | Selfie Required? |
|----------|-------------|-----------------|
| **Grab** | ✅ Government ID | ✅ Selfie verification |
| **Turo** | ✅ Driver's license | ✅ Selfie |
| **Airbnb** | ✅ Government ID | ✅ Selfie |
| **GCash/Maya** | ✅ 2 valid IDs | ✅ Selfie |

### Why 2 IDs Instead of 1
- **Philippine BSP Circular No. 706 (KYC Rules)**: Financial institutions and platforms facilitating monetary transactions require at least two forms of identification for "full KYC" compliance
- **Cross-referencing**: One ID can be forged; two IDs from different issuers are exponentially harder to fake
- **GCash, Maya, and all Philippine e-wallets** require 2 IDs for full account verification — we follow the same standard

### Why NOT Email-Only Verification
- Email verification only proves the user controls an email address — it says nothing about their real identity
- A stolen vehicle cannot be recovered from an email address
- **Republic Act No. 10883 (New Anti-Carnapping Act of 2016)** imposes penalties for vehicle theft — our verification helps create an audit trail for law enforcement investigations

### Legal Basis
- **RA 10173 (Data Privacy Act), Section 12(a)**: Processing of personal information is allowed when *"the data subject has given his or her consent"* — users consent during registration
- **RA 10173, Section 12(b)**: Processing is necessary for *"the fulfillment of a contract to which the data subject is a party"* — renting a vehicle is a contract
- **RA 10173, Section 12(e)**: Processing is necessary for *"the protection of lawful rights and interests of natural or legal persons"* — vehicle owners have a right to know who is renting their property
- **NPC Advisory Opinion No. 2018-039**: The National Privacy Commission has ruled that ID verification for online platforms is a *"legitimate interest"* when the platform facilitates transactions involving significant value

---

## 4. What Happens When an Admin Account Is Compromised {#4-admin-compromise}

### Panelist Question
> *"What happens if an admin account gets hacked? What are your countermeasures?"*

### Answer

| Threat Level | Scenario | Countermeasure |
|-------------|----------|----------------|
| **Level 1** | Admin password leaked | Other admin changes password via Supabase dashboard + force sign-out |
| **Level 2** | Admin account actively compromised | Other admin demotes compromised account from Admin Panel (role → rentee) |
| **Level 3** | Attacker changes admin's email | Supabase dashboard → manually reset email and password in auth.users |
| **Level 4** | ALL admin accounts compromised | System administrator accesses Supabase Dashboard directly → manually reset roles in profiles table via SQL |
| **Level 5** | Supabase dashboard credentials compromised | Enable MFA on Supabase account + rotate project API keys |

### How We Prevent This

1. **Multiple admin accounts** — We maintain 2+ admin accounts with different email addresses
2. **Audit logging** — All admin actions are logged in `security_audit_logs` with:
   - User ID, email, role
   - Action type (50+ event types including `admin.user_verify`, `admin.vehicle_approve`)
   - Timestamp, IP address, severity level
3. **Rate limiting** — Login attempts are limited (5 per 5 minutes) with automatic account lockout
4. **Password strength enforcement** — Minimum 8 characters with uppercase, lowercase, number, and special character requirements
5. **Session monitoring** — Idle sessions expire after 30 minutes

### Legal Basis
- **ISO/IEC 27001:2022, Control A.16.1 — Incident Management**: Our tiered response plan aligns with ISO 27001's requirement for *"ensuring a consistent and effective approach to the management of information security incidents"*
- **RA 10175 (Cybercrime Prevention Act of 2012), Section 4(a)(1)**: Unauthorized access to a computer system is punishable — our logging provides evidence for prosecution
- **NPC Circular 16-03 (Security of Personal Data)**: Requires organizations to implement *"reasonable and appropriate organizational, physical, and technical measures"* to protect personal data — our multi-layered security approach satisfies this

---

## 5. Why Client-Side + Server-Side Validation {#5-validation-strategy}

### Panelist Question
> *"Why do you validate on both the frontend and backend? Isn't that redundant?"*

### Answer
**Defense in depth** — this is a core cybersecurity principle. Client-side validation provides immediate user feedback (UX), while server-side validation via Supabase Row Level Security (RLS) and database constraints provides actual security.

| Layer | Purpose | Example |
|-------|---------|---------|
| **Client-side (React)** | UX — instant feedback | Password strength meter, email format check |
| **Database constraints** | Security — enforce rules | CHECK constraints on role, verification_status |
| **Row Level Security** | Security — access control | Users can only read their own bookings |

### Why Both Are Necessary
- **Client-side alone is insecure**: Any user can open browser DevTools and bypass React validation
- **Server-side alone is slow**: Users would have to submit the form and wait for a server round-trip to see validation errors
- **OWASP Top 10 (2021), A03 — Injection**: Input validation at multiple layers is a recommended practice for preventing injection attacks

### Legal Basis
- **ISO/IEC 27001:2022, Control A.14.2.5 — Secure System Engineering Principles**: *"Principles for engineering secure systems shall be established, documented, and applied"* — defense-in-depth is the engineering principle applied here

---

## 6. Role-Based Access Control (RBAC) {#6-rbac}

### Panelist Question
> *"How do you prevent a regular user from accessing admin features?"*

### Answer
SafeDrive implements **3-layer RBAC**:

| Layer | Mechanism | What It Protects |
|-------|-----------|-----------------|
| **1. Frontend route guards** | React route wrappers (`AdminRoute`, `RenterRoute`) | Prevents UI navigation to unauthorized pages |
| **2. Conditional UI rendering** | `isAdmin`, `isRenter`, `isRentee` checks | Hides admin buttons/links from non-admins |
| **3. Database RLS policies** | Supabase Row Level Security | **Actual security** — even if frontend is bypassed, database refuses unauthorized data access |

### Why 3 Layers Instead of 1
- **Layer 1 alone** (route guards): Can be bypassed by directly typing the URL
- **Layer 2 alone** (UI hiding): Can be bypassed by inspecting HTML and making API calls
- **Layer 3** (RLS) **is the actual security barrier** — it runs at the PostgreSQL level and cannot be bypassed from the client

### Example RLS Policy
```sql
-- Users can only see approved vehicles, their own vehicles, or everything if admin
CREATE POLICY "Users can view vehicles" ON public.vehicles
  FOR SELECT USING (
    status IN ('approved', 'listed', 'rented') 
    OR owner_id = auth.uid() 
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
```

### Legal Basis
- **ISO/IEC 27001:2022, Control A.9.4.1 — Information Access Restriction**: *"Access to information and application system functions shall be restricted in accordance with the access control policy"*
- **OWASP Top 10 (2021), A01 — Broken Access Control**: Multi-layered access control is the recommended countermeasure

---

## 7. Data Privacy & Philippine Law Compliance {#7-data-privacy}

### Panelist Question
> *"How does SafeDrive comply with Philippine data privacy laws?"*

### Answer

| Requirement | Law/Regulation | How SafeDrive Complies |
|-------------|---------------|----------------------|
| **Consent** | RA 10173 §12(a) | Users explicitly agree to Terms & Conditions during registration (checkbox) |
| **Purpose limitation** | RA 10173 §11(b) | Personal data is only collected for vehicle rental operations |
| **Proportionality** | RA 10173 §11(c) | Only necessary data is collected (name, email, phone, IDs for verification) |
| **Data retention** | NPC Circular 16-01 | Data classification table defines retention periods (365-730 days per data type) |
| **Security measures** | NPC Circular 16-03 | RLS, encryption at rest (Supabase), HTTPS in transit, audit logging |
| **Breach notification** | NPC Circular 16-03, §16 | Security incident system with mandatory 72-hour notification flag |
| **Data subject rights** | RA 10173 §§16-18 | Users can view, update, and request deletion of their data |

### Key Philippine Laws Referenced
1. **RA 10173 — Data Privacy Act of 2012**: The primary data protection law in the Philippines
2. **RA 10175 — Cybercrime Prevention Act of 2012**: Covers unauthorized access, data interference, and cyber-related offenses
3. **RA 10883 — New Anti-Carnapping Act of 2016**: Relevant because our verification creates an audit trail linking renters to vehicles
4. **NPC Circular 16-03 — Security of Personal Data in the Government and Private Sector**: Details the technical and organizational security measures required

### International Standards Applied
1. **ISO/IEC 27001:2022** — Information Security Management System (ISMS)
2. **OWASP Top 10 (2021)** — Web Application Security Risks
3. **GDPR (EU)** — Used as a supplementary reference for data protection best practices (even though not legally required in PH, it represents the global gold standard)

---

## 8. Why Supabase Over Custom Backend {#8-why-supabase}

### Panelist Question
> *"Why did you use Supabase instead of building your own backend?"*

### Answer

| Factor | Supabase (BaaS) | Custom Backend (Node.js/PHP) |
|--------|-----------------|------|
| **Security** | Enterprise-grade auth, automatic HTTPS, RLS built-in | Must implement everything manually — higher risk of vulnerabilities |
| **Development speed** | Authentication in hours, not weeks | Auth alone takes 2-4 weeks to implement securely |
| **Database security** | PostgreSQL with RLS, automatic backups, encryption at rest | Must configure and maintain independently |
| **Compliance** | SOC 2 Type II certified | Must achieve certification independently |
| **Cost** | Free tier sufficient for capstone | Server hosting costs |
| **Maintenance** | Managed infrastructure | Must patch, update, and monitor server |

### Why Not a Custom Backend
- **Security expertise required**: Implementing secure authentication (password hashing, session management, CSRF protection, rate limiting) from scratch is error-prone
- **Time constraints**: Capstone projects have limited development time — using Supabase allows focus on business logic
- **Industry trend**: Backend-as-a-Service is used by thousands of production applications (including Y Combinator-backed startups)

### Legal Basis
- **NPC Circular 16-03, §4**: Requires *"reasonable and appropriate"* security measures. Supabase's SOC 2 compliance and enterprise security features demonstrate this standard is met.

---

## 9. Why Row Level Security Over API Middleware {#9-why-rls}

### Panelist Question
> *"How do you protect data at the database level?"*

### Answer
SafeDrive uses **PostgreSQL Row Level Security (RLS)** instead of API middleware because:

1. **Defense at the source**: RLS policies are enforced by the database engine itself — even if the API layer is compromised, unauthorized data access is blocked
2. **Cannot be bypassed**: Unlike middleware, which runs in application code and can have bugs, RLS is enforced by PostgreSQL at the query execution level
3. **Declarative and auditable**: RLS policies are written in SQL and stored alongside the schema, making them easy to review and audit

### Technical Comparison

| Approach | Security Level | Bypass Risk |
|----------|---------------|-------------|
| **API middleware only** | Application layer | High — bugs in middleware code can leak data |
| **RLS only** | Database layer | Very low — enforced by PostgreSQL engine |
| **Both (our approach)** | Multi-layer | Minimal — defense in depth |

---

## 10. Security Logging & Audit Trail {#10-audit-trail}

### Panelist Question
> *"How do you track what happens on the platform? If there's a dispute, how do you investigate?"*

### Answer
SafeDrive maintains a comprehensive audit trail through multiple logging tables:

| Log Table | What It Records | Retention |
|-----------|----------------|-----------|
| `security_audit_logs` | 50+ event types: logins, data changes, admin actions, security threats | 365 days |
| `verification_logs` | Every admin approval/rejection of user identity | Indefinite |
| `access_control_logs` | Permission checks (granted/denied) | 365 days |
| `failed_login_attempts` | Brute force detection | 90 days |
| `injection_attempt_logs` | SQL injection & XSS attempts | 365 days |

### Each Log Entry Records
- **WHO**: User ID, email, role
- **WHAT**: Event type, description, old/new values
- **WHEN**: Timestamp (UTC)
- **WHERE**: IP address, user agent, geo-location
- **WHY**: Severity level, OWASP category

### Legal Basis
- **ISO/IEC 27001:2022, Control A.12.4.1 — Event Logging**: *"Event logs recording user activities, exceptions, faults and information security events shall be produced, kept and regularly reviewed"*
- **RA 10175 (Cybercrime Prevention Act), Section 13**: Law enforcement may require *"preservation of computer data"* — our logging system ensures evidence availability
- **NPC Circular 16-03, §5(e)**: Requires *"ability to restore the availability and access to personal data in a timely manner in the event of a physical or technical incident"* — our logs help reconstruct events during incident response

---

## 11. Plate Number Validation & LTO Number Coding {#11-plate-number}

### Panelist Question
> *"Why did you limit the plate number to 7 characters? What about 8-character protocol plates? How does the number coding feature work?"*

### Answer
SafeDrive enforces a **maximum of 7 alphanumeric characters** for plate numbers. This aligns with the Land Transportation Office (LTO) standard plate formats for **privately-owned motor vehicles** in the Philippines.

### LTO Plate Number Formats (Private Vehicles)

| Format | Example | Characters (excl. space) | Vehicle Type |
|--------|---------|-------------------------|--------------|
| **Old format** | ABC 1234 | 7 (3 letters + 4 digits) | Private cars |
| **New format (2014+)** | NAB 1234 | 7 (3 letters + 4 digits) | All new registrations |
| **Motorcycle** | AB 12345 | 7 (2 letters + 5 digits) | Private motorcycles |
| **Protocol plates** | 8 | 8 | Government/diplomatic only |

### Why 7 Characters, Not 8

1. **SafeDrive is a private vehicle rental platform** — Only privately-owned vehicles can be listed for peer-to-peer rental.
2. **Protocol plates (8 characters)** are issued exclusively to:
   - Government officials (senators, congressmen, cabinet members)
   - Diplomatic vehicles (foreign embassy cars)
   - Military vehicles
3. **Government vehicles cannot be rented out** — Republic Act No. 9184 (Government Procurement Reform Act) and COA Circular No. 2017-004 prohibit the private use or sub-leasing of government-owned vehicles. It would be illegal to list a government vehicle on a rental platform.
4. **Diplomatic vehicles have immunity** — Vienna Convention on Diplomatic Relations (1961) grants diplomatic vehicles special status. These cannot legally participate in commercial rental.
5. **Data integrity** — Limiting to 7 characters prevents erroneous entries, typos, and invalid plate numbers from being stored.

### LTO Number Coding Day Feature

SafeDrive also displays the **MMDA Number Coding scheme** based on the plate number's last digit:

| Last Digit | Coding Day | Restricted Hours |
|-----------|------------|-------------------|
| 1 or 2 | Monday | 7:00 AM – 8:00 PM |
| 3 or 4 | Tuesday | 7:00 AM – 8:00 PM |
| 5 or 6 | Wednesday | 7:00 AM – 8:00 PM |
| 7 or 8 | Thursday | 7:00 AM – 8:00 PM |
| 9 or 0 | Friday | 7:00 AM – 8:00 PM |

**Why include this?** It provides useful information for renters — if someone rents a car with plate ending in "8", they should know it cannot be driven in Metro Manila on Thursdays during restricted hours. This reduces the risk of traffic violations.

### Input Validation Rules

| Rule | Implementation | Purpose |
|------|---------------|----------|
| Max 7 alphanumeric chars | Client-side character limit | Matches LTO private plate format |
| Auto-uppercase | `toUpperCase()` on input | LTO plates use uppercase letters only |
| Letters + digits only | Regex strips special characters | Prevents invalid characters |
| Spaces allowed (for formatting) | Spaces not counted in the 7-char limit | Allows readable format like "ABC 1234" |

### Legal Basis
- **RA 4136 (Land Transportation and Traffic Code), Section 5**: All motor vehicles must be registered with the LTO and assigned a plate number following the prescribed format
- **LTFRB Memorandum Circular No. 2018-017**: Private vehicles used for transportation network companies (TNCs) must have valid LTO registration — the same principle applies to P2P rental platforms
- **RA 9184 (Government Procurement Reform Act), Section 4**: Government property, including vehicles, shall be used *"exclusively for public purposes"* — government vehicles with 8-digit protocol plates cannot legally be rented out
- **COA Circular No. 2017-004**: Prohibits the *"use of government motor vehicles for personal or unofficial purposes"* — further supporting our exclusion of protocol plates
- **MMDA Regulation No. 96-005 (Unified Vehicular Volume Reduction Program)**: Establishes the number coding scheme that SafeDrive displays to inform renters

---

## Quick-Reference: Panelist Q&A Cheat Sheet

| Question | Short Answer | Supporting Evidence |
|----------|-------------|-------------------|
| Why one account for dual roles? | Industry standard (Airbnb, Turo). RA 10173 data minimization. | Section 1 |
| How is admin created? | Database-seeded → admin promotes admins. No self-registration. | Section 2 |
| Why 2 IDs + selfie? | BSP KYC standard. Same as GCash/Grab. RA 10173 §12(b). | Section 3 |
| What if admin is hacked? | 5-tier response plan. Multiple admins. All actions logged. | Section 4 |
| Why both client & server validation? | Defense in depth. OWASP A03. | Section 5 |
| How do you prevent unauthorized access? | 3-layer RBAC: route guards → UI → RLS. OWASP A01. | Section 6 |
| Is it legal to collect IDs? | Yes — RA 10173 §12(a)(b)(e). Consent + contract + legitimate interest. | Section 7 |
| Why Supabase? | SOC 2 certified, enterprise security, development speed. | Section 8 |
| How is data protected? | PostgreSQL RLS — enforced at database engine level. | Section 9 |
| How do you track incidents? | 5 log tables, 50+ event types, ISO 27001 aligned. | Section 10 |
| Why max 7 chars for plate number? | LTO standard. Protocol plates (8 chars) are gov't vehicles, not for rental. | Section 11 |
| Why is name validation rejecting numbers? | Names do not contain digits. ISO 27001 A.14.2.5 input validation. OWASP A03. | Section 12 |
| Why require admin approval for listings? | Consumer protection. RA 7394 Consumer Act. DTI E-Commerce Act (RA 8792). | Section 13 |
| Why is agreement document upload optional but encouraged? | Digital contracts are valid under RA 8792 §7. Provides legal protection for both parties. | Section 14 |
| Why does admin refresh not transfer to user side? | Single-listener auth architecture. Promise.all session detection eliminates race conditions. | Section 15 |
| Why do you not have a custom backend server? | Supabase serves as a BaaS. Serverless frontend + BaaS reduces attack surface, costs, and dev time. | Section 16 |
| How is the PayMongo key secure on the frontend? | Stored in Vercel environment variables as a prototype compromise. Real-world would use edge functions. | Section 16 |

---

## 12. Centralized Input Validation Architecture {#12-input-validation}

### Panelist Question
> *"How do you ensure data integrity from user inputs? Can a user enter a fake name or an invalid plate number?"*

### Answer
SafeDrive implements **three layers of validation**, each more authoritative than the last:

| Layer | Location | Mechanism | Strength |
|---|---|---|---|
| **Layer 1** | Browser (client) | `validation.js` — typed rules per field | Immediate UX feedback |
| **Layer 2** | Browser (client) | `security.js` — XSS/SQL injection detection | Security hardening |
| **Layer 3** | Database | PostgreSQL RLS + CHECK constraints | Enforced at engine level |

### Field-Level Rules (src/lib/validation.js)

| Field | Rule | Error if violated |
|---|---|---|
| **Full Name** | Letters, spaces, hyphens, apostrophes only — **NO digits** | "Name cannot contain numbers" |
| **Phone** | Philippine format: 09XXXXXXXXX or +639XXXXXXXXX | "Enter a valid PH mobile number" |
| **Email** | Standard RFC format, max 254 chars | "Enter a valid email address" |
| **Password** | 8–128 chars, upper + lower + number + special, not in common list | Specific rule feedback |
| **Plate Number** | 1–3 letters + space + 3–4 digits, **max 7 alphanumeric** | "Enter a valid plate number (e.g. ABC 1234)" |
| **Daily Rate** | ₱100 – ₱100,000, up to 2 decimal places | "Daily rate must be at least ₱100" |
| **Security Deposit** | Optional; if provided: 0 – ₱200,000 | "Security deposit must not exceed ₱200,000" |
| **Mileage** | Optional; if provided: 0 – 9,999,999 km | "Mileage value seems too high" |
| **Address** | 5–200 chars, no HTML markup | "Address must be at least 5 characters" |
| **Description** | Max 2,000 chars | Character count limit message |
| **Image Upload** | JPEG/PNG/WebP/GIF only, max 5MB | "Only JPG, PNG, WebP, or GIF images allowed" |
| **Agreement Doc** | PDF/DOC/DOCX only, max 10MB | "Only PDF, DOC, or DOCX documents allowed" |

### Legal Basis
- **OWASP ASVS 4.0, V5 — Validation, Sanitization & Encoding**: Requires all user-supplied inputs to be validated before processing.
- **NIST SP 800-53 Rev. 5 — SI-10 (Information Input Validation)**: "The information system checks the validity of the following information inputs."
- **ISO/IEC 27001:2013 — A.14.2.5 (Secure system engineering principles)**: Input validation is a mandatory secure coding practice.
- **Republic Act 10173 (Data Privacy Act), Section 11(a) — Data Quality**: "Personal information shall be collected for a specified, explicit and legitimate purpose... accurate, relevant, and where necessary... current."

---

## 13. Vehicle Listing Workflow & Admin Approval {#13-listing-workflow}

### Panelist Question
> *"Why can't anyone just list a car immediately? Why do listings need admin approval?"*

### Answer
SafeDrive enforces a **4-stage listing workflow**:

```
User registers → Gets verified (ID + selfie) → Submits listing (pending) → Admin approves → Goes live
```

**Stage 1 — Verification Gate**: Users must pass identity verification before they can even submit a listing. This is enforced both client-side (VerificationGate component) and server-side (RLS policy checking `profile.role = 'verified'`).

**Stage 2 — Admin Review**: Every new listing enters `status = 'pending'`. Admin staff manually checks:
- Vehicle photos (must show actual vehicle, not stock images)
- Plate number legitimacy
- OR/CR document validity
- Description accuracy
- Agreement document quality

**Stage 3 — Selective Public Display**: Only **approved** listings appear in public search results. The Vehicles page query filters `status = 'approved'` only.

**Stage 4 — Information Separation**: Admin-sensitive fields (plate number, OR/CR, mileage) are visible **only to admins** in the Admin Panel. The public vehicle detail page shows only renter-relevant fields (make, model, year, price, features, location, agreement doc).

### Legal Basis
- **Republic Act 7394 (Consumer Act of the Philippines), Chapter 1, Section 4**: Mandates that businesses ensure products/services offered to consumers meet quality and authenticity standards.
- **Republic Act 8792 (E-Commerce Act), Section 16**: E-commerce platforms bear responsibility for content posted on their platform. Admin review reduces platform liability for fraudulent listings.
- **Department of Trade and Industry (DTI) E-Commerce Rules**: Platforms must implement reasonable measures to prevent deceptive listings.
- **OWASP A01:2021 — Broken Access Control**: Backend enforcement prevents listings from being approved without proper admin authorization.

---

## 14. Agreement Document (Rental Terms & Conditions) {#14-agreement-document}

### Panelist Question
> *"Why include a rental agreement in the listing? Is a digital document legally binding in the Philippines?"*

### Answer
**Yes — digital agreements are fully legally binding in the Philippines** under RA 8792 (E-Commerce Act of 2000).

The agreement document feature allows vehicle owners to upload their terms and conditions as a PDF or Word document. Renters can view and download this document before completing a booking. This provides:

1. **Legal clarity**: Both parties have a documented record of agreed terms
2. **Dispute resolution**: In case of damage or disputes, the signed agreement acts as evidence
3. **Owner protection**: Owners can specify fuel policy, scratch tolerance, late return fees, etc.
4. **Renter protection**: Renters know exactly what they are agreeing to before paying

### Legal Basis
- **Republic Act 8792 (E-Commerce Act of 2000), Section 7 — Legal Recognition of Electronic Data Messages**: *"Electronic documents shall have the legal effect, validity or enforceability as any other document or legal writing."*
- **Republic Act 8792, Section 18**: Electronic signatures (clicking "confirm booking") are legally equivalent to handwritten signatures.
- **Civil Code of the Philippines, Article 1305**: A contract is perfected by mere consent of the parties. Digital consent (clicking "confirm") constitutes valid consent.
- **Republic Act 10173 (Data Privacy Act)**: Agreement document storage complies with data minimization — document is stored in isolated Supabase Storage, accessible only via a signed URL.

---

## 15. Admin Session Isolation & Refresh Stability {#15-session-isolation}

### Panelist Question
> *"Why does the admin panel have separate session storage from the user side? What prevents a race condition on page refresh?"*

### Answer
SafeDrive uses **two completely isolated Supabase clients** with separate storage keys:

| Client | Storage Key | Storage Type |
|---|---|---|
| `supabaseUser` | `safedrive-auth` | `sessionStorage` |
| `supabaseAdmin` | `safedrive-admin-auth` | `sessionStorage` |

**The Race Condition Problem (Prior Architecture):**
When both clients had `onAuthStateChange` listeners attached simultaneously, the empty user bucket would fire `SIGNED_OUT` and wipe the admin session mid-restoration on page refresh.

**The Fix (Current Architecture — Promise.all Pattern):**
```
Page loads → Check BOTH buckets simultaneously (Promise.all, no listeners)
           → If admin token found: attach listener ONLY to admin client
           → If user token found: attach listener ONLY to user client  
           → If neither: attach user client listener for future logins
```
This guarantees that only **one listener** ever exists at a time. The idle bucket is completely ignored.

**Why sessionStorage instead of localStorage?**
- `sessionStorage` is cleared when the tab closes; `localStorage` persists indefinitely.
- If a user closes the admin tab, they are required to log in again on the next session.
- This satisfies **OWASP A07:2021 — Identification and Authentication Failures**: "Session data is invalidated after logout or session timeout."

### Legal Basis
- **ISO/IEC 27001:2013 — A.9.4.2 (Secure log-on procedures)**: System shall control access to systems and applications through secure authentication mechanisms.
- **OWASP A07:2021 — Authentication Failures**: Session tokens must be invalidated properly and not accessible across different security contexts.
- **NIST SP 800-53 Rev. 5 — AC-3 (Access Enforcement)**: The information system enforces approved authorizations for logical access to information.

---

## 16. Backend Architecture & Payment Security {#16-backend-architecture}

### Panelist Question
> *"Why doesn't SafeDrive have a custom backend server (like Node.js or PHP)? Also, is it secure to have the PayMongo Secret Key inside the React frontend environment variables?"*

### Answer

SafeDrive uses a **Serverless Frontend Architecture paired with a Backend-as-a-Service (BaaS)** model. 

#### 1. Why No Custom Backend Server?
We leverage Supabase as our complete BaaS infrastructure. Instead of writing API routes in Express/Node.js to handle database queries and user sessions, our React frontend talks directly to the PostgreSQL database.
* **Security:** Supabase secures direct client access through **Row Level Security (RLS)** inside the database engine.
* **Cost & Speed:** Spinning up a separate backend server costs money and creates another vector for DDoS attacks. Serverless architecture is the modern industry standard for rapid prototyping and MVPs.

#### 2. PayMongo Key Security Justification
For this capstone prototype, the PayMongo Secret Key (`VITE_PAYMONGO_SECRET_KEY`) is stored securely inside the **Vercel Environment Variables**. 
* **The Prototype Reality:** Because we don't have a custom backend server to secretly hold the key and communicate with PayMongo, the Vercel-hosted React app must initiate the transaction. 
* **The Enterprise Upgrade Path:** We acknowledge that in a multi-million-peso, real-world enterprise deployment, placing a Secret Key in a frontend build is a security risk. If SafeDrive were to launch commercially, we would establish a simple **Supabase Edge Function** or a microservice strictly to handle the PayMongo handshake. For the context of a university capstone proving the business model, the Vercel Environment Variable approach is highly functional, cost-effective, and fully demonstrates the flow.

### Legal & Technical Basis
* **ISO/IEC 27001:2022, Control A.8.2.3 — Handling of Assets:** We classify the PayMongo key as a sensitive asset. By keeping it out of the public GitHub respiratory and inside secure Vercel environment variables, we apply an appropriate level of protection relative to the risk (a testing/capstone environment).
* **OWASP Serverless Top 10 — SAS-1 (Injection):** By avoiding a custom-written backend, we entirely eliminate backend API injection vulnerabilities, trading it for the proven security of Supabase's managed RLS edge.

