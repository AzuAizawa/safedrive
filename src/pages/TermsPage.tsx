import { ArrowLeft, Scale, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { usePlatformContactEmail } from "@/lib/platformSettings";

export default function TermsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  const contactEmail = usePlatformContactEmail();

  const handleBack = () => {
    const returnTo =
      typeof location.state?.returnTo === "string"
        ? location.state.returnTo
        : null;

    if (returnTo) {
      navigate(returnTo, { replace: true });
      return;
    }

    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(profile?.is_lister ? "/lister-bookings" : profile ? "/browse" : "/");
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto py-12 px-4 animate-fade-in">
        <Button variant="ghost" size="sm" className="-ml-2 mb-6" onClick={handleBack}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Scale className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Terms and Conditions</h1>
        </div>
        <p className="text-muted-foreground text-sm mb-10">Last Updated: August 6, 2026</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-8 text-foreground/90 leading-relaxed">

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">1. Introduction and Acceptance of Terms</h2>
            <p>Welcome to SafeDrive (the "Platform"). These terms describe the rules and current software workflow for users of the peer-to-peer vehicle-rental marketplace. They must receive Philippine legal, consumer, privacy, insurance, and tax review before SafeDrive accepts real-money public transactions.</p>
            <p className="mt-2">By creating an account or using a protected service, you acknowledge the version shown to you and agree to follow these rules. The Platform Terms are separate from the lister's vehicle-specific rental agreement, which the renter must review and accept before a booking request is created.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">2. Definitions</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>"Platform"</strong>: The SafeDrive web application, server handlers, and related services.</li>
              <li><strong>"Owner" / "Lister"</strong>: A verified user who lists a vehicle for rent on the Platform.</li>
              <li><strong>"Renter"</strong>: A verified user who requests to rent a vehicle from a Lister.</li>
              <li><strong>"Vehicle"</strong>: Any automobile listed for rent on the Platform.</li>
              <li><strong>"Booking"</strong>: A confirmed rental arrangement between a Lister and a Renter.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">3. User Registration and Verification</h2>
            <h3 className="font-semibold text-foreground mt-4 mb-2">3.1 Eligibility</h3>
            <p>You must be at least 18 years of age and possess the legal capacity to enter into a binding contract. <em>Legal Basis: In accordance with Republic Act No. 6809 (lowering the age of majority to 18 years), Article 1327 of the Civil Code of the Philippines, and Article 236 of the Family Code, unemancipated minors cannot give consent to a contract.</em></p>
            <h3 className="font-semibold text-foreground mt-4 mb-2">3.2 Verification</h3>
            <p>To access listing or booking features, users must complete the identity-review process and provide the evidence requested by the current verification form, including:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>Full legal name and contact information.</li>
              <li>A valid Professional or Non-Professional Driver's License (Front and Back) in compliance with the Land Transportation and Traffic Code (Republic Act No. 4136).</li>
              <li>The accepted secondary identification evidence shown by the form.</li>
              <li>Selfies used for manual identity comparison and anti-fraud review.</li>
            </ul>
            <h3 className="font-semibold text-foreground mt-4 mb-2">3.3 Accuracy</h3>
            <p>You must provide truthful and current information. Suspected falsification is reviewed, may lead to restriction or termination under the documented process, and may be reported when SafeDrive has a lawful basis or duty to do so.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">4. Vehicle Listing and Requirements</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>4.1 Registration and authority:</strong> Listers must provide current OR/CR evidence and must have lawful authority to list the vehicle.</li>
              <li><strong>4.2 Condition and insurance disclosure:</strong> Vehicles must be roadworthy and selected from the approved catalogue. Current registration and CTPL evidence are required. The lister must disclose the intended rental use to the insurer; optional comprehensive-policy information creates an admin warning when missing or expired. SafeDrive does not promise that any policy covers peer-to-peer rental.</li>
              <li><strong>4.3 Pricing limits:</strong> The current listing form accepts PHP 500 to PHP 100,000 per day, but the server rejects a booking total above PHP 100,000. A lower operational or provider limit may be shown before checkout.</li>
              <li><strong>4.4 Reapproval:</strong> A material listing, image, ownership, insurance, pricing, or rental-agreement change returns the vehicle to admin review before public availability.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">5. Booking Process and Payments</h2>
            <h3 className="font-semibold text-foreground mt-4 mb-2">5.1 Booking Windows & Duration Limits</h3>
            <ul className="list-disc pl-6 space-y-1">
              <li>The earliest a trip can start is the day after the request; same-day starts are not accepted.</li>
              <li>The 24-hour owner-response and 24-hour reservation-payment windows both apply, but neither can run past the scheduled pickup time. A request that is not accepted and paid before pickup is cancelled automatically.</li>
              <li>Bookings cannot be made more than 30 days in advance.</li>
              <li>The end date must be after the start date and must remain inside the same 30-day booking horizon.</li>
            </ul>
            <p className="mt-3"><strong>5.2 Reservation Payment:</strong> Upon an Owner's approval of a request (within a 24-hour response window), the Renter has 24 hours to either pay the required reservation downpayment or settle the full booking amount via our secure payment gateway (PayMongo).</p>
            <p className="mt-2"><strong>5.3 Final Balance:</strong> If the Renter chooses the partial reservation downpayment option (its current percentage is shown on the vehicle page before booking), the remaining balance must be settled through the Platform before the designated rental start time.</p>
            <p className="mt-2"><strong>5.4 Fees:</strong> The server applies the active platform commission to the base rental price and adds the configured payment-processing recovery to the renter's displayed total. SafeDrive deducts its commission before the eligible lister payout.</p>
            <p className="mt-2"><strong>5.5 Security Deposit:</strong> An owner-set refundable security deposit, if any, is disclosed separately and never counted as rental income or platform commission. It follows the documented return-review and claim process.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">6. Cancellation, Refund, and No-Show Policy</h2>
            <p><strong>6.1 Renter Cancellation (Full-Refund Window):</strong> A paid booking cancelled at least a set number of hours before the scheduled pickup time (currently shown on the vehicle page and in My Bookings, default 24 hours) is refunded in full, handled automatically. Cancelling an unpaid request is always free.</p>
            <p className="mt-2"><strong>6.2 Short-Notice Renter Cancellation:</strong> A paid booking cancelled inside the full-refund window (or after the pickup time has passed) is not refunded automatically. A policy share of the captured amount (default 50%) is recommended back to the Renter, with the remainder recorded as short-notice compensation to the Lister; the exact amount and return method are confirmed by SafeDrive support review against provider evidence. The system does not apply any penalty beyond this published share.</p>
            <p className="mt-2"><strong>6.3 Lister Cancellation:</strong> A lister may cancel before the trip starts. If booking money was captured, SafeDrive attempts a full provider refund and creates super-admin manual review when automation cannot confirm it.</p>
            <p className="mt-2"><strong>6.4 No-Show and Disputes:</strong> After the 30-minute pickup grace period, either participant may open a booking-linked no-show support report. Admin review may use arrival timestamps, optional consented location/photos, messages, payment records, and other lawful evidence. A no-show allegation does not automatically decide a refund or payout.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">7. Insurance and Liability</h2>
            <p><strong>7.1 No Platform Insurance:</strong> SafeDrive DOES NOT provide any insurance coverage for vehicles, users, or third parties.</p>
            <p className="mt-2"><strong>7.2 Required review:</strong> CTPL/CMVLI is connected to vehicle registration and does not by itself prove peer-to-peer rental, own-damage, theft, passenger, or commercial-use coverage. Listers must confirm intended use directly with the insurer and provide current evidence requested by SafeDrive.</p>
            <p className="mt-2"><strong>7.3 Responsibility and non-waivable rights:</strong> Renters and listers remain responsible for lawful driving, roadworthiness, truthful disclosure, and the vehicle-specific agreement. Any limitation of SafeDrive responsibility applies only to the extent Philippine law permits and cannot waive mandatory consumer or statutory rights.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">8. User Conduct</h2>
            <p>Users agree NOT to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Use the vehicle for illegal activities or transportation of prohibited substances.</li>
              <li>Sub-rent or lend the vehicle to any third party (the registered Renter is the sole authorized driver).</li>
              <li>Tamper with or modify the vehicle in any way.</li>
              <li>Bypass the platform to pay for rentals in cash.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">9. Account Security and Termination</h2>
            <p>The browser applies a progressive five-attempt sign-in throttle in five-minute steps and records supported security events; Supabase remains the authentication authority. This browser control can be cleared with browser storage and is not represented as an account-wide server lock. SafeDrive may restrict or terminate an account after authorized review of fraud, safety, security, or repeated Terms violations, with reasons and audit evidence where appropriate.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">10. Governing Law</h2>
            <p>These Terms are intended to be governed by Philippine law. Venue, dispute-resolution, consumer-redress, and enforceability language must be finalized by Philippine counsel before public real-money launch; nothing here removes a remedy or forum that applicable law makes mandatory.</p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-border/40 text-center">
          <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
            <Shield className="w-4 h-4" />
            <span>SafeDrive - Peer-to-Peer Car Rental Platform</span>
          </div>
          <p className="text-xs text-muted-foreground/60 mt-2">
            For legal inquiries: <a href={`mailto:${contactEmail}`} className="text-primary underline underline-offset-2">{contactEmail}</a>
          </p>
        </div>
      </div>
    </div>
  );
}
