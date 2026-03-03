# SafeDrive — Requirements Analysis Document
**Project:** SafeDrive — Peer-to-Peer Car Rental Platform
**Version:** 2.0 | **Date:** March 2026
**Prepared by:** Development Team | **Inspection Method:** Fagan Inspection

---

## 1. Introduction

### 1.1 Purpose
This document defines all functional and non-functional requirements for the SafeDrive P2P car rental web application. Each requirement is uniquely identified, traceable to a system feature, and has been subjected to Fagan Inspection to ensure correctness, completeness, and consistency.

### 1.2 Scope
SafeDrive enables:
- Vehicle owners to list their cars for rental with admin-approved onboarding
- Renters to browse, book, and manage car rentals with verified identities
- Administrators to manage users, listings, bookings, and audit all system activity

### 1.3 Stakeholders
| Stakeholder | Role |
|---|---|
| Vehicle Owners (Listers) | List their vehicles, set pricing, manage availability, upload rental agreements |
| Renters | Search, book, and pay for vehicles via the platform |
| Administrators | Approve listings, verify users, monitor system health, view audit logs |
| National Privacy Commission | RA 10173 compliance oversight |
| DTI / LTO | E-commerce and vehicle registration compliance |

---

## 2. Definitions and Abbreviations

| Term | Definition |
|---|---|
| REQ | Requirement identifier |
| FR | Functional Requirement |
| NFR | Non-Functional Requirement |
| SEC | Security Requirement |
| DPR | Data Privacy Requirement |
| MUST | Mandatory requirement — system cannot function without this |
| SHOULD | Strongly recommended — significant impact if omitted |
| MAY | Optional — desirable but not critical |
| RLS | Row Level Security (PostgreSQL) |
| KYC | Know Your Customer (identity verification) |

---

## 3. Functional Requirements

### 3.1 Authentication and Account Management

| Req. ID | Requirement | Priority | Status | Test Method |
|---|---|---|---|---|
| REQ-FR-001 | The system MUST allow users to register with email, password, full name, and phone number | MUST | ✅ Implemented | Form submission test |
| REQ-FR-002 | The system MUST validate that full names contain only letters, spaces, hyphens, and apostrophes — no digits allowed | MUST | ✅ Implemented | Boundary value test |
| REQ-FR-003 | The system MUST validate phone numbers in Philippine format: 09XXXXXXXXX or +639XXXXXXXXX | MUST | ✅ Implemented | Pattern match test |
| REQ-FR-004 | The system MUST enforce password rules: min 8 chars, uppercase + lowercase + number + special character | MUST | ✅ Implemented | Password rule test |
| REQ-FR-005 | The system MUST block commonly used passwords (password, 123456, qwerty, etc.) | MUST | ✅ Implemented | Blocklist test |
| REQ-FR-006 | The system MUST send an email verification link after registration | MUST | ✅ Implemented | Email trigger test |
| REQ-FR-007 | The system MUST redirect already-authenticated users away from login/register pages | MUST | ✅ Implemented | Route guard test |
| REQ-FR-008 | The system MUST allow users to reset their password via email link | MUST | ✅ Implemented | Password reset flow |
| REQ-FR-009 | The system MUST maintain completely separated session storage for admin and user accounts | MUST | ✅ Implemented | Parallel tab test |
| REQ-FR-010 | The system MUST allow users to change their password from the Settings page | MUST | ✅ Implemented | Settings form test |

### 3.2 User Profile and Verification

| Req. ID | Requirement | Priority | Status | Test Method |
|---|---|---|---|---|
| REQ-FR-011 | The system MUST allow users to upload a government-issued ID for identity verification | MUST | ✅ Implemented | File upload test |
| REQ-FR-012 | The system MUST allow users to upload a selfie for liveness verification | MUST | ✅ Implemented | Selfie upload test |
| REQ-FR-013 | The system MUST update a user's role to 'verified' only after admin approval | MUST | ✅ Implemented | Admin approval flow test |
| REQ-FR-014 | The system MUST allow users to update their avatar, full name, and phone number | MUST | ✅ Implemented | Profile edit test |
| REQ-FR-015 | The system MUST show the user's current verification status (pending / submitted / verified / rejected) | MUST | ✅ Implemented | Profile page review |
| REQ-FR-016 | The system SHOULD notify users via notification when their verification is approved or rejected | SHOULD | ✅ Implemented | Notification trigger test |

