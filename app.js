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
        if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') console.error('Persistence error:', err);
    });
} catch (e) { console.log('Firebase not initialized - offline mode'); }

// ==========================================
// GLOBAL VARIABLES
// ==========================================
let flights = [];
let airportsDB = [];
let currentFlightId = null;

// Leaflet map
let map = null;
let mapMarkers = [];
let mapPolylines = [];
let mapTileLayer = null;
let markerClusterGroup = null;
let mapFilterYear = 'all';

// Three.js globe
let globeActive = false;
let globeRenderer = null;
let globeScene = null;
let globeCamera = null;
let globeAnimFrame = null;
let globeOrbitDragging = false;
let globeOrbitLast = { x: 0, y: 0 };
let globeRotX = 0.3;
let globeRotY = 0;

let charts = {};
let pendingSync = false;
let searchDebounceTimers = {};
const FLIGHTS_PER_PAGE = 20;
let currentPage = 1;
let currentFilter = 'all';
let darkModeTimer = null;
let offlineQueue = [];

// CO2 kg/km/pax by class (source: ADEME)
const CO2_PER_KM = { economy: 0.115, premium: 0.161, business: 0.230, first: 0.345 };
const TREES_PER_TONNE = 40;

// Traveller levels by total km
const TRAVELLER_LEVELS = [
    { name: 'Bronze',  min: 0,       max: 25000,   color: '#cd7f32', icon: '🥉' },
    { name: 'Argent',  min: 25000,   max: 100000,  color: '#c0c0c0', icon: '🥈' },
    { name: 'Or',      min: 100000,  max: 300000,  color: '#ffd700', icon: '🥇' },
    { name: 'Platine', min: 300000,  max: 750000,  color: '#e5e4e2', icon: '💎' },
    { name: 'Diamant', min: 750000,  max: Infinity, color: '#b9f2ff', icon: '💠' },
];

const aircraftSpeeds = {
    'A318':780,'A319':820,'A320':840,'A321':850,'A319neo':830,'A320neo':840,'A321neo':860,
    'A330-200':880,'A330-300':880,'A330-900':880,'A350-900':900,'A350-1000':900,'A380':900,
    'B737-700':830,'B737-800':840,'B737-900':850,'B737MAX7':840,'B737MAX8':850,'B737MAX9':850,
    'B747-400':910,'B747-8':920,'B757-200':850,'B767-300':870,'B777-200':890,'B777-300':900,
    'B777X':920,'B787-8':900,'B787-9':900,'B787-10':900,
    'E170':780,'E175':790,'E190':820,'E195':830,'E190-E2':840,'E195-E2':850,
    'CRJ-200':780,'CRJ-700':790,'CRJ-900':800,'CRJ-1000':820,'Q400':550,'SpaceJet':830,
    'ATR42':550,'ATR72':550,'DHC8':500,'A220-100':850,'A220-300':860,
    'SSJ100':830,'MC21':850,'C919':840,'other':850
};
const classLabels  = { economy:'Économique', premium:'Premium', business:'Affaires', first:'Première' };
const reasonLabels = { leisure:'Loisir', business:'Professionnel', family:'Famille', other:'Autre' };

// ==========================================
// DARK MODE BY TIME
// ==========================================
function applyAutoDarkMode() {
    const h = new Date().getHours();
    document.documentElement.setAttribute('data-theme', (h < 6 || h >= 20) ? 'dark' : 'light');
    const now = new Date();
    clearTimeout(darkModeTimer);
    darkModeTimer = setTimeout(applyAutoDarkMode, (60 - now.getMinutes()) * 60000 - now.getSeconds() * 1000);
}

// ==========================================
// STYLES INJECTION
// ==========================================
function injectStyles() {
    if (document.getElementById('fd-styles')) return;
    const s = document.createElement('style');
    s.id = 'fd-styles';
    s.textContent = `
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        .skeleton-box { background:linear-gradient(90deg,rgba(255,255,255,.05) 25%,rgba(255,255,255,.12) 50%,rgba(255,255,255,.05) 75%); background-size:200% 100%; animation:shimmer 1.5s infinite; }
        @keyframes cardEntrance { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        .flight-card-enter { animation:cardEntrance 0.35s ease-out both; }
        @keyframes toastIn  { from{opacity:0;transform:translateY(20px) translateX(-50%)} to{opacity:1;transform:translateY(0) translateX(-50%)} }
        @keyframes toastOut { from{opacity:1} to{opacity:0} }
        @keyframes statCount { from{transform:scale(.8);opacity:0} to{transform:scale(1);opacity:1} }
        .stat-animate { animation:statCount 0.4s cubic-bezier(.34,1.56,.64,1) both; }
        .map-filter-pill { padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:rgba(255,255,255,.08);color:#9ca3af;cursor:pointer;border:1px solid rgba(255,255,255,.1);transition:all .2s; }
        .map-filter-pill.active { background:rgba(59,130,246,.25);color:#60a5fa;border-color:rgba(59,130,246,.4); }
        #globe-container { display:none;position:relative;border-radius:16px;overflow:hidden;margin-bottom:1rem; }
        #globe-container.active { display:block; }
        #globe-canvas { display:block;width:100%;height:360px;touch-action:none; }
        .heatmap-cell { width:14px;height:14px;border-radius:3px;flex-shrink:0;transition:transform .15s;cursor:default; }
        .heatmap-cell:hover { transform:scale(1.5);z-index:10;position:relative; }
        .score-progress { height:8px;border-radius:4px;background:rgba(255,255,255,.1);overflow:hidden; }
        .score-progress-fill { height:100%;border-radius:4px;transition:width .6s ease; }
    `;
    document.head.appendChild(s);
}

function showSkeletonLoaders(n = 3) {
    const c = document.getElementById('flights-list');
    const e = document.getElementById('empty-state');
    if (e) e.classList.add('hidden');
    c.innerHTML = Array.from({length:n}, () => `
        <div class="glass-card rounded-2xl p-4">
            <div class="flex items-start justify-between mb-3">
                <div class="flex items-center gap-3">
                    <div class="skeleton-box w-12 h-12 rounded-xl"></div>
                    <div><div class="skeleton-box h-5 w-32 mb-2 rounded"></div><div class="skeleton-box h-3 w-24 rounded"></div></div>
                </div>
                <div class="skeleton-box h-6 w-16 rounded-lg"></div>
            </div>
            <div class="skeleton-box h-4 w-full rounded mt-2"></div>
        </div>`).join('');
}

// ==========================================
// AUTH
// ==========================================
function signInWithGoogle() {
    if (!auth) { showToast('Firebase non configuré'); return; }
    const p = new firebase.auth.GoogleAuthProvider();
    p.addScope('https://www.googleapis.com/auth/userinfo.email');
    p.addScope('https://www.googleapis.com/auth/userinfo.profile');
    auth.signInWithPopup(p)
        .then(r => { currentUser = r.user; updateAuthUI(); loadUserData(); showToast('Connecté !'); })
        .catch(e => showToast('Erreur: ' + e.message));
}
function signOut() {
    if (!auth) return;
    auth.signOut().then(() => {
        currentUser = null; updateAuthUI(); flights = [];
        localStorage.removeItem('flightDiary_flights');
        renderFlights(); updateStats(); refreshMap(); showToast('Déconnecté');
    }).catch(() => showToast('Erreur'));
}
function updateAuthUI() {
    const get = id => document.getElementById(id);
    if (currentUser) {
        get('google-signin-btn').classList.add('hidden');
        get('signout-btn').classList.remove('hidden');
        get('user-info').classList.remove('hidden');
        if (get('user-avatar'))  get('user-avatar').src   = currentUser.photoURL || '';
        if (get('user-name'))    get('user-name').textContent  = currentUser.displayName || 'Utilisateur';
        if (get('user-email'))   get('user-email').textContent = currentUser.email || '';
        updateSyncStatus(true, 'Synchronisé');
    } else {
        get('google-signin-btn').classList.remove('hidden');
        get('signout-btn').classList.add('hidden');
        get('user-info').classList.add('hidden');
        updateSyncStatus(false, 'Hors ligne');
    }
}
function updateSyncStatus(online, text) {
    const ind = document.getElementById('sync-indicator'), txt = document.getElementById('sync-text');
    if (!ind || !txt) return;
    ind.className = online ? 'w-2 h-2 rounded-full bg-emerald-500 syncing' : 'w-2 h-2 rounded-full bg-gray-500';
    txt.textContent = text;
}

