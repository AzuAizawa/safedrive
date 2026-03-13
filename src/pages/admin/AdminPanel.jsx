import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabaseAdmin } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { FiUsers, FiTruck, FiCalendar, FiShield, FiCheck, FiX, FiEye, FiSearch, FiImage, FiPlus, FiToggleLeft, FiToggleRight, FiAlertCircle, FiClock, FiTrash2, FiActivity } from 'react-icons/fi';
import toast from 'react-hot-toast';
import BackButton from '../../components/BackButton';
import { logAudit } from '../../lib/auditLogger';
import { badgeClass, bookingStatusClass, cx, ui } from '../../lib/ui';

export default function AdminPanel() {
    const { user, profile } = useAuth();
    const [searchParams] = useSearchParams();
    const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'users');
    const [users, setUsers] = useState([]);
    const [vehicles, setVehicles] = useState([]);
    const [bookings, setBookings] = useState([]);
    const [auditLogs, setAuditLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedUser, setSelectedUser] = useState(null);
    const [userDocs, setUserDocs] = useState([]);
    const [userVehicles, setUserVehicles] = useState([]);
    const [userBookings, setUserBookings] = useState([]);
    const [userDetailLoading, setUserDetailLoading] = useState(false);
    const [docsLoading, setDocsLoading] = useState(false);
    const [selectedVehicle, setSelectedVehicle] = useState(null);
    const [showRejectModal, setShowRejectModal] = useState(null); // 'vehicle' | 'user'
    const [rejectTarget, setRejectTarget] = useState(null);
    const [rejectReason, setRejectReason] = useState('');

    // Car Catalog state
    const [carBrands, setCarBrands] = useState([]);
    const [carModels, setCarModels] = useState([]);
    const [catalogLoading, setCatalogLoading] = useState(false);
    const [newBrandName, setNewBrandName] = useState('');
    const [newModelName, setNewModelName] = useState('');
    const [newModelBodyType, setNewModelBodyType] = useState('Sedan');
    const [selectedBrandId, setSelectedBrandId] = useState('');

    useEffect(() => { fetchData(); }, [activeTab]);

    const fetchData = async () => {
        setLoading(true);
        try {
            if (activeTab === 'users') {
                const { data } = await supabaseAdmin.from('profiles').select('*').order('created_at', { ascending: false });
                setUsers(data || []);
            } else if (activeTab === 'vehicles') {
                const { data } = await supabaseAdmin.from('vehicles').select('*, profiles!vehicles_owner_id_fkey(id, full_name, phone, date_of_birth, drivers_license_number, national_id_number, city, province, verification_status)').order('created_at', { ascending: false });
                setVehicles(data || []);
            } else if (activeTab === 'bookings') {
                const { data } = await supabaseAdmin.from('bookings').select('*, vehicles(make, model, year), profiles!bookings_renter_id_fkey(full_name)').order('created_at', { ascending: false });
                setBookings(data || []);
            } else if (activeTab === 'catalog') {
                await fetchCatalog();
            } else if (activeTab === 'audit') {
                const { data } = await supabaseAdmin.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200);
                setAuditLogs(data || []);
            }
        } catch (err) { console.error('Error:', err); }
        finally { setLoading(false); }
    };

    const fetchUserDetails = async (u) => {
        setUserDetailLoading(true);
        setUserVehicles([]);
        setUserBookings([]);
        try {
            const [vehiclesRes, bookingsRes] = await Promise.all([
                supabaseAdmin.from('vehicles').select('id, make, model, year, status, daily_rate, plate_number').eq('owner_id', u.id).order('created_at', { ascending: false }),
                supabaseAdmin.from('bookings').select('id, start_date, end_date, status, total_amount, vehicles(make, model, year)').eq('renter_id', u.id).order('created_at', { ascending: false }),
            ]);
            setUserVehicles(vehiclesRes.data || []);
            setUserBookings(bookingsRes.data || []);
        } catch (err) {
            console.warn('fetchUserDetails — run SUPABASE_ADMIN_VERIFY_FIX.sql to fix RLS:', err.message);
            setUserVehicles([]);
            setUserBookings([]);
        } finally {
            setUserDetailLoading(false);
        }
    };

    const fetchUserDocs = async (userId) => {
        setDocsLoading(true);
        setUserDocs([]);
        try {
            const allDocs = [];
            const withTimeout = (promise, ms = 5000) =>
                Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

            for (const bucket of ['documents', 'selfies']) {
                try {
                    const { data, error } = await withTimeout(
                        supabaseAdmin.storage.from(bucket).list(userId, { limit: 20 })
                    );
                    if (!error && data) {
                        for (const file of data) {
                            // Use createSignedUrl for private buckets — works with service role
                            const { data: signedData, error: signErr } = await supabaseAdmin.storage
                                .from(bucket)
                                .createSignedUrl(`${userId}/${file.name}`, 3600);
                            const url = !signErr && signedData?.signedUrl
                                ? signedData.signedUrl
                                : supabaseAdmin.storage.from(bucket).getPublicUrl(`${userId}/${file.name}`).data?.publicUrl;
                            allDocs.push({ name: file.name, bucket, url });
                        }
                    }
                } catch (e) {
                    console.warn(`Could not list ${bucket} (run SUPABASE_ADMIN_VERIFY_FIX.sql to fix):`, e.message);
                }
            }
            setUserDocs(allDocs);
        } catch (err) {
            console.error('Error fetching docs:', err);
            setUserDocs([]);
        } finally {
            setDocsLoading(false);
        }
    };

    const verifyUser = async (userId, action, reason = '') => {
        try {
            const isApprove = action === 'approve';
            const { error } = await supabaseAdmin.rpc('admin_verify_user', {
                target_user_id: userId,
                new_verification_status: isApprove ? 'verified' : 'rejected',
                new_role: isApprove ? 'verified' : 'user',
                admin_user_id: user.id,
            });
            if (error) throw error;
            try { await supabaseAdmin.from('verification_logs').insert({ user_id: userId, admin_id: user.id, action, verification_type: 'identity', notes: reason || `User ${isApprove ? 'verified' : 'rejected'} by admin` }); } catch { /* Non-blocking audit insert */ }
            const rejectionNote = reason ? `\n\nAdmin note: ${reason}` : '';
            try { await supabaseAdmin.from('notifications').insert({ user_id: userId, title: isApprove ? 'Identity Verified! ✅' : 'Verification Rejected', message: isApprove ? 'Your identity has been verified. You can now list vehicles and access all SafeDrive features!' : `Your identity verification was not approved. Please resubmit your documents with clearer photos.${rejectionNote}`, type: 'verification' }); } catch { /* Non-blocking notification insert */ }
            await logAudit({ action: isApprove ? 'VERIFY_USER' : 'REJECT_USER', entityType: 'user', entityId: userId, description: `Admin ${isApprove ? 'approved' : 'rejected'} identity verification for user ${selectedUser?.full_name || userId}${reason ? ': ' + reason : ''}`, newValue: { verification_status: isApprove ? 'verified' : 'rejected', role: isApprove ? 'verified' : 'user' }, performedBy: user.id, performerName: profile?.full_name, performerEmail: user.email });
            toast.success(`User ${isApprove ? 'verified ✅' : 'rejected'} successfully`);
            fetchData();
            setSelectedUser(null);
        } catch (err) {
            console.error('verifyUser error:', err);
            toast.error(`Failed to update verification: ${err.message || 'Unknown error'}`);
        }
    };

    const changeRole = async (userId, newRole) => {
        if (!window.confirm(`Change this user's role to "${newRole === 'user' ? 'Not Verified' : newRole}"?`)) return;
        const oldRole = selectedUser?.role;
        try {
            // Use RPC function (SECURITY DEFINER) to bypass RLS
            const { error } = await supabaseAdmin.rpc('admin_change_role', {
                target_user_id: userId,
                new_role: newRole,
                admin_user_id: user.id,
            });
            if (error) throw error;
            await logAudit({ action: 'CHANGE_USER_ROLE', entityType: 'user', entityId: userId, description: `Admin changed role of ${selectedUser?.full_name || userId} from ${oldRole} to ${newRole}`, oldValue: { role: oldRole }, newValue: { role: newRole }, performedBy: user.id, performerName: profile?.full_name, performerEmail: user.email });
            toast.success(`Role changed to ${newRole === 'user' ? 'Not Verified' : newRole}`);
            fetchData();
            setSelectedUser(null);
        } catch (err) {
            console.error('changeRole error:', err);
            toast.error(`Failed to change role: ${err.message || 'Unknown error'}`);
        }
    };

    // ===== VEHICLE FUNCTIONS =====
    const approveVehicle = async (vehicleId, action, reason = '') => {
        try {
            const veh = vehicles.find(v => v.id === vehicleId) || selectedVehicle;
            const newStatus = action === 'approve' ? 'approved' : 'rejected';

            // Update vehicle status
            const { error } = await supabaseAdmin.from('vehicles').update({
                status: newStatus,
            }).eq('id', vehicleId);
            if (error) throw error;

            // Send notification to vehicle owner
            const vehicleName = `${veh?.year || ''} ${veh?.make || ''} ${veh?.model || ''}`.trim();
            const rejectionNote = reason ? `\n\nReason: ${reason}` : '';
            const notifMessage = action === 'approve'
                ? `✅ Your vehicle listing "${vehicleName}" has been approved and is now live!`
                : `❌ Your vehicle listing "${vehicleName}" was not approved.${rejectionNote} Please review and resubmit.`;

            try {
                await supabaseAdmin.from('notifications').insert({
                    user_id: veh?.owner_id,
                    type: action === 'approve' ? 'vehicle_approved' : 'vehicle_rejected',
                    title: action === 'approve' ? 'Vehicle Listing Approved ✅' : 'Vehicle Listing Rejected',
                    message: notifMessage,
                    read: false,
                    created_at: new Date().toISOString(),
                });
            } catch (notifErr) {
                console.warn('Notification insert failed (non-critical):', notifErr.message);
            }

            // Audit log
            await logAudit({
                action: action === 'approve' ? 'APPROVE_VEHICLE' : 'REJECT_VEHICLE',
                entityType: 'vehicle', entityId: vehicleId,
                description: `Admin ${action === 'approve' ? 'approved' : 'rejected'} vehicle ${vehicleName}${reason ? ': ' + reason : ''}`,
                oldValue: { status: 'pending' },
                newValue: { status: newStatus },
                performedBy: user.id, performerName: profile?.full_name, performerEmail: user.email
            });

            toast.success(`Vehicle ${action === 'approve' ? '✅ approved — now live!' : '❌ rejected — owner notified'}`);
            fetchData();
            setSelectedVehicle(null);
        } catch (err) {
            console.error('approveVehicle error:', err);
            toast.error(`Failed to ${action} vehicle: ${err.message || 'Unknown error'}`);
        }
    };

    const confirmReject = () => {
        if (showRejectModal === 'vehicle') {
            approveVehicle(rejectTarget, 'reject', rejectReason);
        } else {
            verifyUser(rejectTarget, 'reject', rejectReason);
        }
        setShowRejectModal(null);
        setRejectReason('');
        setRejectTarget(null);
    };

    // ===== CATALOG FUNCTIONS =====
    const fetchCatalog = async () => {
        setCatalogLoading(true);
        try {
            const [brandsRes, modelsRes] = await Promise.all([
                supabaseAdmin.from('car_brands').select('*').order('name'),
                supabaseAdmin.from('car_models').select('*, car_brands(name)').order('name'),
            ]);
            setCarBrands(brandsRes.data || []);
            setCarModels(modelsRes.data || []);
        } catch (err) { console.error('Error fetching catalog:', err); }
        finally { setCatalogLoading(false); }
    };

    const addBrand = async () => {
        const name = newBrandName.trim();
        if (!name) return toast.error('Brand name is required');
        try {
            const { error } = await supabaseAdmin.from('car_brands').insert({ name, is_active: true });
            if (error) throw error;
            toast.success(`Brand "${name}" added`);
            setNewBrandName('');
            fetchCatalog();
        } catch (err) { toast.error(err.message?.includes('duplicate') ? 'Brand already exists' : 'Failed to add brand'); }
    };

    const addModel = async () => {
        const name = newModelName.trim();
        if (!name) return toast.error('Model name is required');
        if (!selectedBrandId) return toast.error('Select a brand first');
        try {
            const { error } = await supabaseAdmin.from('car_models').insert({ brand_id: selectedBrandId, name, body_type: newModelBodyType, is_active: true });
            if (error) throw error;
            toast.success(`Model "${name}" added`);
            setNewModelName('');
            fetchCatalog();
        } catch (err) { toast.error(err.message?.includes('duplicate') ? 'Model already exists for this brand' : 'Failed to add model'); }
    };

    const toggleBrandActive = async (brandId, current) => {
        try {
            const { error } = await supabaseAdmin.from('car_brands').update({ is_active: !current }).eq('id', brandId);
            if (error) throw error;
            toast.success(current ? 'Brand deactivated' : 'Brand activated');
            fetchCatalog();
        } catch { toast.error('Failed to update brand'); }
    };

    const toggleModelActive = async (modelId, current) => {
        try {
            const { error } = await supabaseAdmin.from('car_models').update({ is_active: !current }).eq('id', modelId);
            if (error) throw error;
            toast.success(current ? 'Model deactivated' : 'Model activated');
            fetchCatalog();
        } catch { toast.error('Failed to update model'); }
    };

    const deleteBrand = async (brandId, brandName) => {
        const modelCount = carModels.filter(m => m.brand_id === brandId).length;
        const msg = modelCount > 0
            ? `Delete "${brandName}" and its ${modelCount} model(s)? This cannot be undone.`
            : `Delete "${brandName}"? This cannot be undone.`;
        if (!window.confirm(msg)) return;
        try {
            if (modelCount > 0) {
                const { error: modelsErr } = await supabaseAdmin.from('car_models').delete().eq('brand_id', brandId);
                if (modelsErr) throw modelsErr;
            }
            const { error } = await supabaseAdmin.from('car_brands').delete().eq('id', brandId);
            if (error) throw error;
            toast.success(`"${brandName}" deleted`);
            if (selectedBrandId === brandId) setSelectedBrandId('');
            fetchCatalog();
        } catch { toast.error('Failed to delete brand. It may be referenced by vehicles.'); }
    };

    const deleteModel = async (modelId, modelName) => {
        if (!window.confirm(`Delete model "${modelName}"? This cannot be undone.`)) return;
        try {
            const { error } = await supabaseAdmin.from('car_models').delete().eq('id', modelId);
            if (error) throw error;
            toast.success(`"${modelName}" deleted`);
            fetchCatalog();
        } catch { toast.error('Failed to delete model. It may be referenced by vehicles.'); }
    };

    // ===== COMPUTED =====
    const handleViewUser = (u) => {
        setSelectedUser(u);
        fetchUserDocs(u.id);
        fetchUserDetails(u);
    };
    const getRoleBadgeClass = (role) => ({ admin: 'error', verified: 'success', user: 'info' }[role] || 'neutral');
    const getStatusBadge = (status) => ({ verified: 'success', submitted: 'pending', rejected: 'error' }[status] || 'neutral');
    const filteredCatalogModels = selectedBrandId ? carModels.filter(m => m.brand_id === selectedBrandId) : carModels;

    // Show all users in one unified table (pending users card removed per requirement)
    const pendingUsers = users.filter(u => u.verification_status === 'submitted');
    const allUsers = users; // Show everyone
    const pendingVehicles = vehicles.filter(v => v.status === 'pending');
    const allVehicles = vehicles.filter(v => v.status !== 'pending');

    const searchFilter = (items, fields) => {
        const term = searchTerm.toLowerCase();
        if (!term) return items;
        return items.filter(item => fields.some(f => {
            const val = f.split('.').reduce((o, k) => o?.[k], item);
            return val?.toString().toLowerCase().includes(term);
        }));
    };

    // ===== USER ROW COMPONENT =====
    const UserRow = ({ u, showActions = false }) => (
        <tr key={u.id} className={showActions ? 'bg-warning-50/70' : ''}>
            <td className={ui.tableCell}>
                <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-full bg-[var(--primary-600)] flex items-center justify-center text-white text-[13px] font-bold shrink-0">
                        {u.full_name?.[0] || 'U'}
                    </div>
                    <div>
                        <div className="font-semibold text-sm">{u.full_name || 'N/A'}</div>
                        <div className="text-[12px] text-[var(--text-tertiary)]">{u.email}</div>
                    </div>
                </div>
            </td>
            <td className={ui.tableCell}><span className={badgeClass(getRoleBadgeClass(u.role))}>{u.role === 'user' ? 'Not Verified' : u.role}</span></td>
            <td className={ui.tableCell}><span className={badgeClass(getStatusBadge(u.verification_status))}>{u.verification_status || 'none'}</span></td>
            <td className={ui.tableCell}>{new Date(u.created_at).toLocaleDateString()}</td>
            <td className={ui.tableCell}>
                <div className="flex gap-1.5">
                    {showActions && (
                        <>
                            <button className={cx(ui.button.success, ui.button.sm)} onClick={() => verifyUser(u.id, 'approve')} title="Approve">✅ Approve</button>
                            <button className={cx(ui.button.danger, ui.button.sm)} onClick={() => { setRejectTarget(u.id); setShowRejectModal('user'); }} title="Reject">❌ Reject</button>
                        </>
                    )}
                    <button className={cx(ui.button.ghost, ui.button.sm)} onClick={() => handleViewUser(u)} title="View details"><FiEye /></button>
                </div>
            </td>
        </tr>
    );

    // ===== VEHICLE ROW COMPONENT =====
    const VehicleRow = ({ v, showActions = false }) => (
        <tr key={v.id} className={showActions ? 'bg-orange-500/5' : ''}>
            <td>
                <div className="flex items-center gap-2.5">
                    <div className="w-12 h-9 rounded-[var(--radius-sm)] bg-[var(--neutral-100)] flex items-center justify-center text-[20px] overflow-hidden shrink-0">
                        {v.thumbnail_url || v.images?.[0] ? (
                            <img src={v.thumbnail_url || v.images[0]} alt="" className="w-full h-full object-cover" />
                        ) : '🚗'}
                    </div>
                    <div>
                        <div className="font-semibold text-sm">{v.year} {v.make} {v.model}</div>
                        <div className="text-[12px] text-[var(--text-tertiary)]">{v.plate_number} • {v.color} • {v.body_type}</div>
                    </div>
                </div>
            </td>
            <td className="text-[14px]">{v.profiles?.full_name || '—'}</td>
            <td className="font-bold font-[var(--font-display)]">
                {v.pricing_type === 'fixed' ? (
                    <div className="leading-[1.2]">
                        <div>₱{v.fixed_price?.toLocaleString()}</div>
                        <div className="text-[11px] text-[var(--text-tertiary)] font-semibold">Fixed • {v.fixed_rental_days}d</div>
                    </div>
                ) : (
                    <div className="leading-[1.2]">
                        <div>₱{v.daily_rate?.toLocaleString()}</div>
                        <div className="text-[11px] text-[var(--text-tertiary)] font-semibold">/day</div>
                    </div>
                )}
            </td>
            {!showActions && (
                <td>
                    <span className={badgeClass(v.status === 'approved' || v.status === 'listed' ? 'success' : v.status === 'rejected' ? 'error' : 'info')}>
                        {v.status}
                    </span>
                </td>
            )}
            {showActions && <td />}
            <td>
                <div className="flex gap-1.5">
                    {showActions && (
                        <>
                            <button className={cx(ui.button.success, ui.button.sm)} onClick={() => approveVehicle(v.id, 'approve')}>✅ Approve</button>
                            <button className={cx(ui.button.danger, ui.button.sm)} onClick={() => { setRejectTarget(v.id); setShowRejectModal('vehicle'); }}>❌ Reject</button>
                        </>
                    )}
                    <button className={cx(ui.button.ghost, ui.button.sm)} onClick={() => setSelectedVehicle(v)} title="View all details"><FiEye /></button>
                </div>
            </td>
        </tr>
    );

    return (
        <div>
            <BackButton to="/admin" label="Back to Admin" />

            <div className="mb-6 space-y-2">
                <h1>🛡️ Admin Panel</h1>
                <p>SAFEDRIVE Platform Administration</p>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3 mb-7">
                {[
                    { icon: <FiAlertCircle />, label: 'Pending Users', value: pendingUsers.length, color: 'text-[#f59e0b]', bg: 'bg-[#fffbeb]' },
                    { icon: <FiClock />, label: 'Pending Vehicles', value: pendingVehicles.length, color: 'text-[#f97316]', bg: 'bg-[#fff7ed]' },
                    { icon: <FiUsers />, label: 'Total Users', value: users.length, color: 'text-[#3b82f6]', bg: 'bg-[#eff6ff]' },
                    { icon: <FiTruck />, label: 'Total Vehicles', value: vehicles.length, color: 'text-[#22c55e]', bg: 'bg-[#f0fdf4]' },
                ].map((s, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-3xl border border-border-light bg-surface-primary px-4 py-4 shadow-soft">
                        <div className={`w-10 h-10 rounded-[var(--radius-md)] flex items-center justify-center text-[18px] ${s.bg} ${s.color}`}>{s.icon}</div>
                        <div>
                            <div className={`text-[22px] font-extrabold font-[var(--font-display)] ${s.color}`}>{s.value}</div>
                            <div className="text-[12px] text-[var(--text-tertiary)]">{s.label}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Tabs */}
            <div className="mb-6 flex max-w-[760px] flex-wrap gap-2 rounded-[28px] border border-border-light bg-surface-primary p-2 shadow-soft">
                {[
                    { id: 'users', icon: <FiUsers />, label: 'Users', count: pendingUsers.length },
                    { id: 'vehicles', icon: <FiTruck />, label: 'Vehicles', count: pendingVehicles.length },
                    { id: 'bookings', icon: <FiCalendar />, label: 'Bookings' },
                    { id: 'catalog', icon: null, label: '🚘 Car Catalog' },
                    { id: 'audit', icon: <FiActivity />, label: 'Audit Trail' },
                ].map(tab => (
                    <button key={tab.id} className={cx('inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition', activeTab === tab.id ? 'bg-primary-700 text-white shadow-soft' : 'text-text-secondary hover:bg-primary-50 hover:text-text-primary')} onClick={() => setActiveTab(tab.id)}>
                        {tab.icon && <span className="mr-1.5">{tab.icon}</span>}
                        {tab.label}
                        {tab.count > 0 && (
                            <span className="ml-1.5 bg-[var(--error-500)] text-white rounded-full w-5 h-5 inline-flex items-center justify-center text-[11px] font-bold">
                                {tab.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Search */}
            {activeTab !== 'catalog' && (
                <div className="relative mb-5 max-w-[400px]">
                    <FiSearch className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
                    <input className={ui.input} placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
            )}

            {loading ? (
                <div className={ui.loadingScreen}><div className={ui.spinner} /></div>
            ) : (
                <>
                    {/* ========== USERS TAB ========== */}
                    {activeTab === 'users' && (
                        <div>
                            {/* UNIFIED ALL USERS TABLE */}
                            <div className={ui.section}>
                                <div className={ui.sectionHeader}>
                                    <h2 className="text-[16px] font-bold">
                                        👥 All Users ({users.length})
                                        {pendingUsers.length > 0 && (
                                            <span className="ml-2.5 bg-[var(--warning-500)] text-white rounded-[20px] p-[2px_10px] text-[12px] font-bold">
                                                {pendingUsers.length} pending review
                                            </span>
                                        )}
                                    </h2>
                                </div>
                                <div className={ui.tableWrap}>
                                    <table className={ui.table}>
                                        <thead>
                                            <tr>
                                                <th>User</th><th>Role</th><th>Status</th><th>Joined</th><th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {searchFilter(allUsers, ['full_name', 'email']).length === 0 ? (
                                                <tr><td colSpan={5} className="text-center p-8 text-[var(--text-tertiary)]">No users found</td></tr>
                                            ) : searchFilter(allUsers, ['full_name', 'email']).map(u => (
                                                <UserRow key={u.id} u={u} showActions={u.verification_status === 'submitted'} />
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ========== VEHICLES TAB ========== */}
                    {activeTab === 'vehicles' && (
                        <div>
                            {/* PENDING APPROVAL SECTION */}
                            {pendingVehicles.length > 0 && (
                                <div className="overflow-hidden rounded-3xl border border-accent-200 bg-surface-primary shadow-soft">
                                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-accent-200 bg-accent-50 px-5 py-4 sm:px-6">
                                        <h2 className="text-[16px] font-bold flex items-center gap-2">
                                            🔍 Pending Approval ({pendingVehicles.length})
                                        </h2>
                                        <span className="text-[12px] text-[var(--text-tertiary)]">New vehicle listings — review and approve/reject</span>
                                    </div>
                                    <div className={ui.tableWrap}>
                                        <table className={ui.table}>
                                            <thead>
                                                <tr>
                                                    <th>Vehicle</th><th>Owner</th><th>Price</th><th>Status</th><th>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {searchFilter(pendingVehicles, ['make', 'model', 'plate_number']).map(v => (
                                                    <VehicleRow key={v.id} v={v} showActions={true} />
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* ALL VEHICLES SECTION */}
                            <div className={ui.section}>
                                <div className={ui.sectionHeader}>
                                    <h2 className="text-[16px] font-bold">
                                        🚗 All Vehicles ({allVehicles.length})
                                    </h2>
                                </div>
                                <div className={ui.tableWrap}>
                                    <table className={ui.table}>
                                        <thead>
                                            <tr>
                                                <th>Vehicle</th><th>Owner</th><th>Price</th><th>Status</th><th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {searchFilter(allVehicles, ['make', 'model', 'plate_number']).length === 0 ? (
                                            <tr><td colSpan={5} className="text-center p-8 text-[var(--text-tertiary)]">No vehicles found</td></tr>
                                            ) : searchFilter(allVehicles, ['make', 'model', 'plate_number']).map(v => (
                                                <VehicleRow key={v.id} v={v} />
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ========== BOOKINGS TAB ========== */}
                    {activeTab === 'bookings' && (
                        <div className={ui.section}>
                            <div className={ui.sectionHeader}>
                                <h2 className="text-[16px] font-bold">📅 All Bookings ({bookings.length})</h2>
                            </div>
                            <div className={ui.tableWrap}>
                                <table className={ui.table}>
                                    <thead>
                                        <tr><th>Vehicle</th><th>Rentee</th><th>Dates</th><th>Amount</th><th>Status</th></tr>
                                    </thead>
                                    <tbody>
                                            {searchFilter(bookings, ['vehicles.make', 'profiles.full_name']).length === 0 ? (
                                            <tr><td colSpan={5} className="text-center p-8 text-[var(--text-tertiary)]">No bookings found</td></tr>
                                        ) : searchFilter(bookings, ['vehicles.make', 'profiles.full_name']).map(b => (
                                            <tr key={b.id}>
                                                <td className="font-semibold">{b.vehicles?.year} {b.vehicles?.make} {b.vehicles?.model}</td>
                                                <td>{b.profiles?.full_name}</td>
                                                <td className="text-[13px] text-[var(--text-secondary)]">
                                                    {new Date(b.start_date).toLocaleDateString()} → {new Date(b.end_date).toLocaleDateString()}
                                                </td>
                                                <td className="font-bold font-[var(--font-display)]">₱{b.total_amount?.toLocaleString()}</td>
                                                <td>
                                                    <span className={bookingStatusClass(b.status)}>
                                                        {b.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                    {/* ========== AUDIT TRAIL TAB ========== */}
                    {activeTab === 'audit' && (
                        <div className={ui.section}>
                            <div className={ui.sectionHeader}>
                                <h2 className="text-[16px] font-bold">🕵️ Audit Trail ({auditLogs.length})</h2>
                                <span className="text-[12px] text-[var(--text-tertiary)]">All admin actions — who did what and when</span>
                            </div>
                            <div className={ui.tableWrap}>
                                <table className={ui.table}>
                                    <thead>
                                        <tr>
                                            <th>Timestamp</th>
                                            <th>Admin</th>
                                            <th>Action</th>
                                            <th>Entity</th>
                                            <th>Description</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {auditLogs.length === 0 ? (
                                            <tr><td colSpan={5} className="text-center p-8 text-[var(--text-tertiary)]">No audit logs yet. Admin actions will appear here.</td></tr>
                                        ) : auditLogs.map(log => {
                                            let auditBadgeVariant = 'info';
                                            if (log.action?.includes('APPROVE') || log.action?.includes('VERIFY')) auditBadgeVariant = 'success';
                                            if (log.action?.includes('REJECT') || log.action?.includes('DELETE')) auditBadgeVariant = 'error';

                                            return (
                                                <tr key={log.id}>
                                                    <td className="text-[12px] text-[var(--text-secondary)] whitespace-nowrap">
                                                        {new Date(log.created_at).toLocaleString()}
                                                    </td>
                                                    <td>
                                                        <div className="font-semibold text-[13px]">{log.performer_name || '—'}</div>
                                                        <div className="text-[11px] text-[var(--text-tertiary)]">{log.performer_email || ''}</div>
                                                    </td>
                                                    <td>
                                                        <span className={cx(badgeClass(auditBadgeVariant), 'text-[11px]')}>{log.action}</span>
                                                    </td>
                                                    <td className="text-[13px]">
                                                        <span className={cx(badgeClass('neutral'), 'text-[11px]')}>{log.entity_type}</span>
                                                    </td>
                                                    <td className="text-[13px] text-[var(--text-secondary)] max-w-[280px]">{log.description}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ========== CAR CATALOG TAB ========== */}
            {activeTab === 'catalog' && (
                <div className="grid grid-cols-[1fr_1.5fr] gap-6">
                    {/* Brands Column */}
                    <div className={ui.section}>
                        <div className={ui.sectionHeader}><h2 className="text-[16px] font-bold">🏭 Brands ({carBrands.length})</h2></div>
                        <div className={ui.sectionBody}>
                            <div className="flex gap-2 mb-4">
                                <input className={cx(ui.input, 'flex-1')} placeholder="New brand name" value={newBrandName} onChange={(e) => setNewBrandName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addBrand()} />
                                <button className={cx(ui.button.accent, ui.button.sm)} onClick={addBrand}><FiPlus /> Add</button>
                            </div>
                            {catalogLoading ? (
                                <div className="text-center p-6"><div className={cx(ui.spinner, 'mx-auto')} /></div>
                            ) : carBrands.length === 0 ? (
                                <div className="text-center p-6 text-[var(--text-tertiary)]">No brands yet</div>
                            ) : (
                                <div className="max-h-[450px] overflow-y-auto">
                                    {carBrands.map(brand => (
                                        <div key={brand.id} onClick={() => setSelectedBrandId(brand.id === selectedBrandId ? '' : brand.id)} className={`
                                            flex justify-between items-center p-[10px_12px] rounded-[var(--radius-md)] mb-1 cursor-pointer transition-colors
                                            ${selectedBrandId === brand.id ? 'bg-[var(--primary-50)] border border-[var(--primary-200)]' : 'bg-transparent border border-transparent'}
                                        `}>
                                            <div className="flex items-center gap-2">
                                                <span className={`font-semibold text-[14px] ${brand.is_active ? 'opacity-100' : 'opacity-50'}`}>{brand.name}</span>
                                                {!brand.is_active && <span className={cx(badgeClass('neutral'), 'text-[10px]')}>Inactive</span>}
                                                <span className="text-[11px] text-[var(--text-tertiary)]">({carModels.filter(m => m.brand_id === brand.id).length})</span>
                                            </div>
                                            <div className="flex">
                                                <button className={cx(ui.button.ghost, ui.button.sm, 'p-1')} onClick={(e) => { e.stopPropagation(); toggleBrandActive(brand.id, brand.is_active); }}>
                                                    {brand.is_active ? <FiToggleRight size={18} className="text-[var(--success-500)]" /> : <FiToggleLeft size={18} className="text-[var(--neutral-400)]" />}
                                                </button>
                                                <button className={cx(ui.button.ghost, ui.button.sm, 'p-1 text-error-600')} onClick={(e) => { e.stopPropagation(); deleteBrand(brand.id, brand.name); }} title="Delete brand">
                                                    <FiTrash2 size={15} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Models Column */}
                    <div className={ui.section}>
                        <div className={ui.sectionHeader}><h2 className="text-[16px] font-bold">🚗 Models {selectedBrandId && `— ${carBrands.find(b => b.id === selectedBrandId)?.name || ''}`} ({filteredCatalogModels.length})</h2></div>
                        <div className={ui.sectionBody}>
                            <div className="flex gap-2 mb-4 flex-wrap">
                                <select className={cx(ui.select, 'w-[180px]')} value={selectedBrandId} onChange={(e) => setSelectedBrandId(e.target.value)}>
                                    <option value="">All Brands</option>
                                    {carBrands.filter(b => b.is_active).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                </select>
                                <input className={cx(ui.input, 'min-w-[120px] flex-1')} placeholder="New model" value={newModelName} onChange={(e) => setNewModelName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addModel()} />
                                <select className={cx(ui.select, 'w-[130px]')} value={newModelBodyType} onChange={(e) => setNewModelBodyType(e.target.value)}>
                                    {['Sedan', 'SUV', 'MPV', 'Van', 'Hatchback', 'Pickup', 'Crossover', 'Coupe'].map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                                <button className={cx(ui.button.accent, ui.button.sm)} onClick={addModel} disabled={!selectedBrandId}><FiPlus /> Add</button>
                            </div>
                            {catalogLoading ? (
                                <div className="text-center p-6"><div className={cx(ui.spinner, 'mx-auto')} /></div>
                            ) : filteredCatalogModels.length === 0 ? (
                                <div className="text-center p-6 text-[var(--text-tertiary)]">{selectedBrandId ? 'No models for this brand yet.' : 'Select a brand or view all.'}</div>
                            ) : (
                                <div className={ui.tableWrap}>
                                    <table className={ui.table}>
                                        <thead><tr><th>Model</th><th>Brand</th><th>Body Type</th><th>Status</th><th></th></tr></thead>
                                        <tbody>
                                            {filteredCatalogModels.map(m => (
                                                <tr key={m.id}>
                                                    <td className="font-semibold">{m.name}</td>
                                                    <td className="text-[var(--text-secondary)]">{m.car_brands?.name || '—'}</td>
                                                    <td><span className={badgeClass('info')}>{m.body_type}</span></td>
                                                    <td><span className={badgeClass(m.is_active ? 'success' : 'neutral')}>{m.is_active ? 'Active' : 'Inactive'}</span></td>
                                                    <td>
                                                        <div className="flex gap-1">
                                                            <button className={cx(ui.button.ghost, ui.button.sm, 'p-1')} onClick={() => toggleModelActive(m.id, m.is_active)}>
                                                                {m.is_active ? <FiToggleRight size={16} className="text-[var(--success-500)]" /> : <FiToggleLeft size={16} className="text-[var(--neutral-400)]" />}
                                                            </button>
                                                            <button className={cx(ui.button.ghost, ui.button.sm, 'p-1 text-error-600')} onClick={() => deleteModel(m.id, m.name)} title="Delete model">
                                                                <FiTrash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ========== USER DETAIL MODAL ========== */}
            {selectedUser && (
                <div className={ui.modalOverlay} onClick={() => setSelectedUser(null)}>
                    <div className={cx(ui.modalPanel, 'max-w-[700px]')} onClick={(e) => e.stopPropagation()}>
                        <div className={ui.sectionHeader}>
                            <h2>User Details</h2>
                            <button className={cx(ui.button.ghost, ui.button.sm)} onClick={() => setSelectedUser(null)}>✕</button>
                        </div>
                        <div className={ui.sectionBody}>
                            {/* User Info */}
                            <div className="flex items-center gap-4 mb-6">
                                <div className="w-16 h-16 rounded-full bg-[var(--primary-600)] flex items-center justify-center text-white text-[24px] font-bold">
                                    {selectedUser.full_name?.[0] || 'U'}
                                </div>
                                <div>
                                    <h3 className="text-[18px] font-bold">{selectedUser.full_name}</h3>
                                    <p className="text-[var(--text-secondary)] text-[14px]">{selectedUser.email}</p>
                                    <div className="flex gap-2 mt-1">
                                        <span className={badgeClass(getRoleBadgeClass(selectedUser.role))}>{selectedUser.role === 'user' ? 'Not Verified' : selectedUser.role}</span>
                                        <span className={badgeClass(getStatusBadge(selectedUser.verification_status))}>{selectedUser.verification_status || 'none'}</span>
                                    </div>
                                </div>
                            </div>

                            {/* User Details Grid */}
                             <div className="grid grid-cols-2 gap-3 mb-6">
                                 {[
                                     { label: 'Phone', value: selectedUser.phone || 'N/A' },
                                     { label: 'City', value: selectedUser.city || 'N/A' },
                                     { label: 'Province', value: selectedUser.province || 'N/A' },
                                     { label: 'Date of Birth', value: selectedUser.date_of_birth ? new Date(selectedUser.date_of_birth).toLocaleDateString() : 'N/A' },
                                     { label: "Driver's License #", value: selectedUser.drivers_license_number || 'Not submitted' },
                                     { label: 'National / UMID ID #', value: selectedUser.national_id_number || 'Not submitted' },
                                 ].map((item, i) => (
                                     <div key={i} className="p-3 bg-[var(--neutral-50)] rounded-[var(--radius-md)]">
                                         <div className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase">{item.label}</div>
                                         <div className="text-[14px] font-semibold mt-1">{item.value}</div>
                                     </div>
                                 ))}
                             </div>

                            {/* Submitted Documents */}
                            <div className="mb-6">
                                <h3 className="text-[15px] font-bold mb-3 flex items-center gap-2">
                                    <FiImage /> Submitted ID Documents
                                </h3>
                                {docsLoading ? (
                                    <div className="text-center p-6"><div className={cx(ui.spinner, 'mx-auto mb-2')} /><p className="text-[13px] text-[var(--text-tertiary)]">Loading...</p></div>
                                ) : userDocs.length === 0 ? (
                                    <div className="p-6 text-center bg-[var(--neutral-50)] rounded-[var(--radius-md)] text-[var(--text-tertiary)]">No documents uploaded yet</div>
                                ) : (
                                    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                                        {userDocs.map((doc, i) => (
                                            <div key={i} className="border border-[var(--border-light)] rounded-[var(--radius-md)] overflow-hidden bg-[var(--surface-secondary)]">
                                                {doc.url ? (
                                                    <a href={doc.url} target="_blank" rel="noopener noreferrer">
                                                        <img src={doc.url} alt={doc.name} className="w-full h-[150px] object-cover block"
                                                            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.classList.remove('hidden'); e.target.nextSibling.classList.add('flex'); }} />
                                                        <div className="hidden h-[150px] items-center justify-center text-[12px] text-[var(--text-tertiary)] p-2 text-center">
                                                            🖼️ Click to view
                                                        </div>
                                                    </a>
                                                ) : null}
                                                <div className="p-[8px_12px] text-[12px]">
                                                    <div className="font-semibold break-all">{doc.name}</div>
                                                    <div className="text-[var(--text-tertiary)]">{doc.bucket === 'selfies' ? '📸 Selfie' : '🪪 ID Document'}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Role Management — only user <-> verified, no admin promotion */}
                            <div className="mb-4">
                                <h3 className="text-[15px] font-bold mb-3 flex items-center gap-2"><FiShield /> Role Management</h3>
                                <p className="text-[12px] text-[var(--text-tertiary)] mb-2.5">Admin accounts are created separately and cannot be assigned through this panel.</p>
                                <div className="flex gap-2 flex-wrap">
                                    {['user', 'verified'].map(role => (
                                        <button key={role} className={cx(selectedUser.role === role ? ui.button.primary : ui.button.secondary, ui.button.sm, 'capitalize')} onClick={() => selectedUser.role !== role && changeRole(selectedUser.id, role)} disabled={selectedUser.role === role || selectedUser.id === user.id || selectedUser.role === 'admin'}>
                                            {selectedUser.role === role ? `✓ ${role === 'user' ? 'Not Verified' : 'Verified'}` : (role === 'user' ? 'Set Not Verified' : 'Set Verified')}
                                        </button>
                                    ))}
                                    {selectedUser.role === 'admin' && <span className={cx(badgeClass('error'), 'px-3 py-2')}>Admin — role cannot be changed here</span>}
                                </div>
                                {selectedUser.id === user.id && <p className="text-[12px] text-[var(--text-tertiary)] mt-2">⚠️ You cannot change your own role</p>}
                            </div>

                            {/* User's Vehicles */}
                            <div className="mb-4">
                                <h3 className="text-[15px] font-bold mb-3 flex items-center gap-2"><FiTruck /> Listed Vehicles ({userVehicles.length})</h3>
                                {userDetailLoading ? <div className="text-center p-4"><div className={cx(ui.spinner, 'mx-auto')} /></div>
                                    : userVehicles.length === 0 ? <p className="text-[13px] text-[var(--text-tertiary)] p-[8px_0]">No vehicles listed</p>
                                        : (
                                            <div className="flex flex-col gap-2">
                                                {userVehicles.map(v => (
                                                    <div key={v.id} className="flex justify-between items-center p-[10px_12px] bg-[var(--neutral-50)] rounded-[8px]">
                                                        <div>
                                                            <div className="font-semibold text-[13px]">{v.year} {v.make} {v.model}</div>
                                                            <div className="text-[12px] text-[var(--text-tertiary)]">{v.plate_number} • ₱{v.daily_rate?.toLocaleString()}/day</div>
                                                        </div>
                                                        <span className={badgeClass(v.status === 'approved' ? 'success' : v.status === 'pending' ? 'pending' : 'error')}>{v.status}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                            </div>

                            {/* User's Bookings */}
                            <div className="mb-2">
                                <h3 className="text-[15px] font-bold mb-3 flex items-center gap-2"><FiCalendar /> Booking History ({userBookings.length})</h3>
                                {userDetailLoading ? <div className="text-center p-4"><div className={cx(ui.spinner, 'mx-auto')} /></div>
                                    : userBookings.length === 0 ? <p className="text-[13px] text-[var(--text-tertiary)] p-[8px_0]">No bookings yet</p>
                                        : (
                                            <div className="flex flex-col gap-2">
                                                {userBookings.slice(0, 5).map(b => (
                                                    <div key={b.id} className="flex justify-between items-center p-[10px_12px] bg-[var(--neutral-50)] rounded-[8px]">
                                                        <div>
                                                            <div className="font-semibold text-[13px]">{b.vehicles?.year} {b.vehicles?.make} {b.vehicles?.model}</div>
                                                            <div className="text-[12px] text-[var(--text-tertiary)]">{new Date(b.start_date).toLocaleDateString()} → {new Date(b.end_date).toLocaleDateString()} • ₱{b.total_amount?.toLocaleString()}</div>
                                                        </div>
                                                        <span className={bookingStatusClass(b.status)}>{b.status}</span>
                                                    </div>
                                                ))}
                                                {userBookings.length > 5 && <p className="text-[12px] text-[var(--text-tertiary)] text-center">+{userBookings.length - 5} more bookings</p>}
                                            </div>
                                        )}
                            </div>

                        </div>

                        {/* Verification Actions in Footer */}
                        {selectedUser.verification_status === 'submitted' && (
                            <div className="flex flex-wrap justify-end gap-3 border-t border-border-light px-5 py-4 sm:px-6">
                                <button className={ui.button.danger} onClick={() => verifyUser(selectedUser.id, 'reject')}><FiX /> Reject</button>
                                <button className={ui.button.success} onClick={() => verifyUser(selectedUser.id, 'approve')}><FiCheck /> Verify User</button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ========== VEHICLE DETAIL MODAL ========== */}
            {selectedVehicle && (
                <div className={ui.modalOverlay} onClick={() => setSelectedVehicle(null)}>
                    <div className={cx(ui.modalPanel, 'max-w-[720px]')} onClick={(e) => e.stopPropagation()}>
                        <div className={ui.sectionHeader}>
                            <h2>🚗 {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}</h2>
                            <button className={cx(ui.button.ghost, ui.button.sm)} onClick={() => setSelectedVehicle(null)}>✕</button>
                        </div>
                        <div className={ui.sectionBody}>
                            {/* Owner */}
                            <div className="flex justify-between items-center mb-5 p-[10px_14px] bg-[var(--neutral-50)] rounded-[var(--radius-md)]">
                                <div>
                                    <div className="text-[11px] font-bold text-[var(--text-tertiary)] uppercase">Owner</div>
                                    <div className="font-bold text-[15px]">{selectedVehicle.profiles?.full_name || '—'}</div>
                                </div>
                                <span className={cx(badgeClass(selectedVehicle.status === 'approved' ? 'success' : selectedVehicle.status === 'rejected' ? 'error' : 'info'), 'px-3.5 py-1.5 text-[13px]')}>
                                    {selectedVehicle.status?.toUpperCase()}
                                </span>
                            </div>

                            {/* Photos */}
                            {selectedVehicle.images?.length > 0 && (
                                <div className="mb-5">
                                    <div className="text-[12px] font-bold text-[var(--text-tertiary)] uppercase mb-2">Photos</div>
                                    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
                                        {selectedVehicle.images.map((url, i) => (
                                            <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                                                <img src={url} alt={`Photo ${i + 1}`} className="w-full aspect-[4/3] object-cover rounded-[var(--radius-md)]" />
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Vehicle Details Grid */}
                            <div className="text-[12px] font-bold text-[var(--text-tertiary)] uppercase mb-2.5">Vehicle Details</div>
                            <div className="grid grid-cols-3 gap-2.5 mb-5">
                                {[
                                    { label: 'Brand', value: selectedVehicle.make },
                                    { label: 'Model', value: selectedVehicle.model },
                                    { label: 'Year', value: selectedVehicle.year },
                                    { label: 'Color', value: selectedVehicle.color },
                                    { label: 'Plate Number', value: selectedVehicle.plate_number },
                                    { label: 'Body Type', value: selectedVehicle.body_type },
                                    { label: 'Transmission', value: selectedVehicle.transmission },
                                    { label: 'Fuel Type', value: selectedVehicle.fuel_type },
                                    { label: 'Seating', value: selectedVehicle.seating_capacity ? `${selectedVehicle.seating_capacity} seats` : '—' },
                                    { label: 'Mileage', value: selectedVehicle.mileage ? `${selectedVehicle.mileage?.toLocaleString()} km` : 'Not specified' },
                                    { label: 'Pricing Type', value: selectedVehicle.pricing_type === 'fixed' ? '📌 Fixed' : '🔄 Flexible' },
                                    selectedVehicle.pricing_type === 'fixed'
                                        ? { label: 'Fixed Price', value: selectedVehicle.fixed_price ? `₱${selectedVehicle.fixed_price?.toLocaleString()} for ${selectedVehicle.fixed_rental_days} day(s)` : '—' }
                                        : { label: 'Daily Rate', value: `₱${selectedVehicle.daily_rate?.toLocaleString()}/day` },
                                    { label: 'Security Deposit', value: selectedVehicle.security_deposit ? `₱${selectedVehicle.security_deposit?.toLocaleString()}` : 'None' },
                                ].map((item, i) => (
                                    <div key={i} className="p-[10px_12px] bg-[var(--neutral-50)] rounded-[var(--radius-md)]">
                                        <div className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase">{item.label}</div>
                                        <div className="text-[13px] font-semibold mt-0.5">{item.value || '—'}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Contact Info */}
                            {selectedVehicle.contact_info && (
                                <div className="mb-5">
                                    <div className="text-[12px] font-bold text-[var(--text-tertiary)] uppercase mb-2">Owner Contact Info</div>
                                    <div className="background-[var(--neutral-50)] rounded-[var(--radius-md)] p-[12px_16px] text-[13px]">{selectedVehicle.contact_info}</div>
                                </div>
                            )}

                            {/* Pickup Location */}
                            <div className="text-[12px] font-bold text-[var(--text-tertiary)] uppercase mb-2.5">Pickup Location</div>
                            <div className="grid grid-cols-3 gap-2.5 mb-5">
                                {[
                                    { label: 'Street / Landmark', value: selectedVehicle.pickup_location },
                                    { label: 'City', value: selectedVehicle.pickup_city },
                                    { label: 'Province', value: selectedVehicle.pickup_province },
                                ].map((item, i) => (
                                    <div key={i} className="p-[10px_12px] bg-[var(--neutral-50)] rounded-[var(--radius-md)]">
                                        <div className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase">{item.label}</div>
                                        <div className="text-[13px] font-semibold mt-0.5">{item.value || '—'}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Rental Durations */}
                            {selectedVehicle.available_durations?.length > 0 && (
                                <div className="mb-5">
                                    <div className="text-[12px] font-bold text-[var(--text-tertiary)] uppercase mb-2">Available Rental Durations</div>
                                    <div className="flex gap-2 flex-wrap">
                                        {selectedVehicle.available_durations.map((d, i) => (
                                            <span key={i} className={badgeClass('info')}>{d.replace(/_/g, ' ')}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Features */}
                            {selectedVehicle.features?.length > 0 && (
                                <div className="mb-5">
                                    <div className="text-[12px] font-bold text-[var(--text-tertiary)] uppercase mb-2">Features</div>
                                    <div className="flex gap-2 flex-wrap">
                                        {selectedVehicle.features.map((f, i) => (
                                            <span key={i} className="bg-[var(--success-50)] text-[var(--success-700)] rounded-[20px] p-[4px_10px] text-[12px] font-semibold">{f}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Description */}
                            {selectedVehicle.description && (
                                <div className="mb-5">
                                    <div className="text-[12px] font-bold text-[var(--text-tertiary)] uppercase mb-2">Owner's Description</div>
                                    <div className="bg-[var(--neutral-50)] rounded-[var(--radius-md)] p-[12px_16px] text-[13px] leading-[1.6]">
                                        {selectedVehicle.description}
                                    </div>
                                </div>
                            )}

                            {/* Agreement */}
                            {selectedVehicle.agreement_url && (
                                <div className="mb-5">
                                    <div className="text-[12px] font-bold text-[var(--text-tertiary)] uppercase mb-2">Agreement Document</div>
                                    <a href={selectedVehicle.agreement_url} target="_blank" rel="noopener noreferrer" className={cx(ui.button.secondary, ui.button.sm)}>
                                        📄 View Agreement
                                    </a>
                                </div>
                            )}

                            {/* Owner Verification Info — cross-check with ORCR */}
                            <div className="mb-5 border border-[var(--accent-200)] rounded-[var(--radius-md)] overflow-hidden">
                                <div className="bg-[var(--accent-50)] p-[10px_16px] text-[12px] font-bold text-[var(--accent-700)] uppercase tracking-[0.5px]">
                                    🔍 Owner Verification Info — Cross-check with ORCR
                                </div>
                                <div className="grid grid-cols-2 gap-2 p-3">
                                    {[
                                        { label: 'Full Name', value: selectedVehicle.profiles?.full_name },
                                        { label: 'Phone', value: selectedVehicle.profiles?.phone },
                                        { label: 'Date of Birth', value: selectedVehicle.profiles?.date_of_birth ? new Date(selectedVehicle.profiles.date_of_birth).toLocaleDateString() : null },
                                        { label: "Driver's License #", value: selectedVehicle.profiles?.drivers_license_number },
                                        { label: 'National / UMID ID #', value: selectedVehicle.profiles?.national_id_number },
                                        { label: 'Verification Status', value: selectedVehicle.profiles?.verification_status },
                                        { label: 'City', value: selectedVehicle.profiles?.city },
                                        { label: 'Province', value: selectedVehicle.profiles?.province },
                                    ].map((item, i) => (
                                        <div key={i} className="p-[8px_10px] bg-[var(--surface-secondary)] rounded-[var(--radius-sm)] border border-[var(--border-light)]">
                                            <div className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase">{item.label}</div>
                                            <div className={`text-[13px] font-semibold mt-0.5 ${item.value ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}>{item.value || 'N/A'}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* ORCR Document (Admin Only) */}
                            {selectedVehicle.orcr_url && (
                                <div className="mb-5">
                                    <div className="text-[12px] font-bold text-[var(--text-tertiary)] uppercase mb-2">🪪 ORCR Document (Admin Only)</div>
                                    <a href={selectedVehicle.orcr_url} target="_blank" rel="noopener noreferrer">
                                        <img src={selectedVehicle.orcr_url} alt="ORCR" className="max-w-full rounded-[var(--radius-md)] border border-[var(--border-light)] cursor-zoom-in block"
                                            onError={(e) => { e.target.style.display = 'none'; }} />
                                    </a>
                                    <a href={selectedVehicle.orcr_url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-[var(--primary-600)] mt-1.5 inline-block">
                                        Open full image ↗
                                    </a>
                                </div>
                            )}
                        </div>
                        {selectedVehicle.status === 'pending' && (
                            <div className="flex flex-wrap justify-end gap-3 border-t border-border-light px-5 py-4 sm:px-6">
                                <button className={ui.button.danger} onClick={() => { setRejectTarget(selectedVehicle.id); setShowRejectModal('vehicle'); setSelectedVehicle(null); }}><FiX /> Reject</button>
                                <button className={ui.button.success} onClick={() => approveVehicle(selectedVehicle.id, 'approve')}><FiCheck /> Approve Listing</button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ========== REJECTION REASON MODAL ========== */}
            {showRejectModal && (
                <div className={ui.modalOverlay} onClick={() => { setShowRejectModal(null); setRejectReason(''); setRejectTarget(null); }}>
                    <div className={cx(ui.modalPanel, 'max-w-[480px]')} onClick={(e) => e.stopPropagation()}>
                        <div className={ui.sectionHeader}>
                            <h2>❌ Reason for Rejection</h2>
                            <button className={cx(ui.button.ghost, ui.button.sm)} onClick={() => { setShowRejectModal(null); setRejectReason(''); setRejectTarget(null); }}>✕</button>
                        </div>
                        <div className={ui.sectionBody}>
                            <p className="text-[14px] text-[var(--text-secondary)] mb-4">
                                Provide a reason for rejecting this {showRejectModal === 'vehicle' ? 'vehicle listing' : 'verification request'}.
                                This message will be sent to the {showRejectModal === 'vehicle' ? 'vehicle owner' : 'user'} as a notification.
                            </p>
                            <textarea
                                className={cx(ui.textarea, 'min-h-[120px]')}
                                placeholder={showRejectModal === 'vehicle'
                                    ? 'e.g. Photos are unclear, plate number doesn\'t match registration, missing required documents...'
                                    : 'e.g. ID photo is blurry, selfie doesn\'t match ID, expired document...'
                                }
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                            />
                            <p className="text-[12px] text-[var(--text-tertiary)] mt-2">You can leave this blank to use a generic rejection message.</p>
                        </div>
                        <div className="flex flex-wrap justify-end gap-3 border-t border-border-light px-5 py-4 sm:px-6">
                            <button className={ui.button.secondary} onClick={() => { setShowRejectModal(null); setRejectReason(''); setRejectTarget(null); }}>Cancel</button>
                            <button className={ui.button.danger} onClick={confirmReject}><FiX /> Confirm Reject</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}



