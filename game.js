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
        },
        adminButtons: {
            seeAll: document.getElementById('btn-admin-see-all'),
            changeCards: document.getElementById('btn-admin-change-cards')
        }
    };
    
    // --- CORE LOGIC: LOGIN AND TABLE MANAGEMENT ---
    
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
            if (!joined) createTable();
        });
    }

    function createTable() {
        const newTableId = `table_${Date.now()}`;
        const newTableRef = tablesRef.child(newTableId);
        const newPlayer = createPlayerObject();
        const initialTableState = {
            id: newTableId, status: 'waiting', players: { [localPlayerId]: newPlayer }, pot: 0,
            message: 'Waiting for more players...'
        };
        newTableRef.set(initialTableState).then(() => joinTable(newTableId));
    }

    function joinTable(tableId) {
        currentTableId = tableId;
        currentTableRef = tablesRef.child(currentTableId);
        const playerRef = currentTableRef.child('players').child(localPlayerId);
        playerRef.set(createPlayerObject());
        playerRef.onDisconnect().remove();
        globalPlayersRef.child(localPlayerId).update({ tableId: currentTableId });
        ui.loginScreen.classList.remove('active');
        ui.gameScreen.classList.add('active');
        currentTableRef.on('value', handleStateUpdate, handleFirebaseError);
        listenForChat();
    }
    
    function createPlayerObject() {
        return {
            id: localPlayerId, name: localPlayerName, balance: 1000,
            status: 'online', is_admin: isAdmin, avatar: 'avatars/avatar1.png'
        };
    }
    
    function handleStateUpdate(snapshot) {
        if (!snapshot.exists() || !snapshot.val().players || !snapshot.val().players[localPlayerId]) {
            goBackToLogin();
            return;
        }
        currentGameState = snapshot.val();
        renderGame(currentGameState);
    }
    
    function handleFirebaseError(error) {
        console.error("Firebase Read Error:", error);
        alert("Connection to game server lost. Please refresh.");
    }

    function goBackToLogin() {
        if (currentTableRef) currentTableRef.off('value', handleStateUpdate);
        localPlayerId = null; currentTableId = null; currentTableRef = null;
        ui.gameScreen.classList.remove('active');
        ui.loginScreen.classList.add('active');
    }

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
    
    function renderPlayers(players, status, currentTurn) {
        ui.playersContainer.innerHTML = '';
        Object.values(players).forEach((player, index) => {
            const slot = document.createElement('div');
            slot.className = 'player-slot';
            slot.dataset.slot = index;
            slot.dataset.playerId = player.id;
            const isMe = player.id === localPlayerId;
            let cardsHTML = '';
            if (player.cards) {
                const showCards = adminSeeAll || (isMe && player.status === 'seen') || status === 'showdown';
                cardsHTML = player.cards.map(cardStr => `
                    <div class="card ${showCards ? 'flipped' : ''}">
                        <div class="card-face card-back"></div>
                        <div class="card-face card-front">${cardStr}</div>
                    </div>`).join('');
            }
            slot.innerHTML = `
                <div class="player-avatar" style="background-image: url('${player.avatar}')"></div>
                <div class="player-name">${player.name}${isMe ? ' (You)' : ''}</div>
                <div class="player-balance">₹${player.balance}</div>
                <div class="player-status">${player.status}</div>
                <div class="player-cards">${cardsHTML}</div>`;
            if (currentTurn === player.id) slot.classList.add('current-turn');
            ui.playersContainer.appendChild(slot);
        });
    }

    function updateActionButtons(state, myPlayer) {
        const isMyTurn = state.currentTurn === localPlayerId;
        const canPlay = state.status === 'playing' && myPlayer.status !== 'packed' && myPlayer.status !== 'spectating';
        ui.actionButtonsContainer.style.visibility = canPlay ? 'visible' : 'hidden';
        if (!canPlay) return;

        Object.values(ui.actionButtons).forEach(btn => btn.disabled = !isMyTurn);

        if (isMyTurn) {
            ui.actionButtons.see.disabled = myPlayer.status !== 'blind';
            const activePlayersCount = Object.values(state.players).filter(p => p.status !== 'packed' && p.status !== 'spectating').length;
            ui.actionButtons.show.disabled = (activePlayersCount <= 2) ? false : true;
            const stake = myPlayer.status === 'seen' ? (state.currentStake * 2) : state.currentStake;
            ui.actionButtons.chaal.textContent = `Chaal (₹${stake})`;
            ui.actionButtons.chaal.disabled = myPlayer.balance < stake;
        }
    }

    // --- GAMEPLAY LOGIC ---
    function handleAutoStart(state) {
        if(autoStartTimer) clearTimeout(autoStartTimer);
        const hostId = state.players ? Object.keys(state.players)[0] : null;
        if (localPlayerId !== hostId) return;
        const playerCount = Object.keys(state.players).length;
        if ((state.status === 'waiting' || state.status === 'showdown') && playerCount >= 2) {
            autoStartTimer = setTimeout(() => performAction(startGame), GAME_START_DELAY);
        }
    }

    function startGame(state) {
        state.status = 'playing'; state.pot = 0; state.deck = createDeck();
        state.message = "New round started!";
        Object.values(state.players).forEach(player => {
            if (player.balance >= BOOT_AMOUNT) {
                player.balance -= BOOT_AMOUNT; state.pot += BOOT_AMOUNT;
                player.cards = [state.deck.pop(), state.deck.pop(), state.deck.pop()];
                player.status = 'blind'; player.hand = getHandDetails(player.cards);
            } else { player.status = 'spectating'; }
        });
        state.currentStake = BOOT_AMOUNT;
        state.currentTurn = Object.keys(state.players).find(pid => state.players[pid].status === 'blind');
    }

    function moveToNextPlayer(state) {
        const playerIds = Object.keys(state.players).sort();
        let currentIndex = playerIds.indexOf(state.currentTurn);
        if (currentIndex === -1) return;
        for (let i = 0; i < playerIds.length; i++) {
            currentIndex = (currentIndex + 1) % playerIds.length;
            const nextPlayerId = playerIds[currentIndex];
            if (state.players[nextPlayerId]?.status !== 'packed' && state.players[nextPlayerId]?.status !== 'spectating') {
                state.currentTurn = nextPlayerId;
                return;
            }
        }
    }

    function checkForWinner(state) {
        const activePlayers = Object.values(state.players).filter(p => p.status !== 'packed' && p.status !== 'spectating');
        if (activePlayers.length <= 1) {
            const winner = activePlayers[0];
            if (winner) distributePot(winner.id, state);
            else { state.status = 'showdown'; state.message = "Round ends. No winner."; }
            return true;
        }
        return false;
    }

    function endGame(state) {
        const activePlayers = Object.values(state.players).filter(p => p.status !== 'packed' && p.status !== 'spectating');
        if (activePlayers.length < 1) { state.status = 'showdown'; state.message = "No active players left."; return; }
        const winner = activePlayers.reduce((best, current) => compareHands(best.hand, current.hand) >= 0 ? best : current, activePlayers[0]);
        distributePot(winner.id, state);
    }
    
    function distributePot(winnerId, state) {
        const winner = state.players[winnerId];
        if (winner) {
            winner.balance += state.pot;
            state.message = `🎉 ${winner.name} wins ₹${state.pot} with a ${winner.hand.name}! 🎉`;
        }
        state.status = 'showdown';
    }

    function performAction(actionFunc) {
        const stateCopy = JSON.parse(JSON.stringify(currentGameState));
        actionFunc(stateCopy);
        currentTableRef.set(stateCopy);
    }

    // --- BUTTON AND CHAT LISTENERS ---
    ui.actionButtons.pack.onclick = () => performAction(state => {
        state.players[localPlayerId].status = 'packed';
        state.message = `${localPlayerName} packed.`;
        if (!checkForWinner(state)) moveToNextPlayer(state);
    });

    ui.actionButtons.see.onclick = () => performAction(state => {
        state.players[localPlayerId].status = 'seen';
        state.message = `${localPlayerName} has seen their cards.`;
    });
    
    ui.actionButtons.chaal.onclick = () => performAction(state => {
        const myPlayer = state.players[localPlayerId];
        const stake = myPlayer.status === 'seen' ? (state.currentStake * 2) : state.currentStake;
        myPlayer.balance -= stake;
        state.pot += stake;
        state.currentStake = myPlayer.status === 'blind' ? stake : stake / 2;
        state.message = `${localPlayerName} bets ₹${stake}.`;
        moveToNextPlayer(state);
    });

    ui.actionButtons.show.onclick = () => performAction(endGame);
    
    ui.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const text = ui.chatInput.value.trim();
            if (text && currentTableRef) {
                currentTableRef.child('chat').push({
                    sender: localPlayerName, text,
                    timestamp: firebase.database.ServerValue.TIMESTAMP
                });
                ui.chatInput.value = '';
            }
        }
    });

    function listenForChat() {
        if (currentTableRef) {
            currentTableRef.child('chat').limitToLast(10).on('child_added', snapshot => {
                const msg = snapshot.val();
                const msgDiv = document.createElement('div');
                msgDiv.innerHTML = `<strong>${msg.sender}:</strong> ${msg.text}`;
                ui.chatMessages.appendChild(msgDiv);
                ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
            });
        }
    }
    
    // --- ADMIN LISTENERS ---
    ui.adminButtons.seeAll.onclick = () => { adminSeeAll = !adminSeeAll; renderGame(currentGameState); };
    ui.adminButtons.changeCards.onclick = () => performAction(state => {
        const myPlayer = state.players[localPlayerId];
        if (state.deck.length >= 3) {
            myPlayer.cards = [state.deck.pop(), state.deck.pop(), state.deck.pop()];
            myPlayer.hand = getHandDetails(myPlayer.cards);
        }
    });
    
    // --- UTILITY: CARDS & DECK ---
    function createDeck() { const s='♠♥♦♣',r='23456789TJQKA',d=[];for(const i of s)for(const j of r)d.push(j+i);return d.sort(()=>.5-Math.random())}
    function getHandDetails(c){if(!c||c.length!==3)return{r:1,n:"Invalid",v:[]};const o='23456789TJQKA',p=c.map(e=>({r:o.indexOf(e[0]),s:e[1]})).sort((a,b)=>b.r-a.r),v=p.map(e=>e.r),s=p.map(e=>e.s),l=s[0]===s[1]&&s[1]===s[2],t=v.includes(12)&&v.includes(1)&&v.includes(0),q=v[0]-1===v[1]&&v[1]-1===v[2],u=q||t,n=v[0]===v[1]&&v[1]===v[2];let a=-1;v[0]===v[1]||v[1]===v[2]?a=v[1]:v[0]===v[2]&&(a=v[0]);const i=a!==-1,d=t?[12,1,0].sort((e,r)=>r-e):v;return n?{r:7,n:"Trail",v:d}:l&&u?{r:6,n:"Pure Seq",v:d}:u?{r:5,n:"Sequence",v:d}:l?{r:4,n:"Color",v:d}:i?{r:3,n:"Pair",v:function(e,r){const t=e.find(t=>t!==r);return[r,r,t]}(v,a)}:{r:2,n:"High Card",v:d}}
    function compareHands(a,b){if(a.r!==b.r)return a.r-b.r;for(let e=0;e<a.v.length;e++)if(a.v[e]!==b.v[e])return a.v[e]-b.v[e];return 0}

    // --- OTHER FEATURE LISTENERS ---
    ui.themeBtn.onclick = () => ui.themePopup.classList.toggle('active');
    document.querySelector('.theme-options').addEventListener('click', e => {
        if(e.target.matches('.theme-option')){
            ui.tableArea.className = e.target.dataset.theme;
            ui.themePopup.classList.remove('active');
        }
    });
    globalPlayersRef.on('value', snapshot => {
        const players = snapshot.val() || {};
        ui.totalPlayersCount.textContent = `Online: ${Object.keys(players).length}`;
    });
});