### 3.3 Vehicle Listing

| Req. ID | Requirement | Priority | Status | Test Method |
|---|---|---|---|---|
| REQ-FR-017 | The system MUST prevent unverified users from submitting a vehicle listing | MUST | ✅ Implemented | Verification gate test |
| REQ-FR-018 | The system MUST collect: brand, model, year, color, plate number, body type, transmission, fuel type, seating capacity | MUST | ✅ Implemented | Form field test |
| REQ-FR-019 | The system MUST validate plate numbers in LTO format (max 7 alphanumeric chars, e.g. ABC 1234) | MUST | ✅ Implemented | Plate regex test |
| REQ-FR-020 | The system MUST allow only one daily rate field with selectable duration options (1 day, 2 days, 3 days, 1 week, 2 weeks, 1 month) | MUST | ✅ Implemented | Pricing form test |
| REQ-FR-021 | The system MUST display seating capacity as a range label (e.g., "4–5 seater") based on body type | MUST | ✅ Implemented | Body type mapping test |
| REQ-FR-022 | The system MUST allow owners to upload up to 4 vehicle photos (JPEG/PNG/WebP, max 5MB each) | MUST | ✅ Implemented | File upload test |
| REQ-FR-023 | The system MUST allow owners to upload a rental agreement document (PDF/DOC/DOCX, max 10MB) | SHOULD | ✅ Implemented | Document upload test |
| REQ-FR-024 | The system MUST set vehicle status to 'pending' upon submission, requiring admin approval before going live | MUST | ✅ Implemented | Status transition test |
| REQ-FR-025 | The system MUST auto-detect the vehicle's body type from the selected model (from car_models table) | SHOULD | ✅ Implemented | Model select test |
| REQ-FR-026 | The system MUST display the MMDA/LTO number coding day computed from the plate number | SHOULD | ✅ Implemented | Plate coding test |

### 3.4 Vehicle Discovery

| Req. ID | Requirement | Priority | Status | Test Method |
|---|---|---|---|---|
| REQ-FR-027 | The system MUST show only admin-approved ('approved') vehicles in public browse pages | MUST | ✅ Implemented | DB query filter test |
| REQ-FR-028 | The system MUST allow filtering by body type, transmission, fuel type, and price range | SHOULD | ⚠️ Partial | Filter UI test |
| REQ-FR-029 | The system MUST allow sorting by price (ascending/descending) and newest | SHOULD | ⚠️ Partial | Sort UI test |
| REQ-FR-030 | The system MUST NOT display plate numbers or mileage on public vehicle detail pages | MUST | ✅ Implemented | Public page audit |
| REQ-FR-031 | The system MUST display the agreement document download link if the owner provided one | MUST | ✅ Implemented | Detail page review |
| REQ-FR-032 | The system MUST display available rental durations as badges on the vehicle detail page | MUST | ✅ Implemented | Detail page review |

### 3.5 Booking

| Req. ID | Requirement | Priority | Status | Test Method |
|---|---|---|---|---|
| REQ-FR-033 | The system MUST require user verification before allowing a booking to be submitted | MUST | ✅ Implemented | Verification gate test |
| REQ-FR-034 | The system MUST prevent owners from booking their own vehicles | MUST | ✅ Implemented | Self-booking test |
| REQ-FR-035 | The system MUST prevent booking on dates already marked unavailable | MUST | ✅ Implemented | Availability check test |
| REQ-FR-036 | The system MUST calculate total: daily_rate × days + 10% service fee + security deposit | MUST | ✅ Implemented | Calculation test |
| REQ-FR-037 | The system MUST send a notification to the vehicle owner when a booking request is made | MUST | ✅ Implemented | Notification trigger test |
| REQ-FR-038 | The system MUST allow owners to accept or decline booking requests | MUST | ✅ Implemented | Booking status flow |
| REQ-FR-039 | The system MUST not allow booking dates to be in the past | MUST | ✅ Implemented | Date validation test |
| REQ-FR-040 | The system MUST limit booking duration to a maximum of 365 days | SHOULD | ✅ Implemented | Date range test |

