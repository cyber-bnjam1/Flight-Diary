// ==========================================
// FIREBASE CONFIGURATION
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyCUmAI6czL0IXczp8FgJL4aOG7B8_aAkHk",
    authDomain: "flight-diary-6be50.firebaseapp.com",
    projectId: "flight-diary-6be50",
    storageBucket: "flight-diary-6be50.firebasestorage.app",
    messagingSenderId: "417972476833",
    appId: "1:417972476833:web:bc820c662dc9bb3f7f89e0"
};

let app, auth, db;
let currentUser = null;
let isOnline = navigator.onLine;

try {
    app = firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch(err => {
        if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
            console.error('Persistence error:', err);
        }
    });
} catch (error) {
    console.log('Firebase not initialized - running in offline mode');
}

// ==========================================
// GLOBAL VARIABLES
// ==========================================
let flights = [];
let airportsDB = [];
let currentFlightId = null;
let map = null;
let mapMarkers = [];          // FIX: track all map layers for proper cleanup
let mapPolylines = [];
let mapTileLayer = null;      // FIX: track tile layer to avoid duplication
let charts = {};
let pendingSync = false;
let searchDebounceTimers = {}; // FIX: debounce timers per input type

// Pagination
const FLIGHTS_PER_PAGE = 20;
let currentPage = 1;
let currentFilter = 'all';

// Dark mode by time
let darkModeTimer = null;

// Offline queue
let offlineQueue = [];

const aircraftSpeeds = {
    'A318': 780, 'A319': 820, 'A320': 840, 'A321': 850,
    'A319neo': 830, 'A320neo': 840, 'A321neo': 860,
    'A330-200': 880, 'A330-300': 880, 'A330-900': 880,
    'A350-900': 900, 'A350-1000': 900, 'A380': 900,
    'B737-700': 830, 'B737-800': 840, 'B737-900': 850,
    'B737MAX7': 840, 'B737MAX8': 850, 'B737MAX9': 850,
    'B747-400': 910, 'B747-8': 920, 'B757-200': 850,
    'B767-300': 870, 'B777-200': 890, 'B777-300': 900,
    'B777X': 920, 'B787-8': 900, 'B787-9': 900, 'B787-10': 900,
    'E170': 780, 'E175': 790, 'E190': 820, 'E195': 830,
    'E190-E2': 840, 'E195-E2': 850,
    'CRJ-200': 780, 'CRJ-700': 790, 'CRJ-900': 800, 'CRJ-1000': 820,
    'Q400': 550, 'SpaceJet': 830,
    'ATR42': 550, 'ATR72': 550, 'DHC8': 500,
    'A220-100': 850, 'A220-300': 860,
    'SSJ100': 830, 'MC21': 850, 'C919': 840, 'other': 850
};

const classLabels = { economy: 'Économique', premium: 'Premium', business: 'Affaires', first: 'Première' };
const reasonLabels = { leisure: 'Loisir', business: 'Professionnel', family: 'Famille', other: 'Autre' };

// ==========================================
// DARK MODE BY TIME
// ==========================================
function applyAutoDarkMode() {
    const hour = new Date().getHours();
    const isDark = hour < 6 || hour >= 20;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    // Schedule next check at next hour boundary
    const now = new Date();
    const msUntilNextHour = (60 - now.getMinutes()) * 60000 - now.getSeconds() * 1000;
    clearTimeout(darkModeTimer);
    darkModeTimer = setTimeout(applyAutoDarkMode, msUntilNextHour);
}

// ==========================================
// SKELETON LOADERS
// ==========================================
function showSkeletonLoaders(count = 3) {
    const container = document.getElementById('flights-list');
    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.classList.add('hidden');
    container.innerHTML = Array.from({ length: count }, () => `
        <div class="glass-card rounded-2xl p-4 skeleton-card">
            <div class="flex items-start justify-between mb-3">
                <div class="flex items-center gap-3">
                    <div class="skeleton-box w-12 h-12 rounded-xl"></div>
                    <div>
                        <div class="skeleton-box h-5 w-32 mb-2 rounded"></div>
                        <div class="skeleton-box h-3 w-24 rounded"></div>
                    </div>
                </div>
                <div class="skeleton-box h-6 w-16 rounded-lg"></div>
            </div>
            <div class="skeleton-box h-4 w-full rounded mt-2"></div>
        </div>
    `).join('');
}

function injectSkeletonStyles() {
    if (document.getElementById('skeleton-styles')) return;
    const style = document.createElement('style');
    style.id = 'skeleton-styles';
    style.textContent = `
        @keyframes shimmer {
            0% { background-position: -200% 0; }
            100% { background-position: 200% 0; }
        }
        .skeleton-box {
            background: linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.05) 75%);
            background-size: 200% 100%;
            animation: shimmer 1.5s infinite;
        }
        @keyframes cardEntrance {
            from { opacity: 0; transform: translateY(16px); }
            to   { opacity: 1; transform: translateY(0); }
        }
        .flight-card-enter {
            animation: cardEntrance 0.35s ease-out both;
        }
        @keyframes toastIn {
            from { opacity: 0; transform: translateY(20px) translateX(-50%); }
            to   { opacity: 1; transform: translateY(0) translateX(-50%); }
        }
        @keyframes toastOut {
            from { opacity: 1; }
            to   { opacity: 0; }
        }
        @keyframes modalIn {
            from { opacity: 0; transform: scale(0.96); }
            to   { opacity: 1; transform: scale(1); }
        }
        .modal-animate { animation: modalIn 0.25s ease-out; }
        @keyframes statCount {
            from { transform: scale(0.8); opacity: 0; }
            to   { transform: scale(1); opacity: 1; }
        }
        .stat-animate { animation: statCount 0.4s cubic-bezier(.34,1.56,.64,1) both; }
        .light-theme-overlay {
            position: fixed; inset: 0; pointer-events: none;
            background: rgba(255,255,255,0.04); z-index: 0;
            transition: background 1s;
        }
    `;
    document.head.appendChild(style);
}

// ==========================================
// AUTHENTICATION
// ==========================================
function signInWithGoogle() {
    if (!auth) { showToast('Firebase non configuré'); return; }
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/userinfo.email');
    provider.addScope('https://www.googleapis.com/auth/userinfo.profile');
    auth.signInWithPopup(provider)
        .then(result => { currentUser = result.user; updateAuthUI(); loadUserData(); showToast('Connecté avec succès !'); })
        .catch(err => showToast('Erreur de connexion: ' + err.message));
}