// ==========================================
// SYNC
// ==========================================
async function loadUserData() {
    if (!currentUser || !db) return;
    try {
        updateSyncStatus(true, 'Chargement...');
        const doc = await db.collection('users').doc(currentUser.uid).get();
        if (doc.exists) {
            const rd = doc.data(), rf = rd.flights || [];
            const rTs = rd.lastSync?.toMillis() || 0;
            const lTs = parseInt(localStorage.getItem('flightDiary_lastModified') || '0');
            if (rTs >= lTs) { const rIds=new Set(rf.map(f=>f.id)); flights=[...rf,...flights.filter(f=>!rIds.has(f.id))]; }
            else            { const lIds=new Set(flights.map(f=>f.id)); flights=[...flights,...rf.filter(f=>!lIds.has(f.id))]; }
            saveFlightsToLocal(); renderFlights(); updateStats(); refreshMap();
        } else { await syncData(); }
        updateSyncStatus(true, 'Synchronisé');
    } catch(e) { console.error(e); updateSyncStatus(false,'Erreur sync'); loadFlightsFromLocal(); }
}
async function syncData() {
    if (!currentUser || !db) { showToast('Connectez-vous pour synchroniser'); return; }
    if (!isOnline) { showToast('Pas de connexion'); pendingSync=true; return; }
    try {
        updateSyncStatus(true, 'Synchronisation...');
        const doc = await db.collection('users').doc(currentUser.uid).get();
        if (doc.exists) { const rf=doc.data().flights||[]; const lIds=new Set(flights.map(f=>f.id)); flights=[...flights,...rf.filter(f=>!lIds.has(f.id))]; }
        await db.collection('users').doc(currentUser.uid).set({ flights, lastSync:firebase.firestore.FieldValue.serverTimestamp(), userEmail:currentUser.email, userName:currentUser.displayName },{merge:true});
        saveFlightsToLocal(); updateSyncStatus(true,'Synchronisé'); showToast('Synchronisé !'); pendingSync=false; offlineQueue=[];
    } catch(e) { console.error(e); updateSyncStatus(false,'Erreur sync'); pendingSync=true; }
}
function saveFlightsToLocal() { localStorage.setItem('flightDiary_flights',JSON.stringify(flights)); localStorage.setItem('flightDiary_lastModified',Date.now().toString()); }
function loadFlightsFromLocal() { const s=localStorage.getItem('flightDiary_flights'); if(s){try{flights=JSON.parse(s);}catch{flights=[];}} renderFlights(); updateStats(); }
function queueOfflineOperation(type,data) { offlineQueue.push({type,data,timestamp:Date.now()}); localStorage.setItem('flightDiary_offlineQueue',JSON.stringify(offlineQueue)); }
async function flushOfflineQueue() { if(!isOnline||!currentUser||!offlineQueue.length) return; showToast(`Sync de ${offlineQueue.length} action(s)...`); offlineQueue=[]; localStorage.removeItem('flightDiary_offlineQueue'); await syncData(); }
function loadOfflineQueue() { const s=localStorage.getItem('flightDiary_offlineQueue'); if(s){try{offlineQueue=JSON.parse(s);}catch{offlineQueue=[];}} }

// ==========================================
// AIRPORTS
// ==========================================
async function loadAirports() {
    try {
        const r = await fetch('airports.js'), text = await r.text();
        const m = text.match(/const AirportsDB = (\[[\s\S]*?\]);/);
        if (m) { airportsDB=eval(m[1]); console.log(`Loaded ${airportsDB.length} airports`); }
    } catch(e) { console.error(e); showToast('Erreur chargement aéroports'); }
}
function getAirport(code) { return airportsDB.find(a => a.code === code.toUpperCase()); }
function isValidIATA(code) { return /^[A-Z]{3}$/.test(code.toUpperCase()); }
function searchAirport(query, type) { clearTimeout(searchDebounceTimers[type]); searchDebounceTimers[type]=setTimeout(()=>_doSearch(query,type),180); }
function _doSearch(query, type) {
    const div=document.getElementById(`${type}-suggestions`);
    if(query.length<1){div.classList.add('hidden');return;}
    const q=query.toUpperCase();
    const byCode=airportsDB.filter(a=>a.code.startsWith(q));
    const byName=airportsDB.filter(a=>!a.code.startsWith(q)&&(a.name.toUpperCase().includes(q)||a.city.toUpperCase().includes(q)));
    const matches=[...byCode,...byName].slice(0,10);
    div.innerHTML=matches.length
        ?matches.map(a=>`<div class="suggestion-item" onclick="selectAirport('${type}','${a.code}','${a.name.replace(/'/g,"\\'")}','${a.city.replace(/'/g,"\\'")}')"><div class="flex items-center justify-between mb-1"><span class="font-bold text-lg text-white">${a.code}</span><span class="text-xs text-gray-400">${a.country}</span></div><div class="text-sm text-gray-300">${a.name}</div><div class="text-xs text-gray-500">${a.city}</div></div>`).join('')
        :`<div class="suggestion-item" style="cursor:default"><div class="text-sm text-gray-400">Aucun aéroport trouvé</div></div>`;
    div.classList.remove('hidden');
}
function selectAirport(type, code, name, city) {
    const inp=document.getElementById(`${type}-code`);
    inp.value=code; inp.style.borderColor=isValidIATA(code)?'#10b981':'#ef4444';
    document.getElementById(`${type}-name`).textContent=`${name}, ${city}`;
    document.getElementById(`${type}-suggestions`).classList.add('hidden');
    calculateFlightDuration();
}
function validateIATAInput(input) {
    input.value=input.value.toUpperCase().replace(/[^A-Z]/g,'').substring(0,3);
    if(input.value.length===3){const a=getAirport(input.value);input.style.borderColor=a?'#10b981':'#ef4444';if(!a)showToast(`Code IATA inconnu: ${input.value}`);}
    else input.style.borderColor='';
}

