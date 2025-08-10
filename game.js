document.addEventListener('DOMContentLoaded', () => {
    // --- Pre-boot check ---
    if (typeof firebase === 'undefined' || typeof AgoraRTC === 'undefined') {
        alert("CRITICAL ERROR: A required library did not load. Please refresh.");
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
    const AGORA_APP_ID = "f33cf29d42264f55b5130f61686e77a2";
    const DB_ROOT_PATH = 'teenpatti-no-bot';
    const MAX_PLAYERS_PER_TABLE = 4;
    const GAME_START_DELAY = 5000;
    const BOOT_AMOUNT = 10;

    // --- INITIALIZATION ---
    firebase.initializeApp(firebaseConfig);

// --- AUTHENTICATION ---
firebase.auth().signInAnonymously()
    .then(() => {
        console.log("Signed in anonymously with UID:", firebase.auth().currentUser.uid);
    })
    .catch((error) => {
        console.error("Anonymous sign-in failed:", error);
        alert("Login failed. Please refresh.");
    });

    const database = firebase.database();
    const globalPlayersRef = database.ref(`${DB_ROOT_PATH}/globalPlayers`);
    const tablesRef = database.ref(`${DB_ROOT_PATH}/tables`);

    // --- LOCAL STATE ---
    let localPlayerId, localPlayerName, currentTableId, currentTableRef;
    let currentGameState = {}, isAdmin = false, adminSeeAll = false, autoStartTimer;
    let agoraVoiceClient, localAudioTrack, isVoiceJoined = false;

    // --- UI ELEMENTS ---
    const ui = {
        loginScreen: document.getElementById('login-screen'),
        gameScreen: document.getElementById('game-screen'),
        playerNameInput: document.getElementById('player-name-input'),
        joinGameBtn: document.getElementById('join-game-btn'),
        playersContainer: document.getElementById('players-container'),
        potArea: document.getElementById('pot-area'),
        gameMessage: document.getElementById('game-message'),
        adminPanel: document.getElementById('admin-panel'),
        chatInput: document.getElementById('chat-input'),
        chatMessages: document.getElementById('chat-messages'),
        voiceToggleButton: document.getElementById('btn-voice-toggle'),
        actionButtonsContainer: document.getElementById('action-buttons-container'),
        actionButtons: { pack: document.getElementById('btn-pack'), see: document.getElementById('btn-see'), sideshow: document.getElementById('btn-sideshow'), chaal: document.getElementById('btn-chaal'), show: document.getElementById('btn-show') }
    };

    // --- CORE LOGIC: LOGIN AND TABLE ---
    ui.joinGameBtn.onclick = () => {
        const name = ui.playerNameInput.value.trim();
        if (!name) return;
        localPlayerName = name;
        localPlayerId = firebase.auth().currentUser.uid;
        isAdmin = name.toLowerCase() === 'vj';
        globalPlayersRef.child(localPlayerId).set({ name }).then(() => {
            globalPlayersRef.child(localPlayerId).onDisconnect().remove();
            findAndJoinTable();
        });
    };
function findAndJoinTable() {
        tablesRef.get().then(snapshot => {
            const allTables = snapshot.val() || {};
            let joined = false;
            for (const tableId in allTables) {
                if ((allTables[tableId].players ? Object.keys(allTables[tableId].players).length : 0) < MAX_PLAYERS_PER_TABLE) {
                    joinTable(tableId); joined = true; break;
                }
            }
            if (!joined) createTable();
        });
    }

    function createTable() {
        const newTableId = `table_${Date.now()}`;
        const newPlayer = { id: localPlayerId, name: localPlayerName, balance: 1000, status: 'online', is_admin: isAdmin, avatar: 'avatars/avatar1.png' };
        tablesRef.child(newTableId).set({
            id: newTableId, status: 'waiting', players: { [localPlayerId]: newPlayer }, pot: 0, message: 'Waiting...'
        }).then(() => joinTable(newTableId));
    }

    function joinTable(tableId) {
        currentTableId = tableId;
        currentTableRef = tablesRef.child(tableId);

        // first get current table snapshot to see if table is empty/stale
        currentTableRef.get().then(snapshot => {
            const table = snapshot.val() || {};
            const players = table.players || {};

            // If table has no players (last player left earlier), reset important fields
            if (!players || Object.keys(players).length === 0) {
                currentTableRef.update({
                    status: 'waiting',
                    pot: 0,
                    message: 'Waiting...',
                    deck: null,
                    currentStake: null,
                    currentTurn: null
                }).catch(err => console.warn('table reset warning:', err));
            }

            // Now add this player to the table
            const playerRef = currentTableRef.child('players').child(localPlayerId);
            const newPlayer = {
                id: localPlayerId,
                name: localPlayerName,
                balance: 1000,
                status: 'online',
                is_admin: isAdmin,
                avatar: 'avatars/avatar1.png'
            };

            // set player, then ensure any leftover per-player keys are removed
            playerRef.set(newPlayer).then(() => {
                // defensive cleanup
                playerRef.child('cards').remove().catch(()=>{});
                playerRef.child('status').remove().catch(()=>{});
                playerRef.child('hand').remove().catch(()=>{});

                // remove this player on disconnect
                playerRef.onDisconnect().remove();

                // UI + listeners
                showScreen('game');
                currentTableRef.on('value', handleStateUpdate);
                joinVoiceChannel();
                listenForChat();
            }).catch(err => {
                console.error('Error adding player:', err);
            });

        }).catch(err => {
            console.error('joinTable: failed to read table snapshot', err);
            // fallback
            const playerRef = currentTableRef.child('players').child(localPlayerId);
            const newPlayer = { id: localPlayerId, name: localPlayerName, balance: 1000, status: 'online', is_admin: isAdmin, avatar: 'avatars/avatar1.png' };
            playerRef.set(newPlayer);
            playerRef.child('cards').remove().catch(()=>{});
            playerRef.child('status').remove().catch(()=>{});
            playerRef.child('hand').remove().catch(()=>{});
            playerRef.onDisconnect().remove();
            showScreen('game');
            currentTableRef.on('value', handleStateUpdate);
            joinVoiceChannel();
            listenForChat();
        });
    }

    function handleStateUpdate(snapshot) {
        if (!snapshot.exists() || !snapshot.val().players?.[localPlayerId]) {
            goBackToLogin(); return;
        }
        currentGameState = snapshot.val();
        renderGameUI(currentGameState);
        handleAutoStart(currentGameState);
    }

    function goBackToLogin() {
        if (currentTableRef) currentTableRef.off('value', handleStateUpdate);
        leaveVoiceChannel(true);
        showScreen('login');
    }

    function showScreen(screenName) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(`${screenName}-screen`).classList.add('active');
    }

    function renderGameUI(state) {
        renderPlayers(state);
        ui.potArea.textContent = `Pot: ₹${state.pot || 0}`;
        ui.gameMessage.textContent = state.message || '...';
        if (state.players[localPlayerId]) {
            ui.adminPanel.style.display = state.players[localPlayerId].is_admin ? 'flex' : 'none';
        }
        updateActionButtons(state);
    }

    function renderPlayers(state) {
        ui.playersContainer.innerHTML = '';
        Object.values(state.players).forEach((player, index) => {
            const slot = document.createElement('div');
            slot.className = 'player-slot';
            slot.dataset.slot = index;
            const isMe = player.id === localPlayerId;
            let cardsHTML = '';
            if (player.cards) {
                const isShowdown = state.status === 'showdown';
                cardsHTML = player.cards.map(cardStr => {
                    let cardClass = 'card';
                    if ((isMe && player.status === 'seen') || adminSeeAll || (isShowdown && player.status !== 'packed')) {
                        cardClass += ' seen';
                    }
                    return `<div class="${cardClass}"><div class="card-face card-back"></div><div class="card-face card-front">${cardStr}</div></div>`;
                }).join('');
            }
            slot.innerHTML = `
                <div class="player-avatar" style="background-image: url('${player.avatar || 'avatars/avatar1.png'}')"></div>
                <div class="player-name">${player.name}${isMe ? ' (You)' : ''}</div>
                <div class="player-balance">₹${player.balance}</div>
                <div class="player-status">${player.status}</div>
                <div class="player-cards">${cardsHTML}</div>`;
            if (state.currentTurn === player.id) slot.classList.add('current-turn');
            ui.playersContainer.appendChild(slot);
        });
    }
    // --- ACTION BUTTON LISTENERS ---
    let customStake = BOOT_AMOUNT;

    // UI में plus/minus बटन add करना
    const stakeControl = document.createElement('div');
    stakeControl.style.display = 'flex';
    stakeControl.style.gap = '5px';
    stakeControl.style.marginTop = '5px';
    const minusBtn = document.createElement('button');
    minusBtn.textContent = '−';
    const plusBtn = document.createElement('button');
    plusBtn.textContent = '+';
    stakeControl.appendChild(minusBtn);
    stakeControl.appendChild(plusBtn);
    ui.actionButtonsContainer.appendChild(stakeControl);

    minusBtn.onclick = () => {
        if (customStake > BOOT_AMOUNT) {
            customStake -= BOOT_AMOUNT;
            updateChaalLabel();
            saveCustomStake(customStake);
        }
    };
    plusBtn.onclick = () => {
        customStake += BOOT_AMOUNT;
        updateChaalLabel();
        saveCustomStake(customStake);
    };

    function saveCustomStake(value) {
        if (currentTableRef) {
            currentTableRef.update({ currentStake: value });
        }
    }

    function updateChaalLabel() {
        ui.actionButtons.chaal.textContent = `Chaal (₹${customStake})`;
    }

    function performAction(actionFunc) {
        const stateCopy = JSON.parse(JSON.stringify(currentGameState));
        actionFunc(stateCopy);
        currentTableRef.set(stateCopy);
    }

    ui.actionButtons.pack.onclick = () => performAction(state => {
        state.players[localPlayerId].status = 'packed';
        state.message = `${localPlayerName} packed.`;
        if (!checkForWinner(state)) moveToNextPlayer(state);
    });

    ui.actionButtons.see.onclick = () => performAction(state => { 
        state.players[localPlayerId].status = 'seen'; 
        state.message = `${localPlayerName} has seen cards.`; 
    });

    ui.actionButtons.chaal.onclick = () => performAction(state => {
        const myPlayer = state.players[localPlayerId];
        const stake = customStake;
        myPlayer.balance -= stake;
        state.pot += stake;
        state.currentStake = stake;
        state.message = `${localPlayerName} bets ₹${stake}.`;
        moveToNextPlayer(state);
    });

    ui.actionButtons.show.onclick = () => performAction(endGame);

    ui.actionButtons.sideshow.onclick = () => performAction(state => {
        const playerIds = Object.keys(state.players).filter(pid => state.players[pid].status !== 'packed' && state.players[pid].status !== 'spectating');
        const myIndex = playerIds.indexOf(localPlayerId);
        const prevPlayerIndex = (myIndex - 1 + playerIds.length) % playerIds.length;
        const opponent = state.players[playerIds[prevPlayerIndex]];
        if (!opponent || state.players[localPlayerId].status !== 'seen' || opponent.status !== 'seen') {
            state.message = "Side show not possible."; return;
        }
        const result = compareHands(state.players[localPlayerId].hand, opponent.hand);
        const winner = result >= 0 ? state.players[localPlayerId] : opponent;
        const loser = result >= 0 ? opponent : state.players[localPlayerId];
        loser.status = 'packed';
        state.message = `Side show: ${winner.name} wins vs ${loser.name}`;
        if (!checkForWinner(state)) moveToNextPlayer(state);
    });

    // --- FUTURE PAYMENT SUPPORT ---
    function addCredits(playerId, amount) {
        if (!playerId || !amount) return;
        const playerRef = globalPlayersRef.child(playerId);
        playerRef.once('value').then(snapshot => {
            const playerData = snapshot.val();
            if (playerData) {
                const newBalance = (playerData.balance || 0) + amount;
                playerRef.update({ balance: newBalance });
                alert(`Added ₹${amount} to ${playerData.name}'s balance.`);
            }
        });
    }
