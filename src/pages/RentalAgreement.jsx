import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FiCheck, FiPrinter } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { badgeClass, cx, ui } from '../lib/ui';

function AgreementSection({ title, children }) {
  return (
    <section className="space-y-4">
      <h2 className="border-b border-border-light pb-3 text-xs font-semibold uppercase tracking-[0.2em] text-text-tertiary">
        {title}
      </h2>
      {children}
    </section>
  );
}

function InfoCard({ label, value }) {
  return (
    <div className="rounded-[24px] border border-border-light bg-surface-secondary px-4 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">{label}</p>
      <p className="mt-2 text-sm font-semibold text-text-primary">{value || 'N/A'}</p>
    </div>
  );
}

export default function RentalAgreement() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [booking, setBooking] = useState(null);
  const [agreement, setAgreement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    fetchAgreement();
  }, [bookingId]);

  const fetchAgreement = async () => {
    try {
      const { data: bookingData, error: bookingError } = await supabase
        .from('bookings')
        .select('*, vehicles(*), profiles!bookings_renter_id_fkey(*)')
        .eq('id', bookingId)
        .single();

      if (bookingError) {
        throw bookingError;
      }

      setBooking(bookingData);

      const { data: agreementData } = await supabase
        .from('rental_agreements')
        .select('*')
        .eq('booking_id', bookingId)
        .single();

      if (agreementData) {
        setAgreement(agreementData);
        return;
      }

      const terms = `
TERMS AND CONDITIONS OF RENTAL AGREEMENT

1. RENTAL PERIOD: The vehicle shall be rented from ${new Date(bookingData.start_date).toLocaleDateString()} to ${new Date(bookingData.end_date).toLocaleDateString()}.

2. RENTAL RATE: The daily rental rate is P${bookingData.daily_rate?.toLocaleString()} for a total of ${bookingData.total_days} day(s).

3. TOTAL AMOUNT: The total rental amount is P${bookingData.total_amount?.toLocaleString()}, inclusive of service fees and security deposit.

4. SECURITY DEPOSIT: A security deposit of P${bookingData.security_deposit?.toLocaleString() || '0'} is required and will be refunded upon satisfactory return of the vehicle.

5. VEHICLE CONDITION: The renter agrees to return the vehicle in the same condition as received, normal wear and tear excepted.

6. FUEL POLICY: The vehicle must be returned with the same fuel level as when picked up. Failure to do so may result in additional charges.

7. PROHIBITED USES: The vehicle shall not be used for illegal purposes, racing, towing, or any activity that may damage the vehicle.

8. INSURANCE AND LIABILITY: The renter is responsible for damage, loss, or theft not covered by insurance during the rental period.

9. TRAFFIC VIOLATIONS: The renter is responsible for traffic violations and fines incurred during the rental period.

10. EARLY TERMINATION: Either party may terminate this agreement with proper notice. Refunds will be calculated based on unused rental days minus applicable fees.

11. IDENTITY VERIFICATION: Both parties confirm that their identities have been verified through SafeDrive's verification system.

12. DISPUTE RESOLUTION: Any disputes arising from this agreement shall first be mediated through SafeDrive's dispute resolution process.

13. PHYSICAL VERIFICATION: The renter is required to undergo a physical identity check at pickup. The owner must verify the renter's face matches the submitted ID.

14. GOVERNING LAW: This agreement is governed by the laws of the Republic of the Philippines.
      `.trim();

      const { data: newAgreement, error: createError } = await supabase
        .from('rental_agreements')
        .insert({
          booking_id: bookingId,
          owner_id: bookingData.owner_id,
          renter_id: bookingData.renter_id,
          vehicle_info: {
            make: bookingData.vehicles.make,
            model: bookingData.vehicles.model,
            year: bookingData.vehicles.year,
            plate_number: bookingData.vehicles.plate_number,
            color: bookingData.vehicles.color,
          },
          terms_and_conditions: terms,
          rental_period_start: bookingData.start_date,
          rental_period_end: bookingData.end_date,
          daily_rate: bookingData.daily_rate,
          total_amount: bookingData.total_amount,
          security_deposit: bookingData.security_deposit,
          status: 'pending_signatures',
        })
        .select()
        .single();

      if (createError) {
        throw createError;
      }

      setAgreement(newAgreement);
    } catch (err) {
      console.error('Error in fetchAgreement:', err);
      toast.error(`Failed to load agreement: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const signAgreement = async () => {
    setSigning(true);
    try {
      const isOwner = user.id === booking.owner_id;
      const update = isOwner
        ? { owner_signed: true, owner_signed_at: new Date().toISOString() }
        : { renter_signed: true, renter_signed_at: new Date().toISOString() };

      if ((isOwner && agreement.renter_signed) || (!isOwner && agreement.owner_signed)) {
        update.status = 'active';
      }

      const { error } = await supabase.from('rental_agreements').update(update).eq('id', agreement.id);
      if (error) {
        throw error;
      }

      toast.success('Agreement signed successfully');
      fetchAgreement();
    } catch {
      toast.error('Failed to sign agreement');
    } finally {
      setSigning(false);
    }
  };

  if (loading) {
    return (
      <div className={ui.loadingScreen}>
        <div className={ui.spinner} />
        <p className="text-sm font-medium text-text-secondary">Loading rental agreement...</p>
      </div>
    );
  }

  if (!booking || !agreement) {
    return null;
  }

  const isOwner = user.id === booking.owner_id;
  const hasSigned = isOwner ? agreement.owner_signed : agreement.renter_signed;
  const statusVariant =
    agreement.status === 'active'
      ? 'success'
      : agreement.status === 'pending_signatures'
        ? 'pending'
        : 'info';

  return (
    <div className={ui.pageNarrow}>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <button type="button" className={ui.button.ghost} onClick={() => navigate(-1)}>
          Back
        </button>
        <button type="button" className={ui.button.secondary} onClick={() => window.print()}>
          <FiPrinter />
          Print
        </button>
      </div>

      <article className="rounded-[36px] border border-border-light bg-surface-primary px-6 py-8 shadow-float sm:px-10 sm:py-10">
        <header className="border-b border-border-light pb-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary-700 font-display text-lg font-bold text-white shadow-soft">
            SD
          </div>
          <h1 className="mt-5 font-display text-3xl font-semibold tracking-tight text-text-primary">
            SafeDrive Digital Rental Agreement
          </h1>
          <p className="mt-3 text-sm text-text-secondary">
            Agreement ID {agreement.id?.slice(0, 8).toUpperCase()} | Generated{' '}
            {new Date(agreement.created_at).toLocaleDateString()}
          </p>
          <span className={cx(badgeClass(statusVariant), 'mt-4')}>
            {agreement.status.replace('_', ' ')}
          </span>
        </header>

        <div className="mt-8 space-y-8">
          <AgreementSection title="Parties involved">
            <div className="grid gap-4 md:grid-cols-2">
              <InfoCard label="Vehicle owner" value={`ID: ${booking.owner_id?.slice(0, 8).toUpperCase()}`} />
              <InfoCard label="Renter" value={booking.profiles?.full_name || booking.renter_id?.slice(0, 8).toUpperCase()} />
            </div>
          </AgreementSection>

          <AgreementSection title="Vehicle information">
            <div className="grid gap-4 md:grid-cols-3">
              <InfoCard
                label="Vehicle"
                value={`${agreement.vehicle_info.year} ${agreement.vehicle_info.make} ${agreement.vehicle_info.model}`}
              />
              <InfoCard label="Plate number" value={agreement.vehicle_info.plate_number} />
              <InfoCard label="Color" value={agreement.vehicle_info.color} />
            </div>
          </AgreementSection>

          <AgreementSection title="Rental details">
            <div className="grid gap-4 md:grid-cols-2">
              <InfoCard label="Start date" value={new Date(agreement.rental_period_start).toLocaleDateString()} />
              <InfoCard label="End date" value={new Date(agreement.rental_period_end).toLocaleDateString()} />
              <InfoCard label="Daily rate" value={`P${agreement.daily_rate?.toLocaleString()}`} />
              <InfoCard label="Total amount" value={`P${agreement.total_amount?.toLocaleString()}`} />
            </div>
          </AgreementSection>

          <AgreementSection title="Terms and conditions">
            <div className="rounded-[28px] border border-border-light bg-surface-secondary px-5 py-5 text-sm leading-7 text-text-secondary whitespace-pre-wrap">
              {agreement.terms_and_conditions}
            </div>
          </AgreementSection>

          <AgreementSection title="Digital signatures">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[28px] border border-dashed border-border-medium px-5 py-6 text-center">
                <div className="flex min-h-[56px] items-end justify-center border-b border-text-primary pb-4 text-sm font-semibold text-success-700">
                  {agreement.owner_signed ? 'Digitally signed' : ''}
                </div>
                <p className="mt-4 text-sm font-semibold text-text-primary">Vehicle owner</p>
                <p className="mt-1 text-sm text-text-secondary">
                  {agreement.owner_signed
                    ? `Signed ${new Date(agreement.owner_signed_at).toLocaleString()}`
                    : 'Awaiting signature'}
                </p>
              </div>

              <div className="rounded-[28px] border border-dashed border-border-medium px-5 py-6 text-center">
                <div className="flex min-h-[56px] items-end justify-center border-b border-text-primary pb-4 text-sm font-semibold text-success-700">
                  {agreement.renter_signed ? 'Digitally signed' : ''}
                </div>
                <p className="mt-4 text-sm font-semibold text-text-primary">Renter</p>
                <p className="mt-1 text-sm text-text-secondary">
                  {agreement.renter_signed
                    ? `Signed ${new Date(agreement.renter_signed_at).toLocaleString()}`
                    : 'Awaiting signature'}
                </p>
              </div>
            </div>
          </AgreementSection>
        </div>

        {!hasSigned && (
          <div className="mt-10 text-center">
            <button
              type="button"
              className={cx(ui.button.accent, ui.button.lg)}
              onClick={signAgreement}
              disabled={signing}
            >
              <FiCheck />
              {signing ? 'Signing...' : 'Sign this agreement'}
            </button>
            <p className="mt-3 text-sm text-text-tertiary">
              By signing, you agree to the terms and conditions shown above.
            </p>
          </div>
        )}
      </article>
    </div>
  );
}
