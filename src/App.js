import React, { useState, useEffect, useMemo } from "react";

/* global __firebase_config, __app_id, __initial_auth_token */

// --- FIREBASE AND FIRESTORE IMPORTS (Integrated into single file) ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { 
    getFirestore, collection, query, onSnapshot, 
    addDoc, updateDoc, doc, Timestamp, where 
} from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const PRIORITY_OPTIONS = ["Low", "Medium", "High", "Critical"];
const STATUS_OPTIONS = ["Submitted", "In Progress", "Completed", "Canceled"];
const DEPARTMENT_OPTIONS = ["Unassigned", "Plumbing", "Electrical", "Housekeeping", "HVAC", "IT"];

// Global Firebase variables will be initialized inside the component
let app, auth, db, storage;
let currentUserId = null;
let appId;

// --- DYNAMIC CDN LOADER HOOK ---

const useExternalAssets = () => {
    useEffect(() => {
        // 1. Load Bootstrap CSS
        const bsCssId = 'bootstrap-css-link';
        const bsCssUrl = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css';
        if (!document.getElementById(bsCssId)) {
            const link = document.createElement('link');
            link.id = bsCssId;
            link.rel = 'stylesheet';
            link.href = bsCssUrl;
            document.head.appendChild(link);
        }
        
        // 2. Load Bootstrap JS Bundle (required for components like dropdowns/modals)
        const bsJsId = 'bootstrap-js-script';
        const bsJsUrl = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js';
        if (!document.getElementById(bsJsId)) {
            const script = document.createElement('script');
            script.id = bsJsId;
            script.src = bsJsUrl;
            document.head.appendChild(script);
        }

        // 3. Load Font Awesome 6
        const faLinkId = 'font-awesome-link';
        const faUrl = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css';
        if (!document.getElementById(faLinkId)) {
            const link = document.createElement('link');
            link.id = faLinkId;
            link.rel = 'stylesheet';
            link.href = faUrl;
            document.head.appendChild(link);
        }
    }, []);
};


// --- INITIALIZATION AND AUTHENTICATION LOGIC ---
const initializeFirebase = (setUserId) => {
    try {
        // 1. Get Configs
        const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
        appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

        // 2. Initialize App and Services
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        storage = getStorage(app);

        // 3. Authentication
        const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

        const handleSignIn = async () => {
            try {
                if (initialAuthToken) {
                    await signInWithCustomToken(auth, initialAuthToken);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (error) {
                console.error("Firebase sign-in error:", error);
            }
        };

        // 4. Auth State Listener
        const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
            if (user) {
                currentUserId = user.uid;
                setUserId(user.uid);
                console.log("Authenticated with User ID:", user.uid);
            } else {
                currentUserId = null;
                setUserId(null);
                console.log("Signed out or not authenticated.");
            }
        });

        handleSignIn();
        return unsubscribeAuth; // Return the cleanup function
        
    } catch (e) {
        console.error("Firebase Initialization Failed:", e);
        // Handle initialization failure gracefully
        return () => {};
    }
};

// --- FIRESTORE API LOGIC (Integrated into single file) ---

const getCollectionPath = (userId) => {
    // Public data path: /artifacts/{appId}/public/data/firs
    // This allows all users to see and update all issues in a collaborative manner.
    return `artifacts/${appId}/public/data/firs`; 
};

/**
 * Subscribes to real-time updates for maintenance issues.
 * Applies filtering for priority and department.
 */
const subscribeToIssues = (userId, callback, priorityFilter, departmentFilter) => {
    if (!db || !userId) return () => {};

    const path = getCollectionPath(userId);
    let issuesQuery = collection(db, path);

    // Apply priority filter if not "All"
    if (priorityFilter !== "All") {
        issuesQuery = query(issuesQuery, where("priority", "==", priorityFilter));
    }
    
    // Apply department filter if not "All"
    if (departmentFilter !== "All") {
        issuesQuery = query(issuesQuery, where("department", "==", departmentFilter));
    }
    
    // NOTE: We sort in memory to avoid Firestore index requirements for queries.

    const unsubscribe = onSnapshot(issuesQuery, (snapshot) => {
        const issues = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        // Sort in memory by creation time (newest first)
        issues.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

        callback(issues);
    }, (error) => {
        console.error("Firestore onSnapshot error:", error);
    });

    return unsubscribe;
};

