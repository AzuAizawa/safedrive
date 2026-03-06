import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabaseAdmin } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { FiUsers, FiTruck, FiCalendar, FiShield, FiCheck, FiX, FiEye, FiSearch, FiImage, FiPlus, FiToggleLeft, FiToggleRight, FiAlertCircle, FiClock, FiTrash2, FiActivity } from 'react-icons/fi';
import toast from 'react-hot-toast';
import BackButton from '../../components/BackButton';
import { logAudit } from '../../lib/auditLogger';

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
    const [userDetailTab, setUserDetailTab] = useState('overview');
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
            try { await supabaseAdmin.from('verification_logs').insert({ user_id: userId, admin_id: user.id, action, verification_type: 'identity', notes: reason || `User ${isApprove ? 'verified' : 'rejected'} by admin` }); } catch (e) { }
            const rejectionNote = reason ? `\n\nAdmin note: ${reason}` : '';
            try { await supabaseAdmin.from('notifications').insert({ user_id: userId, title: isApprove ? 'Identity Verified! ✅' : 'Verification Rejected', message: isApprove ? 'Your identity has been verified. You can now list vehicles and access all SafeDrive features!' : `Your identity verification was not approved. Please resubmit your documents with clearer photos.${rejectionNote}`, type: 'verification' }); } catch (e) { }
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
        } catch (err) { toast.error('Failed to update brand'); }
    };

    const toggleModelActive = async (modelId, current) => {
        try {
            const { error } = await supabaseAdmin.from('car_models').update({ is_active: !current }).eq('id', modelId);
            if (error) throw error;
            toast.success(current ? 'Model deactivated' : 'Model activated');
            fetchCatalog();
        } catch (err) { toast.error('Failed to update model'); }
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
        } catch (err) { toast.error('Failed to delete brand. It may be referenced by vehicles.'); }
    };

    const deleteModel = async (modelId, modelName) => {
        if (!window.confirm(`Delete model "${modelName}"? This cannot be undone.`)) return;
        try {
            const { error } = await supabaseAdmin.from('car_models').delete().eq('id', modelId);
            if (error) throw error;
            toast.success(`"${modelName}" deleted`);
            fetchCatalog();
        } catch (err) { toast.error('Failed to delete model. It may be referenced by vehicles.'); }
    };

    // ===== COMPUTED =====
    const handleViewUser = (u) => {
        setSelectedUser(u);
        setUserDetailTab('overview');
        fetchUserDocs(u.id);
        fetchUserDetails(u);
    };
    const getRoleBadgeClass = (role) => ({ admin: 'badge-error', verified: 'badge-success', user: 'badge-info' }[role] || 'badge-neutral');
    const getStatusBadge = (status) => ({ verified: 'badge-success', submitted: 'badge-pending', rejected: 'badge-error' }[status] || 'badge-neutral');
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
        <tr key={u.id} style={{ background: showActions ? 'var(--warning-50)' : undefined }}>
            <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary-400), var(--accent-400))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                        {u.full_name?.[0] || 'U'}
                    </div>
                    <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{u.full_name || 'N/A'}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{u.email}</div>
                    </div>
                </div>
            </td>
            <td><span className={`badge ${getRoleBadgeClass(u.role)}`}>{u.role === 'user' ? 'Not Verified' : u.role}</span></td>
            <td><span className={`badge ${getStatusBadge(u.verification_status)}`}>{u.verification_status || 'none'}</span></td>
            <td style={{ fontSize: 13 }}>{new Date(u.created_at).toLocaleDateString()}</td>
            <td>
                <div style={{ display: 'flex', gap: 6 }}>
                    {showActions && (
                        <>
                            <button className="btn btn-success btn-sm" onClick={() => verifyUser(u.id, 'approve')} title="Approve">✅ Approve</button>
                            <button className="btn btn-danger btn-sm" onClick={() => { setRejectTarget(u.id); setShowRejectModal('user'); }} title="Reject">❌ Reject</button>
                        </>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => handleViewUser(u)} title="View details"><FiEye /></button>
                </div>
            </td>
        </tr>
    );

    // ===== VEHICLE ROW COMPONENT =====
    const VehicleRow = ({ v, showActions = false }) => (
        <tr key={v.id} style={{ background: showActions ? 'rgba(251,146,60,0.06)' : undefined }}>
            <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 48, height: 36, borderRadius: 'var(--radius-sm)', background: 'var(--neutral-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, overflow: 'hidden', flexShrink: 0 }}>
                        {v.thumbnail_url || v.images?.[0] ? (
                            <img src={v.thumbnail_url || v.images[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : '🚗'}
                    </div>
                    <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{v.year} {v.make} {v.model}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{v.plate_number} • {v.color} • {v.body_type}</div>
                    </div>
                </div>
            </td>
            <td style={{ fontSize: 14 }}>{v.profiles?.full_name || '—'}</td>
            <td style={{ fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                {v.pricing_type === 'fixed' ? (
                    <div style={{ lineHeight: 1.2 }}>
                        <div>₱{v.fixed_price?.toLocaleString()}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>Fixed • {v.fixed_rental_days}d</div>
                    </div>
                ) : (
                    <div style={{ lineHeight: 1.2 }}>
                        <div>₱{v.daily_rate?.toLocaleString()}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>/day</div>
                    </div>
                )}
            </td>
            {!showActions && (
                <td>
                    <span className={`badge ${v.status === 'approved' || v.status === 'listed' ? 'badge-success' : v.status === 'rejected' ? 'badge-error' : 'badge-info'}`}>
                        {v.status}
                    </span>
                </td>
            )}
            {showActions && <td />}
            <td>
                <div style={{ display: 'flex', gap: 6 }}>
                    {showActions && (
                        <>
                            <button className="btn btn-success btn-sm" onClick={() => approveVehicle(v.id, 'approve')}>✅ Approve</button>
                            <button className="btn btn-danger btn-sm" onClick={() => { setRejectTarget(v.id); setShowRejectModal('vehicle'); }}>❌ Reject</button>
                        </>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => setSelectedVehicle(v)} title="View all details"><FiEye /></button>
                </div>
            </td>
        </tr>
    );

    return (
        <div>
            <BackButton to="/dashboard" label="Back to Dashboard" />

            <div className="page-header">
                <h1>🛡️ Admin Panel</h1>
                <p>SAFEDRIVE Platform Administration</p>
            </div>

            {/* Summary Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 28 }}>
                {[
                    { icon: <FiAlertCircle />, label: 'Pending Users', value: pendingUsers.length, color: 'var(--warning-500)', bg: 'var(--warning-50)' },
                    { icon: <FiClock />, label: 'Pending Vehicles', value: pendingVehicles.length, color: 'var(--accent-500)', bg: 'var(--accent-50)' },
                    { icon: <FiUsers />, label: 'Total Users', value: users.length, color: 'var(--primary-500)', bg: 'var(--primary-50)' },
                    { icon: <FiTruck />, label: 'Total Vehicles', value: vehicles.length, color: 'var(--success-500)', bg: 'var(--success-50)' },
                ].map((s, i) => (
                    <div key={i} className="card card-body" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
                        <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: s.color, fontSize: 18 }}>{s.icon}</div>
                        <div>
                            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-display)', color: s.color }}>{s.value}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{s.label}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Tabs */}
            <div className="tabs" style={{ maxWidth: 650, marginBottom: 24 }}>
                {[
                    { id: 'users', icon: <FiUsers />, label: 'Users', count: pendingUsers.length },
                    { id: 'vehicles', icon: <FiTruck />, label: 'Vehicles', count: pendingVehicles.length },
                    { id: 'bookings', icon: <FiCalendar />, label: 'Bookings' },
                    { id: 'catalog', icon: null, label: '🚘 Car Catalog' },
                    { id: 'audit', icon: <FiActivity />, label: 'Audit Trail' },
                ].map(tab => (
                    <button key={tab.id} className={`tab ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>
                        {tab.icon && <span style={{ marginRight: 6 }}>{tab.icon}</span>}
                        {tab.label}
                        {tab.count > 0 && (
                            <span style={{ marginLeft: 6, background: 'var(--error-500)', color: '#fff', borderRadius: '50%', width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                                {tab.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Search */}
            {activeTab !== 'catalog' && (
                <div className="search-input-wrapper" style={{ marginBottom: 20, maxWidth: 400 }}>
                    <FiSearch className="search-icon" />
                    <input className="form-input" placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
            )}

            {loading ? (
                <div className="loading-spinner"><div className="spinner" /></div>
            ) : (
                <>
                    {/* ========== USERS TAB ========== */}
                    {activeTab === 'users' && (
                        <div>
                            {/* UNIFIED ALL USERS TABLE */}
                            <div className="card">
                                <div className="card-header">
                                    <h2 style={{ fontSize: 16, fontWeight: 700 }}>
                                        👥 All Users ({users.length})
                                        {pendingUsers.length > 0 && (
                                            <span style={{ marginLeft: 10, background: 'var(--warning-500)', color: '#fff', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>
                                                {pendingUsers.length} pending review
                                            </span>
                                        )}
                                    </h2>
                                </div>
                                <div className="table-container">
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>User</th><th>Role</th><th>Status</th><th>Joined</th><th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {searchFilter(allUsers, ['full_name', 'email']).length === 0 ? (
                                                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>No users found</td></tr>
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
                                <div className="card" style={{ marginBottom: 24, borderLeft: '4px solid var(--accent-500)' }}>
                                    <div className="card-header" style={{ background: 'var(--accent-50)' }}>
                                        <h2 style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                                            🔍 Pending Approval ({pendingVehicles.length})
                                        </h2>
                                        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>New vehicle listings — review and approve/reject</span>
                                    </div>
                                    <div className="table-container">
                                        <table className="table">
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
                            <div className="card">
                                <div className="card-header">
                                    <h2 style={{ fontSize: 16, fontWeight: 700 }}>
                                        🚗 All Vehicles ({allVehicles.length})
                                    </h2>
                                </div>
                                <div className="table-container">
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>Vehicle</th><th>Owner</th><th>Price</th><th>Status</th><th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {searchFilter(allVehicles, ['make', 'model', 'plate_number']).length === 0 ? (
                                                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>No vehicles found</td></tr>
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
                        <div className="card">
                            <div className="card-header">
                                <h2 style={{ fontSize: 16, fontWeight: 700 }}>📅 All Bookings ({bookings.length})</h2>
                            </div>
                            <div className="table-container">
                                <table className="table">
                                    <thead>
                                        <tr><th>Vehicle</th><th>Rentee</th><th>Dates</th><th>Amount</th><th>Status</th></tr>
                                    </thead>
                                    <tbody>
                                        {searchFilter(bookings, ['vehicles.make', 'profiles.full_name']).length === 0 ? (
                                            <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>No bookings found</td></tr>
                                        ) : searchFilter(bookings, ['vehicles.make', 'profiles.full_name']).map(b => (
                                            <tr key={b.id}>
                                                <td style={{ fontWeight: 600 }}>{b.vehicles?.year} {b.vehicles?.make} {b.vehicles?.model}</td>
                                                <td>{b.profiles?.full_name}</td>
                                                <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                                    {new Date(b.start_date).toLocaleDateString()} → {new Date(b.end_date).toLocaleDateString()}
                                                </td>
                                                <td style={{ fontWeight: 700, fontFamily: 'var(--font-display)' }}>₱{b.total_amount?.toLocaleString()}</td>
                                                <td>
                                                    <span className={`badge badge-${b.status === 'completed' || b.status === 'confirmed' ? 'success' : b.status === 'pending' ? 'pending' : b.status === 'cancelled' ? 'error' : 'info'}`}>
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
                        <div className="card">
                            <div className="card-header">
                                <h2 style={{ fontSize: 16, fontWeight: 700 }}>🕵️ Audit Trail ({auditLogs.length})</h2>
                                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>All admin actions — who did what and when</span>
                            </div>
                            <div className="table-container">
                                <table className="table">
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
                                            <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>No audit logs yet. Admin actions will appear here.</td></tr>
                                        ) : auditLogs.map(log => {
                                            let badgeClass = 'badge-info';
                                            if (log.action?.includes('APPROVE') || log.action?.includes('VERIFY')) badgeClass = 'badge-success';
                                            if (log.action?.includes('REJECT') || log.action?.includes('DELETE')) badgeClass = 'badge-error';

                                            return (
                                                <tr key={log.id}>
                                                    <td style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                                        {new Date(log.created_at).toLocaleString()}
                                                    </td>
                                                    <td>
                                                        <div style={{ fontWeight: 600, fontSize: 13 }}>{log.performer_name || '—'}</div>
                                                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{log.performer_email || ''}</div>
                                                    </td>
                                                    <td>
                                                        <span className={`badge ${badgeClass}`} style={{ fontSize: 11 }}>{log.action}</span>
                                                    </td>
                                                    <td style={{ fontSize: 13 }}>
                                                        <span className="badge badge-neutral" style={{ fontSize: 11 }}>{log.entity_type}</span>
                                                    </td>
                                                    <td style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 280 }}>{log.description}</td>
                                                </tr>
                                            )
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 24 }}>
                    {/* Brands Column */}
                    <div className="card">
                        <div className="card-header"><h2 style={{ fontSize: 16, fontWeight: 700 }}>🏭 Brands ({carBrands.length})</h2></div>
                        <div className="card-body">
                            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                                <input className="form-input" style={{ flex: 1 }} placeholder="New brand name" value={newBrandName} onChange={(e) => setNewBrandName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addBrand()} />
                                <button className="btn btn-accent btn-sm" onClick={addBrand}><FiPlus /> Add</button>
                            </div>
                            {catalogLoading ? (
                                <div style={{ textAlign: 'center', padding: 24 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
                            ) : carBrands.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-tertiary)' }}>No brands yet</div>
                            ) : (
                                <div style={{ maxHeight: 450, overflowY: 'auto' }}>
                                    {carBrands.map(brand => (
                                        <div key={brand.id} onClick={() => setSelectedBrandId(brand.id === selectedBrandId ? '' : brand.id)} style={{
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 'var(--radius-md)', marginBottom: 4, cursor: 'pointer',
                                            background: selectedBrandId === brand.id ? 'var(--primary-50)' : 'transparent', border: selectedBrandId === brand.id ? '1px solid var(--primary-200)' : '1px solid transparent',
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span style={{ fontWeight: 600, fontSize: 14, opacity: brand.is_active ? 1 : 0.5 }}>{brand.name}</span>
                                                {!brand.is_active && <span className="badge badge-neutral" style={{ fontSize: 10 }}>Inactive</span>}
                                                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>({carModels.filter(m => m.brand_id === brand.id).length})</span>
                                            </div>
                                            <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); toggleBrandActive(brand.id, brand.is_active); }} style={{ color: brand.is_active ? 'var(--success-500)' : 'var(--neutral-400)' }}>
                                                {brand.is_active ? <FiToggleRight size={18} /> : <FiToggleLeft size={18} />}
                                            </button>
                                            <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); deleteBrand(brand.id, brand.name); }} style={{ color: 'var(--error-400)' }} title="Delete brand">
                                                <FiTrash2 size={15} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Models Column */}
                    <div className="card">
                        <div className="card-header"><h2 style={{ fontSize: 16, fontWeight: 700 }}>🚗 Models {selectedBrandId && `— ${carBrands.find(b => b.id === selectedBrandId)?.name || ''}`} ({filteredCatalogModels.length})</h2></div>
                        <div className="card-body">
                            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                                <select className="form-select" style={{ width: 180 }} value={selectedBrandId} onChange={(e) => setSelectedBrandId(e.target.value)}>
                                    <option value="">All Brands</option>
                                    {carBrands.filter(b => b.is_active).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                </select>
                                <input className="form-input" style={{ flex: 1, minWidth: 120 }} placeholder="New model" value={newModelName} onChange={(e) => setNewModelName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addModel()} />
                                <select className="form-select" style={{ width: 130 }} value={newModelBodyType} onChange={(e) => setNewModelBodyType(e.target.value)}>
                                    {['Sedan', 'SUV', 'MPV', 'Van', 'Hatchback', 'Pickup', 'Crossover', 'Coupe'].map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                                <button className="btn btn-accent btn-sm" onClick={addModel} disabled={!selectedBrandId}><FiPlus /> Add</button>
                            </div>
                            {catalogLoading ? (
                                <div style={{ textAlign: 'center', padding: 24 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
                            ) : filteredCatalogModels.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-tertiary)' }}>{selectedBrandId ? 'No models for this brand yet.' : 'Select a brand or view all.'}</div>
                            ) : (
                                <div className="table-container">
                                    <table className="table">
                                        <thead><tr><th>Model</th><th>Brand</th><th>Body Type</th><th>Status</th><th></th></tr></thead>
                                        <tbody>
                                            {filteredCatalogModels.map(m => (
                                                <tr key={m.id}>
                                                    <td style={{ fontWeight: 600 }}>{m.name}</td>
                                                    <td style={{ color: 'var(--text-secondary)' }}>{m.car_brands?.name || '—'}</td>
                                                    <td><span className="badge badge-info">{m.body_type}</span></td>
                                                    <td><span className={`badge ${m.is_active ? 'badge-success' : 'badge-neutral'}`}>{m.is_active ? 'Active' : 'Inactive'}</span></td>
                                                    <td>
                                                        <div style={{ display: 'flex', gap: 4 }}>
                                                            <button className="btn btn-ghost btn-sm" onClick={() => toggleModelActive(m.id, m.is_active)} style={{ color: m.is_active ? 'var(--success-500)' : 'var(--neutral-400)' }}>
                                                                {m.is_active ? <FiToggleRight size={16} /> : <FiToggleLeft size={16} />}
                                                            </button>
                                                            <button className="btn btn-ghost btn-sm" onClick={() => deleteModel(m.id, m.name)} style={{ color: 'var(--error-400)' }} title="Delete model">
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
                <div className="modal-overlay" onClick={() => setSelectedUser(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 700, maxHeight: '90vh', overflow: 'auto' }}>
                        <div className="modal-header">
                            <h2>User Details</h2>
                            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedUser(null)}>✕</button>
                        </div>
                        <div className="modal-body">
                            {/* User Info */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                                <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary-400), var(--accent-400))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 24, fontWeight: 700 }}>
                                    {selectedUser.full_name?.[0] || 'U'}
                                </div>
                                <div>
                                    <h3 style={{ fontSize: 18, fontWeight: 700 }}>{selectedUser.full_name}</h3>
                                    <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{selectedUser.email}</p>
                                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                        <span className={`badge ${getRoleBadgeClass(selectedUser.role)}`}>{selectedUser.role === 'user' ? 'Not Verified' : selectedUser.role}</span>
                                        <span className={`badge ${getStatusBadge(selectedUser.verification_status)}`}>{selectedUser.verification_status || 'none'}</span>
                                    </div>
                                </div>
                            </div>

                            {/* User Details Grid */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
                                {[
                                    { label: 'Phone', value: selectedUser.phone || 'N/A' },
                                    { label: 'City', value: selectedUser.city || 'N/A' },
                                    { label: 'Province', value: selectedUser.province || 'N/A' },
                                    { label: 'Date of Birth', value: selectedUser.date_of_birth ? new Date(selectedUser.date_of_birth).toLocaleDateString() : 'N/A' },
                                    { label: "Driver's License #", value: selectedUser.drivers_license_number || 'Not submitted' },
                                    { label: 'National / UMID ID #', value: selectedUser.national_id_number || 'Not submitted' },
                                ].map((item, i) => (
                                    <div key={i} style={{ padding: 12, background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
                                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{item.label}</div>
                                        <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{item.value}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Submitted Documents */}
                            <div style={{ marginBottom: 24 }}>
                                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <FiImage /> Submitted ID Documents
                                </h3>
                                {docsLoading ? (
                                    <div style={{ textAlign: 'center', padding: 24 }}><div className="spinner" style={{ margin: '0 auto 8px' }} /><p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Loading...</p></div>
                                ) : userDocs.length === 0 ? (
                                    <div style={{ padding: 24, textAlign: 'center', background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)', color: 'var(--text-tertiary)' }}>No documents uploaded yet</div>
                                ) : (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                                        {userDocs.map((doc, i) => (
                                            <div key={i} style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--surface-secondary)' }}>
                                                {doc.url ? (
                                                    <a href={doc.url} target="_blank" rel="noopener noreferrer">
                                                        <img src={doc.url} alt={doc.name} style={{ width: '100%', height: 150, objectFit: 'cover', display: 'block' }}
                                                            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                                                        <div style={{ display: 'none', height: 150, alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--text-tertiary)', padding: 8, textAlign: 'center' }}>
                                                            🖼️ Click to view
                                                        </div>
                                                    </a>
                                                ) : null}
                                                <div style={{ padding: '8px 12px', fontSize: 12 }}>
                                                    <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{doc.name}</div>
                                                    <div style={{ color: 'var(--text-tertiary)' }}>{doc.bucket === 'selfies' ? '📸 Selfie' : '🪪 ID Document'}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Role Management — only user <-> verified, no admin promotion */}
                            <div style={{ marginBottom: 16 }}>
                                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}><FiShield /> Role Management</h3>
                                <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 10 }}>Admin accounts are created separately and cannot be assigned through this panel.</p>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    {['user', 'verified'].map(role => (
                                        <button key={role} className={`btn btn-sm ${selectedUser.role === role ? 'btn-primary' : 'btn-secondary'}`} onClick={() => selectedUser.role !== role && changeRole(selectedUser.id, role)} disabled={selectedUser.role === role || selectedUser.id === user.id || selectedUser.role === 'admin'} style={{ textTransform: 'capitalize' }}>
                                            {selectedUser.role === role ? `✓ ${role === 'user' ? 'Not Verified' : 'Verified'}` : (role === 'user' ? 'Set Not Verified' : 'Set Verified')}
                                        </button>
                                    ))}
                                    {selectedUser.role === 'admin' && <span className="badge badge-error" style={{ padding: '8px 12px' }}>Admin — role cannot be changed here</span>}
                                </div>
                                {selectedUser.id === user.id && <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8 }}>⚠️ You cannot change your own role</p>}
                            </div>

                            {/* User's Vehicles */}
                            <div style={{ marginBottom: 16 }}>
                                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}><FiTruck /> Listed Vehicles ({userVehicles.length})</h3>
                                {userDetailLoading ? <div style={{ textAlign: 'center', padding: 16 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
                                    : userVehicles.length === 0 ? <p style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 0' }}>No vehicles listed</p>
                                        : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                {userVehicles.map(v => (
                                                    <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--neutral-50)', borderRadius: 8 }}>
                                                        <div>
                                                            <div style={{ fontWeight: 600, fontSize: 13 }}>{v.year} {v.make} {v.model}</div>
                                                            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{v.plate_number} • ₱{v.daily_rate?.toLocaleString()}/day</div>
                                                        </div>
                                                        <span className={`badge ${v.status === 'approved' ? 'badge-success' : v.status === 'pending' ? 'badge-pending' : 'badge-error'}`}>{v.status}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                            </div>

                            {/* User's Bookings */}
                            <div style={{ marginBottom: 8 }}>
                                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}><FiCalendar /> Booking History ({userBookings.length})</h3>
                                {userDetailLoading ? <div style={{ textAlign: 'center', padding: 16 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
                                    : userBookings.length === 0 ? <p style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 0' }}>No bookings yet</p>
                                        : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                {userBookings.slice(0, 5).map(b => (
                                                    <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--neutral-50)', borderRadius: 8 }}>
                                                        <div>
                                                            <div style={{ fontWeight: 600, fontSize: 13 }}>{b.vehicles?.year} {b.vehicles?.make} {b.vehicles?.model}</div>
                                                            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{new Date(b.start_date).toLocaleDateString()} → {new Date(b.end_date).toLocaleDateString()} • ₱{b.total_amount?.toLocaleString()}</div>
                                                        </div>
                                                        <span className={`badge ${b.status === 'completed' ? 'badge-success' : b.status === 'confirmed' ? 'badge-info' : b.status === 'cancelled' ? 'badge-error' : 'badge-pending'}`}>{b.status}</span>
                                                    </div>
                                                ))}
                                                {userBookings.length > 5 && <p style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>+{userBookings.length - 5} more bookings</p>}
                                            </div>
                                        )}
                            </div>

                        </div>

                        {/* Verification Actions in Footer */}
                        {selectedUser.verification_status === 'submitted' && (
                            <div className="modal-footer">
                                <button className="btn btn-danger" onClick={() => verifyUser(selectedUser.id, 'reject')}><FiX /> Reject</button>
                                <button className="btn btn-success" onClick={() => verifyUser(selectedUser.id, 'approve')}><FiCheck /> Verify User</button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ========== VEHICLE DETAIL MODAL ========== */}
            {selectedVehicle && (
                <div className="modal-overlay" onClick={() => setSelectedVehicle(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, maxHeight: '92vh', overflow: 'auto' }}>
                        <div className="modal-header">
                            <h2>🚗 {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}</h2>
                            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedVehicle(null)}>✕</button>
                        </div>
                        <div className="modal-body">
                            {/* Owner */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, padding: '10px 14px', background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
                                <div>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Owner</div>
                                    <div style={{ fontWeight: 700, fontSize: 15 }}>{selectedVehicle.profiles?.full_name || '—'}</div>
                                </div>
                                <span className={`badge ${selectedVehicle.status === 'approved' ? 'badge-success' : selectedVehicle.status === 'rejected' ? 'badge-error' : 'badge-info'}`} style={{ fontSize: 13, padding: '6px 14px' }}>
                                    {selectedVehicle.status?.toUpperCase()}
                                </span>
                            </div>

                            {/* Photos */}
                            {selectedVehicle.images?.length > 0 && (
                                <div style={{ marginBottom: 20 }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>Photos</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                                        {selectedVehicle.images.map((url, i) => (
                                            <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                                                <img src={url} alt={`Photo ${i + 1}`} style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: 'var(--radius-md)' }} />
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Vehicle Details Grid */}
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 10 }}>Vehicle Details</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
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
                                    <div key={i} style={{ padding: '10px 12px', background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{item.label}</div>
                                        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3 }}>{item.value || '—'}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Contact Info */}
                            {selectedVehicle.contact_info && (
                                <div style={{ marginBottom: 20 }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>Owner Contact Info</div>
                                    <div style={{ background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)', padding: '12px 16px', fontSize: 13 }}>{selectedVehicle.contact_info}</div>
                                </div>
                            )}

                            {/* Pickup Location */}
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 10 }}>Pickup Location</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
                                {[
                                    { label: 'Street / Landmark', value: selectedVehicle.pickup_location },
                                    { label: 'City', value: selectedVehicle.pickup_city },
                                    { label: 'Province', value: selectedVehicle.pickup_province },
                                ].map((item, i) => (
                                    <div key={i} style={{ padding: '10px 12px', background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{item.label}</div>
                                        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3 }}>{item.value || '—'}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Rental Durations */}
                            {selectedVehicle.available_durations?.length > 0 && (
                                <div style={{ marginBottom: 20 }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>Available Rental Durations</div>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                        {selectedVehicle.available_durations.map((d, i) => (
                                            <span key={i} className="badge badge-info">{d.replace(/_/g, ' ')}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Features */}
                            {selectedVehicle.features?.length > 0 && (
                                <div style={{ marginBottom: 20 }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>Features</div>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                        {selectedVehicle.features.map((f, i) => (
                                            <span key={i} style={{ background: 'var(--success-50)', color: 'var(--success-700)', borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>{f}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Description */}
                            {selectedVehicle.description && (
                                <div style={{ marginBottom: 20 }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>Owner's Description</div>
                                    <div style={{ background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)', padding: '12px 16px', fontSize: 13, lineHeight: 1.6 }}>
                                        {selectedVehicle.description}
                                    </div>
                                </div>
                            )}

                            {/* Agreement */}
                            {selectedVehicle.agreement_url && (
                                <div style={{ marginBottom: 20 }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>Agreement Document</div>
                                    <a href={selectedVehicle.agreement_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                                        📄 View Agreement
                                    </a>
                                </div>
                            )}

                            {/* Owner Verification Info — cross-check with ORCR */}
                            <div style={{ marginBottom: 20, border: '1px solid var(--accent-200)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                                <div style={{ background: 'var(--accent-50)', padding: '10px 16px', fontSize: 12, fontWeight: 700, color: 'var(--accent-700)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                    🔍 Owner Verification Info — Cross-check with ORCR
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: 12 }}>
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
                                        <div key={i} style={{ padding: '8px 10px', background: 'var(--surface-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)' }}>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{item.label}</div>
                                            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2, color: item.value ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{item.value || 'N/A'}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* ORCR Document (Admin Only) */}
                            {selectedVehicle.orcr_url && (
                                <div style={{ marginBottom: 20 }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>🪪 ORCR Document (Admin Only)</div>
                                    <a href={selectedVehicle.orcr_url} target="_blank" rel="noopener noreferrer">
                                        <img src={selectedVehicle.orcr_url} alt="ORCR" style={{ maxWidth: '100%', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)', cursor: 'zoom-in', display: 'block' }}
                                            onError={(e) => { e.target.style.display = 'none'; }} />
                                    </a>
                                    <a href={selectedVehicle.orcr_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--primary-600)', marginTop: 6, display: 'inline-block' }}>
                                        Open full image ↗
                                    </a>
                                </div>
                            )}
                        </div>
                        {selectedVehicle.status === 'pending' && (
                            <div className="modal-footer">
                                <button className="btn btn-danger" onClick={() => { setRejectTarget(selectedVehicle.id); setShowRejectModal('vehicle'); setSelectedVehicle(null); }}><FiX /> Reject</button>
                                <button className="btn btn-success" onClick={() => approveVehicle(selectedVehicle.id, 'approve')}><FiCheck /> Approve Listing</button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ========== REJECTION REASON MODAL ========== */}
            {showRejectModal && (
                <div className="modal-overlay" onClick={() => { setShowRejectModal(null); setRejectReason(''); setRejectTarget(null); }}>
                    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
                        <div className="modal-header">
                            <h2>❌ Reason for Rejection</h2>
                            <button className="btn btn-ghost btn-sm" onClick={() => { setShowRejectModal(null); setRejectReason(''); setRejectTarget(null); }}>✕</button>
                        </div>
                        <div className="modal-body">
                            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
                                Provide a reason for rejecting this {showRejectModal === 'vehicle' ? 'vehicle listing' : 'verification request'}.
                                This message will be sent to the {showRejectModal === 'vehicle' ? 'vehicle owner' : 'user'} as a notification.
                            </p>
                            <textarea
                                className="form-input"
                                style={{ width: '100%', height: 120, resize: 'vertical', fontFamily: 'inherit' }}
                                placeholder={showRejectModal === 'vehicle'
                                    ? 'e.g. Photos are unclear, plate number doesn\'t match registration, missing required documents...'
                                    : 'e.g. ID photo is blurry, selfie doesn\'t match ID, expired document...'
                                }
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                            />
                            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8 }}>You can leave this blank to use a generic rejection message.</p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => { setShowRejectModal(null); setRejectReason(''); setRejectTarget(null); }}>Cancel</button>
                            <button className="btn btn-danger" onClick={confirmReject}><FiX /> Confirm Reject</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