// ==========================================
// CALCULATIONS
// ==========================================
function calculateDistance(lat1,lon1,lat2,lon2) {
    const R=6371,toRad=d=>d*Math.PI/180;
    const a=Math.sin(toRad(lat2-lat1)/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(toRad(lon2-lon1)/2)**2;
    return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
}
function calculateFlightDuration() {
    const dep=getAirport(document.getElementById('departure-code').value.toUpperCase());
    const arr=getAirport(document.getElementById('arrival-code').value.toUpperCase());
    const aircraft=document.getElementById('aircraft-type').value||'other';
    const dd=document.getElementById('calculated-duration'),di=document.getElementById('distance-display'),dur=document.getElementById('flight-duration');
    if(!dep||!arr){dd.textContent='--h --min';di.textContent='Distance: -- km';dur.value='';return;}
    const dist=calculateDistance(dep.lat,dep.lng,arr.lat,arr.lng);
    const total=Math.round((dist/(aircraftSpeeds[aircraft]||850))*60+30);
    dd.textContent=`${Math.floor(total/60)}h ${(total%60).toString().padStart(2,'0')}min`;
    di.textContent=`Distance: ${dist.toLocaleString()} km`;
    dur.value=total;
}
function calcCO2(flight) { return Math.round((flight.distance||0)*(CO2_PER_KM[flight.class]||CO2_PER_KM.economy)); }
function getTravellerLevel(km) { return TRAVELLER_LEVELS.find(l=>km>=l.min&&km<l.max)||TRAVELLER_LEVELS[0]; }

// Great-circle path
function greatCirclePoints(lat1,lon1,lat2,lon2,n=60) {
    const toRad=d=>d*Math.PI/180,toDeg=r=>r*180/Math.PI,pts=[];
    const d=2*Math.asin(Math.sqrt(Math.sin(toRad(lat2-lat1)/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(toRad(lon2-lon1)/2)**2));
    for(let i=0;i<=n;i++){
        const f=i/n;
        if(d===0){pts.push([lat1,lon1]);continue;}
        const sA=Math.sin((1-f)*d)/Math.sin(d),sB=Math.sin(f*d)/Math.sin(d);
        const x=sA*Math.cos(toRad(lat1))*Math.cos(toRad(lon1))+sB*Math.cos(toRad(lat2))*Math.cos(toRad(lon2));
        const y=sA*Math.cos(toRad(lat1))*Math.sin(toRad(lon1))+sB*Math.cos(toRad(lat2))*Math.sin(toRad(lon2));
        const z=sA*Math.sin(toRad(lat1))+sB*Math.sin(toRad(lat2));
        pts.push([toDeg(Math.atan2(z,Math.sqrt(x*x+y*y))),toDeg(Math.atan2(y,x))]);
    }
    return pts;
}

// ==========================================
// UI
// ==========================================
function toggleMenu() {
    const d=document.getElementById('menu-drawer'),o=document.getElementById('menu-overlay');
    const open=d.classList.contains('open');
    d.classList.toggle('open',!open); o.classList.toggle('open',!open);
}
function showAddFlight(isEdit=false) {
    const modal=document.getElementById('add-modal');
    if(!isEdit){
        currentFlightId=null; document.getElementById('flight-form').reset();
        ['departure-name','arrival-name'].forEach(id=>document.getElementById(id).textContent='');
        document.getElementById('calculated-duration').textContent='--h --min';
        document.getElementById('distance-display').textContent='Distance: -- km';
        document.getElementById('flight-date').valueAsDate=new Date();
        const now=new Date();
        document.getElementById('departure-time').value=`${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
    }
    const inner=modal.querySelector('.modal-content, .glass');
    if(inner){inner.style.transition='none';inner.style.transform='translateY(100%)';inner.style.opacity='0';}
    modal.classList.remove('hidden');
    if(inner){inner.getBoundingClientRect();inner.style.transition='transform 0.35s cubic-bezier(0.32,0.72,0,1),opacity 0.25s ease';inner.style.transform='translateY(0)';inner.style.opacity='1';}
    const mc=modal.querySelector('.modal-content'); if(mc) mc.scrollTop=0;
}
function hideAddFlight() {
    const modal=document.getElementById('add-modal'), inner=modal.querySelector('.modal-content, .glass');
    ['departure-suggestions','arrival-suggestions'].forEach(id=>document.getElementById(id).classList.add('hidden'));
    if(inner){
        inner.style.transition='transform 0.28s cubic-bezier(0.32,0.72,0,1),opacity 0.2s ease';
        inner.style.transform='translateY(100%)'; inner.style.opacity='0';
        setTimeout(()=>{modal.classList.add('hidden');inner.style.transition='none';inner.style.transform='';inner.style.opacity='';},280);
    } else modal.classList.add('hidden');
}
function showToast(msg) {
    const t=document.getElementById('toast'); if(!t) return;
    t.textContent=msg; t.style.animation='toastIn 0.3s ease-out both'; t.classList.remove('opacity-0');
    clearTimeout(t._timer);
    t._timer=setTimeout(()=>{t.style.animation='toastOut 0.3s ease-out both';setTimeout(()=>{t.classList.add('opacity-0');t.style.animation='';},300);},3000);
}

// ==========================================
// FLIGHT CRUD
// ==========================================
function saveFlight(e) {
    e.preventDefault();
    const dCode=document.getElementById('departure-code').value.toUpperCase();
    const aCode=document.getElementById('arrival-code').value.toUpperCase();
    if(!isValidIATA(dCode)||!isValidIATA(aCode)){showToast('Codes IATA invalides');return;}
    const dep=getAirport(dCode),arr=getAirport(aCode);
    if(!dep||!arr){showToast('Aéroport non trouvé');return;}
    const dist=calculateDistance(dep.lat,dep.lng,arr.lat,arr.lng);
    const flight={
        id:currentFlightId||Date.now().toString(),
        number:document.getElementById('flight-number').value,
        departure:{code:dCode,name:dep.name,city:dep.city,country:dep.country,lat:dep.lat,lng:dep.lng,time:document.getElementById('departure-time').value},
        arrival:{code:aCode,name:arr.name,city:arr.city,country:arr.country,lat:arr.lat,lng:arr.lng},
        date:document.getElementById('flight-date').value,
        duration:parseInt(document.getElementById('flight-duration').value)||0,
        aircraft:document.getElementById('aircraft-type').value,
        seat:document.getElementById('seat-number').value,
        class:document.getElementById('travel-class').value,
        reason:document.getElementById('travel-reason').value,
        notes:document.getElementById('flight-notes').value,
        distance:dist,
        createdAt:currentFlightId?(flights.find(f=>f.id===currentFlightId)?.createdAt||new Date().toISOString()):new Date().toISOString(),
        updatedAt:new Date().toISOString()
    };
    if(currentFlightId){const i=flights.findIndex(f=>f.id===currentFlightId);if(i!==-1)flights[i]=flight;}
    else flights.unshift(flight);
    saveFlightsToLocal(); currentPage=1; renderFlights(currentFilter); updateStats(); refreshMap(); hideAddFlight();
    if(currentUser&&isOnline) syncData(); else {pendingSync=true;queueOfflineOperation('save',flight);}
    showToast(currentFlightId?'Vol modifié !':'Vol enregistré !');
}

// ==========================================
// RENDER + PAGINATION
// ==========================================
function renderFlights(filter='all') {
    currentFilter=filter;
    const container=document.getElementById('flights-list'),emptyState=document.getElementById('empty-state');
    let ff=[...flights];
    if(filter==='year'){const y=new Date().getFullYear();ff=ff.filter(f=>new Date(f.date).getFullYear()===y);}
    else if(filter==='month'){const n=new Date();ff=ff.filter(f=>{const d=new Date(f.date);return d.getFullYear()===n.getFullYear()&&d.getMonth()===n.getMonth();});}
    const total=ff.length,totalPages=Math.ceil(total/FLIGHTS_PER_PAGE);
    if(currentPage>totalPages) currentPage=Math.max(1,totalPages);
    if(!total){container.innerHTML='';emptyState.classList.remove('hidden');hidePagination();return;}
    emptyState.classList.add('hidden');
    const pf=ff.slice((currentPage-1)*FLIGHTS_PER_PAGE,currentPage*FLIGHTS_PER_PAGE);
    const cls={economy:'bg-green-500/20 text-green-400',premium:'bg-blue-500/20 text-blue-400',business:'bg-purple-500/20 text-purple-400',first:'bg-amber-500/20 text-amber-400'};
    container.innerHTML=pf.map((flight,idx)=>{
        const date=new Date(flight.date).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'});
        const dH=Math.floor(flight.duration/60),dM=flight.duration%60,co2=calcCO2(flight);
        return `<div class="glass-card rounded-2xl p-4 btn-press flight-card-enter" style="animation-delay:${idx*.05}s" onclick="showFlightDetail('${flight.id}')">
            <div class="flex items-start justify-between mb-3">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xl">✈️</div>
                    <div><div class="flex items-center gap-2"><span class="font-bold text-lg">${flight.departure.code}</span><i data-lucide="arrow-right" class="w-4 h-4 text-gray-400"></i><span class="font-bold text-lg">${flight.arrival.code}</span></div><p class="text-xs text-gray-400">${flight.number} • ${date}</p></div>
                </div>
                <span class="px-2 py-1 rounded-lg text-xs font-medium ${cls[flight.class]||cls.economy}">${classLabels[flight.class]||flight.class}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
                <div class="flex items-center gap-2 text-gray-400 truncate">
                    <span class="truncate">${flight.departure.city||flight.departure.name}</span>
                    <div class="flex-shrink-0 h-px w-8 bg-gray-600 relative"><i data-lucide="plane" class="w-3 h-3 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-blue-400"></i></div>
                    <span class="truncate">${flight.arrival.city||flight.arrival.name}</span>
                </div>
                <div class="text-right flex-shrink-0 ml-2">
                    <span class="text-gray-500 block">${(flight.distance||0).toLocaleString()} km</span>
                    ${flight.duration>0?`<span class="text-xs text-blue-400">${dH}h${dM.toString().padStart(2,'0')}</span>`:''}
                    <span class="text-xs text-emerald-400 block">🌿 ${co2} kg</span>
                </div>
            </div>
        </div>`;
    }).join('');
    lucide.createIcons();
    const mc=document.getElementById('menu-flight-count');
    if(mc) mc.textContent=`${flights.length} vol${flights.length>1?'s':''} enregistré${flights.length>1?'s':''}`;
    renderPagination(totalPages,total);
}
function renderPagination(totalPages,total) {
    let pag=document.getElementById('pagination-bar');
    if(!pag){pag=document.createElement('div');pag.id='pagination-bar';pag.className='flex items-center justify-center gap-3 mt-4 mb-6';document.getElementById('flights-list').after(pag);}
    if(totalPages<=1){pag.innerHTML='';return;}
    const start=(currentPage-1)*FLIGHTS_PER_PAGE+1,end=Math.min(currentPage*FLIGHTS_PER_PAGE,total);
    pag.innerHTML=`<button onclick="gotoPage(${currentPage-1})" ${currentPage===1?'disabled':''} class="px-3 py-2 rounded-lg glass text-sm ${currentPage===1?'opacity-40 cursor-not-allowed':'hover:bg-white/10'}">‹ Préc.</button><span class="text-sm text-gray-400">${start}–${end} sur ${total}</span><button onclick="gotoPage(${currentPage+1})" ${currentPage===totalPages?'disabled':''} class="px-3 py-2 rounded-lg glass text-sm ${currentPage===totalPages?'opacity-40 cursor-not-allowed':'hover:bg-white/10'}">Suiv. ›</button>`;
}
function hidePagination(){const p=document.getElementById('pagination-bar');if(p)p.innerHTML='';}
function gotoPage(p){currentPage=p;renderFlights(currentFilter);window.scrollTo({top:0,behavior:'smooth'});}
function filterFlights(type){currentPage=1;document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active-filter',b.dataset.filter===type));renderFlights(type);}
function updateStats() {
    const td=flights.reduce((s,f)=>s+(f.distance||0),0),th=Math.round(flights.reduce((s,f)=>s+(f.duration||0),0)/60);
    const countries=new Set(flights.flatMap(f=>[f.departure.country,f.arrival.country])).size;
    ['stat-flights','stat-distance','stat-countries','stat-hours'].forEach(id=>{const el=document.getElementById(id);if(el){el.classList.remove('stat-animate');void el.offsetWidth;el.classList.add('stat-animate');}});
    const sf=document.getElementById('stat-flights'),sd=document.getElementById('stat-distance'),sc=document.getElementById('stat-countries'),sh=document.getElementById('stat-hours');
    if(sf)sf.textContent=flights.length;if(sd)sd.innerHTML=`${td.toLocaleString()} <span class="text-sm font-normal">km</span>`;if(sc)sc.textContent=countries;if(sh)sh.textContent=th;
    const hs=document.getElementById('header-stats');if(hs)hs.textContent=flights.length>0?`${flights.length} vol${flights.length>1?'s':''} • ${td.toLocaleString()} km`:'Commencez votre journal';
}

// ==========================================
// MAP — Leaflet + Clustering + Period filter + Arc hover animation
// ==========================================
function initMap() {
    if(map) return;
    map=L.map('map',{center:[20,0],zoom:2,zoomControl:false,attributionControl:false});
    mapTileLayer=L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{maxZoom:19}).addTo(map);
    _injectMapControls();
    refreshMap();
}
function _injectMapControls() {
    if(document.getElementById('map-controls')) return;
    const wrap=document.getElementById('map')?.parentElement;
    if(!wrap) return;
    wrap.style.position='relative';
    const ctrl=document.createElement('div');
    ctrl.id='map-controls';
    ctrl.style.cssText='position:absolute;top:10px;left:10px;z-index:400;display:flex;gap:6px;flex-wrap:wrap;';
    wrap.appendChild(ctrl);
    _updateMapControls(ctrl);
}
function _updateMapControls(ctrl) {
    if(!ctrl) ctrl=document.getElementById('map-controls'); if(!ctrl) return;
    const years=[...new Set(flights.map(f=>new Date(f.date).getFullYear()))].sort((a,b)=>b-a);
    ctrl.innerHTML=`
        <span class="map-filter-pill ${mapFilterYear==='all'?'active':''}" data-map-year="all" onclick="setMapFilter('all')">Tous</span>
        ${years.map(y=>`<span class="map-filter-pill ${mapFilterYear===String(y)?'active':''}" data-map-year="${y}" onclick="setMapFilter('${y}')">${y}</span>`).join('')}
        <span class="map-filter-pill" onclick="toggleGlobe()">🌍 Globe</span>
        <span class="map-filter-pill" onclick="showChoropleth()">🗺️ Pays</span>`;
}
function setMapFilter(year) {
    mapFilterYear=year; _updateMapControls(); refreshMap();
}
function clearAllMapLayers() {
    if(markerClusterGroup){markerClusterGroup.clearLayers();try{map.removeLayer(markerClusterGroup);}catch{}markerClusterGroup=null;}
    mapMarkers.forEach(m=>{try{m.remove();}catch{}});
    mapPolylines.forEach(p=>{try{p.remove();}catch{}});
    mapMarkers=[];mapPolylines=[];
}
function destroyMap() {
    clearAllMapLayers();
    if(mapTileLayer){mapTileLayer.remove();mapTileLayer=null;}
    if(map){map.off();map.remove();map=null;}
}
function refreshMap() {
    if(!map){initMap();return;}
    clearAllMapLayers();
    let ff=[...flights];
    if(mapFilterYear!=='all') ff=ff.filter(f=>new Date(f.date).getFullYear()===parseInt(mapFilterYear));
    _updateMapControls();
    if(!ff.length) return;
    const useCluster=typeof L.markerClusterGroup==='function';
    if(useCluster){
        markerClusterGroup=L.markerClusterGroup({maxClusterRadius:50,spiderfyOnMaxZoom:true,showCoverageOnHover:false,
            iconCreateFunction:c=>L.divIcon({html:`<div style="background:rgba(59,130,246,.85);border:2px solid #fff;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#fff">${c.getChildCount()}</div>`,className:'',iconSize:[36,36]})});
    }
    const bounds=[];
    ff.forEach(flight=>{
        const dep=[flight.departure.lat,flight.departure.lng],arr=[flight.arrival.lat,flight.arrival.lng];
        bounds.push(dep,arr);
        const mkIcon=(color)=>L.divIcon({html:`<div style="background:${color};border:2px solid #fff;border-radius:50%;width:12px;height:12px;"></div>`,className:'',iconSize:[12,12],iconAnchor:[6,6]});
        const dm=L.marker(dep,{icon:mkIcon('#3b82f6')}).bindPopup(`<b>${flight.departure.code}</b><br>${flight.departure.name}`);
        const am=L.marker(arr,{icon:mkIcon('#8b5cf6')}).bindPopup(`<b>${flight.arrival.code}</b><br>${flight.arrival.name}`);
        if(useCluster){markerClusterGroup.addLayer(dm);markerClusterGroup.addLayer(am);}
        else{dm.addTo(map);am.addTo(map);}
        mapMarkers.push(dm,am);
        // Animated arc on hover
        const gcPts=greatCirclePoints(flight.departure.lat,flight.departure.lng,flight.arrival.lat,flight.arrival.lng);
        const path=L.polyline(gcPts,{color:'#3b82f6',weight:2,opacity:0.5,dashArray:'5,10',className:'flight-path'}).addTo(map);
        path.on('mouseover',function(){this.setStyle({color:'#f59e0b',weight:3,opacity:1,dashArray:'0'});this.bindTooltip(`${flight.departure.code} → ${flight.arrival.code} · ${(flight.distance||0).toLocaleString()} km · 🌿${calcCO2(flight)}kg`,{sticky:true}).openTooltip();});
        path.on('mouseout', function(){this.setStyle({color:'#3b82f6',weight:2,opacity:0.5,dashArray:'5,10'});this.closeTooltip();});
        mapPolylines.push(path);
    });
    if(useCluster) map.addLayer(markerClusterGroup);
    if(bounds.length) map.fitBounds(bounds,{padding:[50,50]});
}

// ==========================================
// CHOROPLETH
// ==========================================
function showChoropleth() {
    let modal=document.getElementById('choropleth-modal');
    if(!modal){
        modal=document.createElement('div');
        modal.id='choropleth-modal';
        modal.className='fixed inset-0 z-50 flex items-center justify-center p-4';
        modal.style.background='rgba(0,0,0,.75)';
        modal.innerHTML=`<div class="glass rounded-2xl w-full max-w-lg overflow-hidden" style="max-height:88vh"><div class="flex items-center justify-between p-4 border-b border-white/10"><h2 class="text-lg font-bold">🗺️ Pays visités</h2><button onclick="hideChoropleth()" class="text-gray-400 hover:text-white text-2xl leading-none">×</button></div><div id="choropleth-content" class="p-4 overflow-y-auto" style="max-height:72vh"></div></div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click',e=>{if(e.target===modal)hideChoropleth();});
    }
    modal.classList.remove('hidden');
    _buildChoropleth();
}
function hideChoropleth(){const m=document.getElementById('choropleth-modal');if(m)m.classList.add('hidden');}
function _buildChoropleth() {
    const content=document.getElementById('choropleth-content'); if(!content) return;
    const countByCountry={};
    flights.forEach(f=>{[f.departure.country,f.arrival.country].forEach(c=>{countByCountry[c]=(countByCountry[c]||0)+1;});});
    const sorted=Object.entries(countByCountry).sort((a,b)=>b[1]-a[1]);
    const max=sorted[0]?.[1]||1, visited=Object.keys(countByCountry).length;
    content.innerHTML=`<p class="text-sm text-gray-400 mb-4">${visited} pays visités</p><div class="space-y-2">${sorted.map(([country,count])=>{
        const pct=Math.round((count/max)*100),op=(0.15+0.85*(count/max)).toFixed(2);
        return `<div class="flex items-center gap-3"><span class="text-sm w-36 truncate font-medium">${country}</span><div class="flex-1 h-6 rounded-md overflow-hidden" style="background:rgba(255,255,255,.06)"><div style="width:${pct}%;height:100%;background:rgba(59,130,246,${op});border-radius:4px;display:flex;align-items:center;padding-left:8px"><span class="text-xs text-white font-semibold">${count}</span></div></div></div>`;
    }).join('')}</div>`;
}

// ==========================================
// GLOBE 3D — Three.js
// ==========================================
function toggleGlobe() { globeActive ? hideGlobe() : showGlobe(); }
function showGlobe() {
    let container=document.getElementById('globe-container');
    if(!container){
        container=document.createElement('div');
        container.id='globe-container';
        container.innerHTML=`<canvas id="globe-canvas"></canvas><button onclick="hideGlobe()" style="position:absolute;top:10px;right:10px;background:rgba(0,0,0,.55);border:none;color:#fff;border-radius:8px;padding:4px 12px;cursor:pointer;font-size:13px;">✕ Fermer</button><div style="position:absolute;bottom:10px;left:50%;transform:translateX(-50%);font-size:11px;color:rgba(255,255,255,.35)">Glisser pour tourner</div>`;
        const mapEl=document.getElementById('map');
        mapEl?.parentElement?.insertAdjacentElement('afterend',container);
    }
    container.classList.add('active');
    globeActive=true;
    if(!globeRenderer) _initGlobe();
}
function hideGlobe() {
    const c=document.getElementById('globe-container');
    if(c) c.classList.remove('active');
    globeActive=false;
    if(globeAnimFrame){cancelAnimationFrame(globeAnimFrame);globeAnimFrame=null;}
    if(globeRenderer){globeRenderer.dispose();globeRenderer=null;globeScene=null;globeCamera=null;}
}
function _initGlobe() {
    if(!window.THREE){showToast('Three.js requis — ajoutez le script dans index.html');return;}
    const canvas=document.getElementById('globe-canvas');
    if(!canvas) return;
    const W=canvas.clientWidth||360,H=360;
    globeRenderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
    globeRenderer.setSize(W,H,false);
    globeRenderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    globeScene=new THREE.Scene();
    globeCamera=new THREE.PerspectiveCamera(45,W/H,.1,100);
    globeCamera.position.z=2.5;
    const sphere=new THREE.Mesh(new THREE.SphereGeometry(1,64,64),new THREE.MeshPhongMaterial({color:0x1e3a5f,shininess:20}));
    globeScene.add(sphere);
    const gMat=new THREE.LineBasicMaterial({color:0x334155,transparent:true,opacity:.3});
    for(let la=-80;la<=80;la+=20){const pts=[];for(let lo=0;lo<=360;lo+=5){const a=la*Math.PI/180,b=lo*Math.PI/180;pts.push(new THREE.Vector3(Math.cos(a)*Math.cos(b),Math.sin(a),Math.cos(a)*Math.sin(b)));}globeScene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),gMat));}
    for(let lo=0;lo<360;lo+=30){const pts=[];for(let la=-90;la<=90;la+=5){const a=la*Math.PI/180,b=lo*Math.PI/180;pts.push(new THREE.Vector3(Math.cos(a)*Math.cos(b),Math.sin(a),Math.cos(a)*Math.sin(b)));}globeScene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),gMat));}
    globeScene.add(new THREE.AmbientLight(0x4466aa,1));
    const dl=new THREE.DirectionalLight(0xffffff,1.2);dl.position.set(5,3,5);globeScene.add(dl);
    const toV=(la,lo)=>{const a=la*Math.PI/180,b=lo*Math.PI/180;return new THREE.Vector3(Math.cos(a)*Math.cos(b),Math.sin(a),Math.cos(a)*Math.sin(b));};
    flights.forEach(flight=>{
        const pts=greatCirclePoints(flight.departure.lat,flight.departure.lng,flight.arrival.lat,flight.arrival.lng,40);
        const v3=pts.map((p,i)=>toV(p[0],p[1]).multiplyScalar(1.01+Math.sin(i/pts.length*Math.PI)*0.07));
        globeScene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(v3),new THREE.LineBasicMaterial({color:0x3b82f6,transparent:true,opacity:.8})));
        [toV(flight.departure.lat,flight.departure.lng),toV(flight.arrival.lat,flight.arrival.lng)].forEach((pos,i)=>{
            const dot=new THREE.Mesh(new THREE.SphereGeometry(.013,8,8),new THREE.MeshBasicMaterial({color:i===0?0x3b82f6:0x8b5cf6}));
            dot.position.copy(pos.multiplyScalar(1.015));globeScene.add(dot);
        });
    });
    canvas.addEventListener('pointerdown',e=>{globeOrbitDragging=true;globeOrbitLast={x:e.clientX,y:e.clientY};});
    canvas.addEventListener('pointermove',e=>{if(!globeOrbitDragging)return;globeRotY+=(e.clientX-globeOrbitLast.x)*.005;globeRotX=Math.max(-1.4,Math.min(1.4,globeRotX+(e.clientY-globeOrbitLast.y)*.005));globeOrbitLast={x:e.clientX,y:e.clientY};});
    canvas.addEventListener('pointerup',()=>globeOrbitDragging=false);
    const root=new THREE.Group();globeScene.add(root);
    const animate=()=>{
        globeAnimFrame=requestAnimationFrame(animate);
        if(!globeOrbitDragging) globeRotY+=.0015;
        globeScene.children.forEach(c=>{if(!(c instanceof THREE.Light)){c.rotation.y=globeRotY;c.rotation.x=globeRotX;}});
        globeRenderer.render(globeScene,globeCamera);
    };
    animate();
}

