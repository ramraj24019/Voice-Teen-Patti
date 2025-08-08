document.addEventListener('DOMContentLoaded', () => {
    if (typeof firebase === 'undefined') {
        alert("Error: Firebase library not loaded.");
        return;
    }

    const firebaseConfig = {
      apiKey: "AIzaSyBlbNZBZa6X7SNMWibj3-OsRJQar9jU-RY",
      authDomain: "desi-teen-patti-c4639.firebaseapp.com",
      databaseURL: "https://desi-teen-patti-c4639-default-rtdb.firebaseio.com",
      projectId: "desi-teen-patti-c4639",
      storageBucket: "desi-teen-patti-c4639.firebasestorage.app",
      messagingSenderId: "1007516567686",
      appId: "1:1007516567686:web:072f4172bda32d881de907"
    };
    
    firebase.initializeApp(firebaseConfig);
    const database = firebase.database();
    const GAME_DB_PATH = 'teenpatti-pro-game';
    const gameRef = database.ref(GAME_DB_PATH);

    const BOOT_AMOUNT = 10;
    const HAND_RANKS = { TRAIL: 6, PURE_SEQ: 5, SEQ: 4, COLOR: 3, PAIR: 2, HIGH_CARD: 1 };
    
    let localPlayerId = null;
    let currentGameState = {};
    let isAdmin = false;
    let adminSeeAll = false;
    let autoStartTimer = null;

    const screens = { login: document.getElementById('login-screen'), table: document.getElementById('game-table') };
    const allActionBtns = { pack: document.getElementById('btn-pack'), see: document.getElementById('btn-see'), sideshow: document.getElementById('btn-sideshow'), chaal: document.getElementById('btn-chaal'), show: document.getElementById('btn-show') };
    const adminPanel = { panel: document.getElementById('admin-panel'), seeAll: document.getElementById('btn-admin-see-all'), change: document.getElementById('btn-admin-change-cards') };

    function getPlayerBalance() { return parseInt(localStorage.getItem('teenPattiProBalance') || '1000', 10); }
    function savePlayerBalance(balance) { localStorage.setItem('teenPattiProBalance', balance); }
    function showScreen(screenName) { Object.values(screens).forEach(s => s.classList.remove('active')); if (screens[screenName]) screens[screenName].classList.add('active'); }

    document.getElementById('join-game-btn').onclick = () => {
        const name = document.getElementById('player-name-input').value.trim();
        if (!name) return;
        if (currentGameState.players && Object.keys(currentGameState.players).length >= 4) {
            alert("Game is full.");
            return;
        }
        
        localPlayerId = `player_${Date.now()}`;
        const isGameInProgress = currentGameState.status === 'playing' || currentGameState.status === 'showdown';
        const newPlayer = { id: localPlayerId, name, balance: getPlayerBalance(), status: isGameInProgress ? 'spectating' : 'online', is_admin: name.toLowerCase() === 'vj' };
        
        const playerRef = database.ref(`${GAME_DB_PATH}/players/${localPlayerId}`);
        playerRef.onDisconnect().remove();
        
        if (!currentGameState.status || Object.keys(currentGameState.players || {}).length === 0) {
            const initialGameState = { status: 'waiting', players: { [localPlayerId]: newPlayer }, pot: 0 };
            gameRef.set(initialGameState);
        } else {
            playerRef.set(newPlayer);
        }
    };
    
    gameRef.on('value', (snapshot) => {
        const state = snapshot.val();
        if(state) {
            updateUI(state);
        } else {
            showScreen('login');
            currentGameState = {};
        }
    });

    function performAction(action) {
        const stateCopy = JSON.parse(JSON.stringify(currentGameState)); 
        action(stateCopy);
        gameRef.set(stateCopy).catch(error => console.error("Firebase write failed:", error));
    }

    function updateUI(state) {
        currentGameState = state;
        if (!state.players || !state.players[localPlayerId]) {
            showScreen('login');
            return;
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
                
                let cardsHTML = '';
                if (player.status !== 'spectating' && player.cards) {
                    const showCards = adminSeeAll || (player.id === localPlayerId && player.status === 'seen') || state.status === 'showdown';
                    cardsHTML = `<div class="player-cards">${player.cards.map(c => `<div class="card ${showCards ? '' : 'hidden'}">${showCards ? c : ''}</div>`).join('')}</div>`;
                }
                
                let handInfo = (state.status === 'showdown' && player.status !== 'packed' && player.status !== 'spectating' && player.hand) ? `<div class="player-status">${player.hand.name}</div>` : '';
                
                slot.innerHTML = `
                    <div class="player-avatar">${player.name.substring(0, 2).toUpperCase()}</div>
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

    function updateActionButtons(state) {
        const myPlayer = state.players[localPlayerId];
        Object.values(allActionBtns).forEach(btn => btn.disabled = true);

        if (!myPlayer || state.status !== 'playing' || myPlayer.status === 'packed' || myPlayer.status === 'spectating') return;
        
        const isMyTurn = state.currentTurn === localPlayerId;
        if (!isMyTurn) return;

        const activePlayersCount = Object.values(state.players).filter(p => p.status !== 'packed' && p.status !== 'spectating').length;
        
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
    
    function handleAutoStart(state) {
        if(autoStartTimer) clearTimeout(autoStartTimer);
        if (!state.players || Object.keys(state.players).length === 0) return;
        
        const hostId = Object.keys(state.players)[0];
        if (localPlayerId !== hostId) return;

        // YAHAN PAR BADLAV KIYA GAYA HAI (CHANGE IS HERE)
        const playersInLobby = Object.keys(state.players).length;
        
        if ((state.status === 'waiting' || state.status === 'showdown') && playersInLobby >= 2) {
            gameRef.child('message').set(`Starting in 5 seconds...`);
            autoStartTimer = setTimeout(() => performAction(startGame), 5000);
        }
    }
    
    function startGame(newState) {
        newState.status = 'playing';
        newState.pot = 0;
        newState.deck = createDeck();
        addLog("New round started!", newState);
        
        // YAHAN PAR BHI BADLAV KIYA GAYA HAI (CHANGE IS ALSO HERE)
        Object.values(newState.players).forEach(player => {
            if (player.balance >= BOOT_AMOUNT) {
                player.balance -= BOOT_AMOUNT;
                newState.pot += BOOT_AMOUNT;
                player.cards = [newState.deck.pop(), newState.deck.pop(), newState.deck.pop()];
                player.status = 'blind'; // Sabko blind banayein
                player.hand = getHandDetails(player.cards);
            } else {
                player.status = 'spectating';
                addLog(`${player.name} has insufficient balance.`, newState);
            }
        });

        addLog(`Everyone put ₹${BOOT_AMOUNT} in the pot.`, newState);
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
            addLog(`🎉 ${winner.name} wins ₹${state.pot} with a ${winner.hand.name}! 🎉`, state);
            winner.balance += state.pot; 
        }
        state.status = 'showdown';
    }

    function addLog(message, state) { state.message = message; }

    allActionBtns.see.onclick = () => performAction(state => { if (state.players[localPlayerId].status !== 'blind') return; state.players[localPlayerId].status = 'seen'; addLog(`${state.players[localPlayerId].name} has seen cards.`, state); });
    allActionBtns.pack.onclick = () => performAction(state => { state.players[localPlayerId].status = 'packed'; addLog(`${state.players[localPlayerId].name} packed.`, state); if (!checkForWinner(state)) moveToNextPlayer(state); });
    allActionBtns.chaal.onclick = () => performAction(state => { const myPlayer = state.players[localPlayerId]; const stake = myPlayer.status === 'seen' ? state.currentStake * 2 : state.currentStake; myPlayer.balance -= stake; state.pot += stake; state.currentStake = myPlayer.status === 'blind' ? state.currentStake : stake / 2; addLog(`${myPlayer.name} bets ₹${stake}.`, state); moveToNextPlayer(state); });
    allActionBtns.sideshow.onclick = () => performAction(state => { const myPlayer = state.players[localPlayerId]; const playerIds = Object.keys(state.players).filter(pid => state.players[pid].status !== 'packed' && state.players[pid].status !== 'spectating'); const myCurrentIndex = playerIds.indexOf(localPlayerId); const prevPlayerIndex = (myCurrentIndex - 1 + playerIds.length) % playerIds.length; const opponent = state.players[playerIds[prevPlayerIndex]]; if (!opponent || opponent.id === myPlayer.id) return; const cost = myPlayer.status === 'seen' ? state.currentStake * 2 : state.currentStake; if (myPlayer.balance < cost) return; myPlayer.balance -= cost; state.pot += cost; const result = compareHands(myPlayer.hand, opponent.hand); const loser = result >= 0 ? opponent : myPlayer; const winner = result >= 0 ? myPlayer : opponent; loser.status = 'packed'; addLog(`Side Show: ${myPlayer.name} vs ${opponent.name}. ${winner.name} wins.`, state); if (!checkForWinner(state)) moveToNextPlayer(state); });
    allActionBtns.show.onclick = () => performAction(state => { addLog(`${state.players[localPlayerId].name} called for a SHOWDOWN!`, state); endGame(state); });
    
    adminPanel.seeAll.onclick = () => { adminSeeAll = !adminSeeAll; updateUI(currentGameState); };
    adminPanel.change.onclick = () => { if (!isAdmin) return; performAction(state => { if (!state.deck || state.deck.length < 3) return; const myPlayer = state.players[localPlayerId]; state.deck.push(...myPlayer.cards); state.deck.sort(() => Math.random() - 0.5); myPlayer.cards = [state.deck.pop(), state.deck.pop(), state.deck.pop()]; myPlayer.hand = getHandDetails(myPlayer.cards); }); };
    
    function createDeck() { const suits = ['♠', '♥', '♦', '♣']; const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']; let deck = []; for (const suit of suits) for (const rank of ranks) deck.push(rank + suit); return deck.sort(() => Math.random() - 0.5); }
    function getHandDetails(cards) { if (!cards || cards.length !== 3) return { rank: 0, name: "Invalid Hand", values: [] }; const cardVals = '23456789TJQKA'; const parsed = cards.map(c => ({ rank: cardVals.indexOf(c[0]), suit: c[1] })).sort((a, b) => b.rank - a.rank); const values = parsed.map(c => c.rank); const suits = parsed.map(c => c.suit); const isColor = suits[0] === suits[1] && suits[1] === suits[2]; const isNormalSeq = (values[0] - 1 === values[1] && values[1] - 1 === values[2]); const isSpecialSeq = values.includes(12) && values.includes(1) && values.includes(0); const isSeq = isNormalSeq || isSpecialSeq; const isTrail = values[0] === values[1] && values[1] === values[2]; let pairValue = -1; if (values[0] === values[1] || values[1] === values[2]) { pairValue = values[1]; } else if (values[0] === values[2]) { pairValue = values[0]; } const isPair = pairValue !== -1; const handValues = isSpecialSeq ? [12, 1, 0].sort((a, b) => b - a) : values; if (isTrail) return { rank: HAND_RANKS.TRAIL, name: "Trail", values: handValues }; if (isColor && isSeq) return { rank: HAND_RANKS.PURE_SEQ, name: "Pure Sequence", values: handValues }; if (isSeq) return { rank: HAND_RANKS.SEQ, name: "Sequence", values: handValues }; if (isColor) return { rank: HAND_RANKS.COLOR, name: "Color", values: handValues }; if (isPair) { const kicker = values.find(v => v !== pairValue); return { rank: HAND_RANKS.PAIR, name: "Pair", values: [pairValue, pairValue, kicker] }; } return { rank: HAND_RANKS.HIGH_CARD, name: "High Card", values: handValues }; }
    function compareHands(handA, handB) { if (handA.rank !== handB.rank) { return handA.rank - handB.rank; } for (let i = 0; i < handA.values.length; i++) { if (handA.values[i] !== handB.values[i]) { return handA.values[i] - handB.values[i]; } } return 0; }
});
