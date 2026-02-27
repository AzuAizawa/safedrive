import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { FiUsers, FiTruck, FiCalendar, FiShield, FiCheck, FiX, FiEye, FiSearch, FiImage, FiPlus, FiToggleLeft, FiToggleRight, FiAlertCircle, FiClock, FiTrash2 } from 'react-icons/fi';
import toast from 'react-hot-toast';
import BackButton from '../../components/BackButton';

export default function AdminPanel() {
    const { user } = useAuth();
    const [searchParams] = useSearchParams();
    const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'users');
    const [users, setUsers] = useState([]);
    const [vehicles, setVehicles] = useState([]);
    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedUser, setSelectedUser] = useState(null);
    const [userDocs, setUserDocs] = useState([]);
    const [docsLoading, setDocsLoading] = useState(false);
    const [selectedVehicle, setSelectedVehicle] = useState(null);

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
                const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
                setUsers(data || []);
            } else if (activeTab === 'vehicles') {
                const { data } = await supabase.from('vehicles').select('*, profiles!vehicles_owner_id_fkey(full_name)').order('created_at', { ascending: false });
                setVehicles(data || []);
            } else if (activeTab === 'bookings') {
                const { data } = await supabase.from('bookings').select('*, vehicles(make, model, year), profiles!bookings_renter_id_fkey(full_name)').order('created_at', { ascending: false });
                setBookings(data || []);
            } else if (activeTab === 'catalog') {
                await fetchCatalog();
            }
        } catch (err) { console.error('Error:', err); }
        finally { setLoading(false); }
    };

    // ===== USER FUNCTIONS =====
    const fetchUserDocs = async (userId) => {
        setDocsLoading(true);
        setUserDocs([]);
        try {
            const allDocs = [];
            for (const bucket of ['documents', 'selfies']) {
                try {
                    const { data, error } = await supabase.storage.from(bucket).list(userId, { limit: 20 });
                    if (!error && data) {
                        for (const file of data) {
                            const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(`${userId}/${file.name}`);
                            allDocs.push({ name: file.name, bucket, url: urlData?.publicUrl });
                        }
                    }
                } catch (e) { console.warn(`Could not list ${bucket}:`, e); }
            }
            setUserDocs(allDocs);
        } catch (err) { console.error('Error fetching docs:', err); }
        finally { setDocsLoading(false); }
    };

    const verifyUser = async (userId, action) => {
        try {
            const { error } = await supabase.from('profiles').update({
                verification_status: action === 'approve' ? 'verified' : 'rejected',
                verified_by: user.id,
                verified_at: new Date().toISOString(),
            }).eq('id', userId);
            if (error) throw error;
            try { await supabase.from('verification_logs').insert({ user_id: userId, admin_id: user.id, action, verification_type: 'identity', notes: `User ${action === 'approve' ? 'verified' : 'rejected'} by admin` }); } catch (e) { }
            try { await supabase.from('notifications').insert({ user_id: userId, title: action === 'approve' ? 'Identity Verified!' : 'Verification Rejected', message: action === 'approve' ? 'Your identity has been verified. You can now access all SafeDrive features!' : 'Your identity verification was not approved. Please resubmit your documents.', type: 'verification' }); } catch (e) { }
            toast.success(`User ${action === 'approve' ? 'verified' : 'rejected'} successfully`);
            fetchData();
            setSelectedUser(null);
        } catch (err) { toast.error('Failed to update verification'); }
    };

    const changeRole = async (userId, newRole) => {
        if (!window.confirm(`Change this user's role to "${newRole}"?`)) return;
        try {
            const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
            if (error) throw error;
            toast.success(`Role changed to ${newRole}`);
            fetchData();
            setSelectedUser(null);
        } catch (err) { toast.error('Failed to change role'); }
    };

    // ===== VEHICLE FUNCTIONS =====
    const approveVehicle = async (vehicleId, action) => {
        try {
            const { error } = await supabase.from('vehicles').update({
                status: action === 'approve' ? 'approved' : 'rejected',
                approved_by: user.id,
                approved_at: new Date().toISOString(),
            }).eq('id', vehicleId);
            if (error) throw error;
            toast.success(`Vehicle ${action === 'approve' ? 'approved' : 'rejected'}`);
            fetchData();
            setSelectedVehicle(null);
        } catch (err) { toast.error('Failed to update vehicle'); }
    };

    // ===== CATALOG FUNCTIONS =====
    const fetchCatalog = async () => {
        setCatalogLoading(true);
        try {
            const [brandsRes, modelsRes] = await Promise.all([
                supabase.from('car_brands').select('*').order('name'),
                supabase.from('car_models').select('*, car_brands(name)').order('name'),
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
            const { error } = await supabase.from('car_brands').insert({ name, is_active: true });
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
            const { error } = await supabase.from('car_models').insert({ brand_id: selectedBrandId, name, body_type: newModelBodyType, is_active: true });
            if (error) throw error;
            toast.success(`Model "${name}" added`);
            setNewModelName('');
            fetchCatalog();
        } catch (err) { toast.error(err.message?.includes('duplicate') ? 'Model already exists for this brand' : 'Failed to add model'); }
    };

    const toggleBrandActive = async (brandId, current) => {
        try {
            const { error } = await supabase.from('car_brands').update({ is_active: !current }).eq('id', brandId);
            if (error) throw error;
            toast.success(current ? 'Brand deactivated' : 'Brand activated');
            fetchCatalog();
        } catch (err) { toast.error('Failed to update brand'); }
    };

    const toggleModelActive = async (modelId, current) => {
        try {
            const { error } = await supabase.from('car_models').update({ is_active: !current }).eq('id', modelId);
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
                const { error: modelsErr } = await supabase.from('car_models').delete().eq('brand_id', brandId);
                if (modelsErr) throw modelsErr;
            }
            const { error } = await supabase.from('car_brands').delete().eq('id', brandId);
            if (error) throw error;
            toast.success(`"${brandName}" deleted`);
            if (selectedBrandId === brandId) setSelectedBrandId('');
            fetchCatalog();
        } catch (err) { toast.error('Failed to delete brand. It may be referenced by vehicles.'); }
    };

    const deleteModel = async (modelId, modelName) => {
        if (!window.confirm(`Delete model "${modelName}"? This cannot be undone.`)) return;
        try {
            const { error } = await supabase.from('car_models').delete().eq('id', modelId);
            if (error) throw error;
            toast.success(`"${modelName}" deleted`);
            fetchCatalog();
        } catch (err) { toast.error('Failed to delete model. It may be referenced by vehicles.'); }
    };

    // ===== COMPUTED =====
    const handleViewUser = (u) => { setSelectedUser(u); fetchUserDocs(u.id); };
    const getRoleBadgeClass = (role) => ({ admin: 'badge-error', verified: 'badge-success', user: 'badge-info' }[role] || 'badge-neutral');
    const getStatusBadge = (status) => ({ verified: 'badge-success', submitted: 'badge-pending', rejected: 'badge-error' }[status] || 'badge-neutral');
    const filteredCatalogModels = selectedBrandId ? carModels.filter(m => m.brand_id === selectedBrandId) : carModels;

    // Separate pending items from the rest
    const pendingUsers = users.filter(u => u.verification_status === 'submitted');
    const allUsers = users.filter(u => u.verification_status !== 'submitted');
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
                            <button className="btn btn-danger btn-sm" onClick={() => verifyUser(u.id, 'reject')} title="Reject">❌ Reject</button>
                        </>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => handleViewUser(u)} title="View details"><FiEye /></button>
                </div>
            </td>
        </tr>
    );

    // ===== VEHICLE ROW COMPONENT =====
    const VehicleRow = ({ v, showActions = false }) => (
        <tr key={v.id} style={{ background: showActions ? 'var(--warning-50)' : undefined }}>
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
            <td style={{ fontWeight: 700, fontFamily: 'var(--font-display)' }}>₱{v.daily_rate?.toLocaleString()}</td>
            <td>
                <span className={`badge ${v.status === 'approved' || v.status === 'listed' ? 'badge-success' : v.status === 'pending' ? 'badge-pending' : 'badge-error'}`}>
                    {v.status}
                </span>
            </td>
            <td>
                <div style={{ display: 'flex', gap: 6 }}>
                    {showActions && (
                        <>
                            <button className="btn btn-success btn-sm" onClick={() => approveVehicle(v.id, 'approve')}>✅ Approve</button>
                            <button className="btn btn-danger btn-sm" onClick={() => approveVehicle(v.id, 'reject')}>❌ Reject</button>
                        </>
                    )}
                    {v.images && v.images.length > 0 && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setSelectedVehicle(v)} title="View photos"><FiImage /></button>
                    )}
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
                            {/* PENDING REVIEW SECTION */}
                            {pendingUsers.length > 0 && (
                                <div className="card" style={{ marginBottom: 24, borderLeft: '4px solid var(--warning-500)' }}>
                                    <div className="card-header" style={{ background: 'var(--warning-50)' }}>
                                        <h2 style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                                            ⏳ Pending Verification ({pendingUsers.length})
                                        </h2>
                                        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Users who submitted documents — review required</span>
                                    </div>
                                    <div className="table-container">
                                        <table className="table">
                                            <thead>
                                                <tr>
                                                    <th>User</th><th>Role</th><th>Status</th><th>Submitted</th><th>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {searchFilter(pendingUsers, ['full_name', 'email']).map(u => (
                                                    <UserRow key={u.id} u={u} showActions={true} />
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* ALL USERS SECTION */}
                            <div className="card">
                                <div className="card-header">
                                    <h2 style={{ fontSize: 16, fontWeight: 700 }}>
                                        👥 All Users ({allUsers.length})
                                    </h2>
                                </div>
                                <div className="table-container">
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>User</th><th>Role</th><th>Verification</th><th>Joined</th><th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {searchFilter(allUsers, ['full_name', 'email']).length === 0 ? (
                                                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>No users found</td></tr>
                                            ) : searchFilter(allUsers, ['full_name', 'email']).map(u => (
                                                <UserRow key={u.id} u={u} />
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
                                                    <th>Vehicle</th><th>Owner</th><th>Rate</th><th>Status</th><th>Actions</th>
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
                                                <th>Vehicle</th><th>Owner</th><th>Rate</th><th>Status</th><th>Actions</th>
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
                                    { label: 'Date of Birth', value: selectedUser.date_of_birth ? new Date(selectedUser.date_of_birth).toLocaleDateString() : 'N/A' },
                                    { label: "Driver's License", value: selectedUser.drivers_license_number || 'Not submitted' },
                                    { label: 'National ID', value: selectedUser.national_id_number || 'Not submitted' },
                                    { label: 'Selfie Verified', value: selectedUser.selfie_verified ? '✅ Yes' : '❌ No' },
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
                                    <FiImage /> Submitted Documents
                                </h3>
                                {docsLoading ? (
                                    <div style={{ textAlign: 'center', padding: 24 }}><div className="spinner" style={{ margin: '0 auto 8px' }} /><p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Loading...</p></div>
                                ) : userDocs.length === 0 && !selectedUser.national_id_front_url && !selectedUser.selfie_url ? (
                                    <div style={{ padding: 24, textAlign: 'center', background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)', color: 'var(--text-tertiary)' }}>No documents uploaded yet</div>
                                ) : (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                                        {userDocs.map((doc, i) => (
                                            <div key={i} style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                                                {doc.url && <a href={doc.url} target="_blank" rel="noopener noreferrer"><img src={doc.url} alt={doc.name} style={{ width: '100%', height: 160, objectFit: 'cover' }} onError={(e) => { e.target.style.display = 'none'; }} /></a>}
                                                <div style={{ padding: '8px 12px', fontSize: 12 }}>
                                                    <div style={{ fontWeight: 600 }}>{doc.name}</div>
                                                    <div style={{ color: 'var(--text-tertiary)' }}>{doc.bucket === 'selfies' ? '📸 Selfie' : '🪪 ID Document'}</div>
                                                </div>
                                            </div>
                                        ))}
                                        {[
                                            { label: 'National ID (Front)', url: selectedUser.national_id_front_url },
                                            { label: 'National ID (Back)', url: selectedUser.national_id_back_url },
                                            { label: "License (Front)", url: selectedUser.drivers_license_front_url },
                                            { label: "License (Back)", url: selectedUser.drivers_license_back_url },
                                            { label: 'Selfie', url: selectedUser.selfie_url },
                                        ].filter(d => d.url).map((doc, i) => (
                                            <a key={`p${i}`} href={doc.url} target="_blank" rel="noopener noreferrer" style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', overflow: 'hidden', textDecoration: 'none' }}>
                                                <img src={doc.url} alt={doc.label} style={{ width: '100%', height: 140, objectFit: 'cover' }} />
                                                <div style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>{doc.label}</div>
                                            </a>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Role Management */}
                            <div style={{ marginBottom: 16 }}>
                                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}><FiShield /> Role Management</h3>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    {['user', 'verified', 'admin'].map(role => (
                                        <button key={role} className={`btn btn-sm ${selectedUser.role === role ? 'btn-primary' : 'btn-secondary'}`} onClick={() => selectedUser.role !== role && changeRole(selectedUser.id, role)} disabled={selectedUser.role === role || selectedUser.id === user.id} style={{ textTransform: 'capitalize' }}>
                                            {selectedUser.role === role ? `✓ ${role === 'user' ? 'Not Verified' : role}` : (role === 'user' ? 'Not Verified' : role)}
                                        </button>
                                    ))}
                                </div>
                                {selectedUser.id === user.id && <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8 }}>⚠️ You cannot change your own role</p>}
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

            {/* ========== VEHICLE PHOTO MODAL ========== */}
            {selectedVehicle && (
                <div className="modal-overlay" onClick={() => setSelectedVehicle(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
                        <div className="modal-header">
                            <h2>{selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}</h2>
                            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedVehicle(null)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                {selectedVehicle.images?.map((url, i) => (
                                    <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                                        <img src={url} alt={`Photo ${i + 1}`} style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: 'var(--radius-md)' }} />
                                    </a>
                                ))}
                            </div>
                            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                                <div><strong>Plate:</strong> {selectedVehicle.plate_number}</div>
                                <div><strong>Color:</strong> {selectedVehicle.color}</div>
                                <div><strong>Body:</strong> {selectedVehicle.body_type}</div>
                                <div><strong>Rate:</strong> ₱{selectedVehicle.daily_rate?.toLocaleString()}/day</div>
                            </div>
                        </div>
                        {selectedVehicle.status === 'pending' && (
                            <div className="modal-footer">
                                <button className="btn btn-danger" onClick={() => approveVehicle(selectedVehicle.id, 'reject')}><FiX /> Reject</button>
                                <button className="btn btn-success" onClick={() => approveVehicle(selectedVehicle.id, 'approve')}><FiCheck /> Approve</button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
