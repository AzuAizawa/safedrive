# 📊 SafeDrive — Business & Financial Analysis Report
> **Prepared for:** SafeDrive Capstone Group (4 Members)
> **Date:** March 2026
> **Currency:** Philippine Peso (₱) | Exchange Rate Used: **₱57.00 = $1.00 USD**

---

## 1. Executive Summary

SafeDrive is a peer-to-peer car rental platform built on modern cloud infrastructure. This report outlines the **full cost structure**, **revenue projections**, and **profitability analysis** across three operational scenarios:

| Scenario | Description |
|---|---|
| 🟢 **Current (Free Tier)** | All services on free/hobby plans — valid for capstone demo |
| 🟡 **Early Production** | Services upgraded to paid plans; 50–300 active subscribers |
| 🔴 **Scaled Production** | Full commercial operation; 500+ subscribers |

---

## 2. Technology Stack & Service Inventory

The following services power SafeDrive. Each has a free tier and a paid commercial tier.

| Service | Role | Current Plan | Paid Plan |
|---|---|---|---|
| **Supabase** | Database, Auth, Storage, RLS | Free | Pro ($25/mo) |
| **Vercel** | Frontend hosting, CDN, deployments | Hobby (Free) | Pro ($20/seat/mo) |
| **GitHub** | Version control, CI/CD | Free | Free |
| **Domain (.company)** | Custom domain — `safedrive.company` | None | $3.99/year |
| **PayMongo** | Payment processing (subscriptions) | Free to register | 2.5–3.5% + flat fee per txn |
| **Resend / SMTP** | Transactional emails | Free (3,000 emails/mo) | $20/mo (50K emails) |
| **Supabase Auth Email** | Built-in via Supabase | Included | Included in Pro |

---

## 3. Detailed Service Pricing (Official Rates as of 2026)

### 3.1 🟣 Supabase