// ==========================================
// FLIGHT DETAIL
// ==========================================
function showFlightDetail(id) {
    const flight=flights.find(f=>f.id===id); if(!flight) return;
    currentFlightId=id;
    const date=new Date(flight.date).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    const dH=Math.floor(flight.duration/60),dM=flight.duration%60;
    const co2=calcCO2(flight),trees=Math.ceil(co2/1000*TREES_PER_TONNE);
    document.getElementById('detail-content').innerHTML=`
        <div class="space-y-5">
            <div class="flex items-center justify-between">
                <div class="text-center"><div class="text-3xl font-bold text-blue-400">${flight.departure.code}</div><div class="text-sm text-gray-400">${flight.departure.city||flight.departure.name}</div><div class="text-xs text-gray-500">${flight.departure.country}</div>${flight.departure.time?`<div class="text-sm text-blue-400 mt-1">🕐 ${flight.departure.time}</div>`:''}</div>
                <div class="flex-1 px-4"><div class="h-px bg-gradient-to-r from-blue-500 to-purple-500 relative"><i data-lucide="plane" class="w-5 h-5 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-blue-400 bg-gray-800 rounded-full p-1"></i></div><div class="text-center text-xs text-gray-500 mt-2">${(flight.distance||0).toLocaleString()} km</div>${flight.duration>0?`<div class="text-center text-xs text-blue-400">${dH}h${dM.toString().padStart(2,'0')}</div>`:''}</div>
                <div class="text-center"><div class="text-3xl font-bold text-purple-400">${flight.arrival.code}</div><div class="text-sm text-gray-400">${flight.arrival.city||flight.arrival.name}</div><div class="text-xs text-gray-500">${flight.arrival.country}</div></div>
            </div>
            <div class="glass-card rounded-xl p-3" style="background:rgba(16,185,129,.06);border-color:rgba(16,185,129,.2)">
                <div class="text-xs text-emerald-400 font-semibold mb-2">🌍 Impact CO₂ estimé</div>
                <div class="flex items-center justify-between">
                    <div><span class="text-xl font-bold text-emerald-400">${co2}</span><span class="text-sm text-gray-400 ml-1">kg CO₂</span></div>
                    <div class="text-right text-xs text-gray-400">🌳 <span class="text-emerald-400 font-semibold">${trees} arbre${trees>1?'s':''}</span> à planter/an</div>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div class="glass-card rounded-xl p-3"><div class="text-xs text-gray-400 mb-1">N° de vol</div><div class="font-semibold">${flight.number}</div></div>
                <div class="glass-card rounded-xl p-3"><div class="text-xs text-gray-400 mb-1">Date</div><div class="font-semibold text-sm">${date}</div></div>
            </div>
            ${flight.aircraft?`<div class="glass-card rounded-xl p-3"><div class="text-xs text-gray-400 mb-1">Appareil</div><div class="font-semibold">${flight.aircraft}</div></div>`:''}
            ${flight.seat?`<div class="glass-card rounded-xl p-3"><div class="text-xs text-gray-400 mb-1">Siège</div><div class="font-semibold">${flight.seat}</div></div>`:''}
            <div class="grid grid-cols-2 gap-4">
                <div class="glass-card rounded-xl p-3"><div class="text-xs text-gray-400 mb-1">Classe</div><div class="font-semibold">${classLabels[flight.class]||flight.class}</div></div>
                <div class="glass-card rounded-xl p-3"><div class="text-xs text-gray-400 mb-1">Motif</div><div class="font-semibold">${reasonLabels[flight.reason]||flight.reason}</div></div>
            </div>
            ${flight.notes?`<div class="glass-card rounded-xl p-3"><div class="text-xs text-gray-400 mb-1">Notes</div><div class="text-sm text-gray-300">${flight.notes}</div></div>`:''}
        </div>`;
    lucide.createIcons();
    const modal=document.getElementById('detail-modal');
    modal.classList.remove('hidden');
    const inner=modal.querySelector('.glass');
    if(inner){inner.classList.add('modal-animate');setTimeout(()=>inner.classList.remove('modal-animate'),300);}
}
function hideDetail(){document.getElementById('detail-modal').classList.add('hidden');currentFlightId=null;}
function editCurrentFlight() {
    if(!currentFlightId) return;
    const flight=flights.find(f=>f.id===currentFlightId); if(!flight) return;
    hideDetail(); showAddFlight(true);
    setTimeout(()=>{
        document.getElementById('flight-number').value=flight.number||'';
        document.getElementById('departure-code').value=flight.departure?.code||'';
        document.getElementById('departure-name').textContent=flight.departure?.name?`${flight.departure.name}, ${flight.departure.city}`:'';
        document.getElementById('arrival-code').value=flight.arrival?.code||'';
        document.getElementById('arrival-name').textContent=flight.arrival?.name?`${flight.arrival.name}, ${flight.arrival.city}`:'';
        document.getElementById('flight-date').value=flight.date||'';
        document.getElementById('departure-time').value=flight.departure?.time||'';
        document.getElementById('flight-duration').value=flight.duration||'';
        document.getElementById('aircraft-type').value=flight.aircraft||'';
        document.getElementById('seat-number').value=flight.seat||'';
        document.getElementById('travel-class').value=flight.class||'economy';
        document.getElementById('travel-reason').value=flight.reason||'leisure';
        document.getElementById('flight-notes').value=flight.notes||'';
        if(flight.duration>0){const h=Math.floor(flight.duration/60),m=flight.duration%60;document.getElementById('calculated-duration').textContent=`${h}h ${m.toString().padStart(2,'0')}min`;}
        if(flight.distance) document.getElementById('distance-display').textContent=`Distance: ${flight.distance.toLocaleString()} km`;
    },50);
}
function deleteCurrentFlight() {
    if(!currentFlightId) return;
    if(confirm('Supprimer ce vol ?')){
        flights=flights.filter(f=>f.id!==currentFlightId);
        saveFlightsToLocal();renderFlights(currentFilter);updateStats();refreshMap();hideDetail();
        if(currentUser&&isOnline)syncData();else{pendingSync=true;queueOfflineOperation('delete',{id:currentFlightId});}
        showToast('Vol supprimé');
    }
}

