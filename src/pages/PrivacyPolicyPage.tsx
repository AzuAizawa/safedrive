import { ArrowLeft, Shield, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "@/contexts/AuthContext";

export default function PrivacyPolicyPage() {
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
            <Lock className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Privacy Policy</h1>
        </div>
        <p className="text-muted-foreground text-sm mb-10">Last Updated: August 6, 2026</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-8 text-foreground/90 leading-relaxed">

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">1. Introduction</h2>
            <p>SafeDrive ("we," "our," or "us") is a peer-to-peer car-rental platform. This notice explains the personal data the current system is designed to collect, why it is used, who may receive it, and how you may exercise your rights under Republic Act No. 10173 (the Data Privacy Act of 2012) and its implementing rules. Technical controls support compliance, but they do not replace the privacy, legal, and vendor reviews required before a public launch.</p>
            <p className="mt-3">Our data processing is bound by the DPA's core principles:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li><strong>Transparency:</strong> We describe the data and purposes before or as soon as reasonably practical after collection.</li>
              <li><strong>Legitimate purpose:</strong> Processing must have a declared, specific, and lawful platform purpose.</li>
              <li><strong>Proportionality:</strong> Collection and use should be adequate, relevant, and not excessive for that purpose.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">2. Data We Collect</h2>
            <p>To provide our peer-to-peer car rental services and deter fraud, we distinguish between standard Personal Information and highly protected Sensitive Personal Information (SPI):</p>
            <ul className="list-disc pl-6 space-y-2 mt-3">
              <li><strong>Contact and identity information:</strong> Name, address, phone number, email address, date of birth, and the verification fields requested by the current form.</li>
              <li><strong>Verification and vehicle documents:</strong> Driver's-license and other accepted identity evidence, selfies used for identity comparison, OR/CR images, insurance declarations, and rental-agreement files.</li>
              <li><strong>Transaction Data:</strong> Records of PayMongo payments, refunds, and booking history.</li>
              <li><strong>Trip and evidence data:</strong> Condition photos, odometer and fuel/battery readings, support records, and optional browser location only when you actively consent to location-backed evidence.</li>
              <li><strong>Guest inquiry data:</strong> Name, email, optional phone, selected topics, message, reply status, and a salted anti-abuse fingerprint.</li>
              <li><strong>Device and usage data:</strong> Timestamped security, audit, and login-related events used for account security, fraud review, and dispute handling.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">3. Data Security and Technical Safeguards</h2>
            <p>The repository includes technical controls intended to reduce unauthorized access, alteration, disclosure, or destruction. Their live effectiveness must be verified after each database migration and deployment.</p>
            <div className="grid sm:grid-cols-2 gap-4 mt-4">
              <div className="bg-muted/30 rounded-lg p-4 border border-border/40">
                <p className="font-semibold text-foreground text-sm mb-1">Encryption at Rest</p>
                <p className="text-xs text-muted-foreground">The database master defines pgcrypto protection for designated identity fields. This claim applies only after the reviewed chapter and its key-management procedure are proven in the live database.</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-4 border border-border/40">
                <p className="font-semibold text-foreground text-sm mb-1">Encryption in Transit</p>
                <p className="text-xs text-muted-foreground">Supabase and payment-provider traffic uses HTTPS. The selected production host must also enforce HTTPS before public use.</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-4 border border-border/40">
                <p className="font-semibold text-foreground text-sm mb-1">Row-Level Security</p>
                <p className="text-xs text-muted-foreground">Row-Level Security, role checks, private storage, and short-lived signed URLs restrict ordinary access. Service-role operations run only in server handlers.</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-4 border border-border/40">
                <p className="font-semibold text-foreground text-sm mb-1">Audit and review</p>
                <p className="text-xs text-muted-foreground">Security events, privileged actions, agreement acceptance, and financial corrections are recorded for review. Logs are evidence inputs, not a guarantee that every incident is prevented.</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">4. Purpose of Data Processing</h2>
            <p>Depending on the data and activity, processing must rely on an applicable lawful basis, such as steps necessary to provide the requested service, compliance with a legal obligation, a properly assessed legitimate interest, or consent where consent is required. Current purposes include:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>To verify your identity, driving eligibility, and legal age to contract.</li>
              <li>To preserve the approved lister agreement version and the renter's recorded acceptance for later evidentiary review.</li>
              <li>To create hosted payments, confirm provider events, process refunds and payouts, and reconcile transaction records through PayMongo. SafeDrive does not describe this arrangement as regulated escrow.</li>
              <li>To monitor platform integrity and resolve disputes using timestamped check-in evidence, including optional location data only when you choose the location-backed arrival button.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">5. Third-Party Disclosures</h2>
            <p>SafeDrive does not sell personal data. Data may be disclosed to service providers or authorities only for a declared purpose, with appropriate contracts, safeguards, and legal authority. The current integrations are:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li><strong>Supabase:</strong> Database, authentication, and object-storage infrastructure.</li>
              <li><strong>PayMongo:</strong> Hosted checkout and approved payment, refund, or money-movement services. SafeDrive does not receive or store full card credentials entered on the hosted checkout.</li>
              <li><strong>Google Apps Script and Gmail:</strong> Delivery of guest-inquiry replies and configured reminder emails.</li>
              <li><strong>Selected application host:</strong> Hosting is not yet selected. This notice and the vendor register must be updated before production deployment.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">6. Data Retention and Account Deletion</h2>
            <p><strong>6.1 Schedule:</strong> Data is retained only for the declared purpose, a documented legal or operational requirement, establishment or defense of legal claims, or another lawful basis. Category-specific periods in the internal retention schedule are provisional until privacy, legal, tax, and accounting review is complete.</p>
            <p className="mt-2"><strong>6.2 Requests:</strong> An account-closure or deletion request starts an identity and scope review; it is not a promise of instant blanket deletion. Approved deletion may use erasure, blocking, restricted archival, or anonymization depending on the record and applicable obligation.</p>
            <p className="mt-2"><strong>6.3 Holds:</strong> SafeDrive may preserve limited records while they are required for an active booking, payment, refund, payout, dispute, fraud/security investigation, accounting/tax record, or legal claim. The decision and reason must be recorded and communicated where required.</p>
            <p className="mt-2"><strong>6.4 Disposal:</strong> When retention is no longer justified, the approved procedure must cover live records, storage objects, derived copies, and backups. A super-admin completion record is operational evidence; it does not by itself prove every provider copy was erased.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">7. Your Data Privacy Rights</h2>
            <p>As a Filipino citizen or resident acting within the Philippines, the Data Privacy Act of 2012 grants you the following rights:</p>
            <ul className="list-disc pl-6 space-y-2 mt-3">
              <li><strong>Right to be Informed:</strong> To know how your data is being collected and processed.</li>
              <li><strong>Right to Access:</strong> To request copies of your personal data held by us.</li>
              <li><strong>Right to Rectification:</strong> To correct inaccurate, false, or outdated information.</li>
              <li><strong>Right to Erasure/Blocking:</strong> To request the suspension, withdrawal, or removal of your data from our systems.</li>
              <li><strong>Right to Object:</strong> To object to the processing of your data, including processing for direct marketing or automated profiling.</li>
              <li><strong>Right to Data Portability:</strong> To obtain covered electronically processed data in an appropriate format when the statutory conditions apply.</li>
              <li><strong>Right to File a Complaint and Claim Damages:</strong> To raise a complaint with the National Privacy Commission and pursue remedies available under applicable law.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">8. Privacy Contact and Requests</h2>
            <p>For a privacy question or security concern, use the contact below. Registered users may also submit and track an access, correction, restriction, anonymization, or deletion request from the Data Requests page. SafeDrive's formal DPO/responsible-person designation and any required NPC registration remain launch requirements and must not be inferred from this contact address.</p>
            <div className="mt-3 bg-primary/5 border border-primary/20 rounded-lg p-4">
              <p className="font-semibold text-foreground">Email: <a href="mailto:admin.no.reply.360@gmail.com" className="text-primary underline underline-offset-2">admin.no.reply.360@gmail.com</a></p>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">Using the platform acknowledges receipt of this notice. It does not convert every processing purpose into consent or waive any statutory privacy right. Where consent is the applicable lawful basis, SafeDrive must request it specifically and allow withdrawal subject to other lawful grounds.</p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-border/40 text-center">
          <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
            <Shield className="w-4 h-4" />
            <span>SafeDrive - Peer-to-Peer Car Rental Platform</span>
          </div>
          <p className="text-xs text-muted-foreground/60 mt-2">
            Privacy controls designed with RA 10173 and its implementing rules in view
          </p>
        </div>
      </div>
    </div>
  );
}
