import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { FiCheckCircle, FiStar } from 'react-icons/fi';
import toast from 'react-hot-toast';

export default function SubscriptionSuccess() {
    const [searchParams] = useSearchParams();
    const { user, refreshProfile } = useAuth();
    const [isActivating, setIsActivating] = useState(true);

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

                const { data: updatedProfile, error: profileError } = await supabase.from('profiles')
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
                await supabase.from('vehicles')
                    .update({ is_available: true, is_active_listing: true })
                    .eq('owner_id', userId);

                // Forces the AuthContext to reload the profile from the database,
                // instantly updating the UI navbar and "Subscribe" buttons to Premium mode.
                if (refreshProfile) {
                    await refreshProfile();
                }

                toast.success('Premium activated successfully!');
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
            } finally {
                setIsActivating(false);
            }
        };

        activatePremium();
    }, [userId]);

    return (
        <div style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center', padding: '0 24px' }}>
            <div style={{
                background: 'var(--surface-primary)',
                border: '2px solid var(--success-300)',
                borderRadius: 'var(--radius-xl)',
                padding: 48,
            }}>
                <div style={{ fontSize: 72, marginBottom: 16 }}>⭐</div>
                <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--success-700)', marginBottom: 8 }}>
                    Welcome to Premium!
                </h1>
                <p style={{ color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.7 }}>
                    Your ₱399 payment was successful. Your SafeDrive Premium subscription is now active for
                    <strong> 30 days</strong>. You can now list unlimited vehicles simultaneously!
                </p>

                <div style={{
                    background: 'var(--success-50)', borderRadius: 'var(--radius-lg)', padding: '16px 20px',
                    marginBottom: 24, textAlign: 'left', border: '1px solid var(--success-200)',
                }}>
                    <div style={{ fontWeight: 700, marginBottom: 8, color: 'var(--success-800)' }}>What you unlocked:</div>
                    {['Unlimited active vehicle listings', 'All your vehicles are now active'].map((f, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, fontSize: 14, marginBottom: 6, color: 'var(--success-700)' }}>
                            <FiCheckCircle style={{ flexShrink: 0 }} />{f}
                        </div>
                    ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <Link to="/owner/vehicles" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                        <FiStar /> Manage My Listings
                    </Link>
                    <Link to="/owner/create-vehicle" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }}>
                        Add New Vehicle
                    </Link>
                </div>
            </div>
        </div>
    );
}