### 3.6 Admin Panel

| Req. ID | Requirement | Priority | Status | Test Method |
|---|---|---|---|---|
| REQ-FR-041 | The system MUST restrict the admin panel to accounts with role = 'admin' | MUST | ✅ Implemented | Route guard test |
| REQ-FR-042 | Admins MUST be able to view and approve or reject vehicle listings | MUST | ✅ Implemented | Admin listing review |
| REQ-FR-043 | Admins MUST be able to view, verify, or suspend user accounts | MUST | ✅ Implemented | Admin user management |
| REQ-FR-044 | Admins MUST see all bookings across all users | MUST | ✅ Implemented | Admin booking view |
| REQ-FR-045 | Admins MUST be able to view the full audit log of all system actions | MUST | ✅ Implemented | Audit log view |
| REQ-FR-046 | Admins MUST NOT be redirected to the user side when refreshing their admin session | MUST | ✅ Implemented | Session refresh test |
| REQ-FR-047 | The admin panel MUST display all pending vehicle listings for review | MUST | ✅ Implemented | Admin pending queue |

### 3.7 Settings and Notifications

| Req. ID | Requirement | Priority | Status | Test Method |
|---|---|---|---|---|
| REQ-FR-048 | The system MUST provide a dedicated Settings page accessible from the navbar dropdown | MUST | ✅ Implemented | Navigation test |
| REQ-FR-049 | Settings MUST allow users to change their password | MUST | ✅ Implemented | Password change test |
| REQ-FR-050 | Settings MUST display notification preference toggles | SHOULD | ✅ Implemented | Toggle test |
| REQ-FR-051 | Settings MUST provide a data export request option (RA 10173 compliance) | SHOULD | ✅ Implemented | Export trigger test |
| REQ-FR-052 | Settings MUST provide an account deletion flow with confirmation modal | SHOULD | ✅ Implemented | Delete confirm test |
| REQ-FR-053 | The system MUST provide a Notifications page showing all user notifications with read/unread status | MUST | ✅ Implemented | Notifications list test |
| REQ-FR-054 | Users MUST be able to mark individual or all notifications as read | SHOULD | ✅ Implemented | Mark-read test |

---

## 4. Non-Functional Requirements

### 4.1 Performance

| Req. ID | Requirement | Priority | Threshold |
|---|---|---|---|
| REQ-NFR-001 | Page load time MUST be under 3 seconds on first load (LCP) | MUST | < 3s |
| REQ-NFR-002 | Database queries MUST complete within 2 seconds under normal load | MUST | < 2s |
| REQ-NFR-003 | Image uploads MUST complete within 10 seconds for a 5MB file | SHOULD | < 10s |
| REQ-NFR-004 | The system SHOULD maintain performance for at least 1,000 concurrent users | SHOULD | 1000 users |

### 4.2 Usability

| Req. ID | Requirement | Priority |
|---|---|---|
| REQ-NFR-005 | All forms MUST display inline validation errors next to the failing field | MUST |
| REQ-NFR-006 | All errors MUST be human-readable and actionable (not raw error codes) | MUST |
| REQ-NFR-007 | The interface MUST be responsive on screens 375px and wider (mobile to desktop) | MUST |
| REQ-NFR-008 | All interactive elements MUST have hover and active states | SHOULD |

### 4.3 Reliability

| Req. ID | Requirement | Priority |
|---|---|---|
| REQ-NFR-009 | The system MUST have a safety timeout (5 seconds) so loading spinners never show forever | MUST |
| REQ-NFR-010 | Failed database queries MUST be caught and display user-friendly error messages, not crash the app | MUST |
| REQ-NFR-011 | Auth state MUST be correctly restored on page refresh without redirecting to the wrong portal | MUST |

---

## 5. Security Requirements