/**
 * Creates a new maintenance issue document, including image upload if provided.
 */
const createNewIssue = async (userId, formData, displayId) => {
    if (!db || !storage || !userId) throw new Error("Database or storage not initialized.");

    let imageUrl = null;

    if (formData.imageFile) {
        // Upload image to Firebase Storage
        const storageRef = ref(storage, `firs/${userId}/${Date.now()}_${formData.imageFile.name}`);
        const snapshot = await uploadBytes(storageRef, formData.imageFile);
        imageUrl = await getDownloadURL(snapshot.ref);
    }

    const path = getCollectionPath(userId);
    const newIssue = {
        displayId: displayId,
        roomNumber: formData.roomNumber,
        issueTitle: formData.issueTitle,
        description: formData.description,
        priority: formData.priority,
        status: "Submitted", // Default status
        department: "Unassigned", // Default department
        imageUrl: imageUrl,
        submittedBy: userId,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
    };

    const docRef = await addDoc(collection(db, path), newIssue);
    console.log("Document written with ID: ", docRef.id);
};

/**
 * Updates a single field in an existing maintenance issue document.
 */
const updateIssueField = async (userId, issueId, field, value) => {
    if (!db || !userId) throw new Error("Database not initialized.");
    
    const path = getCollectionPath(userId);
    const issueRef = doc(db, path, issueId);

    await updateDoc(issueRef, {
        [field]: value,
        updatedAt: Timestamp.now()
    });
    console.log(`Updated issue ${issueId}: set ${field} to ${value}`);
};


// --- ICON SETUP (Font Awesome integration) ---

// Custom Bootstrap classes mapping for status colors
const getStatusBadge = (status) => {
    switch (status) {
        case "Submitted": return "badge bg-info text-dark"; // Blue/Light
        case "In Progress": return "badge bg-warning text-dark"; // Yellow
        case "Completed": return "badge bg-success"; // Green
        case "Canceled": return "badge bg-danger"; // Red
        default: return "badge bg-secondary";
    }
};

// Icon mapping function
const getIconComponent = (iconName, className = "text-white fs-5") => {
    // fs-5 is Bootstrap font size 5
    switch (iconName) {
        case 'Home': return <i className={`fa-solid fa-house ${className}`}></i>;
        case 'Zap': return <i className={`fa-solid fa-bolt ${className}`}></i>;
        case 'Clock': return <i className={`fa-solid fa-clock ${className}`}></i>;
        case 'ShieldAlert': return <i className={`fa-solid fa-triangle-exclamation ${className}`}></i>;
        case 'Check': return <i className={`fa-solid fa-check ${className}`}></i>;
        case 'Users': return <i className={`fa-solid fa-user-gear ${className}`}></i>;
        case 'Calendar': return <i className={`fa-regular fa-calendar-days ${className}`}></i>;
        case 'List': return <i className={`fa-solid fa-clipboard-list ${className}`}></i>;
        case 'Upload': return <i className={`fa-solid fa-cloud-arrow-up ${className}`}></i>;
        case 'Search': return <i className={`fa-solid fa-magnifying-glass ${className}`}></i>;
        case 'User': return <i className={`fa-solid fa-user ${className}`}></i>;
        case 'Spinner': return <i className={`fa-solid fa-spinner fa-spin ${className}`}></i>;
        case 'Toolbox': return <i className={`fa-solid fa-toolbox ${className}`}></i>;
        case 'Chart': return <i className={`fa-solid fa-chart-line ${className}`}></i>;
        case 'PaperPlane': return <i className={`fa-solid fa-paper-plane ${className}`}></i>;
        default: return null;
    }
};