function signOut() {
    if (!auth) return;
    auth.signOut()
        .then(() => {
            currentUser = null; updateAuthUI();
            flights = [];
            localStorage.removeItem('flightDiary_flights');
            renderFlights(); updateStats(); refreshMap();
            showToast('Déconnecté');
        })
        .catch(() => showToast('Erreur de déconnexion'));
}

function updateAuthUI() {
    const signInBtn = document.getElementById('google-signin-btn');
    const signOutBtn = document.getElementById('signout-btn');
    const userInfo = document.getElementById('user-info');
    const userAvatar = document.getElementById('user-avatar');
    const userName = document.getElementById('user-name');
    const userEmail = document.getElementById('user-email');
    if (currentUser) {
        signInBtn.classList.add('hidden');
        signOutBtn.classList.remove('hidden');
        userInfo.classList.remove('hidden');
        userAvatar.src = currentUser.photoURL || '';
        userName.textContent = currentUser.displayName || 'Utilisateur';
        userEmail.textContent = currentUser.email || '';
        updateSyncStatus(true, 'Synchronisé');
    } else {
        signInBtn.classList.remove('hidden');
        signOutBtn.classList.add('hidden');
        userInfo.classList.add('hidden');
        updateSyncStatus(false, 'Hors ligne');
    }
}

function updateSyncStatus(online, text) {
    const indicator = document.getElementById('sync-indicator');
    const syncText = document.getElementById('sync-text');
    if (!indicator || !syncText) return;
    indicator.className = online
        ? 'w-2 h-2 rounded-full bg-emerald-500 syncing'
        : 'w-2 h-2 rounded-full bg-gray-500';
    syncText.textContent = text;
}

// ==========================================
// DATA SYNC WITH CONFLICT RESOLUTION
// ==========================================
async function loadUserData() {
    if (!currentUser || !db) return;
    try {
        updateSyncStatus(true, 'Chargement...');
        const doc = await db.collection('users').doc(currentUser.uid).get();
        if (doc.exists) {
            const remoteData = doc.data();
            const remoteFlights = remoteData.flights || [];
            const remoteTimestamp = remoteData.lastSync?.toMillis() || 0;
            const localTimestamp = parseInt(localStorage.getItem('flightDiary_lastModified') || '0');

            // FIX: Conflict resolution — merge by id, remote wins if newer
            if (remoteTimestamp >= localTimestamp) {
                // Remote is newer or equal: use remote as base, add local-only entries
                const remoteIds = new Set(remoteFlights.map(f => f.id));
                const localOnly = flights.filter(f => !remoteIds.has(f.id));
                flights = [...remoteFlights, ...localOnly];
            } else {
                // Local is newer: merge remote entries not present locally
                const localIds = new Set(flights.map(f => f.id));
                const remoteOnly = remoteFlights.filter(f => !localIds.has(f.id));
                flights = [...flights, ...remoteOnly];
            }
            saveFlightsToLocal();
            renderFlights(); updateStats(); refreshMap();
        } else {
            await syncData();
        }
        updateSyncStatus(true, 'Synchronisé');
    } catch (error) {
        console.error('Load error:', error);
        updateSyncStatus(false, 'Erreur sync');
        loadFlightsFromLocal();
    }
}

async function syncData() {
    if (!currentUser || !db) { showToast('Connectez-vous pour synchroniser'); return; }
    if (!isOnline) { showToast('Pas de connexion internet'); pendingSync = true; return; }
    try {
        updateSyncStatus(true, 'Synchronisation...');
        // FIX: Read remote first, merge, then write (conflict-safe)
        const doc = await db.collection('users').doc(currentUser.uid).get();
        let finalFlights = [...flights];
        if (doc.exists) {
            const remoteFlights = doc.data().flights || [];
            const localIds = new Set(flights.map(f => f.id));
            const remoteOnly = remoteFlights.filter(f => !localIds.has(f.id));
            finalFlights = [...flights, ...remoteOnly];
        }
        flights = finalFlights;
        await db.collection('users').doc(currentUser.uid).set({
            flights,
            lastSync: firebase.firestore.FieldValue.serverTimestamp(),
            userEmail: currentUser.email,
            userName: currentUser.displayName
        }, { merge: true });
        saveFlightsToLocal();
        updateSyncStatus(true, 'Synchronisé');
        showToast('Données synchronisées !');
        pendingSync = false;
        // Flush offline queue
        if (offlineQueue.length > 0) offlineQueue = [];
    } catch (error) {
        console.error('Sync error:', error);
        updateSyncStatus(false, 'Erreur sync');
        showToast('Erreur de synchronisation');
        pendingSync = true;
    }
}

function saveFlightsToLocal() {
    localStorage.setItem('flightDiary_flights', JSON.stringify(flights));
    localStorage.setItem('flightDiary_lastModified', Date.now().toString());
}

function loadFlightsFromLocal() {
    const saved = localStorage.getItem('flightDiary_flights');
    if (saved) {
        try { flights = JSON.parse(saved); } catch { flights = []; }
    }
    renderFlights(); updateStats();
}

// ==========================================
// ROBUST OFFLINE MANAGEMENT
// ==========================================
function queueOfflineOperation(type, data) {
    offlineQueue.push({ type, data, timestamp: Date.now() });
    localStorage.setItem('flightDiary_offlineQueue', JSON.stringify(offlineQueue));
}

async function flushOfflineQueue() {
    if (!isOnline || !currentUser || offlineQueue.length === 0) return;
    showToast(`Synchronisation de ${offlineQueue.length} action(s) hors-ligne...`);
    offlineQueue = [];
    localStorage.removeItem('flightDiary_offlineQueue');
    await syncData();
}

function loadOfflineQueue() {
    const saved = localStorage.getItem('flightDiary_offlineQueue');
    if (saved) { try { offlineQueue = JSON.parse(saved); } catch { offlineQueue = []; } }
}

// ==========================================
// AIRPORTS DATA
// ==========================================
async function loadAirports() {
    try {
        const response = await fetch('airports.js');
        const text = await response.text();
        const match = text.match(/const AirportsDB = (\[[\s\S]*?\]);/);
        if (match) {
            airportsDB = eval(match[1]);
            console.log(`Loaded ${airportsDB.length} airports`);
        }
    } catch (error) {
        console.error('Error loading airports:', error);
        showToast('Erreur de chargement des aéroports');
    }
}

function getAirport(code) {
    return airportsDB.find(a => a.code === code.toUpperCase());
}

// FIX: IATA code validation (3 uppercase letters)
function isValidIATA(code) {
    return /^[A-Z]{3}$/.test(code.toUpperCase());
}

