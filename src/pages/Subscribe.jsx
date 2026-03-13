import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { FiCheck, FiStar, FiZap, FiList, FiToggleRight, FiCreditCard, FiShield } from 'react-icons/fi';
import { createSubscriptionPaymentLink, isSubscriptionActive, getSubscriptionDaysLeft, formatPHP, SUBSCRIPTION_PRICE, FREE_LISTING_LIMIT, verifyPaymentStatus } from '../lib/paymongo';
import toast from 'react-hot-toast';
import BackButton from '../components/BackButton';

const FEATURES_FREE = [
    { text: '1 active vehicle listing', ok: true },
    { text: 'Multiple active listings', ok: false },
];

const FEATURES_PRO = [
    { text: 'Unlimited active listings', ok: true },
];

export default function Subscribe() {
    const { user, profile, isVerified: ctxVerified, refreshProfile } = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [vehicleCount, setVehicleCount] = useState(0);

    const [paymentStarted, setPaymentStarted] = useState(false);
    const [pendingLinkId, setPendingLinkId] = useState(null);
    const [verifying, setVerifying] = useState(false);

    // Check EITHER role='verified' OR verification_status='verified'
    // Admin may have set role before verification_status depending on SQL state
    const isVerified = ctxVerified || profile?.role === 'verified' || profile?.verification_status === 'verified';
    const isActive = isSubscriptionActive(profile);
    const daysLeft = getSubscriptionDaysLeft(profile);

    // --- Verification Gate ---
    // Unverified users cannot subscribe. If they pay and can't list cars,
    // they waste their money. Require verification first.
    if (!isVerified) {
        return (
            <div className="max-w-[520px] mx-auto my-[60px] px-4 text-center">
                <BackButton />
                <div className="bg-gradient-to-br from-[#fff7ed] to-[#fef3c7] border-2 border-[rgba(245,158,11,0.4)] rounded-[var(--radius-xl)] p-10 mt-4">
                    <div className="text-[52px] mb-3">🔒</div>
                    <h2 className="font-extrabold text-[20px] mb-2 text-[#92400e]">
                        Verification Required
                    </h2>
                    <p className="text-[14px] text-[#78350f] leading-loose mb-6">
                        You need to be <strong>verified</strong> before subscribing to SafeDrive Premium.
                        <br /><br />
                        This protects you — a subscription lets you list unlimited vehicles, but listing vehicles
                        requires identity verification. We don't want you paying for features you can't use yet.
                    </p>
                    <div className="bg-[rgba(245,158,11,0.1)] rounded-[var(--radius-md)] p-3 mb-6 text-[13px] text-[#92400e]">
                        {profile?.verification_status === 'submitted'
                            ? '⏳ Your documents are currently under review (24–48 hours). Please check back soon!'
                            : profile?.verification_status === 'rejected'
                                ? '❌ Your verification was rejected. Please resubmit your documents with clearer photos.'
                                : '📄 Please submit your government-issued ID and a selfie in your Profile to get verified.'}
                    </div>
                    <a href="/profile" className="btn btn-primary inline-flex gap-2">
                        📋 Go to Profile & Submit Documents
                    </a>
                </div>
            </div>
        );
    }

    useEffect(() => {
        if (user) {
            fetchVehicleCount();
            // Guarantee we don't accidentally let a user buy a sub twice due to a stale cache
            if (refreshProfile) refreshProfile().catch(console.error);
        }
    }, [user?.id]);

    const fetchVehicleCount = async () => {
        const { count } = await supabase.from('vehicles')
            .select('*', { count: 'exact', head: true })
            .eq('owner_id', user.id);
        setVehicleCount(count || 0);
    };

    const handleSubscribe = async () => {
        if (!user) { navigate('/login'); return; }
        setLoading(true);
        try {
            const { url, linkId } = await createSubscriptionPaymentLink(user.id, user.email);
            if (url && linkId) {
                // Open PayMongo in a new tab so they don't lose the SafeDrive tab
                window.open(url, '_blank');
                // Switch the UI to the "Verify Payment" state
                setPendingLinkId(linkId);
                setPaymentStarted(true);
            } else {
                throw new Error('Payment link could not be created');
            }
        } catch (err) {
            toast.error(err.message || 'Could not start payment. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyPayment = async () => {
        if (!pendingLinkId) return;

        setVerifying(true);
        const toastId = toast.loading('Verifying your payment with PayMongo...');

        try {
            const status = await verifyPaymentStatus(pendingLinkId);

            if (status === 'paid') {
                toast.success('Payment confirmed! Activating Premium...', { id: toastId });
                navigate(`/subscription/success?user_id=${user.id}`);
            } else {
                toast.error('We have not received your payment yet. Please finish the GCash steps in the other tab.', { id: toastId, duration: 5000 });
            }
        } catch (err) {
            toast.error('Could not verify payment status. If you already paid, please contact support.', { id: toastId });
        } finally {
            setVerifying(false);
        }
    };

    return (
        <div className="max-w-[860px] mx-auto pb-12">
            <BackButton />

            <div className="page-header text-center mb-2">
                <h1>⭐ SafeDrive Premium</h1>
                <p>List as many vehicles as you want. One affordable monthly subscription.</p>
            </div>

            {/* Active Subscription Banner */}
            {isActive && (
                <div className="bg-gradient-to-br from-[var(--success-50)] to-[var(--success-100)] border-2 border-[var(--success-300)] rounded-[var(--radius-xl)] p-5 mb-7 flex items-center gap-4">
                    <span className="text-[36px]">🎉</span>
                    <div className="flex-1">
                        <div className="font-extrabold text-[17px] text-[var(--success-800)]">
                            You have SafeDrive Premium!
                        </div>
                        <div className="text-[14px] text-[var(--success-700)] mt-1">
                            {daysLeft} days remaining — expires {new Date(profile.subscription_end_date).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
                        </div>
                    </div>
                    <button className="btn btn-sm bg-[var(--success-600)] text-white border-none whitespace-nowrap"
                        onClick={handleSubscribe} disabled={loading}>
                        Renew Early
                    </button>
                </div>
            )}

            {/* Plans */}
            <div className="grid grid-cols-2 gap-5 mb-8">
                {/* Free Plan */}
                <div className="bg-[var(--surface-primary)] border-2 border-[var(--border-light)] rounded-[var(--radius-xl)] p-7 relative">
                    <div className="font-extrabold text-lg mb-1">Free</div>
                    <div className="text-[36px] font-black font-[var(--font-display)] mb-1">₱0</div>
                    <div className="text-[13px] text-[var(--text-tertiary)] mb-5">Forever free</div>
                    <div className="flex flex-col gap-2.5 mb-6">
                        {FEATURES_FREE.map((f, i) => (
                            <div key={i} className={`flex gap-2.5 items-center text-[14px] ${f.ok ? 'opacity-100' : 'opacity-40'}`}>
                                <FiCheck className={`shrink-0 ${f.ok ? 'text-[var(--success-500)]' : 'text-[var(--neutral-400)]'}`} />
                                <span className={f.ok ? 'no-underline' : 'line-through'}>{f.text}</span>
                            </div>
                        ))}
                    </div>
                    {!isActive && (
                        <div className="text-[12px] text-[var(--text-tertiary)] bg-[var(--neutral-50)] rounded-[var(--radius-md)] p-[8px_12px]">
                            ✓ Your current plan
                        </div>
                    )}
                </div>

                {/* Premium Plan */}
                <div className="bg-gradient-to-br from-[#1e3a5f] to-[#1a2e4a] border-2 border-[var(--primary-400)] rounded-[var(--radius-xl)] p-7 relative text-white shadow-[0_8px_32px_rgba(59,130,246,0.25)]">
                    <div className="absolute top-4 right-4 bg-[var(--primary-400)] text-white text-[11px] font-extrabold p-[4px_10px] rounded-[var(--radius-sm)] uppercase">Most Popular</div>
                    <div className="font-extrabold text-lg mb-1 text-[#e2e8f0]">Premium</div>
                    <div className="text-[36px] font-black font-[var(--font-display)] mb-0.5">
                        {formatPHP(SUBSCRIPTION_PRICE)}
                    </div>
                    <div className="text-[13px] text-[#94a3b8] mb-5">per month · via GCash</div>
                    <div className="flex flex-col gap-2.5 mb-6">
                        {FEATURES_PRO.map((f, i) => (
                            <div key={i} className="flex gap-2.5 items-center text-[14px]">
                                <FiCheck className="text-[#4ade80] shrink-0" />
                                <span>{f.text}</span>
                            </div>
                        ))}
                    </div>
                    {isActive ? (
                        <div className="text-[12px] bg-[rgba(74,222,128,0.15)] rounded-[var(--radius-md)] p-[8px_12px] text-[#4ade80] font-bold">
                            ✓ Active — {daysLeft} days remaining
                        </div>
                    ) : paymentStarted ? (
                        <div className="bg-white/10 rounded-[var(--radius-lg)] p-4 text-center border border-white/20">
                            <div className="text-[13px] mb-3 leading-loose text-[#94a3b8]">
                                A new tab opened for PayMongo checkout. Once you complete the GCash payment there, come back here and click the button below.
                            </div>
                            <button
                                className={`btn w-full text-[15px] font-bold py-3 border-none ${verifying ? 'bg-[#94a3b8] text-[#f1f5f9] cursor-not-allowed shadow-none' : 'bg-[#4ade80] text-[#064e3b] cursor-pointer shadow-[0_4px_14px_rgba(74,222,128,0.4)]'}`}
                                onClick={handleVerifyPayment}
                                disabled={verifying}
                            >
                                {verifying ? 'Verifying with PayMongo...' : '✅ I have finished paying'}
                            </button>
                        </div>
                    ) : (
                        <button
                            className="btn w-full text-[15px] font-bold py-3 bg-gradient-to-br from-[#3b82f6] to-[#2563eb] text-white border-none shadow-[0_4px_14px_rgba(37,99,235,0.4)]"
                            onClick={handleSubscribe}
                            disabled={loading}
                        >
                            {loading ? 'Creating secure link...' : '💳 Subscribe via GCash'}
                        </button>
                    )}
                </div>
            </div>

            {/* How it works */}
            <div className="bg-[var(--surface-primary)] border border-[var(--border-light)] rounded-[var(--radius-xl)] p-[24px_28px] mb-6">
                <h3 className="font-bold mb-4">📋 How Listings Work</h3>
                <div className="grid grid-cols-3 gap-4">
                    {[
                        { icon: <FiList />, title: 'Free Tier', desc: `You can have up to ${FREE_LISTING_LIMIT} active vehicle listing at a time. Additional vehicles you add will be inactive — you choose which one is active.` },
                        { icon: <FiStar />, title: 'Premium Tier', desc: 'Subscribe for ₱399/month to activate unlimited listings simultaneously. All your vehicles stay active automatically.' },
                        { icon: <FiToggleRight />, title: 'Manual Control', desc: 'You can always toggle any listing on or off. Free users can have exactly 1 active at a time; subscribers can have all active.' },
                    ].map((item, i) => (
                        <div key={i} className="p-4 bg-[var(--surface-secondary)] rounded-[var(--radius-md)]">
                            <div className="text-[20px] text-[var(--primary-500)] mb-2">{item.icon}</div>
                            <div className="font-bold mb-1.5 text-[14px]">{item.title}</div>
                            <div className="text-[13px] text-[var(--text-secondary)] leading-loose">{item.desc}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Payment Security Note */}
            <div className="flex items-start gap-3 text-[13px] text-[var(--text-tertiary)] px-1">
                <FiShield className="shrink-0 mt-0.5 text-[var(--primary-400)]" />
                <div>
                    Payment is securely processed by <strong>PayMongo</strong> — a BSP-regulated payment gateway. You'll be redirected to your GCash app to authorize the ₱399 payment. SafeDrive does not store your card or account information. Subscription is valid for 30 days from payment date.
                </div>
            </div>
        </div>
    );
}
