# SafeDrive — Complete System Documentation

> **Project:** SafeDrive — Web-Based Car Rental Community Platform
> **Type:** Full-Stack Web Application
> **Target Users:** Filipino vehicle owners (listers) and renters
> **Currency:** Philippine Peso (₱)

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [System Architecture](#2-system-architecture)
3. [Frontend Technology](#3-frontend-technology)
4. [Backend & Database](#4-backend--database)
5. [Database Tables](#5-database-tables)
6. [Authentication & Security](#6-authentication--security)
7. [File Storage](#7-file-storage)
8. [APIs Used](#8-apis-used)
9. [Deployment & Hosting](#9-deployment--hosting)
10. [Libraries & Dependencies](#10-libraries--dependencies)
11. [Developer Tools](#11-developer-tools)
12. [User Roles & Access Control](#12-user-roles--access-control)
13. [Key Features by Module](#13-key-features-by-module)
14. [ACID Compliance](#14-acid-compliance)
15. [Audit Trail](#15-audit-trail)
16. [Security Measures](#16-security-measures)
17. [File & Folder Structure](#17-file--folder-structure)

---

## 1. System Overview

SafeDrive is a **peer-to-peer car rental platform** that connects verified vehicle owners with verified renters. Unlike traditional rental companies, SafeDrive operates as a **community marketplace** — car owners list their private vehicles and set their own pricing, while renters browse, book, and pay directly through the platform.

| Property | Value |
|---|---|
| Platform Type | Web Application (SPA) |
| Architecture | 3-Tier (Frontend → BaaS → Database) |
| Live URL | https://safedrive-umber.vercel.app |
| Admin Portal | https://safedrive-umber.vercel.app/admin-login |
| Version Control | GitHub |
| Deployment | Vercel (continuous deployment) |

---

## 2. System Architecture

```
┌────────────────────────────────────────────────────────┐
│                     USER'S BROWSER                      │
│            React SPA (Single Page Application)          │
│         (HTML + CSS + JavaScript — runs on client)      │
└──────────────────────┬─────────────────────────────────┘
                       │  HTTPS requests
                       ▼
┌────────────────────────────────────────────────────────┐
│                  SUPABASE (Backend-as-a-Service)         │
│                                                          │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────┐ │
│  │  Auth Module  │  │  REST API /    │  │   Storage   │ │
│  │  (JWT Tokens) │  │  Realtime API  │  │  (Files)    │ │
│  └──────────────┘  └────────────────┘  └─────────────┘ │
│                           │                              │
└───────────────────────────┼──────────────────────────────┘
                            │  SQL queries
                            ▼
┌────────────────────────────────────────────────────────┐
│               PostgreSQL DATABASE                        │
│   (Supabase-managed, hosted on AWS infrastructure)       │
│                                                          │
│   profiles │ vehicles │ bookings │ reviews │ audit_logs  │
│   car_brands │ car_models │ notifications │ ...          │
└────────────────────────────────────────────────────────┘
```

**Architecture Type:** 3-Tier Architecture
- **Tier 1 (Presentation):** React — what users see and interact with
- **Tier 2 (Business Logic / API):** Supabase — handles authentication, API, business rules via RLS
- **Tier 3 (Data):** PostgreSQL — relational database that stores all data

---

## 3. Frontend Technology

### Core Framework
| Technology | Version | Purpose |
|---|---|---|
| **React** | v19.2.0 | UI framework — component-based interface |
| **React DOM** | v19.2.0 | Renders React components into the browser |
| **Vite** | v7.3.1 | Build tool — fast development server and production bundler |

### Routing
| Library | Version | Purpose |
|---|---|---|
| **React Router DOM** | v7.13.0 | Client-side routing — `/dashboard`, `/vehicles`, `/admin`, etc. |

How it works: React Router creates a Single Page Application (SPA). When you go to `/dashboard`, the browser does NOT reload the page — React swaps out the visible components instead. This is called **client-side routing**.

### Styling
- **Vanilla CSS** — Custom design system in `src/index.css`
- **CSS Variables** — Design tokens (`--primary-500`, `--surface-primary`, `--radius-lg`)
- No CSS framework (no Bootstrap, no Tailwind) — everything custom-written
- Supports **dark mode** via CSS media queries
- **Google Fonts** — Custom typography (`Inter`, `Outfit`)

### State Management
- **React Context API** — Global auth state (`AuthContext.jsx`)
- **useState / useEffect** — Component-level state
- No Redux or Zustand — Context is sufficient for this scale

---

## 4. Backend & Database

### Backend: Supabase (Backend-as-a-Service)

**Supabase** is an open-source Firebase alternative built on top of PostgreSQL. It eliminates the need to write a custom backend server (like Node.js/Express). Instead, it provides:

| Supabase Module | What it provides |
|---|---|
| **Supabase Auth** | User registration, login, JWT tokens, session management |
| **Supabase Database** | PostgreSQL database with auto-generated REST API |
| **Supabase Storage** | File uploads (images, PDFs, documents) |
| **Supabase Realtime** | Live database subscriptions (WebSocket) |
| **Row Level Security (RLS)** | Database-level access rules |
| **SQL Functions (RPC)** | Server-side PostgreSQL functions |

### Database: PostgreSQL

**PostgreSQL** is the world's most advanced open-source relational database. It is the actual database engine that Supabase runs on top of.

| Property | Detail |
|---|---|
| Type | Relational Database (RDBMS) |
| Query Language | SQL (Structured Query Language) |
| Hosting | AWS (managed by Supabase) |
| Region | Southeast Asia (Singapore) |
| Extensions used | `uuid-ossp` (UUID generation) |
| ACID Compliant | ✅ Yes — by default (all transactions) |

---

## 5. Database Tables

All tables are in the `public` schema of PostgreSQL.

### `profiles`
Extends Supabase Auth users. Every registered user has a profile row.

| Column | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Links to `auth.users` — same ID as the logged-in user |
| `email` | TEXT | User's email address |
| `full_name` | TEXT | Full legal name |
| `phone` | TEXT | Contact number |
| `city`, `province` | TEXT | Location |
| `avatar_url` | TEXT | Profile picture URL |
| `role` | TEXT | `'user'`, `'verified'`, `'admin'` |
| `verification_status` | TEXT | `'pending'`, `'submitted'`, `'verified'`, `'rejected'` |
| `national_id_number` | TEXT | Gov ID number |
| `drivers_license_number` | TEXT | Driver's license number |
| `selfie_url` | TEXT | Selfie photo URL for identity check |
| `average_rating` | DECIMAL | Star rating (1–5) |
| `verified_by` | UUID | Admin who verified this user |
| `created_at` | TIMESTAMPTZ | When account was created |

### `vehicles`
Car listings posted by verified users.

| Column | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Unique vehicle ID |
| `owner_id` | UUID (FK) | References `profiles.id` |
| `make` | TEXT | Brand (Toyota, Honda, etc.) |
| `model` | TEXT | Model (Vios, Civic, etc.) |
| `year` | INTEGER | Manufacturing year |
| `plate_number` | TEXT (UNIQUE) | LTO plate number |
| `body_type` | TEXT | Sedan, SUV, MPV, Van, etc. |
| `transmission` | TEXT | Automatic or Manual |
| `fuel_type` | TEXT | Gasoline, Diesel, Hybrid, Electric |
| `daily_rate` | DECIMAL | Rental price per day (₱) |
| `images` | TEXT[] | Array of image URLs |
| `status` | TEXT | `'pending'`, `'approved'`, `'rejected'`, `'listed'`, etc. |
| `approved_by` | UUID | Admin who approved the listing |

### `bookings`
Rental transactions between renters and car owners.

| Column | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Unique booking ID |
| `vehicle_id` | UUID (FK) | Which car is being rented |
| `renter_id` | UUID (FK) | Who is renting |
| `owner_id` | UUID (FK) | Who owns the car |
| `start_date` / `end_date` | DATE | Rental period |
| `daily_rate` | DECIMAL | Rate at time of booking |
| `total_days` | INTEGER | Number of rental days |
| `total_amount` | DECIMAL | Final price (₱) |
| `status` | TEXT | `'pending'`, `'confirmed'`, `'active'`, `'completed'`, `'cancelled'` |

### `car_brands` and `car_models`
Dynamic vehicle catalog maintained by admin.

- **`car_brands`** — Toyota, Honda, Mitsubishi, etc.
- **`car_models`** — Vios, Civic, Xpander, etc. (linked to brand)
- Includes body type, active/inactive status

### `vehicle_availability`
Blocked dates per vehicle (prevents double-booking).

### `reviews`
Ratings and reviews after completed bookings. Linked to booking, vehicle, renter, and owner.

### `notifications`
In-app notifications (booking confirmations, verification updates).

### `verification_logs`
Log of each admin verification action (who verified whom, when).

### `audit_logs`
Complete audit trail of all admin actions (role changes, approvals, deletions).

| Column | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Log entry ID |
| `performed_by` | UUID | Admin who did the action |
| `performer_name` | TEXT | Admin's full name |
| `performer_email` | TEXT | Admin's email |
| `action` | TEXT | `'VERIFY_USER'`, `'APPROVE_VEHICLE'`, etc. |
| `entity_type` | TEXT | `'user'`, `'vehicle'`, `'brand'`, `'model'` |
| `old_value` | JSONB | State before the change |
| `new_value` | JSONB | State after the change |
| `created_at` | TIMESTAMPTZ | Exact timestamp |

---

## 6. Authentication & Security

### Authentication Flow

```
User enters email + password
        ↓
Supabase Auth validates credentials
        ↓
Returns JWT (JSON Web Token) + Refresh Token
        ↓
Tokens stored in localStorage (safedrive-auth key)
        ↓
Every API request automatically includes JWT in header
        ↓
Supabase verifies JWT on every request (auth.uid())
```

### Session Management
- **JWT Token** — 1 hour expiry (auto-refreshed in background)
- **Refresh Token** — Long-lived, used to get new JWT without re-login
- **`persistSession: true`** — Session survives page refreshes
- **`autoRefreshToken: true`** — Token refreshed before expiry automatically

### Row Level Security (RLS)
Every table has RLS enabled. Policies define who can read/write each row:

```sql
-- Example: Users can only see their own bookings
CREATE POLICY "Users see own bookings"
ON public.bookings FOR SELECT
USING (renter_id = auth.uid() OR owner_id = auth.uid());
```

This means even if someone tries to hack the API, they can only see their own data at the database level — not other users' data.

### Application-Level Security
Implemented in `src/lib/security.js`:
- **Rate limiting** — Max 5 login attempts per 5 minutes
- **Input sanitization** — Strips HTML tags and dangerous characters
- **Threat detection** — Detects SQL injection and XSS attempts
- **Session timeout** — Auto-logout after 30 minutes of inactivity
- **Security event logging** — All security events logged

### HTTP Security Headers (via vercel.json)
| Header | Value | Purpose |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Prevents MIME type sniffing |
| `X-Frame-Options` | `DENY` | Prevents clickjacking |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Controls referrer info |
| `Permissions-Policy` | Restricts camera, mic, geolocation | Limits browser permissions |

---

## 7. File Storage

**Supabase Storage** is used for all file uploads. It uses **Amazon S3** under the hood.

### Storage Buckets
| Bucket | Contents | Access |
|---|---|---|
| `documents` | Government IDs, driver's licenses | Private — owner + admin only |
| `selfies` | User selfie photos for verification | Private — owner + admin only |
| `vehicles` | Car photos uploaded during listing | Public — anyone can view |
| `avatars` | Profile pictures | Public |

Files are referenced by their public URL stored in the database (e.g., `images[]` array in the vehicles table).

---

## 8. APIs Used

### Supabase Client SDK (`@supabase/supabase-js`)
The main API used in SafeDrive. It is a JavaScript SDK that wraps Supabase's REST and Realtime APIs.

```javascript
// Example: Fetch all approved vehicles
const { data } = await supabase
  .from('vehicles')
  .select('*, profiles!vehicles_owner_id_fkey(full_name)')
  .eq('status', 'approved')
  .order('created_at', { ascending: false });
```

**Supabase API Methods Used:**
| Method | Purpose |
|---|---|
| `supabase.auth.signUp()` | Register new user |
| `supabase.auth.signInWithPassword()` | Login |
| `supabase.auth.signOut()` | Logout |
| `supabase.auth.getSession()` | Get current session on page load |
| `supabase.from('table').select()` | Read data from a table |
| `supabase.from('table').insert()` | Create new record |
| `supabase.from('table').update()` | Update existing record |
| `supabase.from('table').delete()` | Delete record |
| `supabase.rpc('function_name')` | Call a PostgreSQL function |
| `supabase.storage.from('bucket').upload()` | Upload file |
| `supabase.storage.from('bucket').getPublicUrl()` | Get file URL |

### Supabase Auth API
Used for:
- Email/password registration and login
- Password reset via email (forgot password)
- JWT token management and refresh
- Email verification

### No External Third-Party APIs
SafeDrive does **not** use Google Maps, Stripe, Twilio, or other external APIs. Everything is handled within Supabase and the frontend React code.

---

## 9. Deployment & Hosting

### Frontend Hosting: Vercel
| Property | Detail |
|---|---|
| Platform | Vercel (vercel.com) |
| Plan | Free Hobby plan |
| Deployment | Automatic — every `git push` to `main` triggers a new deploy |
| CDN | Vercel Edge Network (global CDN) |
| Build Command | `npx vite build` |
| Output Directory | `dist/` |
| Rewrites | All routes → `index.html` (SPA support) |

### Backend/Database Hosting: Supabase
| Property | Detail |
|---|---|
| Platform | Supabase cloud (supabase.com) |
| Plan | Free tier |
| Database Host | AWS (Amazon Web Services) |
| Region | Singapore (ap-southeast-1) |
| Database Size | Up to 500 MB (free tier) |
| Auth Users | Up to 50,000 MAU (free tier) |
| Storage | Up to 1 GB (free tier) |

### Version Control: GitHub
| Property | Detail |
|---|---|
| Repository | github.com/AzuAizawa/safedrive |
| Branch | `main` (production) |
| CI/CD | GitHub → Vercel auto-deploy on push |

### Deployment Flow
```
Developer edits code locally
        ↓
git add + git commit + git push
        ↓
GitHub receives new code
        ↓
Vercel detects push → runs vite build
        ↓
New build deployed to CDN globally
        ↓
Users see updated site within ~1 minute
```

---

## 10. Libraries & Dependencies

### Production Dependencies

| Package | Version | Purpose |
|---|---|---|
| `react` | 19.2.0 | Core UI framework |
| `react-dom` | 19.2.0 | Renders React to browser DOM |
| `react-router-dom` | 7.13.0 | Client-side page routing |
| `@supabase/supabase-js` | 2.95.3 | Supabase API client (auth + database + storage) |
| `react-hot-toast` | 2.6.0 | Beautiful toast notifications (success/error popups) |
| `react-icons` | 5.5.0 | Icon library (Feather Icons, Font Awesome, etc.) |
| `date-fns` | 4.1.0 | Date formatting and manipulation utilities |

### Development Dependencies

| Package | Version | Purpose |
|---|---|---|
| `vite` | 7.3.1 | Build tool and local development server |
| `@vitejs/plugin-react` | 5.1.1 | React support for Vite (JSX transform, HMR) |
| `eslint` | 9.39.1 | JavaScript code quality checker |
| `eslint-plugin-react-hooks` | 7.0.1 | Enforces React Hooks rules |
| `@types/react` | 19.2.7 | TypeScript type definitions for React |
| `globals` | 16.5.0 | Global variable definitions for ESLint |

---

## 11. Developer Tools

| Tool | Purpose |
|---|---|
| **Visual Studio Code** | Code editor |
| **Git** | Version control |
| **GitHub** | Remote code repository |
| **Node.js** | JavaScript runtime to run npm/vite locally |
| **npm** | Package manager (installs libraries) |
| **Vite Dev Server** | Local preview (`npm run dev` → `localhost:5173`) |
| **Supabase Dashboard** | Visual database management (supabase.com/dashboard) |
| **Supabase SQL Editor** | Run raw SQL queries on the database |
| **Chrome DevTools** | Browser debugging |
| **Vercel Dashboard** | Deployment monitoring and logs |

---

## 12. User Roles & Access Control

SafeDrive has **3 user roles**, each with strict boundaries enforced at both the frontend and database (RLS) level:

| Feature | Not Verified (`user`) | Verified (`verified`) | Admin (`admin`) |
|---|---|---|---|
| Browse vehicles | ✅ | ✅ | ✅ (view-only) |
| Book a vehicle | ❌ | ✅ | ❌ |
| List a vehicle | ❌ | ✅ | ❌ |
| Upload ID documents | ✅ | ✅ | ❌ |
| Access Admin Panel | ❌ | ❌ | ✅ |
| Approve/Reject users | ❌ | ❌ | ✅ |
| Manage car catalog | ❌ | ❌ | ✅ |
| View audit trail | ❌ | ❌ | ✅ |
| Login portal | `/login` | `/login` | `/admin-login` only |

### How Role Protection Works

**Frontend Level:**
```jsx
// Route guard — only admin can access /admin
function AdminRoute() {
  const { user, isAdmin } = useAuth();
  if (!user) return <Navigate to="/admin-login" />;
  if (!isAdmin) return <Navigate to="/dashboard" />;
  return <Outlet />;
}
```

**Database Level (RLS):**
```sql
-- Only the owner can see their own vehicles
CREATE POLICY "Owners can manage vehicles"
ON public.vehicles
FOR ALL USING (owner_id = auth.uid());
```

Both layers work together — even if someone bypasses the UI, the database will block unauthorized access.

---

## 13. Key Features by Module

### User Authentication (`/login`, `/register`, `/admin-login`)
- Email + password registration
- Email verification (Supabase sends confirmation email)
- Forgot password via email reset link
- Separate admin portal (`/admin-login`) isolated from user login
- Password strength indicator
- Rate limiting (5 attempts max per 5 minutes)

### Dashboard (`/dashboard`)
- Personalized welcome based on role
- Stats: total vehicles, bookings, pending reviews
- Quick action shortcuts
- Admin dashboard vs. user dashboard are completely different views

### Browse Vehicles (`/vehicles`)
- Search by make, model, city, body type
- Filter by price range, transmission, fuel type
- Vehicle cards with thumbnail, price, location
- Responsive grid layout

### Vehicle Detail (`/vehicles/:id`)
- Full vehicle info (photos, specs, features)
- Availability calendar
- Booking form with date picker
- Owner info and rating

### My Vehicles (`/my-vehicles`) — Verified Users Only
- View all listed vehicles
- Edit vehicle details
- Manage availability (block dates)
- See booking requests per vehicle

### Bookings (`/bookings`) — Verified Users Only
- View bookings as renter (cars you booked)
- View bookings as owner (cars booked from you)
- Accept / reject booking requests
- Rental agreement access

### Profile (`/profile`)
- Edit personal info
- Upload verification documents (National ID, Driver's License, Selfie)
- Submit for verification

### Admin Panel (`/admin`) — Admin Only
| Tab | What it does |
|---|---|
| **Users** | View all users, approve/reject identity verification |
| **Vehicles** | Approve or reject vehicle listings |
| **Bookings** | View all platform bookings |
| **Car Catalog** | Add/edit/delete vehicle brands and models |
| **Audit Trail** | View all admin actions with timestamps |

---

## 14. ACID Compliance

**ACID** stands for **Atomicity, Consistency, Isolation, Durability** — the four properties that guarantee reliable database transactions.

SafeDrive inherits ACID compliance from PostgreSQL:

| Property | How SafeDrive achieves it |
|---|---|
| **Atomicity** | PostgreSQL `BEGIN...COMMIT` transactions — if any step fails, everything rolls back. The `create_booking_atomic()` SQL function handles booking creation atomically. |
| **Consistency** | Database CHECK constraints (e.g., `status IN ('pending', 'approved', ...)`) ensure only valid data is stored. |
| **Isolation** | Each database transaction runs independently. Concurrent bookings for the same dates are prevented by the atomic booking function. |
| **Durability** | PostgreSQL uses Write-Ahead Logging (WAL) — committed data survives crashes. Supabase runs on AWS with automatic backups. |

### Atomic Booking Function
```sql
CREATE FUNCTION create_booking_atomic(...)
BEGIN
  -- Check no conflicting bookings exist
  -- Insert booking record
  -- All steps in ONE transaction
  -- If anything fails → automatic full rollback
COMMIT;
$$;
```

---

## 15. Audit Trail

Every admin action is recorded in the `audit_logs` table:

| Admin Action | Logged as |
|---|---|
| Verify user identity | `VERIFY_USER` |
| Reject user identity | `REJECT_USER` |
| Change user role | `CHANGE_USER_ROLE` |
| Approve vehicle | `APPROVE_VEHICLE` |
| Reject vehicle | `REJECT_VEHICLE` |
| Add brand | `ADD_BRAND` |
| Delete brand | `DELETE_BRAND` |
| Add model | `ADD_MODEL` |
| Delete model | `DELETE_MODEL` |

Each log records: **who did it** (name + email), **what they did**, **what changed** (old vs. new value), and the **exact timestamp**.

---

## 16. Security Measures

| Measure | Implementation |
|---|---|
| **JWT Authentication** | Supabase Auth — all API calls require valid token |
| **Row Level Security** | Database-level — users only see their own data |
| **Rate Limiting** | 5 login attempts per 5 minutes (client-side) |
| **Input Sanitization** | All user inputs stripped of HTML/scripts before saving |
| **SQL Injection Prevention** | Supabase uses parameterized queries — no raw SQL from user input |
| **XSS Prevention** | React escapes all rendered values by default |
| **CSRF Protection** | SPA + JWT (not cookie-based) is immune to CSRF |
| **Secure HTTP Headers** | X-Frame-Options, X-Content-Type-Options, Permissions-Policy |
| **Admin Portal Isolation** | `/admin-login` is a completely separate URL — admin blocked from user login |
| **Role-Based Access Control** | Every route has a guard; RLS enforces at database level |
| **Audit Trail** | Every admin action logged with actor, timestamp, and change |
| **Session Timeout** | Auto-sign-out after 30 minutes of inactivity |

---

## 17. File & Folder Structure

```
SafeDrive/app/
├── public/                     # Static files served as-is
├── src/
│   ├── assets/                 # Images, icons
│   ├── components/             # Reusable UI components
│   │   ├── Navbar.jsx          # Navigation bar
│   │   ├── BackButton.jsx      # Back navigation button
│   │   └── AvailabilityCalendar.jsx  # Vehicle availability calendar
│   ├── context/
│   │   └── AuthContext.jsx     # Global auth state (user, profile, login/logout)
│   ├── lib/
│   │   ├── supabase.js         # Supabase client configuration
│   │   ├── security.js         # Rate limiting, sanitization, threat detection
│   │   └── auditLogger.js      # Audit trail logging utility
│   ├── pages/
│   │   ├── Landing.jsx         # Homepage
│   │   ├── Dashboard.jsx       # User/admin dashboard
│   │   ├── Vehicles.jsx        # Browse all vehicles
│   │   ├── VehicleDetail.jsx   # Single vehicle page + booking
│   │   ├── Bookings.jsx        # User's bookings
│   │   ├── Profile.jsx         # User profile + verification
│   │   ├── RentalAgreement.jsx # Rental agreement viewer
│   │   ├── auth/
│   │   │   ├── Login.jsx       # User login page
│   │   │   ├── AdminLogin.jsx  # Admin-only login portal
│   │   │   ├── Register.jsx    # Registration page
│   │   │   └── AuthCallback.jsx # Email verification redirect handler
│   │   ├── owner/
│   │   │   ├── CreateVehicle.jsx     # List a new vehicle
│   │   │   ├── MyVehicles.jsx        # Manage owned vehicles
│   │   │   └── ManageAvailability.jsx # Block/unblock dates
│   │   └── admin/
│   │       └── AdminPanel.jsx  # Full admin panel (users, vehicles, audit)
│   ├── App.jsx                 # Root component — routes and layout
│   ├── main.jsx                # Entry point
│   ├── index.css               # Global design system (CSS variables + styles)
│   └── App.css                 # App-level styles
├── SUPABASE_SETUP.sql          # Run in Supabase to create audit_logs table
├── supabase-schema.sql         # Full database schema
├── supabase-security-schema.sql # RLS policies and security functions
├── vercel.json                 # Vercel deployment config + security headers
├── vite.config.js              # Vite build configuration
├── package.json                # Dependencies list
├── DEFENSE_JUSTIFICATIONS.md   # Answers for thesis/capstone defense
└── SYSTEM_DOCUMENTATION.md     # ← THIS FILE
```

---

## Summary Table — Technologies Used

| Category | Technology | Purpose |
|---|---|---|
| **Frontend Framework** | React 19 | UI components |
| **Build Tool** | Vite 7 | Bundling and local dev server |
| **Routing** | React Router DOM 7 | Page navigation (SPA) |
| **Backend** | Supabase (BaaS) | API, auth, database access |
| **Database** | PostgreSQL | Relational data storage |
| **Database Hosting** | AWS (via Supabase) | Cloud database server |
| **Authentication** | Supabase Auth (JWT) | Login, sessions, tokens |
| **File Storage** | Supabase Storage (S3) | Images, documents |
| **CSS** | Vanilla CSS + CSS Variables | Styling and design system |
| **Icons** | React Icons (Feather) | UI icons |
| **Notifications** | React Hot Toast | User feedback toasts |
| **Date Utilities** | date-fns | Date formatting |
| **Frontend Hosting** | Vercel | Web hosting + CDN |
| **Version Control** | Git + GitHub | Code versioning |
| **API Protocol** | REST (via Supabase SDK) | Data requests |
| **Security** | RLS + JWT + rate limiting | Access control |
| **Compliance** | ACID (PostgreSQL native) | Data integrity |
| **Audit Trail** | Custom `audit_logs` table | Admin action tracking |
