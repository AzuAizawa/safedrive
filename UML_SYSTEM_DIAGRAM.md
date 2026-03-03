# SafeDrive — Complete System UML Diagram
**Version 3.0 · March 2026**

---

## 1. Actor Definitions

| Actor | Description |
|---|---|
| **Guest** | Unauthenticated visitor browsing the platform |
| **User (Unverified)** | Registered account, email confirmed, no ID submitted yet |
| **User (Verified)** | Account with approved government ID — can list and rent vehicles |
| **Admin** | Platform staff — can approve listings, manage users, view audit logs |

---

## 2. Use Case Diagram

```mermaid
graph LR
    Guest(["🌐 Guest"])
    Unverified(["👤 Unverified User"])
    Verified(["✅ Verified User"])
    Admin(["🛡️ Admin"])

    subgraph Public["Public Actions"]
        UC1["Browse Vehicles"]
        UC2["View Vehicle Detail"]
        UC3["Register Account"]
        UC4["Login"]
    end

    subgraph UserActions["Authenticated User Actions"]
        UC5["Submit ID for Verification"]
        UC6["View Dashboard"]
        UC7["Edit Profile"]
        UC8["View Bookings"]
        UC9["Write Review"]
    end

    subgraph OwnerActions["Verified Owner Actions"]
        UC10["List a Vehicle"]
        UC11["Manage My Vehicles"]
        UC12["Upload Agreement Doc"]
        UC13["Set Availability"]
        UC14["Accept/Decline Booking"]
    end

    subgraph RenterActions["Verified Renter Actions"]
        UC15["Book a Vehicle"]
        UC16["Download Agreement"]
        UC17["Cancel Booking"]
    end

    subgraph AdminActions["Admin-Only Actions"]
        UC18["Approve / Reject Listing"]
        UC19["Verify / Suspend User"]
        UC20["View Audit Trail"]
        UC21["Manage Car Brands / Models"]
        UC22["View All Bookings"]
    end

    Guest --> UC1 & UC2 & UC3 & UC4
    Unverified --> UC5 & UC6 & UC7 & UC8
    Verified --> UC10 & UC11 & UC12 & UC13 & UC14
    Verified --> UC15 & UC16 & UC17 & UC9
    Admin --> UC18 & UC19 & UC20 & UC21 & UC22
```

---

## 3. Authentication Flow Diagram

```mermaid
flowchart TD
    A([Start]) --> B{Has session in storage?}

    B -- "Check safedrive-admin-auth\nand safedrive-auth\nin parallel Promise.all" --> C{Admin session found?}
    C -- Yes --> D[Set activeClient = supabaseAdmin\nAttach single listener to admin client\nLoad admin profile]
    C -- No --> E{User session found?}
    E -- Yes --> F[Set activeClient = supabaseUser\nAttach single listener to user client\nLoad user profile]
    E -- No --> G[No session\nAttach user client listener for future logins\nShow login page]

    D --> H{profile.role === 'admin'?}
    H -- Yes --> I[Render AdminPanel\n/admin route]
    H -- No --> J[Role mismatch — sign out\nRedirect to login]

    F --> K{profile.role}
    K -- user/verified --> L[Render Dashboard\n/dashboard route]
    K -- admin --> M[Admin tried user portal\nRedirect to /admin-login]

    subgraph SessionRestore["On every page refresh"]
        B
    end
```

---

## 4. Vehicle Listing Workflow (State Machine)

```mermaid
stateDiagram-v2
    [*] --> Draft : Owner fills listing form
    Draft --> ValidationFailed : Client validation error
    ValidationFailed --> Draft : Owner corrects inputs
    Draft --> Pending : Owner submits\n(status = 'pending')
    Pending --> UnderReview : Admin opens listing
    UnderReview --> Approved : Admin clicks Approve
    UnderReview --> Rejected : Admin clicks Reject
    Approved --> Active : Appears in public listings
    Active --> Inactive : Owner deactivates
    Rejected --> Draft : Owner edits and resubmits
    Active --> [*] : Owner deletes listing
```

---

## 5. Booking Flow Diagram

```mermaid
sequenceDiagram
    participant Renter
    participant System
    participant DB as Supabase DB
    participant Owner

    Renter->>System: Select vehicle + dates
    System->>System: Validate booking dates\n(no past dates, not > 365 days)
    System->>DB: Check vehicle_availability for conflicts
    DB-->>System: Return blocked dates
    alt Dates are available
        System->>DB: INSERT booking (status='pending')
        DB-->>System: Booking created
        System->>DB: INSERT notification for owner
        System-->>Renter: "Booking request sent!"
        Owner->>System: View booking request
        Owner->>DB: UPDATE booking status = 'accepted'/'declined'
        DB->>System: NOTIFY renter via notification
        System-->>Renter: "Your booking was accepted/declined"
    else Dates unavailable
        System-->>Renter: "Selected dates are not available"
    end
```

---

## 6. User Verification Workflow

```mermaid
flowchart LR
    A([User registers]) --> B[Email sent for confirmation]
    B --> C{Email confirmed?}
    C -- No --> D[Resend email prompt]
    C -- Yes --> E[Account active\nrole = 'user']
    E --> F[User uploads Govt ID + Selfie\nvia Profile page]
    F --> G[Admin receives verification request]
    G --> H{Admin decision}
    H -- Approve --> I[role = 'verified'\nCan list and rent vehicles]
    H -- Reject --> J[Notification sent\nUser must re-upload]
    I --> K[Full platform access]
```

---

## 7. Security Architecture Diagram

