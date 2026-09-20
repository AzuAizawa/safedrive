import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Car, Eye, EyeOff, Loader2, CheckCircle2, Circle, X } from "lucide-react";
import { toast } from "sonner";
import { usePlatformContactEmail } from "@/lib/platformSettings";
import {
  describeSignupEmailDomains,
  fetchSignupEmailDomains,
  isAllowedSignupEmail,
  looksLikeCompleteEmail,
} from "@/lib/signupEmailDomains";
import TurnstileWidget, { captchaConfigured } from "@/components/TurnstileWidget";

export default function SignUpPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  // Raised when the person leaves the email field, not when they submit.
  // The old order made them earn the rejection: type the address, satisfy
  // four password rules, read and accept the Terms, and only then be told
  // the address was never going to work. Reported by a tester who did
  // exactly that.
  const [emailDomainError, setEmailDomainError] = useState<string | null>(null);
  // Which providers registration takes (CHAPTER 102). Read before sign-in so
  // the form can say no early, instead of after a confirmation email. The
  // database trigger is what actually enforces it; an empty list here just
  // means the form has nothing to check against yet.
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);
  const [termsScrolled, setTermsScrolled] = useState(false);
  const [termsModalChecked, setTermsModalChecked] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);

  const rules = [
    { id: "length", text: "At least 8 characters", regex: /.{8,}/ },
    {
      id: "uppercase",
      text: "At least one uppercase letter (A-Z)",
      regex: /[A-Z]/,
    },
    { id: "number", text: "At least one number (0-9)", regex: /[0-9]/ },
    {
      id: "special",
      text: "At least one special character (!@#... etc)",
      regex: /[!@#$%^&*(),.?":{}|<>]/,
    },
  ];
  useEffect(() => {
    let cancelled = false;
    void fetchSignupEmailDomains().then((domains) => {
      if (!cancelled) setAllowedDomains(domains);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const acceptedDomainsLabel = useMemo(
    () => describeSignupEmailDomains(allowedDomains),
    [allowedDomains],
  );

  // One message, built from the live list, used by the field and by submit.
  const rejectedDomainMessage = (value: string) => {
    const domain = value.trim().toLowerCase().split("@")[1] ?? "";
    return acceptedDomainsLabel
      ? `${domain} is not accepted. SafeDrive accepts ${acceptedDomainsLabel}.`
      : `${domain} is not accepted for registration.`;
  };

  const checkEmailDomain = (value: string) => {
    if (!looksLikeCompleteEmail(value) || isAllowedSignupEmail(value, allowedDomains)) {
      setEmailDomainError(null);
      return;
    }
    setEmailDomainError(rejectedDomainMessage(value));
  };

  const { signUp } = useAuth();
  const navigate = useNavigate();
  const contactEmail = usePlatformContactEmail();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!termsAccepted) {
      toast.error("You must agree to the Terms and Conditions to proceed");
      return;
    }
    if (email.trim() && !isAllowedSignupEmail(email, allowedDomains)) {
      setEmailDomainError(rejectedDomainMessage(email));
      toast.error("Use an email address from a supported provider", {
        description: rejectedDomainMessage(email),
      });
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (!/[A-Z]/.test(password)) {
      toast.error("Password must contain at least one uppercase letter");
      return;
    }
    if (!/[0-9]/.test(password)) {
      toast.error("Password must contain at least one number");
      return;
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      toast.error("Password must contain at least one special character");
      return;
    }
    if (captchaConfigured && !captchaToken) {
      toast.error("Please wait for the security check to finish");
      return;
    }
    setIsLoading(true);
    const { error } = await signUp(email, password, captchaToken ?? undefined);
    setCaptchaResetSignal((value) => value + 1);
    setCaptchaToken(null);
    if (error) {
      if (error.message.includes("Error sending confirmation email")) {
        toast.error("Invalid email address", { description: "We couldn't deliver the confirmation email. Please check for typos (e.g., @gmail.com instead of @gmail.co)." });
      } else {
        toast.error("Sign up failed", { description: error.message });
      }
    } else {
      toast.success("Account created!", {
        description:
          "Please check your email (including Spam/Promotions) to verify your account. Didn't get it? Try signing in and use the resend option there.",
      });
      navigate("/login");
    }
    setIsLoading(false);
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-background via-background to-primary/3 p-4">
      <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-3xl translate-x-1/3 translate-y-1/3 pointer-events-none" />

      <div className="relative z-10 w-full max-w-md animate-scale-in">
        <Link
          to="/"
          className="flex items-center justify-center gap-2.5 mb-8 transition-opacity hover:opacity-80"
        >
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/25">
            <Car className="w-6 h-6 text-primary-foreground" />
          </div>
          <span className="text-2xl font-bold tracking-tight">SafeDrive</span>
        </Link>

        <Card className="shadow-2xl border-border/50">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl">Create your account</CardTitle>
            <CardDescription>Get started with SafeDrive today</CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@gmail.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    // Typing is how someone fixes it, so the complaint goes
                    // away the moment they start rather than sitting there
                    // red while they correct it.
                    if (emailDomainError) setEmailDomainError(null);
                  }}
                  onBlur={(e) => checkEmailDomain(e.target.value)}
                  required
                  disabled={isLoading}
                  aria-invalid={emailDomainError !== null}
                  className={`h-10 disabled:opacity-60${emailDomainError ? " border-red-500 focus-visible:ring-red-500" : ""}`}
                />
                {emailDomainError ? (
                  <p className="text-xs text-red-500">{emailDomainError}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Min. 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={isLoading}
                    className="h-10 pr-10 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <div className="space-y-1.5 mt-2 bg-muted/40 p-3 rounded-lg border border-border/50">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">
                    Password Requirements:
                  </p>
                  {rules.map((rule) => {
                    const isMet = rule.regex.test(password);
                    return (
                      <div
                        key={rule.id}
                        className={`flex items-center gap-2 text-xs transition-colors duration-300 ${isMet ? "text-green-500 font-medium" : "text-muted-foreground"}`}
                      >
                        {isMet ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <Circle className="w-3.5 h-3.5" />
                        )}
                        {rule.text}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={isLoading}
                  className="h-10 disabled:opacity-60"
                />
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground">
                      Terms and Conditions
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {termsAccepted
                        ? "Accepted after review."
                        : "Review the agreement before creating your account."}
                    </p>
                  </div>
                  {termsAccepted ? (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-500/10 text-green-600">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setTermsScrolled(false);
                        setTermsModalChecked(false);
                        setShowTermsModal(true);
                      }}
                    >
                      Review
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex-col gap-4 border-none bg-transparent pt-2">
              <TurnstileWidget
                onToken={setCaptchaToken}
                resetSignal={captchaResetSignal}
              />
              <Button
                type="submit"
                className="w-full h-10 shadow-lg shadow-primary/20"
                disabled={isLoading}
              >
                {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Create Account
              </Button>
              <p className="text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link
                  to="/login"
                  className="text-primary font-medium hover:underline"
                >
                  Sign in
                </Link>
              </p>
            </CardFooter>
          </form>
        </Card>
      </div>

      {/* Legal Links */}
      <div className="relative z-10 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 mt-6 text-xs text-muted-foreground">
        <Link to="/privacy-policy" className="text-blue-600 dark:text-blue-400 hover:underline transition-colors duration-200">
          Privacy Policy
        </Link>
        <span className="opacity-30">&middot;</span>
        <Link to="/terms" className="text-blue-600 dark:text-blue-400 hover:underline transition-colors duration-200">
          Terms and Conditions
        </Link>
        <span className="opacity-30">&middot;</span>
        <Link to="/platform-agreement" className="text-blue-600 dark:text-blue-400 hover:underline transition-colors duration-200">
          Platform Agreement
        </Link>
      </div>

      {showTermsModal &&
        createPortal(
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center overflow-y-auto bg-black/80 backdrop-blur-sm p-4 py-6 animate-fade-in" onClick={() => setShowTermsModal(false)}>
          <Card className="max-w-md w-full max-h-[calc(100vh-2rem)] sm:max-h-[80vh] flex flex-col shadow-2xl animate-scale-in relative border-0" onClick={(e) => e.stopPropagation()}>
            <button 
              onClick={() => setShowTermsModal(false)}
              className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors z-10"
            >
              <X className="w-5 h-5" />
            </button>
             <CardHeader className="pt-6 pb-4 border-b">
               <CardTitle>Terms and Conditions</CardTitle>
               <p className="text-xs text-muted-foreground mt-1">Last Updated: August 6, 2026 - Please read carefully before creating your account.</p>
             </CardHeader>
             <CardContent
               className="space-y-4 overflow-y-auto p-6 max-h-full"
               onScroll={(event) => {
                 const target = event.currentTarget;
                 const reachedBottom =
                   target.scrollTop + target.clientHeight >= target.scrollHeight - 8;
                 if (reachedBottom) setTermsScrolled(true);
               }}
             >
                <div className="space-y-4 text-sm text-foreground/80">
                  <div>
                    <h4 className="font-semibold text-foreground mb-1">1. Eligibility</h4>
                    <p>You must be at least 18 years of age and possess the legal capacity to enter into a binding contract (RA 6809, Civil Code Art. 1327).</p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-foreground mb-1">2. Verification (KYC)</h4>
                    <p>To access listing or booking features, you must submit a valid Driver's License, National ID (PhilSys), and selfies for identity verification. Falsified documents will result in immediate termination and reporting to authorities.</p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-foreground mb-1">3. Vehicle Requirements</h4>
                    <p>Listed vehicles must be roadworthy, use a model from the approved catalogue, and include current CR/OR, registration, CTPL, insurer disclosure, images, and rental-agreement evidence. Current daily rates are PHP 500 to PHP 100,000, while a booking total cannot exceed PHP 100,000.</p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-foreground mb-1">4. Payments & Commission</h4>
                    <p>A trip starts no earlier than tomorrow, and its pickup must also be at least the minimum notice after the request (default 12 hours). After a booking is approved, the renter may pay the required reservation downpayment or settle the full amount within 24 hours; any remaining balance is due by its deadline (default 24 hours after the downpayment, never later than pickup). Renters pay exactly the listed rental price plus a disclosed payment-processing fee - SafeDrive's active platform commission is deducted from the lister's payout instead, never added to the renter's total. All payments must go through PayMongo - off-platform cash payments are strictly prohibited.</p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-foreground mb-1">5. Cancellations & No-Show</h4>
                    <p>A paid booking cancelled at least the configured number of hours before pickup (default 24) is refunded in full automatically; if it was paid closer to pickup than that, it can still be cancelled free for a few hours after paying (default 4, never past pickup). After that, a cancellation fee counted in rental days applies (default one day, or half a day for trips of two days or less), never more than was paid and the same whether the downpayment or the full amount was paid. Not showing up, or cancelling after the pickup time, carries a higher no-show fee. Fees go to the lister as compensation after support review. If nobody checks in, only one side does, or the car is never handed over, SafeDrive warns both sides and settles the booking automatically a few hours after pickup. No-shows are reviewed through the in-app arrival trail, optional evidence, payment records, and the booking-linked report.</p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-foreground mb-1">6. Insurance & Liability</h4>
                    <p>SafeDrive does not provide vehicle insurance. Current registration and CTPL evidence do not prove peer-to-peer rental coverage. Listers must disclose intended rental use to their insurer, and all limitations remain subject to applicable Philippine law.</p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-foreground mb-1">7. User Conduct</h4>
                    <p>You must not use the vehicle for illegal purposes, sub-rent it to others, modify the vehicle, or bypass platform payments.</p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-foreground mb-1">8. Data Privacy (RA 10173)</h4>
                    <p>The database master defines encryption, Row-Level Security, and private-storage controls that must be verified in the live project. We do not sell personal data. You may use the Data Requests page or contact <a href={`mailto:${contactEmail}`} className="font-semibold text-primary underline underline-offset-2">{contactEmail}</a> to exercise applicable privacy rights.</p>
                  </div>

                  <p className="text-xs text-muted-foreground pt-2 border-t border-border/40">These Terms are governed by the laws of the Republic of the Philippines.</p>
                </div>
                <label
                  className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${
                    termsScrolled
                      ? "border-primary/30 bg-primary/5"
                      : "border-border bg-muted/30 text-muted-foreground"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0 accent-primary disabled:opacity-40"
                    checked={termsModalChecked}
                    disabled={!termsScrolled}
                    onChange={(event) => setTermsModalChecked(event.target.checked)}
                  />
                  <span>
                    I have scrolled through and read the Terms and Conditions.
                  </span>
                </label>
             </CardContent>
             <CardFooter className="border-t pt-4">
                <Button className="w-full" disabled={!termsScrolled || !termsModalChecked} onClick={() => {
                  setTermsAccepted(true);
                  setShowTermsModal(false);
                }}>I Have Read and Agree</Button>
             </CardFooter>
          </Card>
        </div>,
        document.body,
      )}
    </div>
  );
}
