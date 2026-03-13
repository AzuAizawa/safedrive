import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FiCheckCircle, FiTruck } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { isSubscriptionActive } from '../lib/paymongo';
import { ui } from '../lib/ui';

export default function SubscriptionSuccess() {
    const [searchParams] = useSearchParams();
    const { user, profile, refreshProfile, activeClient } = useAuth();
    const [isActivating, setIsActivating] = useState(true);
    const isSubscribedGlobally = isSubscriptionActive(profile);
    const userId = searchParams.get('user_id') || user?.id;

    useEffect(() => {
        if (!userId) {
            setIsActivating(false);
            return;
        }

        const activatePremium = async () => {
            try {
                const subscriptionEnd = new Date();
                subscriptionEnd.setDate(subscriptionEnd.getDate() + 30);

                const { data: updatedProfile, error } = await activeClient
                    .from('profiles')
                    .update({
                        subscription_status: 'active',
                        subscription_end_date: subscriptionEnd.toISOString(),
                    })
                    .eq('id', userId)
                    .select();

                if (error) throw error;
                if (!updatedProfile || updatedProfile.length === 0) {
                    throw new Error('RLS_BLOCKED');
                }

                await activeClient
                    .from('vehicles')
                    .update({ is_available: true, is_active_listing: true })
                    .eq('owner_id', userId);

                if (refreshProfile) {
                    await refreshProfile();
                }

                toast.success('Premium activated successfully!');
            } catch (error) {
                console.error('Failed to activate subscription:', error);
                if (error.message === 'RLS_BLOCKED') {
                    toast.error('Payment succeeded, but the database blocked the account upgrade.', { duration: 8000 });
                    alert('CRITICAL SETUP ERROR:\n\nRun SUPABASE_SUBSCRIPTION_RLS_FIX.sql in Supabase, then re-open this page to apply the benefits.');
                } else {
                    alert(`DATABASE ERROR: ${JSON.stringify(error)}`);
                    toast.error('Payment succeeded but profile update failed. Contact support.');
                }
            } finally {
                setIsActivating(false);
            }
        };

        activatePremium();
    }, [activeClient, refreshProfile, userId]);

    return (
        <div className="mx-auto mt-28 max-w-2xl">
            <div className="rounded-[36px] border border-success-200 bg-surface-primary p-8 text-center shadow-soft sm:p-10">
                {isActivating ? (
                    <div className="space-y-4">
                        <div className="text-6xl">⭐</div>
                        <h1 className="font-display text-4xl font-bold text-text-primary">Activating premium...</h1>
                        <p className="text-sm leading-7 text-text-secondary">
                            Please wait while we update your subscription benefits and reactivate your listings.
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="text-6xl">⭐</div>
                        <h1 className="mt-4 font-display text-4xl font-bold text-success-700">Welcome to Premium</h1>
                        <p className="mt-3 text-sm leading-7 text-text-secondary">
                            Your 30-day SafeDrive Premium subscription is now active. You can list unlimited vehicles simultaneously.
                        </p>

                        <div className="mt-6 rounded-3xl border border-success-200 bg-success-50 p-5 text-left">
                            <div className="font-semibold text-success-800">What you unlocked</div>
                            <div className="mt-3 space-y-2 text-sm text-success-700">
                                {['Unlimited active vehicle listings', 'All your vehicles are now active'].map((feature) => (
                                    <div key={feature} className="flex items-center gap-2">
                                        <FiCheckCircle className="shrink-0" />
                                        {feature}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="mt-6 flex flex-col gap-3">
                            {!isSubscribedGlobally ? (
                                <div className="rounded-3xl border border-warning-200 bg-warning-50 p-5 text-warning-700">
                                    <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-warning-500 border-t-transparent" />
                                    <div className="font-semibold">Syncing benefits to your device...</div>
                                </div>
                            ) : (
                                <Link to="/my-vehicles" className={`${ui.button.primary} w-full justify-center`}>
                                    Go to my vehicles <FiTruck />
                                </Link>
                            )}
                            <Link to="/vehicles/new" className={`${ui.button.secondary} w-full justify-center`}>
                                Add new vehicle
                            </Link>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
