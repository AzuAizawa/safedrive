import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiCheck, FiList, FiShield, FiStar, FiToggleRight } from 'react-icons/fi';
import toast from 'react-hot-toast';
import BackButton from '../components/BackButton';
import { useAuth } from '../context/AuthContext';
import {
  createSubscriptionPaymentLink,
  FREE_LISTING_LIMIT,
  formatPHP,
  getSubscriptionDaysLeft,
  isSubscriptionActive,
  SUBSCRIPTION_PRICE,
  verifyPaymentStatus,
} from '../lib/paymongo';
import { supabase } from '../lib/supabase';
import { cx, ui } from '../lib/ui';

const FEATURES_FREE = [
  { text: '1 active vehicle listing', ok: true },
  { text: 'Multiple active listings', ok: false },
];

const FEATURES_PRO = [{ text: 'Unlimited active listings', ok: true }];

function PlanFeature({ text, ok, dark = false }) {
  return (
    <div className={cx('flex items-center gap-3 text-sm', !ok && 'opacity-45')}>
      <FiCheck className={cx(ok ? (dark ? 'text-success-500' : 'text-success-600') : 'text-neutral-400')} />
      <span className={ok ? '' : 'line-through'}>{text}</span>
    </div>
  );
}

export default function Subscribe() {
  const { user, profile, isVerified: contextVerified, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [paymentStarted, setPaymentStarted] = useState(false);
  const [pendingLinkId, setPendingLinkId] = useState(null);
  const [verifying, setVerifying] = useState(false);

  const isVerified =
    contextVerified || profile?.role === 'verified' || profile?.verification_status === 'verified';
  const isActive = isSubscriptionActive(profile);
  const daysLeft = getSubscriptionDaysLeft(profile);

  useEffect(() => {
    if (!user) {
      return;
    }

    fetchVehicleCount();
    if (refreshProfile) {
      refreshProfile().catch(console.error);
    }
  }, [user?.id]);

  const fetchVehicleCount = async () => {
    const { count } = await supabase
      .from('vehicles')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', user.id);

    setVehicleCount(count || 0);
  };

  const handleSubscribe = async () => {
    if (!user) {
      navigate('/login');
      return;
    }

    setLoading(true);
    try {
      const { url, linkId } = await createSubscriptionPaymentLink(user.id, user.email);
      if (!url || !linkId) {
        throw new Error('Payment link could not be created');
      }

      window.open(url, '_blank');
      setPendingLinkId(linkId);
      setPaymentStarted(true);
    } catch (err) {
      toast.error(err.message || 'Could not start payment. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPayment = async () => {
    if (!pendingLinkId) {
      return;
    }

    setVerifying(true);
    const toastId = toast.loading('Verifying your payment with PayMongo...');

    try {
      const status = await verifyPaymentStatus(pendingLinkId);

      if (status === 'paid') {
        toast.success('Payment confirmed. Activating Premium...', { id: toastId });
        navigate(`/subscription/success?user_id=${user.id}`);
      } else {
        toast.error('Payment is not confirmed yet. Complete the GCash steps, then try again.', {
          id: toastId,
          duration: 5000,
        });
      }
    } catch {
      toast.error('Could not verify payment status. If you already paid, contact support.', {
        id: toastId,
      });
    } finally {
      setVerifying(false);
    }
  };

  if (!isVerified) {
    return (
      <div className={ui.pageCompact}>
        <BackButton />
        <section className="rounded-[32px] border border-warning-200 bg-warning-50 px-6 py-10 text-center shadow-soft">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white text-2xl text-warning-700 shadow-xs">
            <FiShield />
          </div>
          <h1 className="mt-5 text-2xl font-semibold text-text-primary">Verification required</h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-warning-700">
            Premium only makes sense once your identity is verified, because listing vehicles is locked until verification is approved.
          </p>
          <div className="mx-auto mt-6 max-w-2xl rounded-[28px] border border-warning-200 bg-white/70 px-5 py-4 text-sm leading-6 text-warning-700">
            {profile?.verification_status === 'submitted'
              ? 'Your documents are already under review. Please check back once the admin team approves them.'
              : profile?.verification_status === 'rejected'
                ? 'Your last verification attempt was rejected. Please update your profile with clearer documents and resubmit.'
                : 'Submit your government-issued ID and selfie in your profile first so you do not pay for features you cannot use yet.'}
          </div>
          <Link to="/profile" className={cx(ui.button.primary, 'mt-6')}>
            Go to profile
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className={ui.pageNarrow}>
      <BackButton />

      <div className="space-y-2 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">Premium</p>
        <h1 className={ui.pageTitle}>SafeDrive Premium</h1>
        <p className="mx-auto max-w-2xl text-sm leading-6 text-text-secondary">
          Unlock unlimited active listings with one monthly subscription and keep your vehicles visible without manual juggling.
        </p>
      </div>

      {isActive && (
        <section className="flex flex-col gap-4 rounded-[32px] border border-success-200 bg-success-50 px-6 py-5 shadow-soft sm:flex-row sm:items-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-2xl text-success-700 shadow-xs">
            <FiStar />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-text-primary">Premium is active</h2>
            <p className="mt-1 text-sm text-success-700">
              {daysLeft} days remaining. Expires{' '}
              {new Date(profile.subscription_end_date).toLocaleDateString('en-PH', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
              .
            </p>
          </div>
          <button type="button" className={cx(ui.button.success, ui.button.sm)} onClick={handleSubscribe} disabled={loading}>
            Renew early
          </button>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-[32px] border border-border-light bg-surface-primary px-6 py-7 shadow-soft">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-text-tertiary">Free</p>
          <h2 className="mt-3 text-2xl font-semibold text-text-primary">Starter listing plan</h2>
          <p className="mt-2 font-display text-5xl font-bold text-text-primary">P0</p>
          <p className="mt-2 text-sm text-text-secondary">Great for one active vehicle at a time.</p>

          <div className="mt-8 space-y-3">
            {FEATURES_FREE.map((feature) => (
              <PlanFeature key={feature.text} {...feature} />
            ))}
          </div>

          <div className="mt-8 rounded-[24px] border border-border-light bg-surface-secondary px-4 py-4 text-sm leading-6 text-text-secondary">
            You currently have {vehicleCount} vehicle listing{vehicleCount === 1 ? '' : 's'} in your account.
          </div>
        </section>

        <section className="rounded-[32px] border border-primary-700 bg-primary-900 px-6 py-7 text-white shadow-float">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary-100">Premium</p>
              <h2 className="mt-3 text-2xl font-semibold">Unlimited active listings</h2>
            </div>
            <span className="rounded-full bg-primary-300 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary-900">
              Most popular
            </span>
          </div>

          <p className="mt-4 font-display text-5xl font-bold">{formatPHP(SUBSCRIPTION_PRICE)}</p>
          <p className="mt-2 text-sm text-primary-100">per month via GCash</p>

          <div className="mt-8 space-y-3">
            {FEATURES_PRO.map((feature) => (
              <PlanFeature key={feature.text} {...feature} dark />
            ))}
          </div>

          {isActive ? (
            <div className="mt-8 rounded-[24px] border border-success-500/30 bg-success-500/15 px-4 py-4 text-sm font-medium text-success-50">
              Active now with {daysLeft} day{daysLeft === 1 ? '' : 's'} remaining.
            </div>
          ) : paymentStarted ? (
            <div className="mt-8 rounded-[24px] border border-white/15 bg-white/8 px-4 py-5">
              <p className="text-sm leading-6 text-primary-100">
                Finish the PayMongo checkout in the other tab, then come back here and confirm payment.
              </p>
              <button
                type="button"
                className={cx(
                  'mt-4 w-full rounded-full px-5 py-3 text-sm font-semibold transition',
                  verifying
                    ? 'cursor-not-allowed bg-primary-200 text-primary-800 opacity-60'
                    : 'bg-success-400 text-success-950 hover:bg-success-300'
                )}
                onClick={handleVerifyPayment}
                disabled={verifying}
              >
                {verifying ? 'Verifying payment...' : 'I finished paying'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="mt-8 w-full rounded-full bg-white px-5 py-3 text-sm font-semibold text-primary-900 transition hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleSubscribe}
              disabled={loading}
            >
              {loading ? 'Creating secure link...' : 'Subscribe via GCash'}
            </button>
          )}
        </section>
      </div>

      <section className={ui.section}>
        <div className={ui.sectionHeader}>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">How listings work</h2>
            <p className="text-sm text-text-secondary">Choose between free flexibility and premium scale</p>
          </div>
        </div>

        <div className="grid gap-4 px-5 py-5 md:grid-cols-3 sm:px-6 sm:py-6">
          {[
            {
              icon: <FiList />,
              title: 'Free tier',
              desc: `You can keep up to ${FREE_LISTING_LIMIT} active vehicle listing at a time. Extra listings stay inactive until you switch them on.`,
            },
            {
              icon: <FiStar />,
              title: 'Premium tier',
              desc: 'Premium keeps all of your approved vehicles active simultaneously with one monthly plan.',
            },
            {
              icon: <FiToggleRight />,
              title: 'Manual control',
              desc: 'You can still toggle individual vehicles on or off whenever you want.',
            },
          ].map((item) => (
            <div key={item.title} className="rounded-[28px] border border-border-light bg-surface-secondary px-5 py-5">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-700">
                {item.icon}
              </div>
              <h3 className="mt-4 text-lg font-semibold text-text-primary">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-text-secondary">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="flex items-start gap-3 rounded-[28px] border border-border-light bg-surface-primary px-5 py-4 text-sm leading-6 text-text-secondary shadow-soft">
        <FiShield className="mt-1 shrink-0 text-primary-600" />
        <p>
          Payments are securely processed by <strong>PayMongo</strong>, a BSP-regulated gateway. SafeDrive does not store your card or GCash account information. Your subscription is valid for 30 days from the payment date.
        </p>
      </div>
    </div>
  );
}
