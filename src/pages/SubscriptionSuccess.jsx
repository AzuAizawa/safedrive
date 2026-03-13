import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FiCheckCircle, FiStar, FiTruck } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { isSubscriptionActive } from '../lib/paymongo';

export default function SubscriptionSuccess() {
    const [searchParams] = useSearchParams();
    const { user, profile, refreshProfile, activeClient } = useAuth();
    const [isActivating, setIsActivating] = useState(true);

    const isSubscribedGlobally = isSubscriptionActive(profile);

    // Use URL param if available, otherwise fallback to the logged-in user
    const userId = searchParams.get('user_id') || user?.id;

    useEffect(() => {
        if (!userId) {
            setIsActivating(false);
            return;
        }

        const activatePremium = async () => {
            try {
                // Activate the subscription for 30 days
                const subscriptionEnd = new Date();
                subscriptionEnd.setDate(subscriptionEnd.getDate() + 30);

                const { data: updatedProfile, error: profileError } = await activeClient.from('profiles')
                    .update({
                        subscription_status: 'active',
                        subscription_end_date: subscriptionEnd.toISOString(),
                    })
                    .eq('id', userId)
                    .select();

                if (profileError) throw profileError;
                
                // CRITICAL CHECK: Supabase silently returns successful if RLS blocks the update (0 rows updated)
                if (!updatedProfile || updatedProfile.length === 0) {
                    throw new Error('RLS_BLOCKED');
                }

                if (profileError) throw profileError;

                // Also re-activate any inactive listings the user has
                await activeClient.from('vehicles')
                    .update({ is_available: true, is_active_listing: true })
                    .eq('owner_id', userId);

                // Forces the AuthContext to reload the profile from the database,
                // instantly updating the UI navbar and "Subscribe" buttons to Premium mode.
                if (refreshProfile) {
                    console.log("Calling refreshProfile()...");
                    await refreshProfile();
                    console.log("refreshProfile() finished.");
                }

                toast.success('Premium activated successfully!');
                setIsActivating(false);
            } catch (error) {
                console.error('Failed to activate subscription:', error);
                
                if (error.message === 'RLS_BLOCKED') {
                    toast.error('Payment succeeded, but your database blocked the account upgrade! 🚨', { duration: 8000 });
                    alert('CRITICAL SETUP ERROR:\n\nYou did not apply the Supabase SQL script for subscriptions! Your database rejected the account upgrade.\n\nPlease open Supabase SQL Editor, run the "SUPABASE_SUBSCRIPTION_RLS_FIX.sql" file, then re-open this page to apply your benefits.');
                } else {
                    // Expose the raw error to the user so they can report it for debugging
                    alert(`DATABASE ERROR: ${JSON.stringify(error)}`);
                    toast.error('Payment succeeded but profile update failed. Contact support.');
                }
                setIsActivating(false);
            }
        };

        activatePremium();
    }, [userId]);

    return (
        <div className="max-w-[480px] mx-auto my-[60px] text-center px-6">
            <div className="bg-[var(--surface-primary)] border-2 border-[var(--success-300)] rounded-[var(--radius-xl)] p-12">
                {isActivating ? (
                    <div className="flex flex-col items-center gap-4">
                        <div className="empty-state-icon animate-[bounce_2s_infinite]">⭐</div>
                        <h3>Activating Premium...</h3>
                        <p>Please wait while we update your account benefits.</p>
                    </div>
                ) : (
                    <>
                        <div className="text-[72px] mb-4">⭐</div>
                        <h1 className="text-[26px] font-extrabold text-[var(--success-700)] mb-2">
                            Welcome to Premium!
                        </h1>
                        <p className="text-[var(--text-secondary)] mb-6 leading-[1.7]">
                            Your ₱399 payment was successful. Your SafeDrive Premium subscription is now active for
                            <strong> 30 days</strong>. You can now list unlimited vehicles simultaneously!
                        </p>

                        <div className="bg-[var(--success-50)] rounded-[var(--radius-lg)] px-5 py-4 mb-6 text-left border border-[var(--success-200)]">
                            <div className="font-bold mb-2 text-[var(--success-800)]">What you unlocked:</div>
                            {['Unlimited active vehicle listings', 'All your vehicles are now active'].map((f, i) => (
                                <div key={i} className="flex gap-2 text-sm mb-1.5 text-[var(--success-700)]">
                                    <FiCheckCircle className="shrink-0" />{f}
                                </div>
                            ))}
                        </div>

                        <div className="flex flex-col gap-2.5">
                            {!isSubscribedGlobally ? (
                                <div className="p-5 bg-[var(--warning-50)] rounded-xl border border-[var(--warning-200)]">
                                    <div className="spinner mx-auto mb-2.5 border-[var(--warning-500)] border-t-transparent" />
                                    <div className="text-[var(--warning-700)] font-semibold">Syncing benefits to your device...</div>
                                </div>
                            ) : (
                                <Link to="/my-vehicles" className="btn btn-primary w-full justify-center">
                                    Go to My Vehicles <FiTruck className="ml-2" />
                                </Link>
                            )}
                            <Link to="/owner/create-vehicle" className="btn btn-secondary w-full justify-center">
                                Add New Vehicle
                            </Link>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