// FIX: Airport search with debounce
function searchAirport(query, type) {
    clearTimeout(searchDebounceTimers[type]);
    searchDebounceTimers[type] = setTimeout(() => _doSearchAirport(query, type), 180);
}

function _doSearchAirport(query, type) {
    const suggestionsDiv = document.getElementById(`${type}-suggestions`);
    const nameDiv = document.getElementById(`${type}-name`);
    if (query.length < 1) { suggestionsDiv.classList.add('hidden'); return; }
    const upperQuery = query.toUpperCase();
    const exactCode = airportsDB.filter(a => a.code.startsWith(upperQuery));
    const byName = airportsDB.filter(a =>
        !a.code.startsWith(upperQuery) &&
        (a.name.toUpperCase().includes(upperQuery) || a.city.toUpperCase().includes(upperQuery))
    );
    const matches = [...exactCode, ...byName].slice(0, 10);
    if (matches.length > 0) {
        suggestionsDiv.innerHTML = matches.map(a => `
            <div class="suggestion-item" onclick="selectAirport('${type}', '${a.code}', '${a.name.replace(/'/g, "\\'")}', '${a.city.replace(/'/g, "\\'")}')">
                <div class="flex items-center justify-between mb-1">
                    <span class="font-bold text-lg text-white">${a.code}</span>
                    <span class="text-xs text-gray-400">${a.country}</span>
                </div>
                <div class="text-sm text-gray-300">${a.name}</div>
                <div class="text-xs text-gray-500">${a.city}</div>
            </div>
        `).join('');
        suggestionsDiv.classList.remove('hidden');
    } else {
        suggestionsDiv.innerHTML = `<div class="suggestion-item" style="cursor:default"><div class="text-sm text-gray-400">Aucun aéroport trouvé</div></div>`;
        suggestionsDiv.classList.remove('hidden');
    }
}

function selectAirport(type, code, name, city) {
    document.getElementById(`${type}-code`).value = code;
    document.getElementById(`${type}-name`).textContent = `${name}, ${city}`;
    document.getElementById(`${type}-suggestions`).classList.add('hidden');
    // FIX: Validate IATA visually
    const input = document.getElementById(`${type}-code`);
    if (!isValidIATA(code)) {
        input.style.borderColor = '#ef4444';
    } else {
        input.style.borderColor = '';
    }
    calculateFlightDuration();
}

// ==========================================
// FLIGHT CALCULATIONS
// ==========================================

// FIX: Great-circle distance using Haversine — correct for transpacific routes
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    // The original formula was correct but produced wrong results on some transpacific routes
    // because intermediate map points were using arithmetic midpoints, not great-circle.
    // This pure Haversine result is always correct.
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function calculateFlightDuration() {
    const depCode = document.getElementById('departure-code').value.toUpperCase();
    const arrCode = document.getElementById('arrival-code').value.toUpperCase();
    const aircraft = document.getElementById('aircraft-type').value || 'other';
    const depAirport = getAirport(depCode);
    const arrAirport = getAirport(arrCode);
    const durationDisplay = document.getElementById('calculated-duration');
    const distanceDisplay = document.getElementById('distance-display');
    const durationInput = document.getElementById('flight-duration');
    if (!depAirport || !arrAirport) {
        durationDisplay.textContent = '--h --min';
        distanceDisplay.textContent = 'Distance: -- km';
        durationInput.value = '';
        return;
    }
    const distance = calculateDistance(depAirport.lat, depAirport.lng, arrAirport.lat, arrAirport.lng);
    const speed = aircraftSpeeds[aircraft] || 850;
    const totalTime = Math.round((distance / speed) * 60 + 30);
    const hours = Math.floor(totalTime / 60);
    const minutes = totalTime % 60;
    durationDisplay.textContent = `${hours}h ${minutes.toString().padStart(2, '0')}min`;
    distanceDisplay.textContent = `Distance: ${distance.toLocaleString()} km`;
    durationInput.value = totalTime;
}

// ==========================================
// GREAT-CIRCLE MAP PATH (FIX transpacific)
// ==========================================
function greatCirclePoints(lat1, lon1, lat2, lon2, segments = 60) {
    const toRad = d => d * Math.PI / 180;
    const toDeg = r => r * 180 / Math.PI;
    const points = [];
    for (let i = 0; i <= segments; i++) {
        const f = i / segments;
        const A = Math.sin((1 - f) * Math.PI) / Math.sin(Math.PI); // degenerate but kept
        // Proper spherical interpolation
        const d = 2 * Math.asin(Math.sqrt(
            Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2
        ));
        if (d === 0) { points.push([lat1, lon1]); continue; }
        const sA = Math.sin((1 - f) * d) / Math.sin(d);
        const sB = Math.sin(f * d) / Math.sin(d);
        const x = sA * Math.cos(toRad(lat1)) * Math.cos(toRad(lon1)) + sB * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2));
        const y = sA * Math.cos(toRad(lat1)) * Math.sin(toRad(lon1)) + sB * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2));
        const z = sA * Math.sin(toRad(lat1)) + sB * Math.sin(toRad(lat2));
        points.push([toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))]);
    }
    return points;
}

// ==========================================
// UI FUNCTIONS
// ==========================================
function toggleMenu() {
    const drawer = document.getElementById('menu-drawer');
    const overlay = document.getElementById('menu-overlay');
    const isOpen = drawer.classList.contains('open');
    drawer.classList.toggle('open', !isOpen);
    overlay.classList.toggle('open', !isOpen);
}

