// === FIX: Wait for the entire page to load before running any code ===
window.onload = function() {

    // Use the compat version of Firebase which is more stable with this loading method
    const firebase = window.firebase;
    const AgoraRTC = window.AgoraRTC;

    // --- गेम और API कॉन्फ़िगरेशन ---
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
    const BOOT_AMOUNT = 10;
    const HAND_RANKS = { TRAIL: 6, PURE_SEQ: 5, SEQ: 4, COLOR: 3, PAIR: 2, HIGH_CARD: 1 };

    // --- ऐप और डेटाबेस को इनिशियलाइज़ करें ---
    firebase.initializeApp(firebaseConfig);
    const database = firebase.database();
    const gameRef = database.ref('teenpatti-game-v2');

    // --- ग्लोबल वेरिएबल्स ---
    let localPlayerId = null;
    let currentGameState = {};
    let isAdmin = false;
    let adminSeeAll = false;
    let agoraClient = null;
    let localAudioTrack = null;
    let isVoiceJoined = false;

    // --- UI एलिमेंट्स ---
    const loginScreen = document.getElementById('login-screen');
    const waitingRoom = document.getElementById('waiting-room');
    const gameBoard = document.getElementById('game-board');
    const joinGameBtn = document.getElementById('join-game-btn');
    const allActionBtns = {
        chaal: document.getElementById('btn-chaal'), see: document.getElementById('btn-see'),
        pack: document.getElementById('btn-pack'), show: document.getElementById('btn-show'),
        sideshow: document.getElementById('btn-sideshow'),
    };
    const adminPanel = document.getElementById('admin-panel');
    const adminSeeAllBtn = document.getElementById('btn-admin-see-all');
    const adminChangeCardsBtn = document.getElementById('btn-admin-change-cards');
    const gameControlBtn = document.getElementById('game-control-btn');
    const voiceChatBtn = document.getElementById('btn-voice-chat');

    function getPlayerBalance() {
        return parseInt(localStorage.getItem('teenPattiBalance') || '1000', 10);
    }
    function savePlayerBalance(balance) {
        localStorage.setItem('teenPattiBalance', balance);
    }

    function updateUI(state) {
        currentGameState = state;
        if (!state || !state.players || !state.players[localPlayerId]) {
            loginScreen.classList.add('active');
            gameBoard.classList.remove('active');
            waitingRoom.classList.remove('active');
            adminPanel.classList.remove('active');
            gameControlBtn.style.display = 'none';
            voiceChatBtn.style.display = 'none';
            return;
        }
        const myPlayer = state.players[localPlayerId];
        isAdmin = myPlayer.is_admin || false;
        adminPanel.classList.toggle('active', isAdmin && state.status === 'playing');
        const isHost = state.hostId === localPlayerId;
        gameControlBtn.style.display = 'none';
        voiceChatBtn.style.display = 'block';
        if (state.status === 'waiting' || myPlayer.status === 'spectating') {
            loginScreen.classList.remove('active');
            gameBoard.classList.remove('active');
            waitingRoom.classList.add('active');
            document.getElementById('waiting-room-title').textContent = isHost ? "Waiting for Players... (You are the Host)" : "Waiting for Host to start...";
            document.getElementById('wait-room-balance').textContent = `₹${myPlayer.balance}`;
            document.getElementById('waiting-players-list').innerHTML = Object.values(state.players).map(p => `<div>${p.name} (${p.status}) - Balance: ₹${p.balance}</div>`).join('');
            if (isHost) {
                gameControlBtn.style.display = 'block';
                gameControlBtn.textContent = 'Start Game';
                const readyPlayers = Object.values(state.players).filter(p => p.status === 'waiting' || p.status === 'spectating').length;
                gameControlBtn.disabled = readyPlayers < 2;
            }
        } else if (state.status === 'playing' || state.status === 'showdown') {
            loginScreen.classList.remove('active');
            waitingRoom.classList.remove('active');
            gameBoard.classList.add('active');
            renderPlayers(state);
            document.getElementById('pot-area').textContent = `Pot: ₹${state.pot}`;
            const gameLog = document.getElementById('game-log');
            gameLog.innerHTML = (state.log || []).slice(-15).join('<br>');
            gameLog.scrollTop = gameLog.scrollHeight;
            if (myPlayer) savePlayerBalance(myPlayer.balance);
            updateActionButtons(state);
            if (isHost && state.status === 'showdown') {
                gameControlBtn.style.display = 'block';
                gameControlBtn.textContent = 'New Round';
                gameControlBtn.disabled = false;
            }
        }
    }
    function renderPlayers(state) {
        const playersArea = document.getElementById('players-area');
        playersArea.innerHTML = '';
        Object.values(state.players).forEach(player => {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player';
            if (state.currentTurn === player.id) playerDiv.classList.add('current-turn');
            if (player.status === 'packed' || player.status === 'spectating') playerDiv.style.opacity = '0.6';
            let cardsHTML = '<div class="cards">';
            if (player.status !== 'spectating') {
                const isSideShowPlayer = state.sideShowInfo && (state.sideShowInfo.p1 === player.id || state.sideShowInfo.p2 === player.id);
                const amIInSideShow = state.sideShowInfo && (state.sideShowInfo.p1 === localPlayerId || state.sideShowInfo.p2 === localPlayerId);
                const showCards = adminSeeAll || (player.id === localPlayerId && player.status === 'seen') || state.status === 'showdown' || (isSideShowPlayer && amIInSideShow);
                if (player.cards && player.cards.length > 0) {
                    player.cards.forEach(card => {
                        cardsHTML += `<div class="card ${showCards ? '' : 'hidden'}">${showCards ? formatCard(card) : ''}</div>`;
                    });
                }
            }
            cardsHTML += '</div>';
            let handInfo = '';
            if (state.status === 'showdown' && player.status !== 'packed' && player.status !== 'spectating') {
                handInfo = `<div class="player-status" style="background-color:#4caf50;">${player.hand.name}</div>`;
            }
            playerDiv.innerHTML = `<div class="player-name">${player.name} ${player.is_admin ? '👑' : ''}</div><div class="player-balance">₹${player.balance}</div><div class="player-status">${player.status}</div>${cardsHTML}${handInfo}`;
            playersArea.appendChild(playerDiv);
        });
    }
    function updateActionButtons(state) {
        const myPlayer = state.players[localPlayerId];
        const isMyTurn = state.currentTurn === localPlayerId && myPlayer.status !== 'packed' && myPlayer.status !== 'spectating';
        const activePlayersCount = Object.values(state.players).filter(p => p.status !== 'packed' && p.status !== 'spectating').length;
        Object.values(allActionBtns).forEach(btn => btn.disabled = true);
        if (!isMyTurn || state.status === 'showdown') return;
        allActionBtns.pack.disabled = false;
        allActionBtns.see.disabled = myPlayer.status !== 'blind';
        const stake = myPlayer.status === 'seen' ? state.currentStake * 2 : state.currentStake;
        allActionBtns.chaal.disabled = myPlayer.balance < stake;
        allActionBtns.chaal.textContent = `Chaal (₹${stake})`;
        allActionBtns.show.disabled = activePlayersCount !== 2;
        const playerIds = Object.keys(state.players).filter(pid => state.players[pid].status !== 'packed' && state.players[pid].status !== 'spectating');
        const myCurrentIndex = playerIds.indexOf(localPlayerId);
        const prevPlayerIndex = (myCurrentIndex - 1 + playerIds.length) % playerIds.length;
        const prevPlayer = state.players[playerIds[prevPlayerIndex]];
        const sideShowCost = myPlayer.status === 'seen' ? state.currentStake * 2 : state.currentStake;
        allActionBtns.sideshow.disabled = !(myPlayer.status === 'seen' && prevPlayer && prevPlayer.id !== localPlayerId && myPlayer.balance >= sideShowCost);
    }
    joinGameBtn.onclick = () => {
        const name = document.getElementById('player-name-input').value.trim();
        if (!name) return;
        if (currentGameState && currentGameState.players && Object.keys(currentGameState.players).length >= 4) {
            alert("Game is full.");
            return;
        }
        localPlayerId = `player_${Date.now()}`;
        const isGameInProgress = currentGameState && currentGameState.status === 'playing';
        const newPlayer = {
            id: localPlayerId,
            name,
            balance: getPlayerBalance(),
            status: isGameInProgress ? 'spectating' : 'waiting',
            is_admin: name.toLowerCase() === 'vj'
        };
        const playerRef = database.ref(`teenpatti-game-v2/players/${localPlayerId}`);
        playerRef.onDisconnect().remove();
        if (!currentGameState || !currentGameState.hostId) {
            const initialGameState = {
                hostId: localPlayerId,
                status: 'waiting',
                players: { [localPlayerId]: newPlayer },
                log: [`${name} created a new game room.`]
            };
            gameRef.set(initialGameState);
        } else {
            playerRef.set(newPlayer);
        }
    };
    gameControlBtn.onclick = () => {
        if (currentGameState.hostId !== localPlayerId) return;
        performAction(newState => {
            if (newState.status === 'waiting' || newState.status === 'showdown') {
                const playerIds = Object.keys(newState.players);
                const readyPlayerCount = playerIds.filter(pid => ['waiting', 'spectating'].includes(newState.players[pid].status)).length;
                if (readyPlayerCount < 2) return;
                newState.status = 'playing';
                newState.pot = 0;
                newState.deck = createDeck();
                newState.log = ["New round started!"];
                playerIds.forEach(pid => {
                    const player = newState.players[pid];
                    if (player.status === 'waiting' || player.status === 'spectating') {
                        if (player.balance >= BOOT_AMOUNT) {
                            player.balance -= BOOT_AMOUNT;
                            newState.pot += BOOT_AMOUNT;
                            player.cards = [newState.deck.pop(), newState.deck.pop(), newState.deck.pop()];
                            player.status = 'blind';
                            player.hand = getHandDetails(player.cards);
                        } else {
                            player.status = 'spectating';
                            addLog(`${player.name} has insufficient balance.`, newState);
                        }
                    }
                });
                addLog(`Everyone put ₹${BOOT_AMOUNT} in the pot.`, newState);
                newState.currentTurn = playerIds.find(pid => newState.players[pid].status === 'blind') || null;
                newState.currentStake = BOOT_AMOUNT;
                newState.winner = null;
                newState.sideShowInfo = null;
            }
        });
    };
    function performAction(action) {
        let newState = { ...currentGameState };
        action(newState);
        gameRef.set(newState);
    }
    allActionBtns.see.onclick = () => performAction(state => { if (state.players[localPlayerId].status !== 'blind') return; state.players[localPlayerId].status = 'seen'; addLog(`${state.players[localPlayerId].name} has seen their cards.`, state); });
    allActionBtns.pack.onclick = () => performAction(state => { state.players[localPlayerId].status = 'packed'; addLog(`${state.players[localPlayerId].name} packed.`, state); if (!checkForWinner(state)) moveToNextPlayer(state); });
    allActionBtns.chaal.onclick = () => performAction(state => { const myPlayer = state.players[localPlayerId]; const stake = myPlayer.status === 'seen' ? state.currentStake * 2 : state.currentStake; myPlayer.balance -= stake; state.pot += stake; state.currentStake = myPlayer.status === 'blind' ? stake : stake / 2; addLog(`${myPlayer.name} bets ₹${stake}.`, state); moveToNextPlayer(state); });
    allActionBtns.sideshow.onclick = () => performAction(state => { const myPlayer = state.players[localPlayerId]; const playerIds = Object.keys(state.players).filter(pid => state.players[pid].status !== 'packed' && state.players[pid].status !== 'spectating'); const myCurrentIndex = playerIds.indexOf(localPlayerId); const prevPlayerIndex = (myCurrentIndex - 1 + playerIds.length) % playerIds.length; const opponent = state.players[playerIds[prevPlayerIndex]]; if (!opponent || opponent.id === myPlayer.id) return; const cost = myPlayer.status === 'seen' ? state.currentStake * 2 : state.currentStake; if (myPlayer.balance < cost) return; myPlayer.balance -= cost; state.pot += cost; const result = compareHands(myPlayer.hand, opponent.hand); const loser = result >= 0 ? opponent : myPlayer; const winner = result >= 0 ? myPlayer : opponent; loser.status = 'packed'; addLog(`Side Show: ${myPlayer.name} vs ${opponent.name}. ${winner.name} wins.`, state); state.sideShowInfo = { p1: myPlayer.id, p2: opponent.id }; if (!checkForWinner(state)) moveToNextPlayer(state); setTimeout(() => database.ref('teenpatti-game-v2/sideShowInfo').remove(), 5000); });
    allActionBtns.show.onclick = () => performAction(state => { addLog(`${state.players[localPlayerId].name} called for a SHOWDOWN!`, state); endGame(state); });
    adminSeeAllBtn.onclick = () => { adminSeeAll = !adminSeeAll; adminSeeAllBtn.textContent = `See All Cards: ${adminSeeAll ? 'ON' : 'OFF'}`; updateUI(currentGameState); };
    adminChangeCardsBtn.onclick = () => { if (!isAdmin) return; performAction(state => { if (!state.deck || state.deck.length < 3) return; const myPlayer = state.players[localPlayerId]; state.deck.push(...myPlayer.cards); state.deck.sort(() => Math.random() - 0.5); myPlayer.cards = [state.deck.pop(), state.deck.pop(), state.deck.pop()]; myPlayer.hand = getHandDetails(myPlayer.cards); }); };
    voiceChatBtn.onclick = async () => {
        if (!AgoraRTC.checkSystemRequirements()) {
            alert("Your browser does not support the Agora Web SDK. Please use a modern browser like Chrome or Firefox.");
            return;
        }
        if (!isVoiceJoined) {
            try {
                agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
                agoraClient.on("user-published", async (user, mediaType) => { await agoraClient.subscribe(user, mediaType); if (mediaType === "audio") user.audioTrack.play(); });
                const channelName = currentGameState.hostId || 'default-teenpatti-room';
                await agoraClient.join(AGORA_APP_ID, channelName, null, localPlayerId);
                localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
                await agoraClient.publish([localAudioTrack]);
                voiceChatBtn.textContent = 'Mute 🔇';
                voiceChatBtn.classList.add('active');
                isVoiceJoined = true;
            } catch (error) { console.error("Agora join failed. This can happen on non-HTTPS connections.", error); alert("Could not start voice chat. Please use a secure (https) connection."); }
        } else {
            if (localAudioTrack) localAudioTrack.close();
            if (agoraClient) await agoraClient.leave();
            voiceChatBtn.textContent = 'Join Voice 🎤';
            voiceChatBtn.classList.remove('active');
            isVoiceJoined = false;
        }
    };
    function moveToNextPlayer(state) {
        const playerIds = Object.keys(state.players);
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
                state.status = 'showdown'; addLog("Round ends. No winner.", state);
            }
            return true;
        }
        return false;
    }
    function endGame(state) {
        const activePlayers = Object.values(state.players).filter(p => p.status !== 'packed' && p.status !== 'spectating');
        if (activePlayers.length < 1) {
            state.status = 'showdown'; addLog("No active players left.", state); return;
        }
        const winner = activePlayers.reduce((best, current) => compareHands(best.hand, current.hand) >= 0 ? best : current, activePlayers[0]);
        distributePot(winner.id, state);
    }
    function distributePot(winnerId, state) {
        const winner = state.players[winnerId];
        addLog(`🎉 ${winner.name} wins the pot of ₹${state.pot} with a ${winner.hand.name}! 🎉`, state);
        winner.balance += state.pot;
        state.status = 'showdown';
        state.winner = winnerId;
        state.deck = [];
    }
    function addLog(message, state) {
        if (!state.log) state.log = [];
        state.log.push(message);
    }
    function createDeck() {
        const suits = ['♠', '♥', '♦', '♣']; const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']; let deck = [];
        for (const suit of suits) for (const rank of ranks) deck.push(rank + suit);
        return deck.sort(() => Math.random() - 0.5);
    }
    function getHandDetails(cards) {
        if (!cards || cards.length !== 3) return { rank: 0, name: "Invalid Hand", values: [] };
        const cardVals = '23456789TJQKA';
        const parsed = cards.map(c => ({ rank: cardVals.indexOf(c[0]), suit: c[1] })).sort((a, b) => b.rank - a.rank);
        const values = parsed.map(c => c.rank);
        const suits = parsed.map(c => c.suit);
        const isColor = suits[0] === suits[1] && suits[1] === suits[2];
        const isSpecialSeq = values.includes(12) && values.includes(1) && values.includes(0);
        const isNormalSeq = (values[0] - 1 === values[1] && values[1] - 1 === values[2]);
        const isSeq = isNormalSeq || isSpecialSeq;
        const isTrail = values[0] === values[1] && values[1] === values[2];
        const isPair = values[0] === values[1] || values[1] === values[2] || values[0] === values[2];
        const handValues = isSpecialSeq ? [12, 1, 0] : values;
        if (isTrail) return { rank: HAND_RANKS.TRAIL, name: "Trail", values: handValues };
        if (isColor && isSeq) return { rank: HAND_RANKS.PURE_SEQ, name: "Pure Sequence", values: handValues };
        if (isSeq) return { rank: HAND_RANKS.SEQ, name: "Sequence", values: handValues };
        if (isColor) return { rank: HAND_RANKS.COLOR, name: "Color", values: handValues };
        if (isPair) { const sortedValues = [...values].sort((a, b) => (values.filter(v => v === a).length < values.filter(v => v === b).length) ? 1 : -1); return { rank: HAND_RANKS.PAIR, name: "Pair", values: sortedValues }; }
        return { rank: HAND_RANKS.HIGH_CARD, name: "High Card", values: handValues };
    }
    function compareHands(h1, h2) {
        if (h1.rank !== h2.rank) return h1.rank - h2.rank;
        for (let i = 0; i < h1.values.length; i++) {
            if (h1.values[i] !== h2.values[i]) return h1.values[i] - h2.values[i];
        } return 0;
    }
    function formatCard(card) {
        return card.replace('T', '10');
    }
    gameRef.on('value', (snapshot) => {
        updateUI(snapshot.val());
    });
};