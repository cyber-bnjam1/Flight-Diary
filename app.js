// ==========================================
// FIREBASE CONFIGURATION - À REMPLACER
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyCUmAI6czL0IXczp8FgJL4aOG7B8_aAkHk",
    authDomain: "flight-diary-6be50.firebaseapp.com",
    projectId: "flight-diary-6be50",
    storageBucket: "flight-diary-6be50.firebasestorage.app",
    messagingSenderId: "417972476833",
    appId: "1:417972476833:web:bc820c662dc9bb3f7f89e0"
  };

// Initialize Firebase
let app, auth, db;
let currentUser = null;
let isOnline = navigator.onLine;

try {
    app = firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    
    // Enable offline persistence
    db.enablePersistence({ synchronizeTabs: true })
        .catch((err) => {
            if (err.code == 'failed-precondition') {
                console.log('Persistence failed: Multiple tabs open');
            } else if (err.code == 'unimplemented') {
                console.log('Persistence not supported by browser');
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
let mapMarkers = [];
let charts = {};
let pendingSync = false;

// Aircraft cruise speeds (km/h)
const aircraftSpeeds = {
    'A320': 840,
    'A321': 850,
    'A330': 880,
    'A350': 900,
    'A380': 900,
    'B737': 850,
    'B747': 920,
    'B777': 900,
    'B787': 900,
    'E190': 820,
    'CRJ': 780,
    'ATR': 550,
    'other': 850
};

const classLabels = { 
    economy: 'Économique', 
    premium: 'Premium', 
    business: 'Affaires', 
    first: 'Première' 
};

const reasonLabels = { 
    leisure: 'Loisir', 
    business: 'Professionnel', 
    family: 'Famille', 
    other: 'Autre' 
};

// ==========================================
// AUTHENTICATION FUNCTIONS
// ==========================================

function signInWithGoogle() {
    if (!auth) {
        showToast('Firebase non configuré');
        return;
    }
    
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/userinfo.email');
    provider.addScope('https://www.googleapis.com/auth/userinfo.profile');
    
    auth.signInWithPopup(provider)
        .then((result) => {
            currentUser = result.user;
            updateAuthUI();
            loadUserData();
            showToast('Connecté avec succès !');
        })
        .catch((error) => {
            console.error('Auth error:', error);
            showToast('Erreur de connexion: ' + error.message);
        });
}

function signOut() {
    if (!auth) return;
    
    auth.signOut()
        .then(() => {
            currentUser = null;
            updateAuthUI();
            flights = [];
            localStorage.removeItem('flightDiary_flights');
            renderFlights();
            updateStats();
            refreshMap();
            showToast('Déconnecté');
        })
        .catch((error) => {
            showToast('Erreur de déconnexion');
        });
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
    
    if (online) {
        indicator.className = 'w-2 h-2 rounded-full bg-emerald-500';
        indicator.classList.add('syncing');
    } else {
        indicator.className = 'w-2 h-2 rounded-full bg-gray-500';
        indicator.classList.remove('syncing');
    }
    syncText.textContent = text;
}

// ==========================================
// DATA SYNC FUNCTIONS
// ==========================================

async function loadUserData() {
    if (!currentUser || !db) return;
    
    try {
        updateSyncStatus(true, 'Chargement...');
        const doc = await db.collection('users').doc(currentUser.uid).get();
        
        if (doc.exists) {
            const data = doc.data();
            if (data.flights) {
                flights = data.flights;
                saveFlightsToLocal();
                renderFlights();
                updateStats();
                refreshMap();
            }
        } else {
            // First time user - save local data to cloud
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
    if (!currentUser || !db) {
        showToast('Connectez-vous pour synchroniser');
        return;
    }
    
    if (!isOnline) {
        showToast('Pas de connexion internet');
        return;
    }
    
    try {
        updateSyncStatus(true, 'Synchronisation...');
        
        await db.collection('users').doc(currentUser.uid).set({
            flights: flights,
            lastSync: firebase.firestore.FieldValue.serverTimestamp(),
            userEmail: currentUser.email,
            userName: currentUser.displayName
        }, { merge: true });
        
        updateSyncStatus(true, 'Synchronisé');
        showToast('Données synchronisées !');
        pendingSync = false;
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
        flights = JSON.parse(saved);
    }
    renderFlights();
    updateStats();
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

function searchAirport(query, type) {
    const suggestionsDiv = document.getElementById(`${type}-suggestions`);
    const nameDiv = document.getElementById(`${type}-name`);
    
    if (query.length < 2) {
        suggestionsDiv.classList.add('hidden');
        return;
    }

    const matches = airportsDB.filter(a => 
        a.code.toLowerCase().includes(query.toLowerCase()) ||
        a.name.toLowerCase().includes(query.toLowerCase()) ||
        a.city.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 5);

    if (matches.length > 0) {
        suggestionsDiv.innerHTML = matches.map(a => `
            <div class="px-4 py-3 hover:bg-gray-700 cursor-pointer border-b border-gray-700 last:border-0 transition-colors" 
                 onclick="selectAirport('${type}', '${a.code}', '${a.name.replace(/'/g, "\\'")}', '${a.city.replace(/'/g, "\\'")}')">
                <div class="flex items-center justify-between">
                    <span class="font-bold text-lg">${a.code}</span>
                    <span class="text-xs text-gray-400">${a.country}</span>
                </div>
                <div class="text-sm text-gray-300">${a.name}</div>
                <div class="text-xs text-gray-500">${a.city}</div>
            </div>
        `).join('');
        suggestionsDiv.classList.remove('hidden');
    } else {
        suggestionsDiv.classList.add('hidden');
    }
}

function selectAirport(type, code, name, city) {
    document.getElementById(`${type}-code`).value = code;
    document.getElementById(`${type}-name`).textContent = `${name}, ${city}`;
    document.getElementById(`${type}-suggestions`).classList.add('hidden');
    calculateFlightDuration();
}

// ==========================================
// FLIGHT CALCULATIONS
// ==========================================

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return Math.round(R * c);
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
    
    const distance = calculateDistance(
        depAirport.lat, depAirport.lng,
        arrAirport.lat, arrAirport.lng
    );
    
    const speed = aircraftSpeeds[aircraft] || 850;
    const flightTime = (distance / speed) * 60;
    const totalTime = Math.round(flightTime + 30);
    
    const hours = Math.floor(totalTime / 60);
    const minutes = totalTime % 60;
    
    durationDisplay.textContent = `${hours}h ${minutes.toString().padStart(2, '0')}min`;
    distanceDisplay.textContent = `Distance: ${distance.toLocaleString()} km`;
    durationInput.value = totalTime;
}

// ==========================================
// UI FUNCTIONS
// ==========================================

function toggleMenu() {
    const drawer = document.getElementById('menu-drawer');
    const overlay = document.getElementById('menu-overlay');
    const isOpen = drawer.classList.contains('open');
    
    if (isOpen) {
        drawer.classList.remove('open');
        overlay.classList.remove('open');
    } else {
        drawer.classList.add('open');
        overlay.classList.add('open');
    }
}

function showAddFlight() {
    document.getElementById('add-modal').classList.remove('hidden');
    document.getElementById('flight-date').valueAsDate = new Date();
    
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    document.getElementById('departure-time').value = timeStr;
    
    currentFlightId = null;
    document.getElementById('flight-form').reset();
    setRating(0);
    document.getElementById('departure-name').textContent = '';
    document.getElementById('arrival-name').textContent = '';
    document.getElementById('calculated-duration').textContent = '--h --min';
    document.getElementById('distance-display').textContent = 'Distance: -- km';
    document.getElementById('departure-time').value = timeStr;
}

function hideAddFlight() {
    document.getElementById('add-modal').classList.add('hidden');
}

function setRating(rating) {
    document.getElementById('flight-rating').value = rating;
    const stars = document.querySelectorAll('.star-btn');
    stars.forEach((star, index) => {
        if (index < rating) {
            star.classList.remove('text-gray-600');
            star.classList.add('text-yellow-400');
        } else {
            star.classList.add('text-gray-600');
            star.classList.remove('text-yellow-400');
        }
    });
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.remove('opacity-0');
    setTimeout(() => toast.classList.add('opacity-0'), 3000);
}

// ==========================================
// FLIGHT CRUD
// ==========================================

function saveFlight(e) {
    e.preventDefault();
    
    const departureCode = document.getElementById('departure-code').value.toUpperCase();
    const arrivalCode = document.getElementById('arrival-code').value.toUpperCase();
    
    const depAirport = getAirport(departureCode);
    const arrAirport = getAirport(arrivalCode);
    
    if (!depAirport || !arrAirport) {
        showToast('Aéroport non trouvé dans la base de données');
        return;
    }

    const distance = calculateDistance(
        depAirport.lat, depAirport.lng,
        arrAirport.lat, arrAirport.lng
    );

    const flight = {
        id: currentFlightId || Date.now().toString(),
        number: document.getElementById('flight-number').value,
        departure: {
            code: departureCode,
            name: depAirport.name,
            city: depAirport.city,
            country: depAirport.country,
            lat: depAirport.lat,
            lng: depAirport.lng,
            time: document.getElementById('departure-time').value
        },
        arrival: {
            code: arrivalCode,
            name: arrAirport.name,
            city: arrAirport.city,
            country: arrAirport.country,
            lat: arrAirport.lat,
            lng: arrAirport.lng
        },
        date: document.getElementById('flight-date').value,
        duration: parseInt(document.getElementById('flight-duration').value) || 0,
        aircraft: document.getElementById('aircraft-type').value,
        seat: document.getElementById('seat-number').value,
        class: document.getElementById('travel-class').value,
        reason: document.getElementById('travel-reason').value,
        notes: document.getElementById('flight-notes').value,
        rating: parseInt(document.getElementById('flight-rating').value),
        distance: distance,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    if (currentFlightId) {
        const index = flights.findIndex(f => f.id === currentFlightId);
        if (index !== -1) flights[index] = flight;
    } else {
        flights.unshift(flight);
    }

    saveFlightsToLocal();
    renderFlights();
    updateStats();
    refreshMap();
    hideAddFlight();
    
    // Sync if online
    if (currentUser && isOnline) {
        syncData();
    } else {
        pendingSync = true;
    }
    
    showToast(currentFlightId ? 'Vol modifié !' : 'Vol enregistré !');
}

function renderFlights(filter = 'all') {
    const container = document.getElementById('flights-list');
    const emptyState = document.getElementById('empty-state');
    
    let filteredFlights = [...flights];
    
    if (filter === 'year') {
        const currentYear = new Date().getFullYear();
        filteredFlights = flights.filter(f => new Date(f.date).getFullYear() === currentYear);
    } else if (filter === 'month') {
        const now = new Date();
        filteredFlights = flights.filter(f => {
            const d = new Date(f.date);
            return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
        });
    }

    if (filteredFlights.length === 0) {
        container.innerHTML = '';
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');
    
    const classColors = { 
        economy: 'bg-green-500/20 text-green-400', 
        premium: 'bg-blue-500/20 text-blue-400',
        business: 'bg-purple-500/20 text-purple-400', 
        first: 'bg-amber-500/20 text-amber-400' 
    };
    
    container.innerHTML = filteredFlights.map(flight => {
        const date = new Date(flight.date);
        const dateStr = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
        
        const durationHours = Math.floor(flight.duration / 60);
        const durationMins = flight.duration % 60;
        const durationStr = flight.duration > 0 ? `${durationHours}h${durationMins.toString().padStart(2, '0')}` : '';
        
        return `
            <div class="glass-card rounded-2xl p-4 btn-press" onclick="showFlightDetail('${flight.id}')">
                <div class="flex items-start justify-between mb-3">
                    <div class="flex items-center gap-3">
                        <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-lg font-bold">
                            ${flight.departure.code}
                        </div>
                        <div>
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-lg">${flight.departure.code}</span>
                                <i data-lucide="arrow-right" class="w-4 h-4 text-gray-400"></i>
                                <span class="font-bold text-lg">${flight.arrival.code}</span>
                            </div>
                            <p class="text-xs text-gray-400">${flight.number} • ${dateStr}</p>
                        </div>
                    </div>
                    <span class="px-2 py-1 rounded-lg text-xs font-medium ${classColors[flight.class]}">
                        ${classLabels[flight.class]}
                    </span>
                </div>
                
                <div class="flex items-center justify-between text-sm">
                    <div class="flex items-center gap-4">
                        <span class="text-gray-400">${flight.departure.city || flight.departure.name}</span>
                        <div class="flex-1 h-px bg-gray-600 relative w-16">
                            <i data-lucide="plane" class="w-3 h-3 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-blue-400"></i>
                        </div>
                        <span class="text-gray-400">${flight.arrival.city || flight.arrival.name}</span>
                    </div>
                    <div class="text-right">
                        <span class="text-gray-500 block">${flight.distance} km</span>
                        ${durationStr ? `<span class="text-xs text-blue-400">${durationStr}</span>` : ''}
                    </div>
                </div>
                
                ${flight.rating > 0 ? `
                    <div class="mt-2 flex gap-0.5">
                        ${'⭐'.repeat(flight.rating)}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
    
    lucide.createIcons();
    document.getElementById('menu-flight-count').textContent = `${flights.length} vol${flights.length > 1 ? 's' : ''} enregistré${flights.length > 1 ? 's' : ''}`;
}

function filterFlights(type) {
    document.querySelectorAll('[data-filter]').forEach(btn => {
        if (btn.dataset.filter === type) {
            btn.classList.add('active-filter');
        } else {
            btn.classList.remove('active-filter');
        }
    });
    
    renderFlights(type);
}

function updateStats() {
    const totalFlights = flights.length;
    const totalDistance = flights.reduce((sum, f) => sum + (f.distance || 0), 0);
    const countries = new Set(flights.flatMap(f => [f.departure.country, f.arrival.country])).size;
    const totalHours = Math.round(flights.reduce((sum, f) => sum + (f.duration || 0), 0) / 60);

    document.getElementById('stat-flights').textContent = totalFlights;
    document.getElementById('stat-distance').innerHTML = `${totalDistance.toLocaleString()} <span class="text-sm font-normal">km</span>`;
    document.getElementById('stat-countries').textContent = countries;
    document.getElementById('stat-hours').textContent = totalHours;
    
    document.getElementById('header-stats').textContent = totalFlights > 0 
        ? `${totalFlights} vol${totalFlights > 1 ? 's' : ''} • ${totalDistance.toLocaleString()} km`
        : 'Commencez votre journal';
}

// ==========================================
// MAP FUNCTIONS
// ==========================================

function initMap() {
    if (map) return;
    
    map = L.map('map', {
        center: [20, 0],
        zoom: 2,
        zoomControl: false,
        attributionControl: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
    }).addTo(map);
    
    refreshMap();
}

function refreshMap() {
    if (!map) {
        initMap();
        return;
    }

    mapMarkers.forEach(m => map.removeLayer(m));
    mapMarkers = [];

    if (flights.length === 0) return;

    const bounds = [];

    flights.forEach(flight => {
        const dep = [flight.departure.lat, flight.departure.lng];
        const arr = [flight.arrival.lat, flight.arrival.lng];
        
        bounds.push(dep, arr);

        const depMarker = L.circleMarker(dep, {
            radius: 6,
            fillColor: '#3b82f6',
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        }).addTo(map).bindPopup(`
            <b>${flight.departure.code}</b><br>
            ${flight.departure.name}<br>
            <small>Départ: ${flight.number}</small>
        `);
        mapMarkers.push(depMarker);

        const arrMarker = L.circleMarker(arr, {
            radius: 6,
            fillColor: '#8b5cf6',
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        }).addTo(map).bindPopup(`
            <b>${flight.arrival.code}</b><br>
            ${flight.arrival.name}<br>
            <small>Arrivée: ${flight.number}</small>
        `);
        mapMarkers.push(arrMarker);

        const latlngs = [
            dep,
            [(dep[0] + arr[0])/2, (dep[1] + arr[1])/2 + (arr[1] - dep[1]) * 0.2],
            arr
        ];
        
        const path = L.polyline(latlngs, {
            color: '#3b82f6',
            weight: 2,
            opacity: 0.6,
            dashArray: '5, 10',
            className: 'flight-path'
        }).addTo(map);
        mapMarkers.push(path);
    });

    if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50] });
    }
}

// ==========================================
// FLIGHT DETAIL
// ==========================================

function showFlightDetail(id) {
    const flight = flights.find(f => f.id === id);
    if (!flight) return;
    
    currentFlightId = id;
    const date = new Date(flight.date).toLocaleDateString('fr-FR', { 
        weekday: 'long', 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric' 
    });
    
    const durationHours = Math.floor(flight.duration / 60);
    const durationMins = flight.duration % 60;

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
                        <i data-lucide="plane" class="w-5 h-5 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-blue-400 bg-gray-800 rounded-full p-1"></i>
                    </div>
                    <div class="text-center text-xs text-gray-500 mt-2">${flight.distance} km</div>
                    ${flight.duration > 0 ? `<div class="text-center text-xs text-blue-400">${durationHours}h${durationMins.toString().padStart(2, '0')}</div>` : ''}
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
                    <div class="font-semibold">${date}</div>
                </div>
            </div>

            ${flight.aircraft ? `
                <div class="glass-card rounded-xl p-3">
                    <div class="text-xs text-gray-400 mb-1">Type d'avion</div>
                    <div class="font-semibold">${flight.aircraft}</div>
                </div>
            ` : ''}
            
            ${flight.seat ? `
                <div class="glass-card rounded-xl p-3">
                    <div class="text-xs text-gray-400 mb-1">Siège</div>
                    <div class="font-semibold">${flight.seat}</div>
                </div>
            ` : ''}

            <div class="grid grid-cols-2 gap-4">
                <div class="glass-card rounded-xl p-3">
                    <div class="text-xs text-gray-400 mb-1">Classe</div>
                    <div class="font-semibold">${classLabels[flight.class]}</div>
                </div>
                <div class="glass-card rounded-xl p-3">
                    <div class="text-xs text-gray-400 mb-1">Motif</div>
                    <div class="font-semibold">${reasonLabels[flight.reason]}</div>
                </div>
            </div>

            ${flight.rating > 0 ? `
                <div class="glass-card rounded-xl p-3">
                    <div class="text-xs text-gray-400 mb-1">Note</div>
                    <div class="text-2xl">${'⭐'.repeat(flight.rating)}</div>
                </div>
            ` : ''}

            ${flight.notes ? `
                <div class="glass-card rounded-xl p-3">
                    <div class="text-xs text-gray-400 mb-1">Notes</div>
                    <div class="text-sm text-gray-300">${flight.notes}</div>
                </div>
            ` : ''}
        </div>
    `;
    
    lucide.createIcons();
    document.getElementById('detail-modal').classList.remove('hidden');
}

function hideDetail() {
    document.getElementById('detail-modal').classList.add('hidden');
    currentFlightId = null;
}

function editCurrentFlight() {
    if (!currentFlightId) return;
    
    const flight = flights.find(f => f.id === currentFlightId);
    if (!flight) return;
    
    hideDetail();
    
    document.getElementById('flight-number').value = flight.number;
    document.getElementById('departure-code').value = flight.departure.code;
    document.getElementById('departure-name').textContent = `${flight.departure.name}, ${flight.departure.city}`;
    document.getElementById('arrival-code').value = flight.arrival.code;
    document.getElementById('arrival-name').textContent = `${flight.arrival.name}, ${flight.arrival.city}`;
    document.getElementById('flight-date').value = flight.date;
    document.getElementById('departure-time').value = flight.departure.time || '';
    document.getElementById('flight-duration').value = flight.duration || '';
    document.getElementById('aircraft-type').value = flight.aircraft || '';
    document.getElementById('seat-number').value = flight.seat || '';
    document.getElementById('travel-class').value = flight.class;
    document.getElementById('travel-reason').value = flight.reason;
    document.getElementById('flight-notes').value = flight.notes || '';
    setRating(flight.rating || 0);
    
    if (flight.duration > 0) {
        const hours = Math.floor(flight.duration / 60);
        const mins = flight.duration % 60;
        document.getElementById('calculated-duration').textContent = `${hours}h ${mins.toString().padStart(2, '0')}min`;
        document.getElementById('distance-display').textContent = `Distance: ${flight.distance} km`;
    }
    
    showAddFlight();
}

function deleteCurrentFlight() {
    if (!currentFlightId) return;
    
    if (confirm('Supprimer ce vol ?')) {
        flights = flights.filter(f => f.id !== currentFlightId);
        saveFlightsToLocal();
        renderFlights();
        updateStats();
        refreshMap();
        hideDetail();
        
        if (currentUser && isOnline) {
            syncData();
        }
        
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

function hideStats() {
    document.getElementById('stats-modal').classList.add('hidden');
}

function updateStatsModal() {
    // Destroy existing charts
    Object.values(charts).forEach(c => c.destroy());
    
    const totalDistance = flights.reduce((sum, f) => sum + (f.distance || 0), 0);
    const totalMinutes = flights.reduce((sum, f) => sum + (f.duration || 0), 0);
    const totalHours = Math.round(totalMinutes / 60);
    const totalDays = (totalHours / 24).toFixed(1);
    const equatorCircumference = 40075;
    const equatorTimes = (totalDistance / equatorCircumference).toFixed(2);
    
    // Update overview cards
    document.getElementById('stat-total-distance').textContent = `${totalDistance.toLocaleString()} km`;
    document.getElementById('stat-equator').textContent = equatorTimes;
    document.getElementById('stat-total-time').textContent = `${totalHours}h`;
    document.getElementById('stat-days').textContent = totalDays;
    
    // Flights by Month Chart
    const monthData = {};
    flights.forEach(f => {
        const d = new Date(f.date);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}`;
        monthData[key] = (monthData[key] || 0) + 1;
    });
    
    const sortedMonths = Object.keys(monthData).sort();
    charts.flights = new Chart(document.getElementById('flights-chart'), {
        type: 'bar',
        data: {
            labels: sortedMonths.map(m => {
                const [y, mo] = m.split('-');
                return `${mo}/${y.slice(2)}`;
            }),
            datasets: [{
                label: 'Vols',
                data: sortedMonths.map(m => monthData[m]),
                backgroundColor: '#3b82f6',
                borderRadius: 6
            }]
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
    
    // Top Routes
    const routeCount = {};
    flights.forEach(f => {
        const route = `${f.departure.code}-${f.arrival.code}`;
        routeCount[route] = (routeCount[route] || 0) + 1;
    });
    
    const topRoutes = Object.entries(routeCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    
    const maxRouteCount = topRoutes[0]?.[1] || 1;
    
    document.getElementById('top-routes-list').innerHTML = topRoutes.map(([route, count]) => `
        <div class="flex items-center gap-3">
            <span class="text-sm font-medium w-24">${route}</span>
            <div class="flex-1 stat-progress-bar">
                <div class="stat-progress-fill bg-blue-500" style="width: ${(count / maxRouteCount) * 100}%"></div>
            </div>
            <span class="text-sm text-gray-400 w-8 text-right">${count}</span>
        </div>
    `).join('') || '<p class="text-sm text-gray-500">Aucune donnée</p>';
    
    // Airlines Stats
    const airlineCount = {};
    flights.forEach(f => {
        const airline = f.number.substring(0, 2);
        airlineCount[airline] = (airlineCount[airline] || 0) + 1;
    });
    
    const topAirlines = Object.entries(airlineCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    
    const maxAirlineCount = topAirlines[0]?.[1] || 1;
    
    document.getElementById('airlines-list').innerHTML = topAirlines.map(([airline, count]) => `
        <div class="flex items-center gap-3">
            <span class="text-sm font-medium w-24">${airline}</span>
            <div class="flex-1 stat-progress-bar">
                <div class="stat-progress-fill bg-purple-500" style="width: ${(count / maxAirlineCount) * 100}%"></div>
            </div>
            <span class="text-sm text-gray-400 w-8 text-right">${count}</span>
        </div>
    `).join('') || '<p class="text-sm text-gray-500">Aucune donnée</p>';
    
    // Aircraft Types
    const aircraftCount = {};
    flights.forEach(f => {
        if (f.aircraft) {
            aircraftCount[f.aircraft] = (aircraftCount[f.aircraft] || 0) + 1;
        }
    });
    
    const topAircraft = Object.entries(aircraftCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    
    const maxAircraftCount = topAircraft[0]?.[1] || 1;
    
    document.getElementById('aircraft-list').innerHTML = topAircraft.map(([aircraft, count]) => `
        <div class="flex items-center gap-3">
            <span class="text-sm font-medium w-24">${aircraft}</span>
            <div class="flex-1 stat-progress-bar">
                <div class="stat-progress-fill bg-amber-500" style="width: ${(count / maxAircraftCount) * 100}%"></div>
            </div>
            <span class="text-sm text-gray-400 w-8 text-right">${count}</span>
        </div>
    `).join('') || '<p class="text-sm text-gray-500">Aucune donnée</p>';
    
    // Class Distribution
    const classCount = { economy: 0, premium: 0, business: 0, first: 0 };
    flights.forEach(f => classCount[f.class] = (classCount[f.class] || 0) + 1);
    
    const totalClass = flights.length || 1;
    const classColors = {
        economy: 'bg-green-500',
        premium: 'bg-blue-500',
        business: 'bg-purple-500',
        first: 'bg-amber-500'
    };
    
    document.getElementById('class-distribution').innerHTML = Object.entries(classCount)
        .filter(([_, count]) => count > 0)
        .map(([cls, count]) => `
            <div class="flex items-center justify-between">
                <span class="text-sm text-gray-300">${classLabels[cls]}</span>
                <div class="flex items-center gap-2">
                    <div class="w-32 stat-progress-bar">
                        <div class="stat-progress-fill ${classColors[cls]}" style="width: ${(count / totalClass) * 100}%"></div>
                    </div>
                    <span class="text-sm text-gray-400 w-12 text-right">${count} (${Math.round((count/totalClass)*100)}%)</span>
                </div>
            </div>
        `).join('') || '<p class="text-sm text-gray-500">Aucune donnée</p>';
    
    // Travel Reasons
    const reasonCount = {};
    flights.forEach(f => {
        reasonCount[f.reason] = (reasonCount[f.reason] || 0) + 1;
    });
    
    const topReasons = Object.entries(reasonCount)
        .sort((a, b) => b[1] - a[1]);
    
    const maxReasonCount = topReasons[0]?.[1] || 1;
    
    document.getElementById('reasons-list').innerHTML = topReasons.map(([reason, count]) => `
        <div class="flex items-center gap-3">
            <span class="text-sm font-medium w-24">${reasonLabels[reason]}</span>
            <div class="flex-1 stat-progress-bar">
                <div class="stat-progress-fill bg-emerald-500" style="width: ${(count / maxReasonCount) * 100}%"></div>
            </div>
            <span class="text-sm text-gray-400 w-8 text-right">${count}</span>
        </div>
    `).join('') || '<p class="text-sm text-gray-500">Aucune donnée</p>';
    
    // Ratings
    const ratedFlights = flights.filter(f => f.rating > 0);
    const avgRating = ratedFlights.length > 0 
        ? (ratedFlights.reduce((sum, f) => sum + f.rating, 0) / ratedFlights.length).toFixed(1)
        : '0.0';
    
    document.getElementById('avg-rating').textContent = avgRating;
    
    const ratingCounts = {1:0, 2:0, 3:0, 4:0, 5:0};
    ratedFlights.forEach(f => ratingCounts[f.rating]++);
    const maxRating = Math.max(...Object.values(ratingCounts));
    
    document.getElementById('rating-bars').innerHTML = [5,4,3,2,1].map(star => `
        <div class="flex items-center gap-2">
            <span class="text-xs text-gray-400 w-3">${star}</span>
            <div class="flex-1 rating-bar-bg">
                <div class="rating-bar-fill" style="width: ${maxRating > 0 ? (ratingCounts[star] / maxRating) * 100 : 0}%"></div>
            </div>
            <span class="text-xs text-gray-500 w-6 text-right">${ratingCounts[star]}</span>
        </div>
    `).join('');
    
    // Records
    const longestFlight = flights.reduce((max, f) => (f.distance > max.distance) ? f : max, flights[0] || { distance: 0, number: '-', departure: {}, arrival: {} });
    const shortestFlight = flights.reduce((min, f) => (f.distance < min.distance) ? f : min, flights[0] || { distance: 0, number: '-', departure: {}, arrival: {} });
    const longestDuration = flights.reduce((max, f) => (f.duration > max.duration) ? f : max, flights[0] || { duration: 0, number: '-', departure: {}, arrival: {} });
    
    document.getElementById('records-list').innerHTML = `
        <div class="glass-card rounded-xl p-3 flex justify-between items-center">
            <div>
                <div class="text-xs text-gray-400">Vol le plus long</div>
                <div class="text-sm font-medium">${longestFlight.number} (${longestFlight.distance.toLocaleString()} km)</div>
                <div class="text-xs text-gray-500">${longestFlight.departure.code} → ${longestFlight.arrival.code}</div>
            </div>
            <i data-lucide="trophy" class="w-5 h-5 text-yellow-400"></i>
        </div>
        <div class="glass-card rounded-xl p-3 flex justify-between items-center">
            <div>
                <div class="text-xs text-gray-400">Vol le plus court</div>
                <div class="text-sm font-medium">${shortestFlight.number} (${shortestFlight.distance.toLocaleString()} km)</div>
                <div class="text-xs text-gray-500">${shortestFlight.departure.code} → ${shortestFlight.arrival.code}</div>
            </div>
            <i data-lucide="minimize-2" class="w-5 h-5 text-blue-400"></i>
        </div>
        <div class="glass-card rounded-xl p-3 flex justify-between items-center">
            <div>
                <div class="text-xs text-gray-400">Plus longue durée</div>
                <div class="text-sm font-medium">${longestDuration.number} (${Math.floor(longestDuration.duration/60)}h${longestDuration.duration%60}min)</div>
                <div class="text-xs text-gray-500">${longestDuration.departure.code} → ${longestDuration.arrival.code}</div>
            </div>
            <i data-lucide="clock" class="w-5 h-5 text-purple-400"></i>
        </div>
    `;
    
    // Detailed Summary
    const avgDistance = flights.length > 0 ? Math.round(totalDistance / flights.length) : 0;
    const uniqueAirports = new Set(flights.flatMap(f => [f.departure.code, f.arrival.code])).size;
    
    document.getElementById('detailed-stats').innerHTML = `
        <div class="glass-card rounded-xl p-3 flex justify-between">
            <span class="text-gray-400">Distance moyenne</span>
            <span class="font-semibold">${avgDistance} km</span>
        </div>
        <div class="glass-card rounded-xl p-3 flex justify-between">
            <span class="text-gray-400">Aéroports uniques</span>
            <span class="font-semibold">${uniqueAirports}</span>
        </div>
        <div class="glass-card rounded-xl p-3 flex justify-between">
            <span class="text-gray-400">Vols notés</span>
            <span class="font-semibold">${ratedFlights.length} / ${flights.length}</span>
        </div>
        <div class="glass-card rounded-xl p-3 flex justify-between">
            <span class="text-gray-400">Premier vol</span>
            <span class="font-semibold">${flights.length > 0 ? new Date(Math.min(...flights.map(f => new Date(f.date)))).toLocaleDateString('fr-FR') : '-'}</span>
        </div>
        <div class="glass-card rounded-xl p-3 flex justify-between">
            <span class="text-gray-400">Dernier vol</span>
            <span class="font-semibold">${flights.length > 0 ? new Date(Math.max(...flights.map(f => new Date(f.date)))).toLocaleDateString('fr-FR') : '-'}</span>
        </div>
    `;
    
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
        if (!visited.has(f.departure.code)) {
            visited.set(f.departure.code, f.departure);
        }
        if (!visited.has(f.arrival.code)) {
            visited.set(f.arrival.code, f.arrival);
        }
    });
    
    const sorted = Array.from(visited.values()).sort((a, b) => a.code.localeCompare(b.code));
    
    list.innerHTML = sorted.map(a => `
        <div class="glass-card rounded-xl p-3 flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center font-bold text-blue-400">
                ${a.code}
            </div>
            <div class="flex-1 min-w-0">
                <div class="font-medium truncate">${a.name}</div>
                <div class="text-sm text-gray-400 truncate">${a.city}, ${a.country}</div>
            </div>
        </div>
    `).join('');
    
    modal.classList.remove('hidden');
}

function filterVisitedAirports(query) {
    const list = document.getElementById('visited-airports-list');
    const items = list.children;
    
    Array.from(items).forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(query.toLowerCase()) ? 'flex' : 'none';
    });
}

function hideAirports() {
    document.getElementById('airports-modal').classList.add('hidden');
}

// ==========================================
// EXPORT & UTILS
// ==========================================

function exportData() {
    const data = {
        flights: flights,
        exportDate: new Date().toISOString(),
        stats: {
            totalFlights: flights.length,
            totalDistance: flights.reduce((sum, f) => sum + (f.distance || 0), 0),
            totalCountries: new Set(flights.flatMap(f => [f.departure.country, f.arrival.country])).size,
            totalHours: Math.round(flights.reduce((sum, f) => sum + (f.duration || 0), 0) / 60)
        }
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flight-diary-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('Données exportées !');
}

function showTab(tab) {
    if (tab === 'stats') {
        showStats();
    } else if (tab === 'airports') {
        showVisitedAirports();
    }
}

// ==========================================
// EVENT LISTENERS & INIT
// ==========================================

// Close suggestions when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('#departure-code')) {
        document.getElementById('departure-suggestions').classList.add('hidden');
    }
    if (!e.target.closest('#arrival-code')) {
        document.getElementById('arrival-suggestions').classList.add('hidden');
    }
});

// Online/Offline detection
window.addEventListener('online', () => {
    isOnline = true;
    if (pendingSync && currentUser) {
        syncData();
    }
    updateSyncStatus(currentUser !== null, currentUser ? 'Synchronisé' : 'Hors ligne');
});

window.addEventListener('offline', () => {
    isOnline = false;
    updateSyncStatus(false, 'Hors ligne');
});

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    lucide.createIcons();
    await loadAirports();
    loadFlightsFromLocal();
    setTimeout(initMap, 100);
    
    // Check auth state
    if (auth) {
        auth.onAuthStateChanged((user) => {
            currentUser = user;
            updateAuthUI();
            if (user) {
                loadUserData();
            }
        });
    }
});

// Handle visibility change for PWA
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && map) {
        map.invalidateSize();
    }
});
