Gemini said

Here is a comprehensive markdown file ready for your project documentation. It covers the technical architecture, the payment flow using Xendit, and the "Lazy Option" implementation.
Technical Specification: Car Rental Disbursement System

Version: 1.0.0 (2026)

Provider: Xendit (Disbursement API & Payout Links)

Market: Philippines
1. System Overview

The system is designed as a managed marketplace. The platform handles customer acquisition and payment collection, while the Payout Link system handles the transfer of funds to car owners. This "Lazy Option" removes the need for the platform to build complex bank-validation forms or store sensitive financial data.
2. Payment Architecture

The money flows through three distinct stages to ensure security and platform profitability.
Stage 1: Collection (Pay-In)

The customer pays the total booking fee via your website or app.

    Method: Xendit Invoices or Payment Requests.

    Status: Funds are held in the Platform’s Xendit Balance.

Stage 2: The Split Logic

Before the payout is generated, the system calculates the distribution:

    Total Amount (A): The full price paid by the renter.

    Platform Commission (B): Your percentage cut (e.g., 15%).

    Disbursement Fee (C): Flat fee charged by Xendit for the transfer (approx. ₱10–₱15).

    Owner Share (D): A−B−C=D.

Stage 3: Payout (The "Lazy" Transfer)

Instead of asking for the owner's bank details upfront, the system generates a Payout Link.
3. Integration Workflow (The Lazy Method)
Step 1: Create Payout Link

When the rental is completed (or as per your terms), the backend triggers this request:
Bash

POST https://api.xendit.co/payout_links
Authorization: Basic [Your_Secret_Key]
Content-Type: application/json

{
  "external_id": "RENTAL-ID-1002",
  "amount": 4200,
  "description": "Payout for Toyota Vios Rental - Booking #1002"
}

Step 2: Delivery

The API returns a payout_url. Your system sends this to the owner:

    SMS: "Hi [Name], your payout for Booking #1002 is ready. Claim it here: [URL]"

    Email: Professional breakdown of the earnings with the link button.

Step 3: Owner Experience

The owner clicks the link and is redirected to a Xendit-hosted page where they:

    Choose their destination (e.g., GCash, BPI, BDO, Maya).

    Input their Account Number/Mobile Number.

    Click "Claim."

4. Webhook Implementation (Automatic Tracking)

To keep your database updated without manual checking, you must implement a webhook listener.
Webhook Event: payout_link.status_changed
Event Status	Required Action
PENDING	Default state. Link is sent but not opened.
CLAIMED	Owner has submitted details; Xendit is processing the transfer.
SUCCEEDED	Money has landed. Update booking status to "Paid to Owner."
FAILED	Transfer bounced (e.g., closed bank account). Alert Admin.
Sample Payload Handling (Node.js/Express)
JavaScript

app.post('/webhooks/xendit', (req, res) => {
    const { status, external_id, amount } = req.body;

    if (status === 'SUCCEEDED') {
        // Logic to update your DB
        db.bookings.update({ id: external_id }, { owner_paid: true });
        console.log(`Success: ₱${amount} sent for ${external_id}`);
    }

    res.status(200).send('Webhook Received');
});

5. Security & Best Practices

    Expiration: Set a expiration_date on Payout Links (e.g., 7 days) to prevent old links from being used if a dispute arises.

    Idempotency: Use the external_id (your Booking ID) to prevent sending duplicate payments for the same rental.

    Balance Monitoring: Ensure your Xendit "Available Balance" is sufficient before triggering payouts, or the links will fail.

6. Summary of Benefits

    Zero Data Liability: You never store bank account numbers on your servers.

    User Preference: Owners choose where they want the money (GCash one week, BDO the next).

    Low Maintenance: Xendit handles the UI and bank-side error messaging.

Would you like me to generate the SQL schema for the payouts table to help you track these link statuses in your database?