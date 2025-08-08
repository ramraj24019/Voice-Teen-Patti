document.addEventListener('DOMContentLoaded', () => {
    // --- Pre-boot check ---
    if (typeof firebase === 'undefined' || typeof AgoraRTC === 'undefined') {
        alert("CRITICAL ERROR: A required library (Firebase or Agora) did not load. Please refresh.");
        return;
    }

    // --- CONFIGURATION ---
    const firebaseConfig = {
      apiKey: "AIzaSyBlbNZBZa6X7SNMWibj3-OsRJQar9jU-RY",
      authDomain: "desi-teen-patti-c4639.firebaseapp.com",
      databaseURL: "https://desi-teen-patti-c4639-default-rtdb.firebaseio.com",
      projectId: "desi-teen-patti-c4639",
      storageBucket: "desi-teen-patti-c4639.firebasestorage.app",
      messagingSenderId: "1007516567686",
      appId: "1:1007516567686:web:072f4172bda32d881de907"
    };
    
    const AGORA_APP_ID = "369ab89e0e6e4e0c82612023fe7364b4";
    const DB_ROOT_PATH = 'teenpatti-no-bot';
    const MAX_PLAYERS_PER_TABLE = 4;
    const GAME_START_DELAY = 5000; // 5 seconds
    const NEXT_ROUND_DELAY = 5000; // 5 seconds
    const BOOT_AMOUNT = 10;
    const HAND_RANKS = { TRAIL: 7, PURE_SEQ: 6, SEQ: 5, COLOR: 4, PAIR: 3, HIGH_CARD: 2, INVALID: 1 };
    
    // --- INITIALIZATION ---
    firebase.initializeApp(firebaseConfig);
    const database = firebase.database();
    const globalPlayersRef = database.ref(`${DB_ROOT_PATH}/globalPlayers`);
    const tablesRef = database.ref(`${DB_ROOT_PATH}/tables`);

    // --- LOCAL STATE ---
    let localPlayerId = null;
    let localPlayerName = '';
    let currentTableId = null;
    let currentTableRef = null;
    let currentGameState = {};
    let isAdmin = false;
    let adminSeeAll = false;
    let autoStartTimer = null;

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
        actionButtons: document.getElementById('action-buttons-container'),
        adminPanel: document.getElementById('admin-panel'),
        themeBtn: document.getElementById('theme-btn'),
        themePopup: document.getElementById('theme-popup'),
    };

    // --- CORE LOGIC: LOGIN AND TABLE MANAGEMENT ---
    
    ui.joinGameBtn.onclick = () => {
        const name = ui.playerNameInput.value.trim();
        if (!name) return;
        localPlayerName = name;
        localPlayerId = `player_${Date.now()}`;
        isAdmin = name.toLowerCase() === 'vj';
        
        // Add to global player list for total count
        const myGlobalPlayerRef = globalPlayersRef.child(localPlayerId);
        myGlobalPlayerRef.set({ name: localPlayerName });
        myGlobalPlayerRef.onDisconnect().remove();

        findAndJoinTable();
    };

    function findAndJoinTable() {
        tablesRef.get().then(snapshot => {
            const allTables = snapshot.val() || {};
            let joined = false;

            for (const tableId in allTables) {
                const table = allTables[tableId];
                const playerCount = table.players ? Object.keys(table.players).length : 0;
                if (playerCount < MAX_PLAYERS_PER_TABLE && (table.status === 'waiting' || table.status === 'showdown')) {
                    joinTable(tableId);
                    joined = true;
                    break;
                }
            }

            if (!joined) {
                createTable();
            }
        });
    }

    function createTable() {
        const newTableId = `table_${Date.now()}`;
        const newTableRef = tablesRef.child(newTableId);
        const newPlayer = createPlayerObject();
        
        const initialTableState = {
            id: newTableId,
            status: 'waiting',
            players: { [localPlayerId]: newPlayer },
            pot: 0,
            message: 'Waiting for more players...'
        };

        newTableRef.set(initialTableState).then(() => {
            joinTable(newTableId);
        });
    }

    function joinTable(tableId) {
        currentTableId = tableId;
        currentTableRef = tablesRef.child(currentTableId);
        const playerRef = currentTableRef.child('players').child(localPlayerId);

        const newPlayer = createPlayerObject();
        playerRef.set(newPlayer);
        playerRef.onDisconnect().remove();
        
        // Update global player's tableId
        globalPlayersRef.child(localPlayerId).update({ tableId: currentTableId });

        // Switch to game screen and start listening for updates
        ui.loginScreen.classList.remove('active');
        ui.gameScreen.classList.add('active');
        
        currentTableRef.on('value', handleStateUpdate, handleFirebaseError);
    }
    
    function createPlayerObject() {
        return {
            id: localPlayerId,
            name: localPlayerName,
            balance: 1000,
            status: 'online', // Initial status
            is_admin: isAdmin,
            avatar: 'avatars/avatar1.png' // Default avatar
        };
    }
    
    function handleStateUpdate(snapshot) {
        if (!snapshot.exists()) {
            // Table was removed, go back to login
            goBackToLogin();
            return;
        }
        const state = snapshot.val();
        currentGameState = state;
        
        // If local player is not in the list, means they were kicked or disconnected
        if (!state.players || !state.players[localPlayerId]) {
            goBackToLogin();
            return;
        }

        renderGame(state);
    }
    
    function handleFirebaseError(error) {
        console.error("Firebase Read Error:", error);
        alert("Connection to game server lost. Please refresh.");
    }

    function goBackToLogin() {
        if (currentTableRef) {
            currentTableRef.off('value', handleStateUpdate);
        }
        localPlayerId = null;
        currentTableId = null;
        currentTableRef = null;
        ui.gameScreen.classList.remove('active');
        ui.loginScreen.classList.add('active');
    }

    // --- RENDER LOGIC ---

    function renderGame(state) {
        const myPlayer = state.players[localPlayerId];
        
        // Render players
        renderPlayers(state.players);

        // Update UI elements
        ui.potArea.textContent = `Pot: ₹${state.pot || 0}`;
        ui.gameMessage.textContent = state.message || '...';
        ui.adminPanel.style.display = myPlayer.is_admin ? 'flex' : 'none';

        // Update action buttons based on state
        updateActionButtons(state, myPlayer);
        
        // Handle game logic triggers
        handleAutoStart(state);
    }
    
    function renderPlayers(players) {
        ui.playersContainer.innerHTML = '';
        const playerIds = Object.keys(players);
        
        playerIds.forEach((playerId, index) => {
            const player = players[playerId];
            const slot = document.createElement('div');
            slot.className = 'player-slot';
            slot.dataset.slot = index;
            slot.dataset.playerId = player.id;

            const isMe = player.id === localPlayerId;
            
            // Cards HTML
            let cardsHTML = '';
            if (player.cards) {
                const showCards = adminSeeAll || (isMe && player.status === 'seen') || state.status === 'showdown';
                cardsHTML = player.cards.map(cardStr => `
                    <div class="card ${showCards ? 'flipped' : ''}">
                        <div class="card-face card-back"></div>
                        <div class="card-face card-front">${cardStr}</div>
                    </div>
                `).join('');
            }

            slot.innerHTML = `
                <div class="player-avatar" style="background-image: url('${player.avatar}')"></div>
                <div class="player-name">${player.name}${isMe ? ' (You)' : ''}</div>
                <div class="player-balance">₹${player.balance}</div>
                <div class="player-status">${player.status}</div>
                <div class="player-cards">${cardsHTML}</div>
            `;
            
            if (currentGameState.currentTurn === player.id) {
                slot.classList.add('current-turn');
            }
            
            ui.playersContainer.appendChild(slot);
        });
    }

    function updateActionButtons(state, myPlayer) {
        const isMyTurn = state.currentTurn === localPlayerId;
        const show = state.status === 'playing' && isMyTurn && myPlayer.status !== 'packed' && myPlayer.status !== 'spectating';
        ui.actionButtons.style.visibility = show ? 'visible' : 'hidden';
    }

    // --- GAMEPLAY LOGIC ---
    
    function handleAutoStart(state) {
        if(autoStartTimer) clearTimeout(autoStartTimer);
        const hostId = state.players ? Object.keys(state.players)[0] : null;

        // Only the "host" (first player) of the table can trigger the start
        if (localPlayerId !== hostId) return;

        const playerCount = Object.keys(state.players).length;

        if (state.status === 'waiting' && playerCount >= 2) {
            autoStartTimer = setTimeout(() => performAction(startGame), GAME_START_DELAY);
        } else if (state.status === 'showdown') {
            autoStartTimer = setTimeout(() => performAction(startGame), NEXT_ROUND_DELAY);
        }
    }

    function startGame(state) {
        state.status = 'playing';
        state.pot = 0;
        state.deck = createDeck();
        state.message = "New round started!";
        
        Object.values(state.players).forEach(player => {
            if (player.balance >= BOOT_AMOUNT) {
                player.balance -= BOOT_AMOUNT;
                state.pot += BOOT_AMOUNT;
                player.cards = [state.deck.pop(), state.deck.pop(), state.deck.pop()];
                player.status = 'blind';
                player.hand = getHandDetails(player.cards);
            } else {
                player.status = 'spectating';
            }
        });
        
        state.currentStake = BOOT_AMOUNT;
        state.currentTurn = Object.keys(state.players).find(pid => state.players[pid].status === 'blind');
    }
    
    function performAction(actionFunc) {
        // This function makes it easier to update the state
        const stateCopy = JSON.parse(JSON.stringify(currentGameState));
        actionFunc(stateCopy);
        currentTableRef.set(stateCopy);
    }

    // Placeholder for other gameplay functions (pack, see, chaal, etc.)
    // They would call performAction with their specific logic.

    // --- UTILITY: CARDS & DECK ---
    function createDeck() {
        const suits = ['♠', '♥', '♦', '♣'];
        const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
        let deck = [];
        for (const suit of suits) for (const rank of ranks) deck.push(rank + suit);
        return deck.sort(() => Math.random() - 0.5);
    }
    function getHandDetails(cards) { /* ... same logic as before ... */ return { rank: 1, name: "High Card", values: [1,2,3]}; }
    function compareHands(handA, handB) { /* ... same logic ... */ return 0; }
    
    // --- FEATURE LISTENERS ---

    // Theme Selector
    ui.themeBtn.onclick = () => ui.themePopup.classList.toggle('active');
    document.querySelector('.theme-options').addEventListener('click', (e) => {
        if(e.target.matches('.theme-option')) {
            ui.tableArea.className = e.target.dataset.theme; // Change theme
            ui.themePopup.classList.remove('active');
        }
    });

    // Global player count listener
    globalPlayersRef.on('value', (snapshot) => {
        const players = snapshot.val() || {};
        ui.totalPlayersCount.textContent = `Online: ${Object.keys(players).length}`;
    });

});