| Req. ID | Requirement | Standard Reference | Status |
|---|---|---|---|
| REQ-SEC-001 | All user text inputs MUST be validated before storage | OWASP A03:2021, NIST SI-10 | ✅ |
| REQ-SEC-002 | All text inputs MUST be checked for XSS and SQL injection patterns | OWASP A03:2021 | ✅ |
| REQ-SEC-003 | Admin and user sessions MUST use completely isolated storage keys | OWASP A07:2021 | ✅ |
| REQ-SEC-004 | Session tokens MUST be stored in sessionStorage (not localStorage) to expire on tab close | OWASP A07:2021 | ✅ |
| REQ-SEC-005 | Database operations MUST use parameterized queries via supabase-js ORM | OWASP A03:2021 | ✅ |
| REQ-SEC-006 | All database tables MUST enforce Row Level Security (RLS) policies | OWASP A01:2021 | ✅ |
| REQ-SEC-007 | File uploads MUST validate MIME type and file size before processing | OWASP A08:2021 | ✅ |
| REQ-SEC-008 | The system MUST log all admin actions to the audit_logs table | ISO 27001 A.12.4.1 | ✅ |
| REQ-SEC-009 | detectSessionInUrl MUST be set to false on both Supabase clients | OWASP A01:2021 | ✅ |
| REQ-SEC-010 | Rate limiting MUST be applied to login attempts (max 5 per minute) | OWASP A07:2021 | ✅ |

---

## 6. Data Privacy Requirements

| Req. ID | Requirement | Legal Basis | Status |
|---|---|---|---|
| REQ-DPR-001 | User consent MUST be obtained before collecting personal data during registration | RA 10173 §13 | ✅ |
| REQ-DPR-002 | Government ID images MUST be stored in a private Supabase Storage bucket | RA 10173 §20, §21 | ✅ |
| REQ-DPR-003 | Plate numbers and mileage MUST NOT be visible to the public | RA 10173 §11 | ✅ |
| REQ-DPR-004 | Users MUST be able to request their data export from Settings | RA 10173 §18 (Right to access) | ✅ |
| REQ-DPR-005 | Rental agreement documents MUST only be stored in isolated storage | RA 10173 §20 | ✅ |
| REQ-DPR-006 | The system MUST NOT collect data beyond what is necessary for the service | RA 10173 §11(c) | ✅ |

---

## 7. Fagan Inspection Checklist

> **Fagan Inspection** is a formal, structured review process for detecting defects in software requirements. Each requirement is reviewed against the checklist below by an independent inspector.

### 7.1 Inspection Criteria and Results

| Inspection Code | Criteria | Description |
|---|---|---|
| **FI-C** | **Correctness** | Does the requirement accurately describe the intended system behavior? |
| **FI-A** | **Ambiguity** | Is the requirement free from ambiguous language ("user-friendly", "fast", "secure" without metrics)? |
| **FI-T** | **Testability** | Can the requirement be verified through a specific test or inspection? |
| **FI-F** | **Feasibility** | Is the requirement technically achievable with the current stack (React, Supabase)? |
| **FI-D** | **Duplication** | Does the requirement conflict with or duplicate another requirement? |
| **FI-M** | **Missing Info** | Is all information needed to implement the requirement present? |
| **FI-P** | **Priority** | Is each requirement correctly classified as MUST/SHOULD/MAY? |

### 7.2 Fagan Inspection Results Table

| Req. ID | FI-C | FI-A | FI-T | FI-F | FI-D | FI-M | FI-P | Status | Defect / Notes |
|---|---|---|---|---|---|---|---|---|---|
| REQ-FR-001 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** | — |
| REQ-FR-002 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** | Regex documented in validation.js |
| REQ-FR-003 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** | PH_PHONE_REGEX defined |
| REQ-FR-004 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** | — |
| REQ-FR-005 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** | Blocklist has 16 entries |
| REQ-FR-017 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** | VerificationGate component enforces this |
| REQ-FR-019 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** | PLATE_REGEX: `/^[A-Z]{1,3}[ -]?\d{3,4}$/` |
| REQ-FR-020 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** | DURATION_OPTIONS array with 6 choices |
| REQ-FR-024 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** | Enforced via Supabase RLS on INSERT |
| REQ-FR-027 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** | Vehicles.jsx filters `status = 'approved'` |
| REQ-FR-028 | ⚠️ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | **PARTIAL** | FI-M: Price range filter needs min/max UI inputs |
| REQ-FR-029 | ⚠️ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | **PARTIAL** | FI-M: Sort dropdown exists but newest sort missing |
| REQ-FR-030 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** | Removed from public specs grid in VehicleDetail.jsx |
| REQ-FR-036 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** | calculateTotal() function verified |
| REQ-FR-046 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** | Promise.all + single listener architecture |
| REQ-FR-048 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** | Settings.jsx created and routed |
| REQ-SEC-001 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** | validation.js covers 16 field types |
| REQ-SEC-006 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** | RLS documented in supabase-security-schema.sql |
| REQ-DPR-003 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** | Plate removed from public VehicleDetail.jsx |