// ==========================================
// STATS MODAL
// ==========================================
function showStats(){document.getElementById('stats-modal').classList.remove('hidden');updateStatsModal();}
function hideStats(){document.getElementById('stats-modal').classList.add('hidden');}
function updateStatsModal() {
    Object.values(charts).forEach(c=>{try{c.destroy();}catch{}});charts={};
    const totalDist=flights.reduce((s,f)=>s+(f.distance||0),0);
    const totalHours=Math.round(flights.reduce((s,f)=>s+(f.duration||0),0)/60);
    const totalCO2=flights.reduce((s,f)=>s+calcCO2(f),0);
    const totalTrees=Math.ceil(totalCO2/1000*TREES_PER_TONNE);
    document.getElementById('stat-total-distance').textContent=`${totalDist.toLocaleString()} km`;
    document.getElementById('stat-equator').textContent=(totalDist/40075).toFixed(2);
    document.getElementById('stat-total-time').textContent=`${totalHours}h`;
    document.getElementById('stat-days').textContent=(totalHours/24).toFixed(1);

    _renderTravellerScore(totalDist);
    _renderCO2Summary(totalCO2,totalTrees);

    // Flights by month chart
    const mData={};
    flights.forEach(f=>{const d=new Date(f.date),k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;mData[k]=(mData[k]||0)+1;});
    const sm=Object.keys(mData).sort();
    const fce=document.getElementById('flights-chart');
    if(fce)charts.flights=new Chart(fce,{type:'bar',data:{labels:sm.map(m=>{const[y,mo]=m.split('-');return`${mo}/${y.slice(2)}`;}),datasets:[{label:'Vols',data:sm.map(m=>mData[m]),backgroundColor:'#3b82f6',borderRadius:6}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{color:'#9ca3af'},grid:{color:'#374151'}},x:{ticks:{color:'#9ca3af'},grid:{display:false}}}}});

    _renderCumulativeChart();
    _renderHeatmap();

    // Top routes
    const rc={};flights.forEach(f=>{const r=`${f.departure.code}-${f.arrival.code}`;rc[r]=(rc[r]||0)+1;});
    const tr=Object.entries(rc).sort((a,b)=>b[1]-a[1]).slice(0,5),mr=tr[0]?.[1]||1;
    document.getElementById('top-routes-list').innerHTML=tr.map(([r,c])=>`<div class="flex items-center gap-3"><span class="text-sm font-medium w-24">${r}</span><div class="flex-1 stat-progress-bar"><div class="stat-progress-fill bg-blue-500" style="width:${(c/mr)*100}%"></div></div><span class="text-sm text-gray-400 w-8 text-right">${c}</span></div>`).join('')||'<p class="text-sm text-gray-500">Aucune donnée</p>';

    const ac={};flights.forEach(f=>{const a=f.number.substring(0,2);ac[a]=(ac[a]||0)+1;});
    const ta=Object.entries(ac).sort((a,b)=>b[1]-a[1]).slice(0,5),ma=ta[0]?.[1]||1;
    document.getElementById('airlines-list').innerHTML=ta.map(([a,c])=>`<div class="flex items-center gap-3"><span class="text-sm font-medium w-24">${a}</span><div class="flex-1 stat-progress-bar"><div class="stat-progress-fill bg-purple-500" style="width:${(c/ma)*100}%"></div></div><span class="text-sm text-gray-400 w-8 text-right">${c}</span></div>`).join('')||'<p class="text-sm text-gray-500">Aucune donnée</p>';

    const apc={};flights.forEach(f=>{if(f.aircraft)apc[f.aircraft]=(apc[f.aircraft]||0)+1;});
    const tap=Object.entries(apc).sort((a,b)=>b[1]-a[1]).slice(0,5),map2=tap[0]?.[1]||1;
    document.getElementById('aircraft-list').innerHTML=tap.map(([a,c])=>`<div class="flex items-center gap-3"><span class="text-sm font-medium w-32 truncate">${a}</span><div class="flex-1 stat-progress-bar"><div class="stat-progress-fill bg-amber-500" style="width:${(c/map2)*100}%"></div></div><span class="text-sm text-gray-400 w-8 text-right">${c}</span></div>`).join('')||'<p class="text-sm text-gray-500">Aucune donnée</p>';

    const cc={economy:0,premium:0,business:0,first:0};flights.forEach(f=>{if(cc[f.class]!==undefined)cc[f.class]++;});
    const tc=flights.length||1,cco={economy:'bg-green-500',premium:'bg-blue-500',business:'bg-purple-500',first:'bg-amber-500'};
    document.getElementById('class-distribution').innerHTML=Object.entries(cc).filter(([,c])=>c>0).map(([cl,c])=>`<div class="flex items-center justify-between"><span class="text-sm text-gray-300">${classLabels[cl]}</span><div class="flex items-center gap-2"><div class="w-32 stat-progress-bar"><div class="stat-progress-fill ${cco[cl]}" style="width:${(c/tc)*100}%"></div></div><span class="text-sm text-gray-400 w-12 text-right">${c} (${Math.round((c/tc)*100)}%)</span></div></div>`).join('')||'<p class="text-sm text-gray-500">Aucune donnée</p>';

    const rco={};flights.forEach(f=>{rco[f.reason]=(rco[f.reason]||0)+1;});
    const trr=Object.entries(rco).sort((a,b)=>b[1]-a[1]),mrr=trr[0]?.[1]||1;
    document.getElementById('reasons-list').innerHTML=trr.map(([r,c])=>`<div class="flex items-center gap-3"><span class="text-sm font-medium w-24">${reasonLabels[r]||r}</span><div class="flex-1 stat-progress-bar"><div class="stat-progress-fill bg-emerald-500" style="width:${(c/mrr)*100}%"></div></div><span class="text-sm text-gray-400 w-8 text-right">${c}</span></div>`).join('')||'<p class="text-sm text-gray-500">Aucune donnée</p>';

    const longest=flights.reduce((mx,f)=>(f.distance>(mx.distance||0))?f:mx,flights[0]||{distance:0,number:'-',departure:{code:'?'},arrival:{code:'?'}});
    const shortest=flights.reduce((mn,f)=>(f.distance<(mn.distance??Infinity))?f:mn,flights[0]||{distance:0,number:'-',departure:{code:'?'},arrival:{code:'?'}});
    const longestDur=flights.reduce((mx,f)=>(f.duration>(mx.duration||0))?f:mx,flights[0]||{duration:0,number:'-',departure:{code:'?'},arrival:{code:'?'}});
    document.getElementById('records-list').innerHTML=`
        <div class="glass-card rounded-xl p-3 flex justify-between items-center"><div><div class="text-xs text-gray-400">Vol le plus long</div><div class="text-sm font-medium">${longest.number} (${(longest.distance||0).toLocaleString()} km)</div><div class="text-xs text-gray-500">${longest.departure.code}→${longest.arrival.code}</div></div><i data-lucide="trophy" class="w-5 h-5 text-yellow-400"></i></div>
        <div class="glass-card rounded-xl p-3 flex justify-between items-center"><div><div class="text-xs text-gray-400">Vol le plus court</div><div class="text-sm font-medium">${shortest.number} (${(shortest.distance||0).toLocaleString()} km)</div><div class="text-xs text-gray-500">${shortest.departure.code}→${shortest.arrival.code}</div></div><i data-lucide="minimize-2" class="w-5 h-5 text-blue-400"></i></div>
        <div class="glass-card rounded-xl p-3 flex justify-between items-center"><div><div class="text-xs text-gray-400">Plus longue durée</div><div class="text-sm font-medium">${longestDur.number} (${Math.floor((longestDur.duration||0)/60)}h${((longestDur.duration||0)%60).toString().padStart(2,'0')}min)</div><div class="text-xs text-gray-500">${longestDur.departure.code}→${longestDur.arrival.code}</div></div><i data-lucide="clock" class="w-5 h-5 text-purple-400"></i></div>`;

    const avg=flights.length?Math.round(totalDist/flights.length):0;
    const ua=new Set(flights.flatMap(f=>[f.departure.code,f.arrival.code])).size;
    document.getElementById('detailed-stats').innerHTML=`
        <div class="glass-card rounded-xl p-3 flex justify-between"><span class="text-gray-400">Distance moyenne</span><span class="font-semibold">${avg} km</span></div>
        <div class="glass-card rounded-xl p-3 flex justify-between"><span class="text-gray-400">Aéroports uniques</span><span class="font-semibold">${ua}</span></div>
        <div class="glass-card rounded-xl p-3 flex justify-between"><span class="text-gray-400">CO₂ total</span><span class="font-semibold text-emerald-400">${totalCO2.toLocaleString()} kg</span></div>
        <div class="glass-card rounded-xl p-3 flex justify-between"><span class="text-gray-400">Premier vol</span><span class="font-semibold">${flights.length?new Date(Math.min(...flights.map(f=>+new Date(f.date)))).toLocaleDateString('fr-FR'):'-'}</span></div>`;
    lucide.createIcons();
}

