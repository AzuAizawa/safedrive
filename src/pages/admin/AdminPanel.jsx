import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { FiUsers, FiTruck, FiCalendar, FiShield, FiCheck, FiX, FiEye, FiSearch, FiImage, FiUserPlus, FiPlus, FiToggleLeft, FiToggleRight } from 'react-icons/fi';
import toast from 'react-hot-toast';
import BackButton from '../../components/BackButton';

export default function AdminPanel() {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState('users');
    const [users, setUsers] = useState([]);
    const [vehicles, setVehicles] = useState([]);
    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedUser, setSelectedUser] = useState(null);
    const [userDocs, setUserDocs] = useState([]);
    const [docsLoading, setDocsLoading] = useState(false);

    // Car Catalog state
    const [carBrands, setCarBrands] = useState([]);
    const [carModels, setCarModels] = useState([]);
    const [catalogLoading, setCatalogLoading] = useState(false);
    const [newBrandName, setNewBrandName] = useState('');
    const [newModelName, setNewModelName] = useState('');
    const [newModelBodyType, setNewModelBodyType] = useState('Sedan');
    const [selectedBrandId, setSelectedBrandId] = useState('');

    useEffect(() => {
        fetchData();
    }, [activeTab]);

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
                const { data } = await supabase
                    .from('bookings')
                    .select('*, vehicles(make, model, year), profiles!bookings_renter_id_fkey(full_name)')
                    .order('created_at', { ascending: false });
                setBookings(data || []);
            } else if (activeTab === 'catalog') {
                await fetchCatalog();
            }
        } catch (err) {
            console.error('Error:', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchUserDocs = async (userId) => {
        setDocsLoading(true);
        setUserDocs([]);
        try {
            // Try to list documents from storage
            const docBuckets = [
                { bucket: 'documents', prefix: `${userId}/` },
                { bucket: 'selfies', prefix: `${userId}/` },
            ];

            const allDocs = [];
            for (const { bucket, prefix } of docBuckets) {
                try {
                    const { data, error } = await supabase.storage.from(bucket).list(userId, { limit: 20 });
                    if (!error && data) {
                        for (const file of data) {
                            const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(`${userId}/${file.name}`);
                            allDocs.push({
                                name: file.name,
                                bucket,
                                url: urlData?.publicUrl,
                                size: file.metadata?.size,
                                created: file.created_at,
                            });
                        }
                    }
                } catch (e) {
                    console.warn(`Could not list ${bucket}:`, e);
                }
            }
            setUserDocs(allDocs);
        } catch (err) {
            console.error('Error fetching docs:', err);
        } finally {
            setDocsLoading(false);
        }
    };

    const verifyUser = async (userId, action) => {
        try {
            const update = {
                verification_status: action === 'approve' ? 'verified' : 'rejected',
                verified_by: user.id,
                verified_at: new Date().toISOString(),
            };
            const { error } = await supabase.from('profiles').update(update).eq('id', userId);
            if (error) throw error;

            // Log the verification action
            try {
                await supabase.from('verification_logs').insert({
                    user_id: userId,
                    admin_id: user.id,
                    action: action,
                    verification_type: 'identity',
                    notes: `User ${action === 'approve' ? 'verified' : 'rejected'} by admin`,
                });
            } catch (e) { /* logging should not block */ }

            // Notify user
            try {
                await supabase.from('notifications').insert({
                    user_id: userId,
                    title: action === 'approve' ? 'Identity Verified!' : 'Verification Rejected',
                    message: action === 'approve'
                        ? 'Your identity has been verified. You can now access all SafeDrive features!'
                        : 'Your identity verification was not approved. Please resubmit your documents.',
                    type: 'verification',
                });
            } catch (e) { /* notifications should not block */ }

            toast.success(`User ${action === 'approve' ? 'verified' : 'rejected'} successfully`);
            fetchData();
            setSelectedUser(null);
        } catch (err) {
            toast.error('Failed to update verification');
        }
    };

    const promoteToAdmin = async (userId) => {
        if (!window.confirm('Are you sure you want to promote this user to Admin? This gives full platform access.')) return;
        try {
            const { error } = await supabase.from('profiles').update({ role: 'admin' }).eq('id', userId);
            if (error) throw error;
            toast.success('User promoted to Admin');
            fetchData();
            setSelectedUser(null);
        } catch (err) {
            toast.error('Failed to promote user');
        }
    };

    const changeRole = async (userId, newRole) => {
        if (!window.confirm(`Change this user's role to "${newRole}"?`)) return;
        try {
            const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
            if (error) throw error;
            toast.success(`Role changed to ${newRole}`);
            fetchData();
            setSelectedUser(null);
        } catch (err) {
            toast.error('Failed to change role');
        }
    };

    const approveVehicle = async (vehicleId, action) => {
        try {
            const { error } = await supabase
                .from('vehicles')
                .update({
                    status: action === 'approve' ? 'approved' : 'rejected',
                    approved_by: user.id,
                    approved_at: new Date().toISOString(),
                })
                .eq('id', vehicleId);

            if (error) throw error;
            toast.success(`Vehicle ${action === 'approve' ? 'approved' : 'rejected'}`);
            fetchData();
        } catch (err) {
            toast.error('Failed to update vehicle');
        }
    };

    const filteredItems = () => {
        const term = searchTerm.toLowerCase();
        if (activeTab === 'users') return users.filter(u => u.full_name?.toLowerCase().includes(term) || u.email?.toLowerCase().includes(term));
        if (activeTab === 'vehicles') return vehicles.filter(v => `${v.make} ${v.model} ${v.year}`.toLowerCase().includes(term));
        return bookings.filter(b => b.vehicles?.make?.toLowerCase().includes(term) || b.profiles?.full_name?.toLowerCase().includes(term));
    };

    const handleViewUser = (u) => {
        setSelectedUser(u);
        fetchUserDocs(u.id);
    };

    const getRoleBadgeClass = (role) => {
        switch (role) {
            case 'admin': return 'badge-error';
            case 'renter': return 'badge-success';
            case 'rentee': return 'badge-info';
            default: return 'badge-neutral';
        }
    };

    // ===== CAR CATALOG FUNCTIONS =====
    const fetchCatalog = async () => {
        setCatalogLoading(true);
        try {
            const [brandsRes, modelsRes] = await Promise.all([
                supabase.from('car_brands').select('*').order('name'),
                supabase.from('car_models').select('*, car_brands(name)').order('name'),
            ]);
            setCarBrands(brandsRes.data || []);
            setCarModels(modelsRes.data || []);
        } catch (err) {
            console.error('Error fetching catalog:', err);
        } finally {
            setCatalogLoading(false);
        }
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
        } catch (err) {
            toast.error(err.message?.includes('duplicate') ? 'Brand already exists' : 'Failed to add brand');
        }
    };

    const addModel = async () => {
        const name = newModelName.trim();
        if (!name) return toast.error('Model name is required');
        if (!selectedBrandId) return toast.error('Select a brand first');
        try {
            const { error } = await supabase.from('car_models').insert({
                brand_id: selectedBrandId,
                name,
                body_type: newModelBodyType,
                is_active: true,
            });
            if (error) throw error;
            toast.success(`Model "${name}" added`);
            setNewModelName('');
            fetchCatalog();
        } catch (err) {
            toast.error(err.message?.includes('duplicate') ? 'Model already exists for this brand' : 'Failed to add model');
        }
    };

    const toggleBrandActive = async (brandId, current) => {
        try {
            const { error } = await supabase.from('car_brands').update({ is_active: !current }).eq('id', brandId);
            if (error) throw error;
            toast.success(current ? 'Brand deactivated' : 'Brand activated');
            fetchCatalog();
        } catch (err) {
            toast.error('Failed to update brand');
        }
    };

    const toggleModelActive = async (modelId, current) => {
        try {
            const { error } = await supabase.from('car_models').update({ is_active: !current }).eq('id', modelId);
            if (error) throw error;
            toast.success(current ? 'Model deactivated' : 'Model activated');
            fetchCatalog();
        } catch (err) {
            toast.error('Failed to update model');
        }
    };

    const filteredCatalogModels = selectedBrandId
        ? carModels.filter(m => m.brand_id === selectedBrandId)
        : carModels;

    return (
        <div>
            <BackButton to="/dashboard" label="Back to Dashboard" />

            <div className="page-header">
                <h1>🛡️ Admin Panel</h1>
                <p>SAFEDRIVE Platform Administration — Manage users, vehicles, and bookings</p>
            </div>

            {/* Admin Tabs */}
            <div className="tabs" style={{ maxWidth: 650 }}>
                <button className={`tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
                    <FiUsers style={{ marginRight: 6 }} /> Users ({users.length})
                </button>
                <button className={`tab ${activeTab === 'vehicles' ? 'active' : ''}`} onClick={() => setActiveTab('vehicles')}>
                    <FiTruck style={{ marginRight: 6 }} /> Vehicles ({vehicles.length})
                </button>
                <button className={`tab ${activeTab === 'bookings' ? 'active' : ''}`} onClick={() => setActiveTab('bookings')}>
                    <FiCalendar style={{ marginRight: 6 }} /> Bookings ({bookings.length})
                </button>
                <button className={`tab ${activeTab === 'catalog' ? 'active' : ''}`} onClick={() => setActiveTab('catalog')}>
                    🚘 Car Catalog
                </button>
            </div>

            {/* Search — hide on catalog tab */}
            {activeTab !== 'catalog' && (
                <div className="search-input-wrapper" style={{ marginBottom: 24, maxWidth: 400 }}>
                    <FiSearch className="search-icon" />
                    <input className="form-input" placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
            )}

            {loading ? (
                <div className="loading-spinner"><div className="spinner" /></div>
            ) : (
                <>
                    {/* Users Tab */}
                    {activeTab === 'users' && (
                        <div className="table-container">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>User</th>
                                        <th>Role</th>
                                        <th>Verification</th>
                                        <th>Rating</th>
                                        <th>Joined</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredItems().map(u => (
                                        <tr key={u.id}>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary-400), var(--accent-400))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 13, fontWeight: 700 }}>
                                                        {u.full_name?.[0] || 'U'}
                                                    </div>
                                                    <div>
                                                        <div style={{ fontWeight: 600, fontSize: 14 }}>{u.full_name || 'N/A'}</div>
                                                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{u.email}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td><span className={`badge ${getRoleBadgeClass(u.role)}`}>{u.role}</span></td>
                                            <td>
                                                <span className={`badge ${u.verification_status === 'verified' ? 'badge-verified' : u.verification_status === 'submitted' ? 'badge-pending' : u.verification_status === 'rejected' ? 'badge-error' : 'badge-neutral'}`}>
                                                    {u.verification_status}
                                                </span>
                                            </td>
                                            <td style={{ fontWeight: 600 }}>⭐ {u.average_rating?.toFixed(1) || '0.0'}</td>
                                            <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                                            <td>
                                                <div style={{ display: 'flex', gap: 8 }}>
                                                    {u.verification_status === 'submitted' && (
                                                        <>
                                                            <button className="btn btn-success btn-sm" onClick={() => verifyUser(u.id, 'approve')} title="Approve"><FiCheck /></button>
                                                            <button className="btn btn-danger btn-sm" onClick={() => verifyUser(u.id, 'reject')} title="Reject"><FiX /></button>
                                                        </>
                                                    )}
                                                    <button className="btn btn-ghost btn-sm" onClick={() => handleViewUser(u)} title="View Details"><FiEye /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Vehicles Tab */}
                    {activeTab === 'vehicles' && (
                        <div className="table-container">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Vehicle</th>
                                        <th>Owner</th>
                                        <th>Type</th>
                                        <th>Daily Rate</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredItems().map(v => (
                                        <tr key={v.id}>
                                            <td>
                                                <div style={{ fontWeight: 600 }}>{v.year} {v.make} {v.model}</div>
                                                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{v.plate_number} • {v.color}</div>
                                            </td>
                                            <td style={{ fontSize: 14 }}>{v.profiles?.full_name}</td>
                                            <td><span className="badge badge-info">{v.body_type}</span></td>
                                            <td style={{ fontWeight: 700, fontFamily: 'var(--font-display)' }}>₱{v.daily_rate?.toLocaleString()}</td>
                                            <td>
                                                <span className={`badge ${v.status === 'approved' || v.status === 'listed' ? 'badge-success' : v.status === 'pending' ? 'badge-pending' : 'badge-error'}`}>
                                                    {v.status}
                                                </span>
                                            </td>
                                            <td>
                                                {v.status === 'pending' && (
                                                    <div style={{ display: 'flex', gap: 8 }}>
                                                        <button className="btn btn-success btn-sm" onClick={() => approveVehicle(v.id, 'approve')}><FiCheck /> Approve</button>
                                                        <button className="btn btn-danger btn-sm" onClick={() => approveVehicle(v.id, 'reject')}><FiX /> Reject</button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Bookings Tab */}
                    {activeTab === 'bookings' && (
                        <div className="table-container">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Vehicle</th>
                                        <th>Rentee</th>
                                        <th>Dates</th>
                                        <th>Amount</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredItems().map(b => (
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
                    )}
                </>
            )}

            {/* User Detail Modal with Document Viewer */}
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
                                        <span className={`badge ${getRoleBadgeClass(selectedUser.role)}`}>{selectedUser.role}</span>
                                        <span className={`badge ${selectedUser.verification_status === 'verified' ? 'badge-verified' : 'badge-pending'}`}>
                                            {selectedUser.verification_status}
                                        </span>
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

                            {/* Submitted Documents Section */}
                            <div style={{ marginBottom: 24 }}>
                                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <FiImage /> Submitted Documents
                                </h3>
                                {docsLoading ? (
                                    <div style={{ textAlign: 'center', padding: 24 }}>
                                        <div className="spinner" style={{ margin: '0 auto 8px' }} />
                                        <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Loading documents...</p>
                                    </div>
                                ) : userDocs.length === 0 ? (
                                    <div style={{ padding: 24, textAlign: 'center', background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)', color: 'var(--text-tertiary)', fontSize: 14 }}>
                                        No documents uploaded yet
                                    </div>
                                ) : (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                                        {userDocs.map((doc, i) => (
                                            <div key={i} style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                                                {doc.url ? (
                                                    <a href={doc.url} target="_blank" rel="noopener noreferrer">
                                                        <img
                                                            src={doc.url}
                                                            alt={doc.name}
                                                            style={{ width: '100%', height: 160, objectFit: 'cover', cursor: 'pointer' }}
                                                            onError={(e) => { e.target.style.display = 'none'; }}
                                                        />
                                                    </a>
                                                ) : null}
                                                <div style={{ padding: '8px 12px', fontSize: 12 }}>
                                                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{doc.name}</div>
                                                    <div style={{ color: 'var(--text-tertiary)', marginTop: 2 }}>
                                                        {doc.bucket === 'selfies' ? '📸 Selfie' : '🪪 ID Document'}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Also show URL-based docs from profile */}
                                {(selectedUser.national_id_front_url || selectedUser.drivers_license_front_url || selectedUser.selfie_url) && (
                                    <div style={{ marginTop: 16 }}>
                                        <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Profile-linked documents</h4>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                                            {[
                                                { label: 'National ID (Front)', url: selectedUser.national_id_front_url },
                                                { label: 'National ID (Back)', url: selectedUser.national_id_back_url },
                                                { label: "License (Front)", url: selectedUser.drivers_license_front_url },
                                                { label: "License (Back)", url: selectedUser.drivers_license_back_url },
                                                { label: 'Selfie', url: selectedUser.selfie_url },
                                            ].filter(d => d.url).map((doc, i) => (
                                                <a key={i} href={doc.url} target="_blank" rel="noopener noreferrer" style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', overflow: 'hidden', textDecoration: 'none' }}>
                                                    <img src={doc.url} alt={doc.label} style={{ width: '100%', height: 140, objectFit: 'cover' }} />
                                                    <div style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>{doc.label}</div>
                                                </a>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Role Management */}
                            <div style={{ marginBottom: 16 }}>
                                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <FiShield /> Role Management
                                </h3>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    {['rentee', 'renter', 'admin'].map(role => (
                                        <button
                                            key={role}
                                            className={`btn btn-sm ${selectedUser.role === role ? 'btn-primary' : 'btn-secondary'}`}
                                            onClick={() => selectedUser.role !== role && changeRole(selectedUser.id, role)}
                                            disabled={selectedUser.role === role || selectedUser.id === user.id}
                                            style={{ textTransform: 'capitalize' }}
                                        >
                                            {selectedUser.role === role ? `✓ ${role}` : role}
                                        </button>
                                    ))}
                                </div>
                                {selectedUser.id === user.id && (
                                    <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8 }}>
                                        ⚠️ You cannot change your own role
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Verification Actions */}
                        {selectedUser.verification_status === 'submitted' && (
                            <div className="modal-footer">
                                <button className="btn btn-danger" onClick={() => verifyUser(selectedUser.id, 'reject')}><FiX /> Reject</button>
                                <button className="btn btn-success" onClick={() => verifyUser(selectedUser.id, 'approve')}><FiCheck /> Verify User</button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ===== CAR CATALOG TAB ===== */}
            {activeTab === 'catalog' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 24 }}>
                    {/* Brands Column */}
                    <div>
                        <div className="card">
                            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h2 style={{ fontSize: 16, fontWeight: 700 }}>🏭 Brands ({carBrands.length})</h2>
                            </div>
                            <div className="card-body">
                                {/* Add Brand Form */}
                                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                                    <input
                                        className="form-input"
                                        style={{ flex: 1 }}
                                        placeholder="New brand name (e.g., Toyota)"
                                        value={newBrandName}
                                        onChange={(e) => setNewBrandName(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && addBrand()}
                                    />
                                    <button className="btn btn-accent btn-sm" onClick={addBrand}>
                                        <FiPlus /> Add
                                    </button>
                                </div>

                                {/* Brands List */}
                                {catalogLoading ? (
                                    <div style={{ textAlign: 'center', padding: 24 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
                                ) : carBrands.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-tertiary)' }}>No brands yet. Add your first brand above.</div>
                                ) : (
                                    <div style={{ maxHeight: 450, overflowY: 'auto' }}>
                                        {carBrands.map(brand => (
                                            <div
                                                key={brand.id}
                                                onClick={() => setSelectedBrandId(brand.id === selectedBrandId ? '' : brand.id)}
                                                style={{
                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                    padding: '10px 12px', borderRadius: 'var(--radius-md)', marginBottom: 4,
                                                    cursor: 'pointer', transition: 'all 0.15s ease',
                                                    background: selectedBrandId === brand.id ? 'var(--primary-50)' : 'transparent',
                                                    border: selectedBrandId === brand.id ? '1px solid var(--primary-200)' : '1px solid transparent',
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <span style={{ fontWeight: 600, fontSize: 14, opacity: brand.is_active ? 1 : 0.5 }}>{brand.name}</span>
                                                    {!brand.is_active && <span className="badge badge-neutral" style={{ fontSize: 10 }}>Inactive</span>}
                                                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                                                        ({carModels.filter(m => m.brand_id === brand.id).length} models)
                                                    </span>
                                                </div>
                                                <button
                                                    className="btn btn-ghost btn-sm"
                                                    onClick={(e) => { e.stopPropagation(); toggleBrandActive(brand.id, brand.is_active); }}
                                                    title={brand.is_active ? 'Deactivate' : 'Activate'}
                                                    style={{ color: brand.is_active ? 'var(--success-500)' : 'var(--neutral-400)' }}
                                                >
                                                    {brand.is_active ? <FiToggleRight size={18} /> : <FiToggleLeft size={18} />}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Models Column */}
                    <div>
                        <div className="card">
                            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h2 style={{ fontSize: 16, fontWeight: 700 }}>
                                    🚗 Models
                                    {selectedBrandId && ` — ${carBrands.find(b => b.id === selectedBrandId)?.name || ''}`}
                                    {` (${filteredCatalogModels.length})`}
                                </h2>
                            </div>
                            <div className="card-body">
                                {/* Add Model Form */}
                                <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                                    <select
                                        className="form-select"
                                        style={{ width: 180 }}
                                        value={selectedBrandId}
                                        onChange={(e) => setSelectedBrandId(e.target.value)}
                                    >
                                        <option value="">All Brands</option>
                                        {carBrands.filter(b => b.is_active).map(b => (
                                            <option key={b.id} value={b.id}>{b.name}</option>
                                        ))}
                                    </select>
                                    <input
                                        className="form-input"
                                        style={{ flex: 1, minWidth: 120 }}
                                        placeholder="New model (e.g., Vios)"
                                        value={newModelName}
                                        onChange={(e) => setNewModelName(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && addModel()}
                                    />
                                    <select
                                        className="form-select"
                                        style={{ width: 130 }}
                                        value={newModelBodyType}
                                        onChange={(e) => setNewModelBodyType(e.target.value)}
                                    >
                                        <option value="Sedan">Sedan</option>
                                        <option value="SUV">SUV</option>
                                        <option value="MPV">MPV</option>
                                        <option value="Van">Van</option>
                                        <option value="Hatchback">Hatchback</option>
                                        <option value="Pickup">Pickup</option>
                                        <option value="Crossover">Crossover</option>
                                        <option value="Coupe">Coupe</option>
                                    </select>
                                    <button className="btn btn-accent btn-sm" onClick={addModel} disabled={!selectedBrandId}>
                                        <FiPlus /> Add
                                    </button>
                                </div>

                                {/* Models Table */}
                                {catalogLoading ? (
                                    <div style={{ textAlign: 'center', padding: 24 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
                                ) : filteredCatalogModels.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-tertiary)' }}>
                                        {selectedBrandId ? 'No models for this brand yet. Add one above.' : 'Select a brand to filter or view all models.'}
                                    </div>
                                ) : (
                                    <div className="table-container">
                                        <table className="table">
                                            <thead>
                                                <tr>
                                                    <th>Model</th>
                                                    <th>Brand</th>
                                                    <th>Body Type</th>
                                                    <th>Status</th>
                                                    <th>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredCatalogModels.map(model => (
                                                    <tr key={model.id}>
                                                        <td style={{ fontWeight: 600 }}>{model.name}</td>
                                                        <td style={{ color: 'var(--text-secondary)' }}>{model.car_brands?.name || '—'}</td>
                                                        <td><span className="badge badge-info">{model.body_type}</span></td>
                                                        <td>
                                                            <span className={`badge ${model.is_active ? 'badge-success' : 'badge-neutral'}`}>
                                                                {model.is_active ? 'Active' : 'Inactive'}
                                                            </span>
                                                        </td>
                                                        <td>
                                                            <button
                                                                className="btn btn-ghost btn-sm"
                                                                onClick={() => toggleModelActive(model.id, model.is_active)}
                                                                style={{ color: model.is_active ? 'var(--success-500)' : 'var(--neutral-400)' }}
                                                            >
                                                                {model.is_active ? <FiToggleRight size={16} /> : <FiToggleLeft size={16} />}
                                                            </button>
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
                </div>
            )
            }
        </div >
    );
}
