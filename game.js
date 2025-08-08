```javascript
window.onload = function() {
    const firebase = window.firebase;
    const AgoraRTC = window.AgoraRTC;

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
    const GAME_DB_PATH = 'teenpatti-pro-game';
    const BOOT_AMOUNT = 10;
    const HAND_RANKS = { TRAIL: 6, PURE_SEQ: 5, SEQ: 4, COLOR: 3, PAIR: 2, HIGH_CARD: 1 };
    const STICKERS = ['😂', '😡', '🥳', '👏', '😍', '😎', '💩', '🤯'];

    firebase.initializeApp(firebaseConfig);
    const database = firebase.database();
    const gameRef = database.ref(GAME_DB_PATH);

    let localPlayerId = null;
    let currentGameState = {};
    let isAdmin = false;
    let adminSeeAll = false;
    let agoraClient = null;
    let localAudioTrack = null;
    let isVoiceJoined = false;
    let autoStartTimer = null;

    const screens = { login: document.getElementById('login-screen'), table: document.getElementById('game-table') };
    const allActionBtns = { pack: document.getElementById('btn-pack'), see: document.getElementById('btn-see'), sideshow: document.getElementById('btn-sideshow'), chaal: document.getElementById('btn-chaal'), show: document.getElementById('btn-show') };
    const adminPanel = { panel: document.getElementById('admin-panel'), seeAll: document.getElementById('btn-admin-see-all'), change: document.getElementById('btn-admin-change-cards') };
    const voiceChatBtn = document.getElementById('btn-voice-chat');
    const stickerPopup = document.getElementById('sticker-popup');

    function getPlayerBalance() { return parseInt(localStorage.getItem('teenPattiProBalance') || '1000', 10); }
    function savePlayerBalance(balance) { localStorage.setItem('teenPattiProBalance', balance); }
    function showScreen(screenName) { Object.values(screens).forEach(s => s.classList.remove('active')); screens[screenName].classList.add('active'); }

    function updateUI(state) {
        currentGameState = state;
        if (!state || !state.players || !state.players[localPlayerId]) {
            showScreen('login'); return;
        }
        showScreen('table');
        const myPlayer = state.players[localPlayerId];
        isAdmin = myPlayer.is_admin || false;
        adminPanel.panel.style.display = isAdmin ? 'flex' : 'none';
        
        document.getElementById('live-player-count').textContent = `Players: ${Object.keys(state.players).length}/4`;
        renderPlayers(state);
        document.getElementById('pot-area').textContent = `Pot: ₹${state.pot || 0}`;
        document.getElementById('game-message').textContent = state.message || '...';
        
        if (myPlayer) savePlayerBalance(myPlayer.balance);
        updateActionButtons(state);
        handleAutoStart(state);
        renderChat(state.chat);
        if (state.stickerEvent && state.stickerEvent.id > (currentGameState.lastStickerId || 0)) {
             handleStickerAnimation(state.stickerEvent);
             performAction(s => s.lastStickerId = state.stickerEvent.id);
        }
    }
    
    function renderPlayers(state) {
        const playersArea = document.getElementById('players-area');
        playersArea.innerHTML = '';
        const playerSlots = Object.values(state.players);

        for (let i = 0; i < 4; i++) {
            const slot = document.createElement('div');
            slot.className = 'player-slot';
            const player = playerSlots[i];

            if(player) {
                slot.id = `slot-${player.id}`;
                if(state.currentTurn === player.id) slot.classList.add('current-turn');
                
                const avatar = document.createElement('div');
                avatar.className = 'player-avatar';
                avatar.textContent = player.name.substring(0, 2).toUpperCase();
                avatar.onclick = () => showStickerPopup(player.id);

                let cardsHTML = '';
                if (player.status !== 'spectating' && player.cards) {
                    const showCards = adminSeeAll || (player.id === localPlayerId && player.status === 'seen') || state.status === 'showdown';
                    cardsHTML = `<div class="player-cards">${player.cards.map(c => `<div class="card ${showCards ? '' : 'hidden'}">${showCards ? formatCard(c) : ''}</div>`).join('')}</div>`;
                }
                
                let handInfo = (state.status === 'showdown' && player.status !== 'packed' && player.status !== 'spectating') ? `<div class="player-status">${player.hand.name}</div>` : '';
                
                slot.innerHTML = `
                    ${avatar.outerHTML}
                    <div class="player-name">${player.name} ${player.is_admin ? '👑' : ''}</div>
                    <div class="player-balance">₹${player.balance}</div>
                    <div class="player-status">${player.status}</div>
                    ${cardsHTML}
                    ${handInfo}
                `;
            }
            playersArea.appendChild(slot);
        }
    }

    function formatCard(cardStr) {
        if(!cardStr) return '';
        const suitMap = { '♠': 'spades', '♥': 'hearts', '♦': 'diams', '♣': 'clubs' };
        const suit = cardStr.slice(-1);
        return cardStr.replace(suit, `<span class="suit-${suitMap[suit]}">${suit}</span>`);
    }

    function updateActionButtons(state) {
        const myPlayer = state.players[localPlayerId];
        Object.values(allActionBtns).forEach(btn => btn.disabled = true);

        if (!myPlayer || state.status !== 'playing' || myPlayer.status === 'packed' || myPlayer.status === 'spectating') return;
        
        const isMyTurn = state.currentTurn === localPlayerId;
        const activePlayersCount = Object.values(state.players).filter(p => p.status !== 'packed' && p.status !== 'spectating').length;
        
        if (!isMyTurn) return;

        allActionBtns.pack.disabled = false;
        allActionBtns.see.disabled = myPlayer.status !== 'blind';
        
        const stake = myPlayer.status === 'seen' ? state.currentStake * 2 : state.currentStake;
        allActionBtns.chaal.disabled = myPlayer.balance < stake;
        allActionBtns.chaal.textContent = `Chaal (₹${stake})`;
        
        allActionBtns.show.disabled = !(activePlayersCount === 2);
        
        const playerIds = Object.keys(state.players).filter(pid => state.players[pid].status !== 'packed' && state.players[pid].status !== 'spectating');
        const myCurrentIndex = playerIds.indexOf(localPlayerId);
        const prevPlayerIndex = (myCurrentIndex - 1 + playerIds.length) % playerIds.length;
        const prevPlayer = state.players[playerIds[prevPlayerIndex]];
        
        allActionBtns.sideshow.disabled = !(myPlayer.status === 'seen' && prevPlayer && prevPlayer.id !== localPlayerId && prevPlayer.status === 'seen' && myPlayer.balance >= stake);
    }
    
    function performAction(action) {
        const stateCopy = JSON.parse(JSON.stringify(currentGameState)); 
        action(stateCopy);
        gameRef.set(stateCopy).catch(error => console.error("Firebase write failed:", error));
    }

    document.getElementById('join-game-btn').onclick = () => {
        const name = document.getElementById('player-name-input').value.trim();
        if (!name) return;
        if (currentGameState.players && Object.keys(currentGameState.players).length >= 4) { alert("Game is full."); return; }
        
        localPlayerId = `player_${Date.now()}`;
        const isGameInProgress = currentGameState.status === 'playing' || currentGameState.status === 'showdown';
        const newPlayer = { id: localPlayerId, name, balance: getPlayerBalance(), status: isGameInProgress ? 'spectating' : 'online', is_admin: name.toLowerCase() === 'vj' };
        
        const playerRef = database.ref(`${GAME_DB_PATH}/players/${localPlayerId}`);
        playerRef.onDisconnect().remove(); 
        
        if (!currentGameState.status || Object.keys(currentGameState.players || {}).length === 0) {
            const initialGameState = { status: 'waiting', players: { [localPlayerId]: newPlayer }, chat: [], pot: 0 };
            gameRef.set(initialGameState);
        } else {
            playerRef.set(newPlayer);
        }
    };
    
    allActionBtns.see.onclick = () => performAction(state => { if (state.players[localPlayerId].status !== 'blind') return; state.players[localPlayerId].status = 'seen'; addLog(`${state.players[localPlayerId].name} has seen their cards.`, state); });
    allActionBtns.pack.onclick = () => performAction(state => { state.players[localPlayerId].status = 'packed'; addLog(`${state.players[localPlayerId].name} packed.`, state); if (!checkForWinner(state)) moveToNextPlayer(state); });
    allActionBtns.chaal.onclick = () => performAction(state => { const myPlayer = state.players[localPlayerId]; const stake = myPlayer.status === 'seen' ? state.currentStake * 2 : state.currentStake; myPlayer.balance -= stake; state.pot += stake; state.currentStake = myPlayer.status === 'blind' ? state.currentStake : stake / 2; addLog(`${myPlayer.name} bets ₹${stake}.`, state); moveToNextPlayer(state); });
    allActionBtns.sideshow.onclick = () => performAction(state => { const myPlayer = state.players[localPlayerId]; const playerIds = Object.keys(state.players).filter(pid => state.players[pid].status !== 'packed' && state.players[pid].status !== 'spectating'); const myCurrentIndex = playerIds.indexOf(localPlayerId); const prevPlayerIndex = (myCurrentIndex - 1 + playerIds.length) % playerIds.length; const opponent = state.players[playerIds[prevPlayerIndex]]; if (!opponent || opponent.id === myPlayer.id) return; const cost = myPlayer.status === 'seen' ? state.currentStake * 2 : state.currentStake; if (myPlayer.balance < cost) return; myPlayer.balance -= cost; state.pot += cost; const result = compareHands(myPlayer.hand, opponent.hand); const loser = result >= 0 ? opponent : myPlayer; const winner = result >= 0 ? myPlayer : opponent; loser.status = 'packed'; addLog(`Side Show: ${myPlayer.name} vs ${opponent.name}. ${winner.name} wins.`, state); if (!checkForWinner(state)) moveToNextPlayer(state); });
    allActionBtns.show.onclick = () => performAction(state => { addLog(`${state.players[localPlayerId].name} called for a SHOWDOWN!`, state); endGame(state); });
    
    adminPanel.seeAll.onclick = () => { adminSeeAll = !adminSeeAll; updateUI(currentGameState); };
    adminPanel.change.onclick = () => { if (!isAdmin) return; performAction(state => { if (!state.deck || state.deck.length < 3) return; const myPlayer = state.players[localPlayerId]; state.deck.push(...myPlayer.cards); state.deck.sort(() => Math.random() - 0.5); myPlayer.cards = [state.deck.pop(), state.deck.pop(), state.deck.pop()]; myPlayer.hand = getHandDetails(myPlayer.cards); }); };

    voiceChatBtn.onclick = async () => { /* Voice chat logic remains same */ };
    document.getElementById('chat-input').addEventListener('keypress', e => { /* Chat logic remains same */ });

    function handleAutoStart(state) {
        if(autoStartTimer) clearTimeout(autoStartTimer);
        if (!state.players || Object.keys(state.players).length === 0) return;
        
        const hostId = Object.keys(state.players)[0];
        if (localPlayerId !== hostId) return;

        const activeAndWaitingPlayers = Object.values(state.players).filter(p => p.status === 'online' || p.status === 'spectating' || p.status === 'waiting' || (state.status === 'showdown' && p.status !== 'spectating'));
        
        if (state.status === 'waiting' && activeAndWaitingPlayers.length >= 2) {
            gameRef.child('message').set(`Game starting in 5 seconds...`);
            autoStartTimer = setTimeout(() => performAction(startGame), 5000);
        } else if (state.status === 'showdown' && activeAndWaitingPlayers.length >= 2) {
            gameRef.child('message').set(`Next round in 5 seconds...`);
            autoStartTimer = setTimeout(() => performAction(startGame), 5000);
        }
    }
    
    // ==========================================================
    // === YAHAN PAR MUKHYA BADLAV KIYE GAYE HAIN (MAIN CHANGES ARE HERE) ===
    // ==========================================================
    function startGame(newState) {
        newState.status = 'playing';
        newState.pot = 0;
        newState.deck = createDeck();
        newState.log = [];
        addLog("New round started!", newState);
        
        // Sabhi players ko reset karein (Reset all players)
        Object.values(newState.players).forEach(player => {
            // Sirf unko reset karein jinke paas paise hain (Only reset those with enough balance)
            if (player.balance >= BOOT_AMOUNT) {
                player.balance -= BOOT_AMOUNT;
                newState.pot += BOOT_AMOUNT;
                player.cards = [newState.deck.pop(), newState.deck.pop(), newState.deck.pop()];
                player.status = 'blind'; // Sabko blind se start karein (Start everyone as blind)
                player.hand = getHandDetails(player.cards);
            } else {
                // Jinke paas paise nahi, wo spectator banenge (Those without money become spectators)
                player.status = 'spectating';
                addLog(`${player.name} has insufficient balance.`, newState);
            }
        });

        addLog(`Everyone put ₹${BOOT_AMOUNT} in the pot.`, newState);
        
        // Pehla turn us player ko dein jo list me sabse pehle hai (Give first turn to the first active player)
        newState.currentTurn = Object.keys(newState.players).find(pid => newState.players[pid].status === 'blind') || null;
        newState.currentStake = BOOT_AMOUNT;
        newState.winner = null;
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
            if (winner) { 
                addLog(`${winner.name} is the last one standing!`, state); 
                distributePot(winner.id, state); 
            } else { 
                state.status = 'showdown'; 
                addLog("Round ends. No winner.", state); 
            } 
            return true; 
        }
        return false;
    }

    function endGame(state) {
        const activePlayers = Object.values(state.players).filter(p => p.status !== 'packed' && p.status !== 'spectating'); 
        if (activePlayers.length < 1) { state.status = 'showdown'; addLog("No active players left.", state); return; }
        const winner = activePlayers.reduce((best, current) => compareHands(best.hand, current.hand) >= 0 ? best : current, activePlayers[0]);
        distributePot(winner.id, state);
    }

    function distributePot(winnerId, state) {
        const winner = state.players[winnerId]; 
        if(winner) {
            addLog(`🎉 ${winner.name} wins the pot of ₹${state.pot} with a ${winner.hand.name}! 🎉`, state);
            winner.balance += state.pot; 
        }
        state.status = 'showdown';
    }

    function addLog(message, state) { 
        if (!state.log) state.log = []; 
        state.log.unshift(message);
        state.log = state.log.slice(0, 20);
        state.message = message;
    }
    
    function renderChat(chat) { /* ... same ... */ }
    function showStickerPopup(targetPlayerId) { /* ... same ... */ }
    function handleStickerAnimation(event) { /* ... same ... */ }
    function createDeck() { /* ... same ... */ }
    function getHandDetails(cards) { /* ... same ... */ }
    function compareHands(handA, handB) { /* ... same ... */ }
    
    // ... (rest of the functions like chat, sticker, card logic remain exactly the same)
    // The main change was in `startGame` function.

    gameRef.on('value', (snapshot) => {
        const state = snapshot.val();
        if(state) {
            updateUI(state);
        } else {
            // If game state is null (e.g., deleted), reset the UI
            showScreen('login');
            currentGameState = {};
        }
    });
};
