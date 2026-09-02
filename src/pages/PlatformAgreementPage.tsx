import { ArrowLeft, FileText, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "@/contexts/AuthContext";

export default function PlatformAgreementPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();

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
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
            SafeDrive Platform Agreement & Terms of Service
          </h1>
        </div>
        <p className="text-muted-foreground text-sm mb-10">Last Updated: August 6, 2026</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-8 text-foreground/90 leading-relaxed">
          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">1. Purpose and Acceptance of Terms</h2>
            <p>
              This Platform Agreement explains the SafeDrive web application's marketplace rules and is read together
              with the Terms and Privacy Policy. SafeDrive is designed to connect verified vehicle listers with
              verified renters; its final legal classification and required marketplace disclosures remain subject to
              Philippine legal and consumer review. This agreement is separate from the approved vehicle-specific
              rental agreement supplied by the Lister and accepted by the Renter before booking.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">2. Account Verification & Eligibility</h2>
            <p>
              To ensure the safety of all users and vehicles on the platform, SafeDrive enforces strict identity
              verification protocols:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Mandatory Identification:</strong> Users must submit a valid Philippine Driver&apos;s License,
                a valid Secondary Government ID, and a Driver&apos;s License Digital QR code tied to the Land
                Transportation Office Land Transportation Management System portal.
              </li>
              <li>
                <strong>Acceptable Restrictions:</strong> Renters must possess a Land Transportation Office Restriction
                Code of B or B1, or the old Restriction Code 2, authorizing them to operate light passenger vehicles.
              </li>
              <li>
                <strong>Manual Verification:</strong> No user may list a vehicle or book a reservation until their
                identity and documents have been manually reviewed and approved by SafeDrive Administration.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">3. Booking & Reservation Policies</h2>
            <p>
              To maintain fairness and ensure legal contract performance, all bookings are subject to strict
              scheduling rules:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Maximum Advance Booking:</strong> Users may only book a vehicle up to a maximum of 30 days
                in advance. This prevents unjustified holding of funds and helps preserve vehicle availability and
                condition.
              </li>
              <li>
                <strong>Minimum Lead Time:</strong> A trip may start as early as the day after the request is made;
                same-day starts are not accepted. After a request, the lister has 24 hours to accept and the renter
                then has 24 hours to pay the reservation. Both steps must be completed before the scheduled pickup
                time. If they are not, the request is automatically cancelled and the vehicle is released.
              </li>
              <li>
                <strong>Vehicle Turnover:</strong> Both parties must strictly observe the agreed pickup time. A
                30-minute grace period is provided. During pickup, each party must complete the in-app arrival
                confirmation flow, and if only one party checks in while the other does not appear, the waiting party
                may submit an in-app no-show report after the grace period.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">4. Fees, Payments, and Cancellations</h2>
            <p>
              All financial transactions are processed securely through our authorized payment gateway, PayMongo.
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Payment Options:</strong> Once a booking is accepted, the Renter may either settle the
                required reservation downpayment or pay the full booking amount through the platform. Any remaining
                balance must be completed before the rental starts.
              </li>
              <li>
                <strong>Platform Commission:</strong> SafeDrive deducts the active platform commission configured in
                the system from the total booking value to maintain the platform, server infrastructure, and security
                verifications.
              </li>
              <li>
                <strong>Cancellation Policy:</strong> A renter may cancel a captured payment during the current
                24-hour automated-refund window. After that window, the system requires support review and does not
                automatically apply a percentage penalty. A pre-trip lister cancellation starts a full refund attempt,
                with super-admin review if provider confirmation is unavailable.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">5. Vehicle Listing Standards</h2>
            <p>Car Owners or Listers must adhere to strict vehicle standards to list their cars on SafeDrive:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Accepted Vehicles:</strong> Only models and body types present in the admin-approved catalogue
                may be submitted. Approval also requires current ownership/registration evidence, roadworthiness,
                insurance declarations, images, and a vehicle-specific rental agreement.
              </li>
              <li>
                <strong>No unimplemented age promise:</strong> The current schema does not enforce a vehicle-age limit.
                SafeDrive therefore does not claim that an LTFRB passenger-transport age rule automatically governs
                this peer-to-peer marketplace. Any future age rule requires an applicability review and matching
                server/database validation before it appears in these terms.
              </li>
              <li>
                <strong>Annual Renewals:</strong> Listers must submit updated Land Transportation Office Official
                Receipt and Certificate of Registration and emission testing documents annually. Failure to do so will
                result in the immediate suspension of the vehicle&apos;s listing.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">6. Dispute Resolution and Anti-Carnapping Policy</h2>
            <p>SafeDrive acts as a neutral third-party digital witness in the event of disputes or criminal activity:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>No-Show Disputes:</strong> In the event of a no-show, disputes are resolved objectively using
                server-timestamped arrival check-ins, any submitted arrival evidence, and the in-app no-show report
                created after the 30-minute pickup window.
              </li>
              <li>
                <strong>Failure to return a vehicle:</strong> The Lister should use the booking-linked support and
                emergency process. Authorized admins may preserve relevant account, agreement, trip, support, audit,
                and payment records and may restrict the account. Disclosure to law enforcement requires a lawful,
                documented basis; SafeDrive does not promise automatic disclosure or call every record immutable.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">7. Permitted Use of Platform and Brand Identity</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Users may access SafeDrive only for lawful renting, listing, and support-related activities.</li>
              <li>Users, Listers, and Admins may not misrepresent themselves as acting on behalf of SafeDrive or imply ownership of the platform unless explicitly authorized in writing.</li>
              <li>The SafeDrive name, logo, or public trust language may not be reused in misleading advertisements, fake off-platform listings, or independent transactions outside the system.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">8. Limitation of Liability and Legal Position</h2>
            <p>
              SafeDrive does not provide vehicle insurance. Users remain responsible for lawful driving, roadworthiness,
              truthful disclosure, the approved vehicle-specific agreement, and insurer confirmation of intended use.
              Any description of SafeDrive as a marketplace or intermediary, and any limitation of responsibility,
              applies only to the extent allowed by Philippine law and cannot remove mandatory consumer or statutory
              rights. Obtain legal and insurance review before real-money public use.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-border/40 text-center">
          <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
            <Shield className="w-4 h-4" />
            <span>SafeDrive - Platform Usage and Service Terms</span>
          </div>
        </div>
      </div>
    </div>
  );
}