function showAddFlight(isEdit = false) {
    const modal = document.getElementById('add-modal');
    modal.classList.remove('hidden');
    const inner = modal.querySelector('.modal-content, .glass');
    if (inner) { inner.classList.add('modal-animate'); setTimeout(() => inner.classList.remove('modal-animate'), 300); }
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) modalContent.scrollTop = 0;
    if (!isEdit) {
        currentFlightId = null;
        document.getElementById('flight-form').reset();
        document.getElementById('departure-name').textContent = '';
        document.getElementById('arrival-name').textContent = '';
        document.getElementById('calculated-duration').textContent = '--h --min';
        document.getElementById('distance-display').textContent = 'Distance: -- km';
        document.getElementById('flight-date').valueAsDate = new Date();
        const now = new Date();
        document.getElementById('departure-time').value =
            `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    }
}

// FIX: Modal close on mobile — use touchend + prevent default propagation
function hideAddFlight() {
    const modal = document.getElementById('add-modal');
    modal.classList.add('hidden');
    document.getElementById('departure-suggestions').classList.add('hidden');
    document.getElementById('arrival-suggestions').classList.add('hidden');
}

function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.style.animation = 'toastIn 0.3s ease-out both';
    toast.classList.remove('opacity-0');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease-out both';
        setTimeout(() => { toast.classList.add('opacity-0'); toast.style.animation = ''; }, 300);
    }, 3000);
}

// ==========================================
// IATA VALIDATION IN FORM
// ==========================================
function validateIATAInput(input) {
    const val = input.value.toUpperCase();
    input.value = val.replace(/[^A-Z]/g, '').substring(0, 3);
    if (input.value.length === 3) {
        const airport = getAirport(input.value);
        if (!airport) {
            input.style.borderColor = '#ef4444';
            showToast(`Code IATA inconnu: ${input.value}`);
        } else {
            input.style.borderColor = '#10b981';
        }
    } else {
        input.style.borderColor = '';
    }
}

// ==========================================
// FLIGHT CRUD
// ==========================================
function saveFlight(e) {
    e.preventDefault();
    const departureCode = document.getElementById('departure-code').value.toUpperCase();
    const arrivalCode = document.getElementById('arrival-code').value.toUpperCase();

    // FIX: Validate IATA codes
    if (!isValidIATA(departureCode) || !isValidIATA(arrivalCode)) {
        showToast('Codes IATA invalides (3 lettres requis)');
        return;
    }

    const depAirport = getAirport(departureCode);
    const arrAirport = getAirport(arrivalCode);
    if (!depAirport || !arrAirport) {
        showToast('Aéroport non trouvé dans la base de données');
        return;
    }

    const distance = calculateDistance(depAirport.lat, depAirport.lng, arrAirport.lat, arrAirport.lng);

    const flight = {
        id: currentFlightId || Date.now().toString(),
        number: document.getElementById('flight-number').value,
        departure: {
            code: departureCode, name: depAirport.name, city: depAirport.city,
            country: depAirport.country, lat: depAirport.lat, lng: depAirport.lng,
            time: document.getElementById('departure-time').value
        },
        arrival: {
            code: arrivalCode, name: arrAirport.name, city: arrAirport.city,
            country: arrAirport.country, lat: arrAirport.lat, lng: arrAirport.lng
        },
        date: document.getElementById('flight-date').value,
        duration: parseInt(document.getElementById('flight-duration').value) || 0,
        aircraft: document.getElementById('aircraft-type').value,
        seat: document.getElementById('seat-number').value,
        class: document.getElementById('travel-class').value,
        reason: document.getElementById('travel-reason').value,
        notes: document.getElementById('flight-notes').value,
        distance,
        createdAt: currentFlightId
            ? (flights.find(f => f.id === currentFlightId)?.createdAt || new Date().toISOString())
            : new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    if (currentFlightId) {
        const idx = flights.findIndex(f => f.id === currentFlightId);
        if (idx !== -1) flights[idx] = flight;
    } else {
        flights.unshift(flight);
    }

    saveFlightsToLocal();
    currentPage = 1;
    renderFlights(currentFilter);
    updateStats();
    refreshMap();
    hideAddFlight();

    if (currentUser && isOnline) {
        syncData();
    } else {
        pendingSync = true;
        queueOfflineOperation('save', flight);
    }
    showToast(currentFlightId ? 'Vol modifié !' : 'Vol enregistré !');
}

// ==========================================
// PAGINATION + RENDER
// ==========================================
function renderFlights(filter = 'all') {
    currentFilter = filter;
    const container = document.getElementById('flights-list');
    const emptyState = document.getElementById('empty-state');
    let filteredFlights = [...flights];

    if (filter === 'year') {
        const yr = new Date().getFullYear();
        filteredFlights = flights.filter(f => new Date(f.date).getFullYear() === yr);
    } else if (filter === 'month') {
        const now = new Date();
        filteredFlights = flights.filter(f => {
            const d = new Date(f.date);
            return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
        });
    }

    const total = filteredFlights.length;
    const totalPages = Math.ceil(total / FLIGHTS_PER_PAGE);
    if (currentPage > totalPages) currentPage = Math.max(1, totalPages);

    if (total === 0) {
        container.innerHTML = '';
        emptyState.classList.remove('hidden');
        hidePagination();
        return;
    }
    emptyState.classList.add('hidden');

    const start = (currentPage - 1) * FLIGHTS_PER_PAGE;
    const pageFlights = filteredFlights.slice(start, start + FLIGHTS_PER_PAGE);

    const classColors = {
        economy: 'bg-green-500/20 text-green-400',
        premium: 'bg-blue-500/20 text-blue-400',
        business: 'bg-purple-500/20 text-purple-400',
        first: 'bg-amber-500/20 text-amber-400'
    };

    container.innerHTML = pageFlights.map((flight, idx) => {
        const date = new Date(flight.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
        const dH = Math.floor(flight.duration / 60);
        const dM = flight.duration % 60;
        const dStr = flight.duration > 0 ? `${dH}h${dM.toString().padStart(2, '0')}` : '';
        return `
        <div class="glass-card rounded-2xl p-4 btn-press flight-card-enter"
             style="animation-delay:${idx * 0.05}s"
             onclick="showFlightDetail('${flight.id}')">
            <div class="flex items-start justify-between mb-3">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm font-bold">
                        ✈️
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="font-bold text-lg">${flight.departure.code}</span>
                            <i data-lucide="arrow-right" class="w-4 h-4 text-gray-400"></i>
                            <span class="font-bold text-lg">${flight.arrival.code}</span>
                        </div>
                        <p class="text-xs text-gray-400">${flight.number} • ${date}</p>
                    </div>
                </div>
                <span class="px-2 py-1 rounded-lg text-xs font-medium ${classColors[flight.class] || classColors.economy}">
                    ${classLabels[flight.class] || flight.class}
                </span>
            </div>
            <div class="flex items-center justify-between text-sm">
                <div class="flex items-center gap-2 text-gray-400 truncate">
                    <span class="truncate">${flight.departure.city || flight.departure.name}</span>
                    <div class="flex-shrink-0 h-px w-8 bg-gray-600 relative">
                        <i data-lucide="plane" class="w-3 h-3 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-blue-400"></i>
                    </div>
                    <span class="truncate">${flight.arrival.city || flight.arrival.name}</span>
                </div>
                <div class="text-right flex-shrink-0 ml-2">
                    <span class="text-gray-500 block">${(flight.distance || 0).toLocaleString()} km</span>
                    ${dStr ? `<span class="text-xs text-blue-400">${dStr}</span>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');

    lucide.createIcons();
    document.getElementById('menu-flight-count').textContent =
        `${flights.length} vol${flights.length > 1 ? 's' : ''} enregistré${flights.length > 1 ? 's' : ''}`;
    renderPagination(totalPages, total);
}

function renderPagination(totalPages, total) {
    let pag = document.getElementById('pagination-bar');
    if (!pag) {
        pag = document.createElement('div');
        pag.id = 'pagination-bar';
        pag.className = 'flex items-center justify-center gap-3 mt-4 mb-6';
        document.getElementById('flights-list').after(pag);
    }
    if (totalPages <= 1) { pag.innerHTML = ''; return; }
    const start = (currentPage - 1) * FLIGHTS_PER_PAGE + 1;
    const end = Math.min(currentPage * FLIGHTS_PER_PAGE, total);
    pag.innerHTML = `
        <button onclick="gotoPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}
            class="px-3 py-2 rounded-lg glass text-sm ${currentPage === 1 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/10'}">
            ‹ Préc.
        </button>
        <span class="text-sm text-gray-400">${start}–${end} sur ${total}</span>
        <button onclick="gotoPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}
            class="px-3 py-2 rounded-lg glass text-sm ${currentPage === totalPages ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/10'}">
            Suiv. ›
        </button>`;
}

function hidePagination() {
    const pag = document.getElementById('pagination-bar');
    if (pag) pag.innerHTML = '';
}

function gotoPage(page) {
    currentPage = page;
    renderFlights(currentFilter);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function filterFlights(type) {
    currentPage = 1;
    document.querySelectorAll('[data-filter]').forEach(btn => {
        btn.classList.toggle('active-filter', btn.dataset.filter === type);
    });
    renderFlights(type);
}

function updateStats() {
    const totalFlights = flights.length;
    const totalDistance = flights.reduce((s, f) => s + (f.distance || 0), 0);
    const countries = new Set(flights.flatMap(f => [f.departure.country, f.arrival.country])).size;
    const totalHours = Math.round(flights.reduce((s, f) => s + (f.duration || 0), 0) / 60);

    // Animate stat numbers
    ['stat-flights', 'stat-distance', 'stat-countries', 'stat-hours'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.classList.remove('stat-animate'); void el.offsetWidth; el.classList.add('stat-animate'); }
    });

    const sf = document.getElementById('stat-flights');
    const sd = document.getElementById('stat-distance');
    const sc = document.getElementById('stat-countries');
    const sh = document.getElementById('stat-hours');
    if (sf) sf.textContent = totalFlights;
    if (sd) sd.innerHTML = `${totalDistance.toLocaleString()} <span class="text-sm font-normal">km</span>`;
    if (sc) sc.textContent = countries;
    if (sh) sh.textContent = totalHours;

    const hs = document.getElementById('header-stats');
    if (hs) hs.textContent = totalFlights > 0
        ? `${totalFlights} vol${totalFlights > 1 ? 's' : ''} • ${totalDistance.toLocaleString()} km`
        : 'Commencez votre journal';
}

// ==========================================
// MAP FUNCTIONS — FIX: memory leak prevention
// ==========================================
function initMap() {
    if (map) return; // FIX: guard against double-init

    map = L.map('map', { center: [20, 0], zoom: 2, zoomControl: false, attributionControl: false });

    // FIX: Store tile layer reference so it's not duplicated
    mapTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
    }).addTo(map);

    refreshMap();
}

function destroyMap() {
    // FIX: Proper cleanup to prevent memory leaks
    clearAllMapLayers();
    if (mapTileLayer) { mapTileLayer.remove(); mapTileLayer = null; }
    if (map) { map.off(); map.remove(); map = null; }
}

function clearAllMapLayers() {
    mapMarkers.forEach(m => { try { m.remove(); } catch {} });
    mapPolylines.forEach(p => { try { p.remove(); } catch {} });
    mapMarkers = [];
    mapPolylines = [];
}

function refreshMap() {
    if (!map) { initMap(); return; }

    // FIX: Remove all existing layers properly
    clearAllMapLayers();

    if (flights.length === 0) return;

    const bounds = [];

    flights.forEach(flight => {
        const dep = [flight.departure.lat, flight.departure.lng];
        const arr = [flight.arrival.lat, flight.arrival.lng];
        bounds.push(dep, arr);

        const depMarker = L.circleMarker(dep, {
            radius: 6, fillColor: '#3b82f6', color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.8
        }).addTo(map).bindPopup(`<b>${flight.departure.code}</b><br>${flight.departure.name}<br><small>Départ: ${flight.number}</small>`);
        mapMarkers.push(depMarker);

        const arrMarker = L.circleMarker(arr, {
            radius: 6, fillColor: '#8b5cf6', color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.8
        }).addTo(map).bindPopup(`<b>${flight.arrival.code}</b><br>${flight.arrival.name}<br><small>Arrivée: ${flight.number}</small>`);
        mapMarkers.push(arrMarker);

        // FIX: Use great-circle path for transpacific routes
        const gcPoints = greatCirclePoints(
            flight.departure.lat, flight.departure.lng,
            flight.arrival.lat, flight.arrival.lng
        );
        const path = L.polyline(gcPoints, {
            color: '#3b82f6', weight: 2, opacity: 0.6, dashArray: '5, 10', className: 'flight-path'
        }).addTo(map);
        mapPolylines.push(path);
    });

    if (bounds.length > 0) map.fitBounds(bounds, { padding: [50, 50] });
}

// ==========================================
// FLIGHT DETAIL
// ==========================================
function showFlightDetail(id) {
    const flight = flights.find(f => f.id === id);
    if (!flight) return;
    currentFlightId = id;
    const date = new Date(flight.date).toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    const dH = Math.floor(flight.duration / 60);
    const dM = flight.duration % 60;

    document.getElementById('detail-content').innerHTML = `
        <div class="space-y-6">
            <div class="flex items-center justify-between">
                <div class="text-center">
                    <div class="text-3xl font-bold text-blue-400">${flight.departure.code}</div>
                    <div class="text-sm text-gray-400">${flight.departure.city || flight.departure.name}</div>
                    <div class="text-xs text-gray-500">${flight.departure.country}</div>
                    ${flight.departure.time ? `<div class="text-sm text-blue-400 mt-1">🕐 ${flight.departure.time}</div>` : ''}
                </div>
                <div class="flex-1 px-4">
                    <div class="h-px bg-gradient-to-r from-blue-500 to-purple-500 relative">
                        <i data-lucide="plane" class="w-5 h-5 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-blue-400 bg-gray-800 rounded-full p-1"></i>
                    </div>
                    <div class="text-center text-xs text-gray-500 mt-2">${(flight.distance || 0).toLocaleString()} km</div>
                    ${flight.duration > 0 ? `<div class="text-center text-xs text-blue-400">${dH}h${dM.toString().padStart(2, '0')}</div>` : ''}
                </div>
                <div class="text-center">
                    <div class="text-3xl font-bold text-purple-400">${flight.arrival.code}</div>
                    <div class="text-sm text-gray-400">${flight.arrival.city || flight.arrival.name}</div>
                    <div class="text-xs text-gray-500">${flight.arrival.country}</div>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div class="glass-card rounded-xl p-3">
                    <div class="text-xs text-gray-400 mb-1">N° de vol</div>
                    <div class="font-semibold">${flight.number}</div>
                </div>
                <div class="glass-card rounded-xl p-3">
                    <div class="text-xs text-gray-400 mb-1">Date</div>
                    <div class="font-semibold text-sm">${date}</div>
                </div>
            </div>
            ${flight.aircraft ? `<div class="glass-card rounded-xl p-3"><div class="text-xs text-gray-400 mb-1">Type d'avion</div><div class="font-semibold">${flight.aircraft}</div></div>` : ''}
            ${flight.seat ? `<div class="glass-card rounded-xl p-3"><div class="text-xs text-gray-400 mb-1">Siège</div><div class="font-semibold">${flight.seat}</div></div>` : ''}
            <div class="grid grid-cols-2 gap-4">
                <div class="glass-card rounded-xl p-3">
                    <div class="text-xs text-gray-400 mb-1">Classe</div>
                    <div class="font-semibold">${classLabels[flight.class] || flight.class}</div>
                </div>
                <div class="glass-card rounded-xl p-3">
                    <div class="text-xs text-gray-400 mb-1">Motif</div>
                    <div class="font-semibold">${reasonLabels[flight.reason] || flight.reason}</div>
                </div>
            </div>
            ${flight.notes ? `<div class="glass-card rounded-xl p-3"><div class="text-xs text-gray-400 mb-1">Notes</div><div class="text-sm text-gray-300">${flight.notes}</div></div>` : ''}
        </div>`;

    lucide.createIcons();
    const modal = document.getElementById('detail-modal');
    modal.classList.remove('hidden');
    // FIX: animate modal entrance
    const inner = modal.querySelector('.glass');
    if (inner) { inner.classList.add('modal-animate'); setTimeout(() => inner.classList.remove('modal-animate'), 300); }
}

// FIX: hideDetail with touchend support on mobile
function hideDetail() {
    document.getElementById('detail-modal').classList.add('hidden');
    currentFlightId = null;
}

function editCurrentFlight() {
    if (!currentFlightId) return;
    const flight = flights.find(f => f.id === currentFlightId);
    if (!flight) return;
    hideDetail();
    showAddFlight(true);
    setTimeout(() => {
        document.getElementById('flight-number').value = flight.number || '';
        document.getElementById('departure-code').value = flight.departure?.code || '';
        document.getElementById('departure-name').textContent = flight.departure?.name ? `${flight.departure.name}, ${flight.departure.city}` : '';
        document.getElementById('arrival-code').value = flight.arrival?.code || '';
        document.getElementById('arrival-name').textContent = flight.arrival?.name ? `${flight.arrival.name}, ${flight.arrival.city}` : '';
        document.getElementById('flight-date').value = flight.date || '';
        document.getElementById('departure-time').value = flight.departure?.time || '';
        document.getElementById('flight-duration').value = flight.duration || '';
        document.getElementById('aircraft-type').value = flight.aircraft || '';
        document.getElementById('seat-number').value = flight.seat || '';
        document.getElementById('travel-class').value = flight.class || 'economy';
        document.getElementById('travel-reason').value = flight.reason || 'leisure';
        document.getElementById('flight-notes').value = flight.notes || '';
        if (flight.duration > 0) {
            const h = Math.floor(flight.duration / 60), m = flight.duration % 60;
            document.getElementById('calculated-duration').textContent = `${h}h ${m.toString().padStart(2, '0')}min`;
        }
        if (flight.distance) document.getElementById('distance-display').textContent = `Distance: ${flight.distance.toLocaleString()} km`;
    }, 50);
}

function deleteCurrentFlight() {
    if (!currentFlightId) return;
    if (confirm('Supprimer ce vol ?')) {
        flights = flights.filter(f => f.id !== currentFlightId);
        saveFlightsToLocal();
        renderFlights(currentFilter); updateStats(); refreshMap(); hideDetail();
        if (currentUser && isOnline) syncData();
        else { pendingSync = true; queueOfflineOperation('delete', { id: currentFlightId }); }
        showToast('Vol supprimé');
    }
}

// ==========================================
// ENHANCED STATS
// ==========================================
function showStats() {
    document.getElementById('stats-modal').classList.remove('hidden');
    updateStatsModal();
}

function hideStats() { document.getElementById('stats-modal').classList.add('hidden'); }

function updateStatsModal() {
    Object.values(charts).forEach(c => { try { c.destroy(); } catch {} });
    charts = {};

    const totalDistance = flights.reduce((s, f) => s + (f.distance || 0), 0);
    const totalMinutes = flights.reduce((s, f) => s + (f.duration || 0), 0);
    const totalHours = Math.round(totalMinutes / 60);
    const totalDays = (totalHours / 24).toFixed(1);
    const equatorTimes = (totalDistance / 40075).toFixed(2);

    document.getElementById('stat-total-distance').textContent = `${totalDistance.toLocaleString()} km`;
    document.getElementById('stat-equator').textContent = equatorTimes;
    document.getElementById('stat-total-time').textContent = `${totalHours}h`;
    document.getElementById('stat-days').textContent = totalDays;

    // Flights by Month Chart
    const monthData = {};
    flights.forEach(f => {
        const d = new Date(f.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthData[key] = (monthData[key] || 0) + 1;
    });
    const sortedMonths = Object.keys(monthData).sort();
    const flightsChartEl = document.getElementById('flights-chart');
    if (flightsChartEl) {
        charts.flights = new Chart(flightsChartEl, {
            type: 'bar',
            data: {
                labels: sortedMonths.map(m => { const [y, mo] = m.split('-'); return `${mo}/${y.slice(2)}`; }),
                datasets: [{ label: 'Vols', data: sortedMonths.map(m => monthData[m]), backgroundColor: '#3b82f6', borderRadius: 6 }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
                    x: { ticks: { color: '#9ca3af' }, grid: { display: false } }
                }
            }
        });
    }

    // Top Routes
    const routeCount = {};
    flights.forEach(f => { const r = `${f.departure.code}-${f.arrival.code}`; routeCount[r] = (routeCount[r] || 0) + 1; });
    const topRoutes = Object.entries(routeCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxRoute = topRoutes[0]?.[1] || 1;
    document.getElementById('top-routes-list').innerHTML = topRoutes.map(([r, c]) => `
        <div class="flex items-center gap-3">
            <span class="text-sm font-medium w-24">${r}</span>
            <div class="flex-1 stat-progress-bar"><div class="stat-progress-fill bg-blue-500" style="width:${(c/maxRoute)*100}%"></div></div>
            <span class="text-sm text-gray-400 w-8 text-right">${c}</span>
        </div>`).join('') || '<p class="text-sm text-gray-500">Aucune donnée</p>';

    // Airlines
    const airlineCount = {};
    flights.forEach(f => { const a = f.number.substring(0, 2); airlineCount[a] = (airlineCount[a] || 0) + 1; });
    const topAirlines = Object.entries(airlineCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxAirline = topAirlines[0]?.[1] || 1;
    document.getElementById('airlines-list').innerHTML = topAirlines.map(([a, c]) => `
        <div class="flex items-center gap-3">
            <span class="text-sm font-medium w-24">${a}</span>
            <div class="flex-1 stat-progress-bar"><div class="stat-progress-fill bg-purple-500" style="width:${(c/maxAirline)*100}%"></div></div>
            <span class="text-sm text-gray-400 w-8 text-right">${c}</span>
        </div>`).join('') || '<p class="text-sm text-gray-500">Aucune donnée</p>';

    // Aircraft
    const aircraftCount = {};
    flights.forEach(f => { if (f.aircraft) aircraftCount[f.aircraft] = (aircraftCount[f.aircraft] || 0) + 1; });
    const topAircraft = Object.entries(aircraftCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxAircraft = topAircraft[0]?.[1] || 1;
    document.getElementById('aircraft-list').innerHTML = topAircraft.map(([a, c]) => `
        <div class="flex items-center gap-3">
            <span class="text-sm font-medium w-32 truncate">${a}</span>
            <div class="flex-1 stat-progress-bar"><div class="stat-progress-fill bg-amber-500" style="width:${(c/maxAircraft)*100}%"></div></div>
            <span class="text-sm text-gray-400 w-8 text-right">${c}</span>
        </div>`).join('') || '<p class="text-sm text-gray-500">Aucune donnée</p>';

    // Classes
    const classCount = { economy: 0, premium: 0, business: 0, first: 0 };
    flights.forEach(f => { if (classCount[f.class] !== undefined) classCount[f.class]++; });
    const totalClass = flights.length || 1;
    const classColors = { economy: 'bg-green-500', premium: 'bg-blue-500', business: 'bg-purple-500', first: 'bg-amber-500' };
    document.getElementById('class-distribution').innerHTML = Object.entries(classCount)
        .filter(([, c]) => c > 0)
        .map(([cls, c]) => `
            <div class="flex items-center justify-between">
                <span class="text-sm text-gray-300">${classLabels[cls]}</span>
                <div class="flex items-center gap-2">
                    <div class="w-32 stat-progress-bar"><div class="stat-progress-fill ${classColors[cls]}" style="width:${(c/totalClass)*100}%"></div></div>
                    <span class="text-sm text-gray-400 w-12 text-right">${c} (${Math.round((c/totalClass)*100)}%)</span>
                </div>
            </div>`).join('') || '<p class="text-sm text-gray-500">Aucune donnée</p>';

    // Reasons
    const reasonCount = {};
    flights.forEach(f => { reasonCount[f.reason] = (reasonCount[f.reason] || 0) + 1; });
    const topReasons = Object.entries(reasonCount).sort((a, b) => b[1] - a[1]);
    const maxReason = topReasons[0]?.[1] || 1;
    document.getElementById('reasons-list').innerHTML = topReasons.map(([r, c]) => `
        <div class="flex items-center gap-3">
            <span class="text-sm font-medium w-24">${reasonLabels[r] || r}</span>
            <div class="flex-1 stat-progress-bar"><div class="stat-progress-fill bg-emerald-500" style="width:${(c/maxReason)*100}%"></div></div>
            <span class="text-sm text-gray-400 w-8 text-right">${c}</span>
        </div>`).join('') || '<p class="text-sm text-gray-500">Aucune donnée</p>';

    // Records
    const longest = flights.reduce((max, f) => (f.distance > (max.distance || 0)) ? f : max, flights[0] || { distance: 0, number: '-', departure: {}, arrival: {} });
    const shortest = flights.reduce((min, f) => (f.distance < (min.distance || Infinity)) ? f : min, flights[0] || { distance: 0, number: '-', departure: {}, arrival: {} });
    const longestDur = flights.reduce((max, f) => (f.duration > (max.duration || 0)) ? f : max, flights[0] || { duration: 0, number: '-', departure: {}, arrival: {} });

    document.getElementById('records-list').innerHTML = `
        <div class="glass-card rounded-xl p-3 flex justify-between items-center">
            <div><div class="text-xs text-gray-400">Vol le plus long</div><div class="text-sm font-medium">${longest.number} (${(longest.distance||0).toLocaleString()} km)</div><div class="text-xs text-gray-500">${longest.departure.code} → ${longest.arrival.code}</div></div>
            <i data-lucide="trophy" class="w-5 h-5 text-yellow-400"></i>
        </div>
        <div class="glass-card rounded-xl p-3 flex justify-between items-center">
            <div><div class="text-xs text-gray-400">Vol le plus court</div><div class="text-sm font-medium">${shortest.number} (${(shortest.distance||0).toLocaleString()} km)</div><div class="text-xs text-gray-500">${shortest.departure.code} → ${shortest.arrival.code}</div></div>
            <i data-lucide="minimize-2" class="w-5 h-5 text-blue-400"></i>
        </div>
        <div class="glass-card rounded-xl p-3 flex justify-between items-center">
            <div><div class="text-xs text-gray-400">Plus longue durée</div><div class="text-sm font-medium">${longestDur.number} (${Math.floor((longestDur.duration||0)/60)}h${((longestDur.duration||0)%60).toString().padStart(2,'0')}min)</div><div class="text-xs text-gray-500">${longestDur.departure.code} → ${longestDur.arrival.code}</div></div>
            <i data-lucide="clock" class="w-5 h-5 text-purple-400"></i>
        </div>`;

    const avgDist = flights.length > 0 ? Math.round(totalDistance / flights.length) : 0;
    const uniqueAirports = new Set(flights.flatMap(f => [f.departure.code, f.arrival.code])).size;
    document.getElementById('detailed-stats').innerHTML = `
        <div class="glass-card rounded-xl p-3 flex justify-between"><span class="text-gray-400">Distance moyenne</span><span class="font-semibold">${avgDist} km</span></div>
        <div class="glass-card rounded-xl p-3 flex justify-between"><span class="text-gray-400">Aéroports uniques</span><span class="font-semibold">${uniqueAirports}</span></div>
        <div class="glass-card rounded-xl p-3 flex justify-between"><span class="text-gray-400">Premier vol</span><span class="font-semibold">${flights.length > 0 ? new Date(Math.min(...flights.map(f => new Date(f.date)))).toLocaleDateString('fr-FR') : '-'}</span></div>
        <div class="glass-card rounded-xl p-3 flex justify-between"><span class="text-gray-400">Dernier vol</span><span class="font-semibold">${flights.length > 0 ? new Date(Math.max(...flights.map(f => new Date(f.date)))).toLocaleDateString('fr-FR') : '-'}</span></div>`;

    lucide.createIcons();
}

// ==========================================
// AIRPORTS LIST
// ==========================================
function showVisitedAirports() {
    const modal = document.getElementById('airports-modal');
    const list = document.getElementById('visited-airports-list');
    const visited = new Map();
    flights.forEach(f => {
        if (!visited.has(f.departure.code)) visited.set(f.departure.code, f.departure);
        if (!visited.has(f.arrival.code)) visited.set(f.arrival.code, f.arrival);
    });
    const sorted = Array.from(visited.values()).sort((a, b) => a.code.localeCompare(b.code));
    list.innerHTML = sorted.map((a, i) => `
        <div class="glass-card rounded-xl p-3 flex items-center gap-3 flight-card-enter" style="animation-delay:${i * 0.04}s">
            <div class="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center font-bold text-blue-400 text-xs">${a.code}</div>
            <div class="flex-1 min-w-0">
                <div class="font-medium truncate">${a.name}</div>
                <div class="text-sm text-gray-400 truncate">${a.city}, ${a.country}</div>
            </div>
        </div>`).join('');
    modal.classList.remove('hidden');
}

function filterVisitedAirports(query) {
    document.querySelectorAll('#visited-airports-list > div').forEach(item => {
        item.style.display = item.textContent.toLowerCase().includes(query.toLowerCase()) ? 'flex' : 'none';
    });
}

function hideAirports() { document.getElementById('airports-modal').classList.add('hidden'); }

// ==========================================
// EXPORT — JSON + CSV
// ==========================================
function exportData(format = 'json') {
    if (format === 'csv') {
        exportCSV();
        return;
    }
    const data = {
        flights,
        exportDate: new Date().toISOString(),
        stats: {
            totalFlights: flights.length,
            totalDistance: flights.reduce((s, f) => s + (f.distance || 0), 0),
            totalCountries: new Set(flights.flatMap(f => [f.departure.country, f.arrival.country])).size,
            totalHours: Math.round(flights.reduce((s, f) => s + (f.duration || 0), 0) / 60)
        }
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    triggerDownload(blob, `flight-diary-export-${todayStr()}.json`);
    showToast('Export JSON téléchargé !');
}

function exportCSV() {
    const headers = ['N° vol', 'Date', 'Départ', 'Arrivée', 'Ville départ', 'Ville arrivée', 'Distance (km)', 'Durée (min)', 'Appareil', 'Classe', 'Motif', 'Siège', 'Notes'];
    const rows = flights.map(f => [
        f.number, f.date, f.departure.code, f.arrival.code,
        f.departure.city, f.arrival.city, f.distance, f.duration,
        f.aircraft, classLabels[f.class] || f.class, reasonLabels[f.reason] || f.reason,
        f.seat, `"${(f.notes || '').replace(/"/g, '""')}"`
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    triggerDownload(blob, `flight-diary-export-${todayStr()}.csv`);
    showToast('Export CSV téléchargé !');
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function todayStr() { return new Date().toISOString().split('T')[0]; }