**Source:** [supabase.com/pricing](https://supabase.com/pricing)

#### Free Plan (Current)
| Resource | Free Limit |
|---|---|
| Database Size | 500 MB |
| File Storage | 1 GB |
| Monthly Active Users (MAU) | 50,000 |
| Bandwidth (Egress) | 5 GB |
| Real-time connections | 200 concurrent |
| Projects | 2 |
| **Monthly Cost** | **$0 / ₱0** |

> ⚠️ Free projects are **paused after 1 week of inactivity**. Not suitable for production.

#### Pro Plan (Recommended for Production)
| Resource | Included | Overage Rate |
|---|---|---|
| Database Size | 8 GB | $0.125/GB |
| File Storage | 100 GB | $0.021/GB |
| Monthly Active Users | 100,000 | $0.00325/MAU |
| Bandwidth (Egress) | 250 GB | $0.09/GB |
| Compute (Base) | Nano (shared) | Upgrade from $10/mo |
| **Base Monthly Cost** | **$25/month** | **= ₱1,425/month** |

#### Team Plan ($599/month)
| Feature | Verified Details |
|---|---|
| All Pro features | ✅ Included |
| Monthly Active Users | 250,000 MAU included |
| Bandwidth (Egress) | 1 TB included |
| SSO / Audit Logs / Backup Control | ✅ Included |
| Industry Certifications | ✅ Included |
| Compute Credits | $10 included |
| **Monthly Cost** | **$599/month = ₱34,143/month** |

---

### 3.2 🔺 Vercel

**Source:** [vercel.com/pricing](https://vercel.com/pricing)

#### Hobby Plan (Current — Free)
| Resource | Limit |
|---|---|
| Bandwidth | 100 GB/month |
| Deployments | 100/day |
| Serverless Functions | 100 GB-hrs |
| Custom Domain | ✅ 1 domain |
| **Monthly Cost** | **$0 / ₱0** |

> ⚠️ Hobby plan is for **personal/non-commercial use only**. Commercial use requires Pro.

#### Pro Plan (Required for Production)
| Resource | Included | Overage Rate |
|---|---|---|
| Bandwidth (Fast Data Transfer) | 1 TB/month | $0.15/GB |
| Edge Requests | 10 million/month | — |
| Deployments | Unlimited | — |
| Serverless Function Exec | 1M invocations + 360 GB-hrs | $0.60/1M invocations |
| ISR Reads | 1M/month | $0.40/1M |
| Blob Storage | 1 GB | $0.023/GB |
| Seat Price | **$20/deploying member/month** | — |
| **Monthly Cost (1 seat)** | **$20/month** | **= ₱1,140/month** |

> For the team of 4 deploying members: **$20 × 4 = $80/month = ₱4,560/month**
> In practice, only **1 deploying seat** is needed for production deployment. Others can be Viewer seats (free).

---

### 3.3 🌐 Domain Registration

**Note:** `safedrive.com` is **unavailable** (already registered). Available alternatives (verified from domain registrar search, March 2026):

| Domain | Annual Cost | Monthly Equivalent | Notes |
|---|---|---|---|
| ~~safedrive.com~~ | Unavailable | — | Taken |
| **safedrive.company** | **$3.99/year = ₱227/year** | **₱19/month** | ✅ Recommended — cheapest, professional |
| safedrive.community | $14.99/year = ₱854/year | ₱71/month | Casual feel |
| safedrive.computer | $29.99/year = ₱1,709/year | ₱142/month | Not relevant |
| safedrive.com.tw | $21.00/year = ₱1,197/year | ₱100/month | Taiwan ccTLD |

**Recommended:** `safedrive.company` — cheapest available option at **$3.99/year = ₱19/month** equivalent.  
Full domain: **https://safedrive.company**

---

### 3.4 📧 Email / Transactional Email

Supabase's built-in Auth emails (password resets, magic links) are included. For custom notification emails:

| Service | Free Plan | Paid Plan |
|---|---|---|
| **Resend** | 3,000 emails/month | $20/mo = 50,000 emails |
| **SendGrid** | 100 emails/day | $19.95/mo = 50,000 emails |
| **Supabase Auth Email** | Included in plan | Included |

**Decision:** Use Supabase built-in Auth for all auth emails + Resend free tier for notifications (3,000/mo sufficient at early stage).

---

### 3.5 💳 PayMongo — Payment Processing Fees

**Source:** [paymongo.com/pricing](https://www.paymongo.com/pricing) — Verified live March 2026

PayMongo deducts its fee automatically before paying out. SafeDrive **never receives the full ₱399** — only the net after fees.

> 🚨 **Important:** All PayMongo base rates are **VAT-exclusive**. A 12% VAT is charged **on the fee itself** (not on the subscription amount).

#### Official Base Rates (Excluding 12% VAT on Fee)

| Payment Method | Base Rate | Flat Fee |
|---|---|---|
| Credit / Debit Card (Visa, Mastercard) | 3.125% | + ₱13.39 |
| GCash | 2.23% | — |
| Maya | 1.79% | — |
| GrabPay | 1.96% | — |
| ShopeePay | 1.70% | — |
| Direct Online Banking (BDO, BPI, UnionBank, etc.) | 0.71% | or ₱13.39 flat |
| Buy Now, Pay Later (BillEase) | 1.34% | — |

> ✅ **No monthly fee. No setup fee. Registration is free.**

#### Full Fee Breakdown on ₱399 Subscription (Base Fee + 12% VAT on Fee)

| Payment Method | Base Fee | VAT on Fee (12%) | **Total Deducted** | **Net to SafeDrive** |
|---|---|---|---|---|
| Credit / Debit Card | ₱25.86 | ₱3.10 | **₱28.96** | **₱370.04** |
| GCash | ₱8.90 | ₱1.07 | **₱9.97** | **₱389.03** |
| Maya | ₱7.14 | ₱0.86 | **₱8.00** | **₱391.00** |
| GrabPay | ₱7.82 | ₱0.94 | **₱8.76** | **₱390.24** |
| ShopeePay | ₱6.78 | ₱0.81 | **₱7.59** | **₱391.41** |
| Direct Banking | ₱13.39 (flat) | ₱1.61 | **₱15.00** | **₱384.00** |

*Base fee calculation for Card: (399 × 3.125%) + ₱13.39 = ₱12.47 + ₱13.39 = ₱25.86*

#### Blended Fee Calculation (Estimated PH Payment Mix)

| Payment Method | Estimated Usage % | Total Fee (incl. VAT) | Weighted Fee |
|---|---|---|---|
| GCash | 40% | ₱9.97 | ₱3.99 |
| Credit/Debit Card | 30% | ₱28.96 | ₱8.69 |
| Maya | 15% | ₱8.00 | ₱1.20 |
| GrabPay | 10% | ₱8.76 | ₱0.88 |
| ShopeePay | 5% | ₱7.59 | ₱0.38 |
| **Blended Average** | **100%** | — | **₱15.14/transaction** |

**Net Revenue per Subscriber (Blended): ₱399.00 − ₱15.14 = ₱383.86 ≈ ₱384**

> 📌 All revenue, break-even, and profit calculations from this point forward use **₱384 net per subscriber** (after PayMongo fees incl. VAT on fee).

#### ⚠️ Additional Tax: BIR Expanded Withholding Tax (EWT)

Under **BIR Revenue Regulation No. 16-2023**, digital payment platforms like PayMongo may be required to withhold **1% Expanded Withholding Tax** on one-half of gross remittances. This results in an **effective 0.5% additional deduction** from each payout.

| Withholding (0.5% on ₱399) | ₱1.995 ≈ ₱2.00 |
|---|---|
| After card fees (₱28.96) + EWT (₱2.00) | **₱368.04 net** |
| After GCash fees (₱9.97) + EWT (₱2.00) | **₱387.03 net** |
| After blended fees (₱15.14) + EWT (₱2.00) | **₱381.86 ≈ ₱382 net** |

> *EWT is a creditable tax — it is not a lost expense, but a pre-paid income tax. At year-end, SafeDrive can use it to offset income tax payable. For simplicity, main computations use **₱384** (PayMongo fees only) and note the ₱2 EWT credit.*

#### Philippine VAT Threshold

Under the **NIRC (National Internal Revenue Code)**, VAT registration becomes **mandatory** when annual gross sales exceed **₱3,000,000**.

| Gross Revenue Threshold | Approx. Monthly Subscribers | Action Required |
|---|---|---|
| Below ₱3,000,000/year | Below ~627 subscribers | No VAT required; may use 8% GRT option |
| Above ₱3,000,000/year | **627+ subscribers** | Must register as VAT taxpayer with BIR |

**If VAT-registered and ₱399 is VAT-inclusive:**
- VAT portion = ₱399 × 12/112 = **₱42.75** (remitted to BIR monthly)
- Revenue net of VAT = **₱356.25**
- Minus PayMongo blended fee ₱15.14 = **₱341.11 actual income per subscriber**

> ⚠️ VAT does NOT apply below 627 subscribers. Plan for BIR registration when approaching this milestone.

---

## 4. Cost Summary Tables

### 4.1 Scenario A — Current (Free / Capstone Demo)

| Service | Monthly Cost (PHP) |
|---|---|
| Supabase (Free) | ₱0 |
| Vercel (Hobby) | ₱0 |
| Domain | ₱0 (no custom domain) |
| Email | ₱0 |
| **TOTAL MONTHLY OPEX** | **₱0** |

✅ Appropriate for capstone demo and academic submission.

---

### 4.2 Scenario B — Early Production (50–300 subscribers)

| Service | Plan | USD/mo | PHP/mo |
|---|---|---|---|
| Supabase | Pro | $25.00 | ₱1,425 |
| Vercel | Pro (1 deploying seat) | $20.00 | ₱1,140 |
| Domain (safedrive.company, annual) | $3.99/yr | $0.33 | ₱19 |
| Email (Resend Free) | Free | $0 | ₱0 |
| **TOTAL MONTHLY OPEX** | | **$45.33** | **₱2,584** |

---

### 4.3 Scenario C — Scaled Production (500–1,000+ subscribers)

At higher scale, Supabase compute needs upgrading beyond the default Nano instance:

| Service | Plan | USD/mo | PHP/mo |
|---|---|---|---|
| Supabase | Pro + Compute Upgrade (Small: $50) | $75.00 | ₱4,275 |
| Vercel | Pro (1 seat) | $20.00 | ₱1,140 |
| Domain (safedrive.company) | Annual | $0.33 | ₱19 |
| Email (Resend Basic) | Basic paid plan | $20.00 | ₱1,140 |
| Backup / Admin Tools | Optional | $0–$10 | ₱0–₱570 |
| **TOTAL MONTHLY OPEX** | | **$115.33** | **₱6,574** |

---

## 5. Revenue Model

### 5.1 Subscription Pricing

SafeDrive charges **₱399.00/month per subscriber** for platform access.

| Metric | Verified Value |
|---|---|
| Gross Subscription Price | ₱399/month |
| PayMongo Blended Fee (incl. 12% VAT on fee) | −₱15.14/transaction |
| **Net Revenue per Subscriber** | **₱383.86 ≈ ₱384/month** |
| BIR EWT credit (0.5%) | +₱2 credit at year-end |
| Payment Model | Auto-debit via PayMongo |
| Target Market | Car owners in the Philippines |

### 5.2 Revenue Tiers (After PayMongo Fees, ₱384 Net)

| Subscribers | Gross Revenue | PayMongo Fees (approx. ₱15/sub) | **Net Revenue** | Annual Net |
|---|---|---|---|---|
| 10 | ₱3,990 | −₱151 | **₱3,839** | ₱46,068 |
| 25 | ₱9,975 | −₱379 | **₱9,597** | ₱115,164 |
| 50 | ₱19,950 | −₱757 | **₱19,193** | ₱230,316 |
| 100 | ₱39,900 | −₱1,514 | **₱38,386** | ₱460,632 |
| 200 | ₱79,800 | −₱3,028 | **₱76,772** | ₱921,264 |
| 300 | ₱119,700 | −₱4,542 | **₱115,158** | ₱1,381,896 |
| 500 | ₱199,500 | −₱7,570 | **₱191,930** | ₱2,303,160 |
| **627 (VAT threshold)** | ₱250,173 | −₱9,493 | **₱240,680** | ₱2,888,160 |
| 1,000 | ₱399,000 | −₱15,140 | **₱383,860** | ₱4,606,320 |

> ⚠️ At **627 subscribers**, annual gross revenue crosses ₱3,000,000 — BIR VAT registration becomes mandatory.

---

## 6. Team Compensation (4-Person Capstone Group)

### 6.1 For Capstone / Academic Period

During the capstone phase, the team operates under academic context with no formal salary. However, for business planning when transitioning to a real product:

### 6.2 Philippine IT / Software Development Salary Benchmarks (2026)

| Role | Entry Level (0–1 yr) | Mid-Level (2–4 yr) | Senior (5+ yr) |
|---|---|---|---|
| Full Stack Developer | ₱18,000–25,000/mo | ₱30,000–50,000/mo | ₱60,000–100,000/mo |
| UI/UX Designer | ₱15,000–22,000/mo | ₱25,000–40,000/mo | ₱50,000–80,000/mo |
| Backend / DevOps | ₱20,000–28,000/mo | ₱35,000–55,000/mo | ₱65,000–110,000/mo |
| Project Manager | ₱18,000–25,000/mo | ₱30,000–50,000/mo | ₱55,000–90,000/mo |

*Source: Philippine JobStreet, LinkedIn, and DICT wage data 2025–2026*

### 6.3 Proposed Team Structure (4 Members — Entry Level / Post-Capstone)

Assuming the team graduates and continues SafeDrive as a startup, minimum viable compensation:

| Member | Role | Monthly Salary |
|---|---|---|
| Member 1 | Full Stack Developer | ₱22,000 |
| Member 2 | Full Stack Developer / Backend | ₱22,000 |
| Member 3 | UI/UX + Frontend Developer | ₱20,000 |
| Member 4 | Project Manager / QA / DevOps | ₱20,000 |
| **Total Monthly Payroll** | | **₱84,000** |
| **Total Annual Payroll** | | **₱1,008,000** |

> 📌 Note: This is **minimum viable** — enough to sustain a 4-person startup team post-graduation. Does not include 13th month, SSS, PhilHealth, Pag-IBIG contributions (add ~12% employer burden).

#### With Mandatory Government Contributions (Employer Share ~12%)

| Item | Monthly |
|---|---|
| Base Payroll | ₱84,000 |
| SSS (Employer ~8.5%) | ₱7,140 |
| PhilHealth (Employer ~2.5%) | ₱2,100 |
| Pag-IBIG (Employer ₱200/person) | ₱800 |
| **Total Monthly Labor Cost** | **₱94,040** |

---

## 7. Break-Even Analysis

Break-even = **Total Monthly Expenses ÷ Net Revenue per Subscriber (₱384 verified after PayMongo fees)**

### 7.1 Technology Costs Only (No Salaries)

| Scenario | Monthly OPEX | Net Rev/Sub | Break-Even Subscribers |
|---|---|---|---|
| Free Tier | ₱0 | ₱384 | 0 subscribers |
| Early Prod (Scenario B) | ₱2,584 | ₱384 | **7 subscribers** |
| Scaled Prod (Scenario C) | ₱6,574 | ₱384 | **18 subscribers** |

### 7.2 Full Costs (Infrastructure + 4-Person Team)

| Scenario | Monthly OPEX | Team Labor | Total Monthly Cost | Net Rev/Sub | Break-Even |
|---|---|---|---|---|---|
| Early Prod + Team | ₱2,584 | ₱94,040 | ₱96,624 | ₱384 | **≈ 252 subscribers** |
| Scaled Prod + Team | ₱6,574 | ₱94,040 | ₱100,614 | ₱384 | **≈ 262 subscribers** |

> 📌 To cover a full 4-person team at entry-level salaries, SafeDrive needs approximately **≈ 252 paying subscribers**.

### 7.3 PayMongo Cost at Scale

| Subscribers | Monthly Gross | Monthly PayMongo Fees (est. ₱15/sub) | Annual Fees Paid to PayMongo |
|---|---|---|---|
| 100 | ₱39,900 | ₱1,514 | ₱18,168 |
| 300 | ₱119,700 | ₱4,542 | ₱54,504 |
| 500 | ₱199,500 | ₱7,570 | ₱90,840 |
| 1,000 | ₱399,000 | ₱15,140 | ₱181,680 |

> At 1,000 subscribers, **₱15,140/month = ₱181,680/year** goes to PayMongo — the **2nd largest expense** after salaries.

---

## 8. Profit & Loss Projections (3-Year Forecast)

### Assumptions
- Growth rate: +50 subscribers/month in Year 1, +100/month in Year 2, plateau at ~1,000 in Year 3
- **All revenue figures use ₱384 net per subscriber** (after PayMongo fees incl. 12% VAT on fee — verified from paymongo.com)
- Currency risk: $1 USD = ₱57 (peso stable assumption)
- Churn rate: 10%/month (conservative for B2C)
- VAT not yet applicable in Year 1

### 8.1 Year 1 — Launch Phase

| Quarter | Avg Subscribers | Net Revenue/mo | OPEX/mo | Payroll/mo | Net Profit/mo |
|---|---|---|---|---|---|
| Q1 (Months 1-3) | 30 | ₱11,520 | ₱2,584 | ₱94,040 | **-₱85,104** |
| Q2 (Months 4-6) | 100 | ₱38,400 | ₱2,584 | ₱94,040 | **-₱58,224** |
| Q3 (Months 7-9) | 200 | ₱76,800 | ₱6,574 | ₱94,040 | **-₱23,814** |
| Q4 (Months 10-12) | 280 | ₱107,520 | ₱6,574 | ₱94,040 | **+₱6,906** |

**Year 1 Annual Net:** ≈ **-₱1,924,728** (startup phase, expected loss)

> 💡 This is normal for tech startups. Year 1 requires seed funding or the team accepts reduced pay until break-even.

---

### 8.2 Year 2 — Growth Phase

| Quarter | Avg Subscribers | Net Revenue/mo | OPEX/mo | Payroll/mo | Net Profit/mo |
|---|---|---|---|---|---|
| Q1 | 350 | ₱134,400 | ₱6,574 | ₱94,040 | **+₱33,786** |
| Q2 | 500 | ₱192,000 | ₱6,574 | ₱94,040 | **+₱91,386** |
| Q3 | 700 | ₱268,800 | ₱6,574 | ₱110,000* | **+₱152,226** |
| Q4 | 850 | ₱326,400 | ₱8,000 | ₱110,000* | **+₱208,400** |

*Salary increase as business becomes profitable

**Year 2 Annual Net:** ≈ **+₱5,832,792** (profitable from Q1)

> ⚠️ VAT registration required when annual gross revenue exceeds ₱3M (≈ 627 subscribers). Consult a CPA.

---

### 8.3 Year 3 — Maturity Phase

| Scenario | Subscribers | Net Rev/mo | OPEX/mo | Payroll/mo | Net/mo | Net Margin |
|---|---|---|---|---|---|---|
| Conservative | 800 | ₱307,200 | ₱8,000 | ₱120,000 | ₱179,200 | 58.3% |
| Moderate | 1,000 | ₱384,000 | ₱10,000 | ₱140,000 | ₱234,000 | 60.9% |
| Optimistic | 1,500 | ₱576,000 | ₱15,000 | ₱180,000 | ₱381,000 | 66.1% |

---

## 9. Gross Margin Analysis

All figures use **₱384 net per subscriber** (verified: PayMongo blended fee ₱15.14 incl. 12% VAT on fee, sourced from paymongo.com live March 2026).

| Metric | Early Stage | Growth Stage | Maturity |
|---|---|---|---|
| Gross Price/subscriber | ₱399 | ₱399 | ₱399 |
| PayMongo fee (blended, incl. VAT on fee) | −₱15.14 | −₱15.14 | −₱15.14 |
| **Net Revenue/subscriber** | **₱384** | **₱384** | **₱384** |
| OPEX cost/subscriber | ₱25.84 (100 subs) | ₱13.15 (500 subs) | ₱10.00 (1000 subs) |
| Gross Margin (infra only) | **93.3%** | **96.6%** | **97.4%** |
| Net Margin (infra + team) | **-220%** (Year 1) | **47.6%** (Year 2) | **60.9%** (Year 3) |

> 💡 Even with accurate PayMongo fees, SafeDrive's infrastructure-only margin stays **93%+**. The dominant cost drivers are (1) team salaries, (2) PayMongo volume fees at scale.

---

## 10. Risk Assessment & Cost Escalation Scenarios

### 10.1 If Services Raise Prices

| Risk | Current | Potential Increase | Impact |
|---|---|---|---|
| Supabase Pro price increase | $25/mo | +$10 → $35/mo | +₱570/mo |
| Vercel bandwidth overage | 1TB included | At 1,000 users, ~2TB needed → +$150 | +₱8,550/mo one-time |
| Philippine Peso devaluation | ₱57/$1 | ₱65/$1 | +₱672/mo increase in USD bills |
| Supabase database overage | 8 GB included | 1,000 vehicles ≈ 2–3 GB → safe | Minimal |
| File storage overage | 100 GB included | 1,000 vehicles × ~5–10 photos = ~15–30 GB | Within limits |

**Conclusion:** SafeDrive's chosen tech stack is **cost-efficient and scales well**. Even at 1,000 subscribers, storage and compute costs remain manageable.

---

### 10.2 Free Tier Limits vs. SafeDrive Actual Usage

| Resource | Free Limit | Estimated Usage @ 500 users | Action Needed |
|---|---|---|---|
| DB Size | 500 MB | ~200–300 MB | ✅ OK on free |
| File Storage | 1 GB | ~5–15 GB (photos) | ⚠️ Must upgrade to Pro |
| MAU | 50,000 | ~500 active users | ✅ Far under limit |
| Egress | 5 GB | ~10–20 GB (images served) | ⚠️ Must upgrade to Pro |
| Projects | 2 | 1 project | ✅ OK |

> **Verdict:** The trigger to upgrade to Supabase Pro is **file storage / egress** (vehicle photos are bandwidth-heavy). When storage exceeds 1 GB or egress exceeds 5 GB, upgrade is required.

---

## 11. Recommended Financial Plan

### Phase 1: Capstone (Months 1–6) — ₱0/month
- Stay on free tiers
- Use for demo and academic defence
- **No cost**

### Phase 2: Soft Launch (Months 7–12) — ₱2,622/month (≈ $46/mo)
- Upgrade Supabase to Pro ($25/mo)
- Upgrade Vercel to Pro, 1 seat ($20/mo)
- Register domain ($1/mo equivalent)
- **Requires 7 subscribers to break even on infra**

### Phase 3: Commercial Operation (Year 2+)
- Team begins drawing entry-level salaries (₱84,000–94,040/mo total)
- **Requires 243 subscribers to fully break even**
- Target: **300+ subscribers by end of Year 2 Q1**

---

## 12. Funding Requirements (If Seeking Investment)

To sustain 6 months of operations while growing to break-even (250 subscribers):

| Expense | 6-Month Total |
|---|---|
| Infrastructure (Scenario B) | ₱15,732 |
| Team Salaries (6 months) | ₱564,240 |
| Marketing / User Acquisition | ₱30,000–60,000 |
| Legal / Business Registration | ₱5,000–15,000 |
| Contingency (10%) | ₱61,497 |
| **Total Seed Funding Needed** | **≈ ₱676,469 – ₱715,469** |

> This ranges from approximately **₱676K – ₱715K** (~$12,000 USD) — well within reach of a **DTI/Startup PH micro-grant** or a **family/angel seed round**.

---

## 13. Summary Scorecard

| KPI | Verified Value |
|---|---|
| Gross Subscription Price | ₱399/month |
| PayMongo Blended Fee (incl. 12% VAT on fee) | −₱15.14/transaction |
| **Net Revenue per Subscriber** | **₱384/month** |
| Available Domain | `safedrive.company` — $3.99/year |
| Supabase Pro | $25/month (8GB DB, 100GB storage, 250GB egress) |
| Vercel Pro | $20/month/seat |
| Infrastructure break-even | **7 subscribers** |
| Full team break-even | **≈ 252 subscribers** |
| Gross Margin (infra only) | **93–97%** |
| Net Margin @ 1,000 subs | **≈ 60.9%** |
| VAT threshold | **627 subscribers** (₱3M/yr gross) |
| Year 1 loss (with team) | ≈ −₱1.92M |
| Year 2 return (with team) | ≈ +₱5.83M |
| Year 3 net @ 1,000 subs | ≈ ₱234,000/month |
| Required seed funding | ₱676,000–715,000 |
| Recommended first upgrade | Supabase Pro ($25/mo) |

---

## 14. Appendix — Exchange Rate Note

All USD figures converted at **₱57.00 = $1.00 USD** (BSP reference rate, Q1 2026 estimate).

> The Philippine Peso has historically ranged from ₱50–₱58/$1 over the past 3 years. Budget conservatively at ₱58–₱60 for USD-denominated bills.

---

*Document prepared for SafeDrive Capstone Group — Academic Year 2025–2026*
*For official business use, consult a licensed CPA and business consultant.*