```mermaid
graph TB
    subgraph Client["Client Browser"]
        FV["Input Validation\n(validation.js)"]
        SA["Sanitization\n(security.js)"]
        RL["Rate Limiting\nclientRateLimit()"]
        TD["Threat Detection\ndetectThreats()"]
    end

    subgraph SessionLayer["Session Layer"]
        UA["User Auth Storage\nsafedrive-auth\n(sessionStorage)"]
        AA["Admin Auth Storage\nsafedrive-admin-auth\n(sessionStorage)"]
        SL["Single Active Listener\n(no cross-bucket interference)"]
    end

    subgraph SupabaseLayer["Supabase Backend"]
        RLS["Row Level Security\n(per table policies)"]
        JWT["JWT Verification\n(RS256)"]
        SSL["TLS 1.2+ in transit"]
        FS["File Storage\n(MIME validation)"]
    end

    subgraph AppLayer["Application Layer"]
        PG["Route Guards\nProtectedRoute / AdminRoute"]
        AC["Auth Context\n(single source of truth)"]
        AL["Audit Logger\n(all admin actions)"]
    end

    Client --> SessionLayer
    SessionLayer --> AppLayer
    AppLayer --> SupabaseLayer
```

---

## 8. Data Model (Entity Relationship)

```mermaid
erDiagram
    PROFILES {
        uuid id PK
        text full_name
        text email
        text phone
        text role "user | verified | admin"
        text verification_status "pending | approved | rejected"
        text avatar_url
        timestamptz created_at
    }

    VEHICLES {
        uuid id PK
        uuid owner_id FK
        text make
        text model
        int year
        text color
        text plate_number
        text body_type
        text transmission
        text fuel_type
        int seating_capacity
        numeric daily_rate
        jsonb available_durations
        numeric security_deposit
        text pickup_location
        text pickup_city
        text pickup_province
        text description
        jsonb features
        jsonb images
        text agreement_url
        text status "pending | approved | rejected"
        boolean is_available
        timestamptz created_at
    }

    BOOKINGS {
        uuid id PK
        uuid vehicle_id FK
        uuid renter_id FK
        uuid owner_id FK
        date start_date
        date end_date
        int total_days
        numeric daily_rate
        numeric subtotal
        numeric service_fee
        numeric security_deposit
        numeric total_amount
        text status "pending | accepted | declined | completed | cancelled"
        timestamptz created_at
    }

    REVIEWS {
        uuid id PK
        uuid booking_id FK
        uuid reviewer_id FK
        uuid vehicle_id FK
        int rating "1-5"
        text comment
        timestamptz created_at
    }

    AUDIT_LOGS {
        uuid id PK
        uuid performed_by FK
        text performer_name
        text action
        text entity_type
        text entity_id
        text description
        jsonb old_value
        jsonb new_value
        text ip_address
        timestamptz created_at
    }

    CAR_BRANDS {
        uuid id PK
        text name
        text logo_emoji
        boolean is_active
    }

    CAR_MODELS {
        uuid id PK
        uuid brand_id FK
        text name
        text body_type
        boolean is_active
    }

    NOTIFICATIONS {
        uuid id PK
        uuid user_id FK
        text title
        text message
        text type
        boolean is_read
        timestamptz created_at
    }

    PROFILES ||--o{ VEHICLES : "owns"
    PROFILES ||--o{ BOOKINGS : "rents"
    VEHICLES ||--o{ BOOKINGS : "booked via"
    BOOKINGS ||--o| REVIEWS : "reviewed after"
    PROFILES ||--o{ AUDIT_LOGS : "performed by"
    CAR_BRANDS ||--o{ CAR_MODELS : "has"
    PROFILES ||--o{ NOTIFICATIONS : "receives"
```

---

## 9. Input Validation Decision Tree

```mermaid
flowchart TD
    A([User types into a form field]) --> B[Real-time:\ngetFieldError called]
    B --> C{Field type?}

    C -- Name --> D["validateFullName:\n• No digits allowed\n• Letters/spaces/hyphens/apostrophes only\n• 2–80 chars"]
    C -- Phone --> E["validatePhoneNumber:\n• PH format: 09XXXXXXXXX\n• or +639XXXXXXXXX\n• Exactly 11 or 13 digits"]
    C -- Email --> F["validateEmail:\n• Standard RFC format\n• Max 254 chars"]
    C -- Plate --> G["validatePlateNumber:\n• 1-3 letters + space + 3-4 digits\n• Max 7 alphanumeric chars\n• Uppercase only"]
    C -- Price --> H["validateDailyRate:\n• Min ₱100, Max ₱100,000\n• Up to 2 decimal places"]
    C -- Password --> I["validatePassword:\n• Min 8, max 128 chars\n• Upper + lower + number + special\n• Not in common password list"]
    C -- File --> J["validateImageFile /\nvalidateDocumentFile:\n• MIME type check\n• Size limit check"]

    D & E & F & G & H & I & J --> K{Passes all rules?}
    K -- Yes --> L[✅ Field accepted\nNo error shown]
    K -- No --> M[❌ Inline error shown\nSubmit button blocked]

    M --> N[User corrects input]
    N --> A
```

---

## 10. Deployment Architecture

```mermaid
graph LR
    Dev["Developer\n(Local dev server\nnpm run dev)"] -->|git push| GH["GitHub Repository\ngithub.com/AzuAizawa/safedrive"]
    GH -->|Auto-deploy webhook| Vercel["Vercel CDN\n(Production)"]
    Vercel -->|API calls via supabase-js| Supabase["Supabase Platform\n• PostgreSQL DB\n• Auth Service\n• File Storage\n• Row Level Security"]
    Supabase -->|JWT tokens| Vercel
    User["End User (Browser)"] -->|HTTPS TLS 1.3| Vercel
```
