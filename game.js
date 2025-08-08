document.addEventListener('DOMContentLoaded', () => {
    // --- Pre-boot check ---
    if (typeof firebase === 'undefined') {
        alert("CRITICAL ERROR: Firebase did not load. Please refresh.");
        return;
    }

    // --- CONFIGURATION ---
    const firebaseConfig = { /* आपकी Firebase कॉन्फ़िगरेशन यहाँ है */ };
    const AGORA_APP_ID = "369ab89e0e6e4e0c82612023fe7364b4";
    const DB_ROOT_PATH = 'teenpatti-no-bot';
    const MAX_PLAYERS_PER_TABLE = 4;
    const GAME_START_DELAY = 5000;
    const NEXT_ROUND_DELAY = 5000;
    const BOOT_AMOUNT = 10;
    const HAND_RANKS = { TRAIL: 7, PURE_SEQ: 6, SEQ: 5, COLOR: 4, PAIR: 3, HIGH_CARD: 2, INVALID: 1 };
    
    // --- INITIALIZATION ---
    firebase.initializeApp(firebaseConfig);
    const database = firebase.database();
    const globalPlayersRef = database.ref(`${DB_ROOT_PATH}/globalPlayers`);
    const tablesRef = database.ref(`${DB_ROOT_PATH}/tables`);

    // --- LOCAL STATE ---
    let localPlayerId = null, localPlayerName = '', currentTableId = null, currentTableRef = null;
    let currentGameState = {}, isAdmin = false, adminSeeAll = false, autoStartTimer = null;

    // --- UI ELEMENTS CACHE ---
    const ui = {
        loginScreen: document.getElementById('login-screen'),
        gameScreen: document.getElementById('game-screen'),
        playerNameInput: document.getElementById('player-name-input'),
        joinGameBtn: document.getElementById('join-game-btn'),
        totalPlayersCount: document.getElementById('total-players-count'),
        tableArea: document.getElementById('table-area'),
        playersContainer: document.getElementById('players-container'),
        potArea: document.getElementById('pot-area'),
        gameMessage: document.getElementById('game-message'),
        actionButtonsContainer: document.getElementById('action-buttons-container'),
        chatInput: document.getElementById('chat-input'),
        chatMessages: document.getElementById('chat-messages'),
        adminPanel: document.getElementById('admin-panel'),
        themeBtn: document.getElementById('theme-btn'),
        themePopup: document.getElementById('theme-popup'),
        actionButtons: {
            pack: document.getElementById('btn-pack'),
            see: document.getElementById('btn-see'),
            sideshow: document.getElementById('btn-sideshow'),
            chaal: document.getElementById('btn-chaal'),
            show: document.getElementById('btn-show')
        }
    };
    
    // --- CORE LOGIC ---
    ui.joinGameBtn.onclick = () => {
        const name = ui.playerNameInput.value.trim();
        if (!name) return;
        localPlayerName = name;
        localPlayerId = `player_${Date.now()}`;
        isAdmin = name.toLowerCase() === 'vj';
        globalPlayersRef.child(localPlayerId).set({ name: localPlayerName }).then(() => {
            globalPlayersRef.child(localPlayerId).onDisconnect().remove();
            findAndJoinTable();
        });
    };

    function findAndJoinTable() { /* ... पिछला कोड यहाँ ... */ }
    function createTable() { /* ... पिछला कोड यहाँ ... */ }
    function joinTable(tableId) { /* ... पिछला कोड यहाँ ... */ }
    function createPlayerObject() { /* ... पिछला कोड यहाँ ... */ }
    function handleStateUpdate(snapshot) { /* ... पिछला कोड यहाँ ... */ }
    function handleFirebaseError(error) { /* ... पिछला कोड यहाँ ... */ }
    function goBackToLogin() { /* ... पिछला कोड यहाँ ... */ }

    // --- RENDER LOGIC ---
    function renderGame(state) {
        const myPlayer = state.players[localPlayerId];
        renderPlayers(state.players, state.status, state.currentTurn);
        ui.potArea.textContent = `Pot: ₹${state.pot || 0}`;
        ui.gameMessage.textContent = state.message || '...';
        ui.adminPanel.style.display = myPlayer.is_admin ? 'flex' : 'none';
        updateActionButtons(state, myPlayer);
        handleAutoStart(state);
    }
    function renderPlayers(players, status, currentTurn) { /* ... पिछला कोड यहाँ ... */ }

    function updateActionButtons(state, myPlayer) {
        const isMyTurn = state.currentTurn === localPlayerId;
        const canPlay = state.status === 'playing' && myPlayer.status !== 'packed' && myPlayer.status !== 'spectating';
        ui.actionButtonsContainer.style.visibility = canPlay ? 'visible' : 'hidden';
        
        if (!canPlay) return;

        Object.values(ui.actionButtons).forEach(btn => btn.disabled = !isMyTurn);

        if (isMyTurn) {
            ui.actionButtons.see.disabled = myPlayer.status !== 'blind';
            const activePlayersCount = Object.values(state.players).filter(p => p.status !== 'packed' && p.status !== 'spectating').length;
            ui.actionButtons.show.disabled = activePlayersCount > 2;
            const stake = myPlayer.status === 'seen' ? (state.currentStake * 2) : state.currentStake;
            ui.actionButtons.chaal.textContent = `Chaal (₹${stake})`;
            ui.actionButtons.chaal.disabled = myPlayer.balance < stake;
        }
    }

    // --- GAMEPLAY LOGIC ---
    function handleAutoStart(state) { /* ... पिछला कोड यहाँ ... */ }
    function startGame(state) { /* ... पिछला कोड यहाँ ... */ }
    function performAction(actionFunc) { /* ... पिछला कोड यहाँ ... */ }
    
    // ==========================================================
    // === YAHAN PAR BUTTON AUR CHAT KE LIYE CODE JODA GAYA HAI ===
    // ==========================================================
    
    // --- ACTION BUTTON LISTENERS ---
    ui.actionButtons.pack.onclick = () => performAction(state => {
        state.players[localPlayerId].status = 'packed';
        state.message = `${localPlayerName} packed.`;
        // Check for winner or move to next player
    });
    ui.actionButtons.see.onclick = () => performAction(state => {
        state.players[localPlayerId].status = 'seen';
        state.message = `${localPlayerName} has seen their cards.`;
    });
    // Add logic for sideshow, chaal, show later

    // --- CHAT LISTENER ---
    ui.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const message = ui.chatInput.value.trim();
            if (message && currentTableRef) {
                const chatRef = currentTableRef.child('chat');
                chatRef.push({
                    sender: localPlayerName,
                    text: message,
                    timestamp: firebase.database.ServerValue.TIMESTAMP
                });
                ui.chatInput.value = '';
            }
        }
    });

    // Listen for new chat messages
    function listenForChat() {
        if (currentTableRef) {
            currentTableRef.child('chat').limitToLast(10).on('child_added', (snapshot) => {
                const msg = snapshot.val();
                const msgDiv = document.createElement('div');
                msgDiv.innerHTML = `<strong>${msg.sender}:</strong> ${msg.text}`;
                ui.chatMessages.appendChild(msgDiv);
                ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
            });
        }
    }
    
    // Attach this listener when joining a table in joinTable() function
    // joinTable(tableId) { ... listenForChat(); ... }


    // --- UTILITY: CARDS & DECK ---
    function createDeck() { /* ... पिछला कोड यहाँ ... */ }
    function getHandDetails(cards) { /* ... पिछला कोड यहाँ ... */ }
    function compareHands(handA, handB) { /* ... पिछला कोड यहाँ ... */ }
    
    // --- FEATURE LISTENERS ---
    ui.themeBtn.onclick = () => ui.themePopup.classList.toggle('active');
    document.querySelector('.theme-options').addEventListener('click', (e) => {
        if(e.target.matches('.theme-option')) {
            ui.tableArea.className = e.target.dataset.theme;
            ui.themePopup.classList.remove('active');
        }
    });
    globalPlayersRef.on('value', (snapshot) => {
        const players = snapshot.val() || {};
        ui.totalPlayersCount.textContent = `Online: ${Object.keys(players).length}`;
    });
});