// ---- TRAVELLER SCORE ----
function _renderTravellerScore(totalKm) {
    let el=document.getElementById('traveller-score-section');
    if(!el){
        el=document.createElement('div');el.id='traveller-score-section';
        const ref=document.querySelector('#stats-modal .glass > div');
        if(ref) ref.insertAdjacentElement('afterbegin',el);
    }
    const lv=getTravellerLevel(totalKm);
    const next=TRAVELLER_LEVELS.find(l=>l.min>lv.min);
    const pct=next?Math.min(100,Math.round(((totalKm-lv.min)/(next.min-lv.min))*100)):100;
    el.innerHTML=`
        <div class="glass-card rounded-2xl p-4 mb-5" style="border:1px solid ${lv.color}44">
            <div class="flex items-center justify-between mb-3">
                <div><div class="text-xs text-gray-400 mb-1">Score Voyageur</div><div class="flex items-center gap-2"><span class="text-2xl">${lv.icon}</span><span class="text-lg font-bold" style="color:${lv.color}">${lv.name}</span></div></div>
                <div class="text-right"><div class="text-2xl font-bold">${totalKm.toLocaleString()}</div><div class="text-xs text-gray-400">km parcourus</div></div>
            </div>
            ${next?`<div class="score-progress"><div class="score-progress-fill" style="width:${pct}%;background:linear-gradient(90deg,${lv.color},${next.color})"></div></div><div class="flex justify-between mt-1"><span class="text-xs text-gray-500">${lv.name}</span><span class="text-xs text-gray-400">${pct}% → ${next.name} (encore ${(next.min-totalKm).toLocaleString()} km)</span></div>`:`<div class="text-xs text-center text-amber-400 mt-1">🏆 Niveau maximum atteint !</div>`}
        </div>`;
}