### 7.3 Defect Classification

| Severity | Definition | Count |
|---|---|---|
| **Major (M)** | Requirement missing, incorrect, or un-implementable | 0 |
| **Minor (mi)** | Ambiguous wording, missing details, non-critical gap | 2 |
| **Cosmetic (c)** | Formatting, naming, or documentation issue | 0 |

**Defects Found:**
- `REQ-FR-028` (Minor): Price range filter lacks min/max input field specification. Recommendation: add `filter_min_price` and `filter_max_price` inputs.
- `REQ-FR-029` (Minor): "Newest" sort direction not explicitly implemented in sort dropdown. Recommendation: add `order: 'created_at DESC'` option.

### 7.4 Inspection Sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| Author | Development Team | March 2026 | Submitted |
| Moderator | Project Lead | March 2026 | Approved with 2 minor remarks |
| Inspector | QA Lead | March 2026 | Conditionally Approved |
| **Final Status** | — | — | **APPROVED — 2 Minor Defects (Non-blocking)** |

---

## 8. Traceability Matrix

| Req. ID | Feature | Source File(s) | Test Coverage |
|---|---|---|---|
| REQ-FR-001 | Registration Form | `Register.jsx` | Manual |
| REQ-FR-002 | Name Validation | `validation.js:validateFullName` | Unit test |
| REQ-FR-003 | Phone Validation | `validation.js:validatePhoneNumber` | Unit test |
| REQ-FR-004–005 | Password Strength | `Register.jsx`, `validation.js:validatePassword` | Unit test |
| REQ-FR-009 | Session Isolation | `AuthContext.jsx`, `supabase.js` | Integration test |
| REQ-FR-017 | Verification Gate | `CreateVehicle.jsx`, `VerificationGate.jsx` | Manual |
| REQ-FR-019 | Plate Validation | `validation.js:validatePlateNumber` | Unit test |
| REQ-FR-020 | Duration Pricing | `CreateVehicle.jsx` | Manual |
| REQ-FR-022–023 | File Uploads | `CreateVehicle.jsx`, `validation.js` | Manual |
| REQ-FR-024 | Pending Status | `CreateVehicle.jsx`, `SUPABASE_VEHICLE_MIGRATION.sql` | DB inspection |
| REQ-FR-027 | Approved Filter | `Vehicles.jsx` | DB query test |
| REQ-FR-030 | Plate Privacy | `VehicleDetail.jsx` | Manual |
| REQ-FR-046 | Admin Session | `AuthContext.jsx` | Session test |
| REQ-FR-048–054 | Settings + Notifications | `Settings.jsx`, `Notifications.jsx`, `App.jsx` | Manual |
| REQ-SEC-001–010 | Security Controls | `security.js`, `validation.js`, `supabase.js` | Security audit |
| REQ-DPR-001–006 | Privacy Controls | `Profile.jsx`, `Settings.jsx`, RLS policies | DPIA audit |

---

## 9. Open Issues and Future Requirements

| Issue ID | Description | Priority | Target Version |
|---|---|---|---|
| OI-001 | Price range filter (REQ-FR-028) needs min/max input fields | Medium | v2.1 |
| OI-002 | Add "Sort by Newest" option in Vehicles.jsx | Low | v2.1 |
| OI-003 | Implement OTP/2FA for admin login | High | v2.2 |
| OI-004 | Payment gateway integration (GCash, PayMaya, credit card) | High | v3.0 |
| OI-005 | Mobile app (React Native or PWA) for push notifications | Medium | v3.0 |
| OI-006 | Automated ID verification via OCR API | High | v2.2 |
| OI-007 | In-platform messaging between owner and renter | Medium | v2.2 |
| OI-008 | Insurance integration for vehicle coverage during rental | High | v3.0 |