function showTab(tab) {
    if (tab === 'stats') showStats();
    else if (tab === 'airports') showVisitedAirports();
}

// ==========================================
// EVENT LISTENERS & INIT
// ==========================================

// FIX: Close modals on mobile — use both click and touchend on backdrop
function setupModalClosers() {
    const modals = [
        { overlay: 'add-modal', exclude: '.modal-content', fn: hideAddFlight },
        { overlay: 'detail-modal', exclude: '.glass', fn: hideDetail },
        { overlay: 'stats-modal', exclude: '.glass', fn: hideStats },
        { overlay: 'airports-modal', exclude: '.glass', fn: hideAirports },
    ];

    modals.forEach(({ overlay, exclude, fn }) => {
        const el = document.getElementById(overlay);
        if (!el) return;
        const handler = (e) => {
            // Only close if the click/touch was on the backdrop (not inside the card)
            if (!e.target.closest(exclude)) {
                e.preventDefault();
                fn();
            }
        };
        el.addEventListener('click', handler);
        // FIX: touchend for iOS where click sometimes doesn't fire on backdrop
        el.addEventListener('touchend', handler, { passive: false });
    });
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('#departure-code') && !e.target.closest('#departure-suggestions')) {
        document.getElementById('departure-suggestions')?.classList.add('hidden');
    }
    if (!e.target.closest('#arrival-code') && !e.target.closest('#arrival-suggestions')) {
        document.getElementById('arrival-suggestions')?.classList.add('hidden');
    }
});

window.addEventListener('online', () => {
    isOnline = true;
    updateSyncStatus(currentUser !== null, currentUser ? 'En ligne' : 'Hors ligne');
    if (pendingSync && currentUser) flushOfflineQueue();
});

window.addEventListener('offline', () => {
    isOnline = false;
    updateSyncStatus(false, 'Hors ligne');
    showToast('Connexion perdue — mode hors-ligne activé');
});

document.addEventListener('DOMContentLoaded', async () => {
    injectSkeletonStyles();
    applyAutoDarkMode();
    lucide.createIcons();
    showSkeletonLoaders(4);
    await loadAirports();
    loadOfflineQueue();
    loadFlightsFromLocal();
    setTimeout(initMap, 100);
    setupModalClosers();

    if (auth) {
        auth.onAuthStateChanged(user => {
            currentUser = user;
            updateAuthUI();
            if (user) loadUserData();
        });
    }

    // FIX: Invalidate map on visibility change (prevent blank tile issue)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && map) {
            setTimeout(() => map.invalidateSize(), 200);
        }
    });

    // FIX: Safe area styles applied once after DOM ready
    document.querySelectorAll('#menu-drawer').forEach(el => {
        el.style.paddingTop = 'env(safe-area-inset-top)';
    });
});