// ---- CO2 SUMMARY ----
function _renderCO2Summary(co2,trees) {
    let el=document.getElementById('co2-summary-section');
    if(!el){
        el=document.createElement('div');el.id='co2-summary-section';
        const ref=document.getElementById('traveller-score-section');
        if(ref) ref.insertAdjacentElement('afterend',el);
    }
    el.innerHTML=`
        <div class="glass-card rounded-2xl p-4 mb-5" style="background:rgba(16,185,129,.04);border:1px solid rgba(16,185,129,.2)">
            <div class="text-sm font-semibold text-emerald-400 mb-3">🌍 Bilan CO₂ global</div>
            <div class="grid grid-cols-2 gap-3">
                <div class="glass-card rounded-xl p-3 text-center"><div class="text-xl font-bold text-emerald-400">${(co2/1000).toFixed(2)}</div><div class="text-xs text-gray-400">tonnes CO₂</div></div>
                <div class="glass-card rounded-xl p-3 text-center"><div class="text-xl font-bold text-green-400">🌳 ${trees.toLocaleString()}</div><div class="text-xs text-gray-400">arbres/an</div></div>
            </div>
            <div class="mt-3 text-xs text-gray-500 text-center">Source facteurs ADEME — varie selon la classe</div>
        </div>`;
}