const DashboardTile = ({ iconName, title, value, bgColor }) => (
    <div className={`card shadow-lg border-0 ${bgColor} text-white`}>
        <div className="card-body p-4">
            <div className="d-flex align-items-center">
                <div className="p-3 rounded-circle bg-white bg-opacity-25 text-white me-3 fs-4">
                    {getIconComponent(iconName, "text-white")}
                </div>
                <div>
                    <p className="small text-uppercase mb-0 opacity-75">{title}</p>
                    <h3 className="h2 fw-bold">{value}</h3>
                </div>
            </div>
        </div>
    </div>
);

const App = () => {
    useExternalAssets(); // CRITICAL FIX: Inject Bootstrap and Font Awesome CDNs
    
    const [firs, setFirs] = useState([]);
    const [userId, setUserId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState("dashboard"); // 'dashboard', 'interface1', 'interface2'
    const [nextDisplayId, setNextDisplayId] = useState("FIR-0001");
    
    // Form state for Interface 1
    const [formData, setFormData] = useState({
        roomNumber: "",
        issueTitle: "",
        description: "",
        priority: "Medium",
        imageFile: null,
    });

    // Filter states for Interface 2 (Dashboard)
    const [searchTerm, setSearchTerm] = useState("");
    const [priorityFilter, setPriorityFilter] = useState("All");
    const [departmentFilter, setDepartmentFilter] = useState("All");
    
    const [currentDateTime, setCurrentDateTime] = useState(new Date());

    // --- INITIALIZATION AND AUTHENTICATION ---
    useEffect(() => {
        // Initialize Firebase and set up Auth listener
        const unsubscribeAuth = initializeFirebase(setUserId);

        // Clock Timer
        const timer = setInterval(() => setCurrentDateTime(new Date()), 1000);

        return () => {
            clearInterval(timer);
            unsubscribeAuth(); // Clean up the auth listener
        };
    }, []); // Empty dependency array ensures this runs only once

    // --- REAL-TIME DATA SYNC ---
    useEffect(() => {
        // Wait until authenticated and Firebase is ready
        if (!userId || !db) {
             setLoading(true);
             return;
        }

        // Subscribe to issues using the integrated API function
        setLoading(true);
        const unsubscribe = subscribeToIssues(userId, (data) => {
            setFirs(data);
            setLoading(false);
            
            // Calculate next display ID
            const highestId = data.reduce((max, fir) => {
                const num = parseInt(fir.displayId?.slice(4) || '0', 10);
                return num > max ? num : max;
            }, 0);
            setNextDisplayId(`FIR-${String(highestId + 1).padStart(4, "0")}`);
        }, priorityFilter, departmentFilter); // Pass filters to the subscription

        return () => unsubscribe(); // Clean up the listener
    }, [userId, priorityFilter, departmentFilter]); // Re-subscribe when filters change

    // --- FORM HANDLERS (Interface 1) ---

    const handleFormChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleFileChange = (e) => {
        setFormData(prev => ({ ...prev, imageFile: e.target.files[0] }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!userId) {
            console.error("Authentication not ready. Cannot submit.");
             // Show Error Message Modal
             const errorModal = document.getElementById('error-message-modal');
             if(errorModal) {
                 errorModal.classList.remove('d-none');
                 setTimeout(() => errorModal.classList.add('d-none'), 5000);
             }
            return;
        }
        if (!formData.roomNumber || !formData.issueTitle || !formData.description) {
            console.error("Missing required fields.");
            return;
        }

        setLoading(true);
        try {
            await createNewIssue(userId, formData, nextDisplayId);
            
            // Show Success Message 
            const successMessage = document.getElementById('success-message');
            if(successMessage) {
                 successMessage.classList.remove('d-none');
                 setTimeout(() => successMessage.classList.add('d-none'), 3000);
            }

            // Reset Form
            setFormData({
                roomNumber: "",
                issueTitle: "",
                description: "",
                priority: "Medium",
                imageFile: null,
            });

        } catch (error) {
            console.error("Submission error: ", error);
             // Show Submission Error Message
             const errorSubmissionModal = document.getElementById('error-submission-modal');
             if(errorSubmissionModal) {
                 errorSubmissionModal.classList.remove('d-none');
                 setTimeout(() => errorSubmissionModal.classList.add('d-none'), 5000);
             }
        } finally {
            setLoading(false);
        }
    };
    
    // --- TABLE HANDLERS (Interface 2) ---

    const handleUpdateField = async (id, field, value) => {
        if (!userId) return;
        try {
            await updateIssueField(userId, id, field, value);
        } catch (error) {
            console.error("Update error: ", error);
        }
    };

    // --- FILTERED DATA (Client-side Search) ---
    const filteredFirs = useMemo(() => {
        return firs.filter(fir => {
            const searchMatch = fir.roomNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                fir.issueTitle?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                fir.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                fir.displayId?.toLowerCase().includes(searchTerm.toLowerCase());
            
            return searchMatch;
        });
    }, [firs, searchTerm]);

    // --- DASHBOARD METRICS ---
    const totalIssues = firs.length;
    const pendingIssues = firs.filter(f => f.status === "Submitted" || f.status === "In Progress").length;
    const completedIssues = firs.filter(f => f.status === "Completed").length;
    const highPriorityIssues = firs.filter(f => f.priority === "High" || f.priority === "Critical").length;

    // --- RENDER FUNCTIONS ---

    const renderInterface1 = () => (
        <div className="container py-5">
            <div className="row justify-content-center">
                <div className="col-lg-8">
                    <div className="card shadow-lg border-0 rounded-3">
                        <div className="card-body p-4 p-md-5">
                            <h2 className="h4 fw-bold mb-4 text-dark border-bottom pb-2 d-flex align-items-center">
                                {getIconComponent('List', "me-2 text-primary fs-5")} New Maintenance Request 
                                <span className="ms-auto badge bg-primary fs-6">{nextDisplayId}</span>
                            </h2>
                            
                            {/* Success Message */}
                            <div id="success-message" className="d-none position-fixed top-0 end-0 mt-3 me-3 alert alert-success shadow-lg" role="alert" style={{zIndex: 1050}}>
                                <h4 className="alert-heading small fw-bold">Request Submitted!</h4>
                                <p className="mb-0 small">Your maintenance issue has been logged successfully.</p>
                            </div>
                            
                             {/* Auth Error Message */}
                             <div id="error-message-modal" className="d-none position-fixed top-0 end-0 mt-3 me-3 alert alert-danger shadow-lg" role="alert" style={{zIndex: 1050}}>
                                <h4 className="alert-heading small fw-bold">Connection Error</h4>
                                <p className="mb-0 small">Cannot submit form. Please ensure you are authenticated.</p>
                            </div>
                            
                            {/* Submission Error Message */}
                             <div id="error-submission-modal" className="d-none position-fixed top-0 end-0 mt-3 me-3 alert alert-danger shadow-lg" role="alert" style={{zIndex: 1050}}>
                                <h4 className="alert-heading small fw-bold">Submission Failed</h4>
                                <p className="mb-0 small">Check console for Firebase storage/database errors.</p>
                            </div>

                            <form onSubmit={handleSubmit} className="row g-3">
                                {/* Room Number */}
                                <div className="col-md-6">
                                    <label htmlFor="roomNumber" className="form-label small fw-medium text-secondary">Room/Location</label>
                                    <input 
                                        type="text" 
                                        name="roomNumber" 
                                        id="roomNumber"
                                        value={formData.roomNumber} 
                                        onChange={handleFormChange}
                                        placeholder="e.g., Room 301 or Lobby A"
                                        required
                                        className="form-control"
                                    />
                                </div>

                                {/* Issue Title */}
                                <div className="col-md-6">
                                    <label htmlFor="issueTitle" className="form-label small fw-medium text-secondary">Issue Title</label>
                                    <input 
                                        type="text" 
                                        name="issueTitle" 
                                        id="issueTitle"
                                        value={formData.issueTitle} 
                                        onChange={handleFormChange}
                                        placeholder="e.g., AC is making noise"
                                        required
                                        className="form-control"
                                    />
                                </div>

                                {/* Description */}
                                <div className="col-12">
                                    <label htmlFor="description" className="form-label small fw-medium text-secondary">Detailed Description</label>
                                    <textarea
                                        name="description" 
                                        id="description"
                                        value={formData.description} 
                                        onChange={handleFormChange}
                                        placeholder="Describe the issue in detail..."
                                        rows="4"
                                        required
                                        className="form-control"
                                    />
                                </div>
                                
                                {/* Priority Selection */}
                                <div className="col-md-6">
                                    <label htmlFor="priority" className="form-label small fw-medium text-secondary">Suggested Priority</label>
                                    <select
                                        name="priority"
                                        id="priority"
                                        value={formData.priority}
                                        onChange={handleFormChange}
                                        className="form-select"
                                    >
                                        {PRIORITY_OPTIONS.map(p => (
                                            <option key={p} value={p}>{p}</option>
                                        ))}
                                    </select>
                                </div>


                                {/* Image Upload */}
                                <div className="col-md-6">
                                    <label htmlFor="imageFile" className="form-label small fw-medium text-secondary">Photo/Evidence (Optional)</label>
                                    <div className="input-group">
                                        <input 
                                            type="file" 
                                            id="imageFile"
                                            accept="image/*"
                                            onChange={handleFileChange}
                                            className="form-control"
                                        />
                                        <label className="input-group-text">
                                            {getIconComponent('Upload', "text-muted fs-6")}
                                        </label>
                                    </div>
                                    {formData.imageFile && (
                                        <div className="small text-muted mt-1">
                                            {formData.imageFile.name}
                                        </div>
                                    )}
                                </div>

                                <div className="col-12 mt-4">
                                    <button 
                                        type="submit"
                                        disabled={loading || !userId}
                                        className="btn btn-primary btn-lg w-100 shadow-sm d-flex align-items-center justify-content-center"
                                    >
                                        {loading ? (
                                            <>
                                                {getIconComponent('Spinner', "me-2")} Submitting...
                                            </>
                                        ) : (
                                            <>
                                                {getIconComponent('PaperPlane', "me-2")} Submit Maintenance Request
                                            </>
                                        )}
                                    </button>
                                </div>
                                {!userId && (
                                     <p className="text-center text-danger small mt-3 mb-0">Waiting for connection and authentication...</p>
                                )}
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderInterface2 = () => (
        <div className="container-fluid py-5">
            <h2 className="h3 fw-bold mb-4 text-dark d-flex align-items-center">
                {getIconComponent('Toolbox', "me-3 text-primary fs-4")} Technician Dashboard
            </h2>

            {/* Filters and Search */}
            <div className="card mb-4 shadow-sm">
                <div className="card-body">
                    <div className="row g-3">
                        {/* Search */}
                        <div className="col-md-5">
                            <div className="input-group">
                                <span className="input-group-text">{getIconComponent('Search', "text-muted fs-6")}</span>
                                <input
                                    type="text"
                                    placeholder="Search by ID, Room, or Title..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="form-control"
                                />
                            </div>
                        </div>

                        {/* Priority Filter */}
                        <div className="col-md-3">
                            <select
                                value={priorityFilter}
                                onChange={(e) => setPriorityFilter(e.target.value)}
                                className="form-select"
                            >
                                <option value="All">All Priorities</option>
                                {PRIORITY_OPTIONS.map(p => (
                                    <option key={p} value={p}>{p}</option>
                                ))}
                            </select>
                        </div>

                        {/* Department Filter */}
                        <div className="col-md-4">
                            <select
                                value={departmentFilter}
                                onChange={(e) => setDepartmentFilter(e.target.value)}
                                className="form-select"
                            >
                                <option value="All">All Departments</option>
                                {DEPARTMENT_OPTIONS.map(d => (
                                    <option key={d} value={d}>{d}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="card shadow-lg border-0">
                <div className="card-body p-0 overflow-auto">
                    {loading && (
                        <div className="p-5 text-center text-primary d-flex align-items-center justify-content-center">
                            {getIconComponent('Spinner', "me-2 fs-5")} Syncing Real-Time Data...
                        </div>
                    )}
                    {!loading && filteredFirs.length === 0 && (
                        <div className="p-5 text-center text-muted">
                            No maintenance issues found matching your criteria.
                        </div>
                    )}
                    {!loading && filteredFirs.length > 0 && (
                        <table className="table table-hover table-striped table-responsive mb-0">
                            <thead className="table-light">
                                <tr>
                                    <th scope="col" className="small text-uppercase">ID / Room</th>
                                    <th scope="col" className="small text-uppercase">Issue Title & Details</th>
                                    <th scope="col" className="small text-uppercase">Priority</th>
                                    <th scope="col" className="small text-uppercase">Status</th>
                                    <th scope="col" className="small text-uppercase">Department</th>
                                    <th scope="col" className="small text-uppercase">Image</th>
                                    <th scope="col" className="small text-uppercase">Submitted</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredFirs.map((fir) => (
                                    <tr key={fir.id}>
                                        <td className="align-middle">
                                            <div className="fw-bold text-primary small">{fir.displayId}</div>
                                            <div className="text-secondary small">{fir.roomNumber}</div>
                                        </td>
                                        <td className="align-middle" style={{minWidth: '200px'}}>
                                            <div className="fw-semibold text-dark">{fir.issueTitle}</div>
                                            <div className="text-muted small text-truncate" style={{maxWidth: '300px'}}>{fir.description}</div>
                                        </td>
                                        <td className="align-middle">
                                            <select
                                                value={fir.priority}
                                                onChange={(e) => handleUpdateField(fir.id, "priority", e.target.value)}
                                                className="form-select form-select-sm"
                                            >
                                                {PRIORITY_OPTIONS.map(p => (
                                                    <option key={p} value={p}>{p}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="align-middle">
                                            <select
                                                value={fir.status}
                                                onChange={(e) => handleUpdateField(fir.id, "status", e.target.value)}
                                                className={`form-select form-select-sm ${getStatusBadge(fir.status).replace('badge ', 'bg-')} bg-opacity-75`}
                                            >
                                                {STATUS_OPTIONS.map(s => (
                                                    <option key={s} value={s} className='bg-white text-dark'>{s}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="align-middle">
                                            <select
                                                value={fir.department}
                                                onChange={(e) => handleUpdateField(fir.id, "department", e.target.value)}
                                                className="form-select form-select-sm"
                                            >
                                                {DEPARTMENT_OPTIONS.map(d => (
                                                    <option key={d} value={d}>{d}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="align-middle">
                                            {fir.imageUrl ? (
                                                <a href={fir.imageUrl} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-primary small">View Image</a>
                                            ) : (
                                                <span className="text-muted small">N/A</span>
                                            )}
                                        </td>
                                        <td className="align-middle small text-muted">
                                            {fir.createdAt?.toDate ? fir.createdAt.toDate().toLocaleString() : 'N/A'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
            <div className="mt-4 p-3 border-top small text-muted">
                {getIconComponent('User', "me-1 fs-6")} Your User ID (for data access): <span className="text-monospace bg-light p-1 rounded small">{userId || "Connecting..."}</span>
            </div>
        </div>
    );

    const renderDashboard = () => (
        <div className="container-fluid py-5">
            <h2 className="h3 fw-bold mb-4 text-dark d-flex align-items-center">
                {getIconComponent('Home', "me-3 text-primary fs-4")} Hotel Maintenance Overview
            </h2>
            <p className="lead text-secondary mb-5 d-flex align-items-center">
                {getIconComponent('Calendar', "me-2 text-secondary fs-6")} {currentDateTime.toLocaleString()}
            </p>

            {/* Metric Tiles */}
            <div className="row g-4 mb-5">
                <div className="col-lg-3 col-md-6">
                    <DashboardTile 
                        iconName="Zap" 
                        title="Total Issues" 
                        value={totalIssues} 
                        bgColor="bg-primary" 
                    />
                </div>
                <div className="col-lg-3 col-md-6">
                    <DashboardTile 
                        iconName="Clock" 
                        title="Pending (Submitted/In Progress)" 
                        value={pendingIssues} 
                        bgColor="bg-warning text-dark" 
                    />
                </div>
                <div className="col-lg-3 col-md-6">
                    <DashboardTile 
                        iconName="ShieldAlert" 
                        title="High/Critical Priority" 
                        value={highPriorityIssues} 
                        bgColor="bg-danger" 
                    />
                </div>
                <div className="col-lg-3 col-md-6">
                    <DashboardTile 
                        iconName="Check" 
                        title="Completed" 
                        value={completedIssues} 
                        bgColor="bg-success" 
                    />
                </div>
            </div>
            
            {/* Quick View (Top 5 Pending) */}
            <h3 className="h5 fw-semibold mb-3 text-secondary border-bottom pb-2">Top 5 Pending Issues</h3>
            <div className="card shadow-lg border-0">
                <div className="list-group list-group-flush">
                    {firs.filter(f => f.status === "Submitted" || f.status === "In Progress").slice(0, 5).map(fir => (
                        <div key={fir.id} className="list-group-item d-flex justify-content-between align-items-center py-3">
                            <div>
                                <div className="fw-semibold text-dark">{fir.issueTitle} <span className="small text-muted">({fir.displayId})</span></div>
                                <div className="small text-secondary">Room: {fir.roomNumber} - Priority: <span className="fw-bold text-danger">{fir.priority}</span></div>
                            </div>
                            <span className={getStatusBadge(fir.status)}>
                                {fir.status}
                            </span>
                        </div>
                    ))}
                    {firs.filter(f => f.status === "Submitted" || f.status === "In Progress").length === 0 && (
                         <p className="text-center text-muted py-4 mb-0">No active pending issues.</p>
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <div className="d-flex bg-light min-vh-100">
            {/* Sidebar Navigation */}
            <nav className="d-flex flex-column flex-shrink-0 p-3 text-white bg-dark shadow-sm" style={{width: '280px'}}>
                <a href="#" className="d-flex align-items-center mb-3 mb-md-0 me-md-auto text-white text-decoration-none">
                    <span className="fs-4 fw-extrabold text-info">Hotel FIR System</span>
                </a>
                <hr className="text-white-50"/>
                <ul className="nav nav-pills flex-column mb-auto">
                    <li className="nav-item mb-2">
                        <button
                            onClick={() => setTab("dashboard")}
                            className={`btn w-100 text-start py-2 px-3 d-flex align-items-center ${tab === "dashboard" ? "btn-info text-dark shadow-sm" : "btn-dark text-white-50"}`}
                        >
                            {getIconComponent('Chart', "me-3 fs-5")} Dashboard
                        </button>
                    </li>
                    <li className="mb-2">
                        <button
                            onClick={() => setTab("interface1")}
                            className={`btn w-100 text-start py-2 px-3 d-flex align-items-center ${tab === "interface1" ? "btn-info text-dark shadow-sm" : "btn-dark text-white-50"}`}
                        >
                            {getIconComponent('List', "me-3 fs-5")} Submit Issue (Interface 1)
                        </button>
                    </li>
                    <li className="mb-2">
                        <button
                            onClick={() => setTab("interface2")}
                            className={`btn w-100 text-start py-2 px-3 d-flex align-items-center ${tab === "interface2" ? "btn-info text-dark shadow-sm" : "btn-dark text-white-50"}`}
                        >
                            {getIconComponent('Toolbox', "me-3 fs-5")} Manage Issues (Interface 2)
                        </button>
                    </li>
                </ul>
                <hr className="text-white-50"/>
                <div className="dropdown">
                    <span className="d-flex align-items-center text-white text-decoration-none" id="dropdownUser1">
                        {/* Note: data-bs-toggle is handled by Bootstrap JS, which is now loaded */}
                        {getIconComponent('User', "me-2 fs-5 text-secondary")}
                        <strong className="small">{userId ? `User: ${userId.substring(0, 8)}...` : 'Connecting...'}</strong>
                    </span>
                </div>
            </nav>

            {/* Main Content */}
            <main className="flex-grow-1 overflow-auto">
                {tab === "dashboard" && renderDashboard()}
                {tab === "interface1" && renderInterface1()}
                {tab === "interface2" && renderInterface2()}
            </main>
        </div>
    );
};

export default App;