// ---- CUMULATIVE DISTANCE CHART ----
function _renderCumulativeChart() {
    let el=document.getElementById('cumulative-chart-section');
    if(!el){
        el=document.createElement('div');el.id='cumulative-chart-section';
        el.innerHTML=`<div class="glass-card rounded-2xl p-4 mb-5"><div class="text-sm font-semibold mb-3">📈 Distance cumulée</div><canvas id="cumulative-chart" height="140"></canvas></div>`;
        const ref=document.getElementById('co2-summary-section');
        if(ref) ref.insertAdjacentElement('afterend',el);
    }
    const sorted=[...flights].sort((a,b)=>new Date(a.date)-new Date(b.date));
    let cumul=0;const labels=[],data=[];
    sorted.forEach(f=>{cumul+=(f.distance||0);labels.push(new Date(f.date).toLocaleDateString('fr-FR',{month:'short',year:'2-digit'}));data.push(cumul);});
    const c=document.getElementById('cumulative-chart');
    if(c){if(charts.cumulative)charts.cumulative.destroy();charts.cumulative=new Chart(c,{type:'line',data:{labels,datasets:[{label:'km cumulés',data,borderColor:'#10b981',backgroundColor:'rgba(16,185,129,.1)',fill:true,tension:.4,pointRadius:2}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{color:'#9ca3af',callback:v=>`${(v/1000).toFixed(0)}k`},grid:{color:'#374151'}},x:{ticks:{color:'#9ca3af',maxTicksLimit:8},grid:{display:false}}}}});}
}

// ---- HEATMAP ----
function _renderHeatmap() {
    let el=document.getElementById('heatmap-section');
    if(!el){
        el=document.createElement('div');el.id='heatmap-section';
        el.innerHTML=`<div class="glass-card rounded-2xl p-4 mb-5"><div class="text-sm font-semibold mb-3">🗓️ Heatmap mensuelle</div><div id="heatmap-grid" class="overflow-x-auto no-scrollbar pb-1"></div></div>`;
        const ref=document.getElementById('cumulative-chart-section');
        if(ref) ref.insertAdjacentElement('afterend',el);
    }
    const cym={};
    flights.forEach(f=>{const d=new Date(f.date),y=d.getFullYear(),m=d.getMonth();if(!cym[y])cym[y]=new Array(12).fill(0);cym[y][m]++;});
    const years=Object.keys(cym).sort();
    const maxV=Math.max(...Object.values(cym).flatMap(a=>a),1);
    const mths=['J','F','M','A','M','J','J','A','S','O','N','D'];
    const grid=document.getElementById('heatmap-grid');
    if(!grid) return;
    grid.innerHTML=`<div style="display:grid;grid-template-columns:36px repeat(12,1fr);gap:4px;min-width:280px;align-items:center">
        <div></div>${mths.map(m=>`<div class="text-center text-xs text-gray-500">${m}</div>`).join('')}
        ${years.map(y=>`<div class="text-xs text-gray-500 text-right pr-1">${y}</div>${cym[y].map((cnt,mi)=>{
            const op=cnt===0?0:0.12+0.88*(cnt/maxV);
            const bg=cnt===0?'rgba(255,255,255,.04)':`rgba(59,130,246,${op.toFixed(2)})`;
            return `<div class="heatmap-cell" style="background:${bg}" title="${mths[mi]} ${y}: ${cnt} vol${cnt>1?'s':''}"></div>`;
        }).join('')}`).join('')}
    </div>`;
}

// ==========================================
// AIRPORTS MODAL
// ==========================================
function showVisitedAirports() {
    const modal=document.getElementById('airports-modal'),list=document.getElementById('visited-airports-list');
    const visited=new Map();
    flights.forEach(f=>{if(!visited.has(f.departure.code))visited.set(f.departure.code,f.departure);if(!visited.has(f.arrival.code))visited.set(f.arrival.code,f.arrival);});
    const sorted=Array.from(visited.values()).sort((a,b)=>a.code.localeCompare(b.code));
    list.innerHTML=sorted.map((a,i)=>`<div class="glass-card rounded-xl p-3 flex items-center gap-3 flight-card-enter" style="animation-delay:${i*.04}s"><div class="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center font-bold text-blue-400 text-xs">${a.code}</div><div class="flex-1 min-w-0"><div class="font-medium truncate">${a.name}</div><div class="text-sm text-gray-400 truncate">${a.city}, ${a.country}</div></div></div>`).join('');
    modal.classList.remove('hidden');
}
function filterVisitedAirports(q){document.querySelectorAll('#visited-airports-list > div').forEach(item=>{item.style.display=item.textContent.toLowerCase().includes(q.toLowerCase())?'flex':'none';});}
function hideAirports(){document.getElementById('airports-modal').classList.add('hidden');}

// ==========================================
// EXPORT
// ==========================================
function exportData(format='json') {
    if(format==='csv'){exportCSV();return;}
    const data={flights,exportDate:new Date().toISOString(),stats:{totalFlights:flights.length,totalDistance:flights.reduce((s,f)=>s+(f.distance||0),0),totalCO2:flights.reduce((s,f)=>s+calcCO2(f),0),totalCountries:new Set(flights.flatMap(f=>[f.departure.country,f.arrival.country])).size,totalHours:Math.round(flights.reduce((s,f)=>s+(f.duration||0),0)/60)}};
    triggerDownload(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),`flight-diary-${todayStr()}.json`);
    showToast('Export JSON !');
}
function exportCSV() {
    const h=['N° vol','Date','Départ','Arrivée','Ville dep','Ville arr','Distance (km)','Durée (min)','Appareil','Classe','Motif','Siège','CO2 (kg)','Notes'];
    const rows=flights.map(f=>[f.number,f.date,f.departure.code,f.arrival.code,f.departure.city,f.arrival.city,f.distance,f.duration,f.aircraft,classLabels[f.class]||f.class,reasonLabels[f.reason]||f.reason,f.seat,calcCO2(f),`"${(f.notes||'').replace(/"/g,'""')}"`]);
    triggerDownload(new Blob(['\uFEFF'+[h,...rows].map(r=>r.join(',')).join('\n')],{type:'text/csv;charset=utf-8'}),`flight-diary-${todayStr()}.csv`);
    showToast('Export CSV !');
}
function triggerDownload(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function todayStr(){return new Date().toISOString().split('T')[0];}
function showTab(tab){if(tab==='stats')showStats();else if(tab==='airports')showVisitedAirports();}

// ==========================================
// MODAL CLOSERS + EVENTS
// ==========================================
function setupModalClosers() {
    [{overlay:'add-modal',exclude:'.modal-content',fn:hideAddFlight},{overlay:'detail-modal',exclude:'.glass',fn:hideDetail},{overlay:'stats-modal',exclude:'.glass',fn:hideStats},{overlay:'airports-modal',exclude:'.glass',fn:hideAirports}]
    .forEach(({overlay,exclude,fn})=>{
        const el=document.getElementById(overlay); if(!el) return;
        const handler=e=>{if(!e.target.closest(exclude)){e.preventDefault();fn();}};
        el.addEventListener('click',handler);
        el.addEventListener('touchend',handler,{passive:false});
    });
}

document.addEventListener('click',e=>{
    if(!e.target.closest('#departure-code')&&!e.target.closest('#departure-suggestions')) document.getElementById('departure-suggestions')?.classList.add('hidden');
    if(!e.target.closest('#arrival-code')&&!e.target.closest('#arrival-suggestions'))     document.getElementById('arrival-suggestions')?.classList.add('hidden');
});

window.addEventListener('online',()=>{isOnline=true;updateSyncStatus(currentUser!==null,currentUser?'En ligne':'Hors ligne');if(pendingSync&&currentUser)flushOfflineQueue();});
window.addEventListener('offline',()=>{isOnline=false;updateSyncStatus(false,'Hors ligne');showToast('Mode hors-ligne activé');});

document.addEventListener('DOMContentLoaded',async()=>{
    injectStyles();
    applyAutoDarkMode();
    lucide.createIcons();
    showSkeletonLoaders(4);
    await loadAirports();
    loadOfflineQueue();
    loadFlightsFromLocal();
    setTimeout(initMap,100);
    setupModalClosers();
    document.querySelectorAll('#add-modal .modal-content,#add-modal .glass').forEach(el=>el.classList.remove('animate-slide-up','animate-fade-in'));
    if(auth){auth.onAuthStateChanged(user=>{currentUser=user;updateAuthUI();if(user)loadUserData();});}
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&map)setTimeout(()=>map.invalidateSize(),200);});
    document.querySelectorAll('#menu-drawer').forEach(el=>{el.style.paddingTop='env(safe-area-inset-top)';});
});
