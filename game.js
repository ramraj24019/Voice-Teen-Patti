window.onload = function() {
    // Keep a reference to the global libraries
    const firebase = window.firebase;
    const AgoraRTC = window.AgoraRTC;

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
    const GAME_DB_PATH = 'teenpatti-pro-game'; // Firebase path for the game state
    const BOOT_AMOUNT = 10;
    const HAND_RANKS = { TRAIL: 6, PURE_SEQ: 5, SEQ: 4, COLOR: 3, PAIR: 2, HIGH_CARD: 1 };
    const STICKERS = ['😂', '😡', '🥳', '👏', '😍', '😎', '💩', '🤯'];

    // --- INITIALIZATION ---
    firebase.initializeApp(firebaseConfig);
    const database = firebase.database();
    const gameRef = database.ref(GAME_DB_PATH);

    // --- LOCAL STATE VARIABLES ---
    let localPlayerId = null;
    let currentGameState = {};
    let isAdmin = false;
    let adminSeeAll = false;
    let agoraClient = null;
    let localAudioTrack = null;
    let isVoiceJoined = false;
    let autoStartTimer = null;

    // --- UI ELEMENTS ---
    const screens = {
        login: document.getElementById('login-screen'),
        table: document.getElementById('game-table')
    };
    const allActionBtns = { 
        pack: document.getElementById('btn-pack'), 
        see: document.getElementById('btn-see'), 
        sideshow: document.getElementById('btn-sideshow'), 
        chaal: document.getElementById('btn-chaal'), 
        show: document.getElementById('btn-show') 
    };
    const adminPanel = { 
        panel: document.getElementById('admin-panel'), 
        seeAll: document.getElementById('btn-admin-see-all'), 
        change: document.getElementById('btn-admin-change-cards') 
    };
    const voiceChatBtn = document.getElementById('btn-voice-chat');
    const stickerPopup = document.getElementById('sticker-popup');

    // --- HELPER FUNCTIONS ---
    function getPlayerBalance() { return parseInt(localStorage.getItem('teenPattiProBalance') || '1000', 10); }
    function savePlayerBalance(balance) { localStorage.setItem('teenPattiProBalance', balance); }
    function showScreen(screenName) { Object.values(screens).forEach(s => s.classList.remove('active')); screens[screenName].classList.add('active'); }

    // --- CORE UI RENDERING ---
    function updateUI(state) {
        currentGameState = state;
        if (!state || !state.players || !state.players[localPlayerId]) {
            showScreen('login'); 
            return;
        }
        showScreen('table');
        
        const myPlayer = state.players[localPlayerId];
        isAdmin = myPlayer.is_admin || false;
        adminPanel.panel.style.display = isAdmin ? 'flex' : 'none'; // Use flex for better alignment
        
        document.getElementById('live-player-count').textContent = `Players: ${Object.keys(state.players).length}/4`;
        renderPlayers(state);
        document.getElementById('pot-area').textContent = `Pot: ₹${state.pot || 0}`;
        document.getElementById('game-message').textContent = state.message || '...';
        
        if (myPlayer) savePlayerBalance(myPlayer.balance);
        updateActionButtons(state);
        handleAutoStart(state);
        renderChat(state.chat);
        if (state.stickerEvent) {
             handleStickerAnimation(state.stickerEvent);
             gameRef.child('stickerEvent').remove(); // Consume the event
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
        const suitMap = { '♠': 'spades', '♥': 'hearts', '♦': 'diams', '♣': 'clubs' };
        return cardStr.replace(/([♠♥♦♣])/, `<span class="suit-${suitMap[cardStr[1]]}">$1</span>`);
    }

    function updateActionButtons(state) {
        const myPlayer = state.players[localPlayerId];
        const isMyTurn = state.currentTurn === localPlayerId && myPlayer.status !== 'packed' && myPlayer.status !== 'spectating';
        const activePlayersCount = Object.values(state.players).filter(p => p.status !== 'packed' && p.status !== 'spectating').length;
        
        Object.values(allActionBtns).forEach(btn => btn.disabled = true);
        if (!isMyTurn || state.status === 'showdown' || !myPlayer) return;

        allActionBtns.pack.disabled = false;
        allActionBtns.see.disabled = myPlayer.status !== 'blind';
        
        const stake = myPlayer.status === 'seen' ? state.currentStake * 2 : state.currentStake;
        allActionBtns.chaal.disabled = myPlayer.balance < stake;
        allActionBtns.chaal.textContent = `Chaal (₹${stake})`;
        
        allActionBtns.show.disabled = activePlayersCount > 2 ? false : true;
        
        const playerIds = Object.keys(state.players).filter(pid => state.players[pid].status !== 'packed' && state.players[pid].status !== 'spectating');
        const myCurrentIndex = playerIds.indexOf(localPlayerId);
        const prevPlayerIndex = (myCurrentIndex - 1 + playerIds.length) % playerIds.length;
        const prevPlayer = state.players[playerIds[prevPlayerIndex]];
        
        allActionBtns.sideshow.disabled = !(myPlayer.status === 'seen' && prevPlayer && prevPlayer.id !== localPlayerId && prevPlayer.status === 'seen' && myPlayer.balance >= stake);
    }
    
    function performAction(action) {
        const newState = JSON.parse(JSON.stringify(currentGameState)); 
        action(newState);
        gameRef.set(newState).catch(error => console.error("Firebase write failed:", error));
    }

    // --- EVENT LISTENERS ---
    document.getElementById('join-game-btn').onclick = () => {
        const name = document.getElementById('player-name-input').value.trim();
        if (!name) return;
        if (currentGameState.players && Object.keys(currentGameState.players).length >= 4) { alert("Game is full."); return; }
        
        localPlayerId = `player_${Date.now()}`;
        const isGameInProgress = currentGameState.status === 'playing';
        const newPlayer = { 
            id: localPlayerId, 
            name, 
            balance: getPlayerBalance(), 
            status: isGameInProgress ? 'spectating' : 'online', 
            is_admin: name.toLowerCase() === 'vj' 
        };
        
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

    voiceChatBtn.onclick = async () => {
        if (!AgoraRTC.checkSystemRequirements()) { alert("Browser not supported for voice chat."); return; }
        if (!isVoiceJoined) {
            try {
                agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
                agoraClient.on("user-published", async (user, mediaType) => { await agoraClient.subscribe(user, mediaType); if (mediaType === "audio") user.audioTrack.play(); });
                agoraClient.on("user-unpublished", user => {});
                
                const channelName = Object.keys(currentGameState.players)[0]; 
                await agoraClient.join(AGORA_APP_ID, channelName, null, localPlayerId);
                localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
                await agoraClient.publish([localAudioTrack]);
                voiceChatBtn.classList.add('active'); 
                voiceChatBtn.textContent = 'Voice 🔊';
                isVoiceJoined = true;
            } catch (error) { console.error("Agora Error:", error); alert("Could not start voice chat. Check microphone permissions and use HTTPS."); }
        } else {
            if (localAudioTrack) { localAudioTrack.close(); localAudioTrack = null; }
            if (agoraClient) await agoraClient.leave();
            voiceChatBtn.classList.remove('active'); 
            voiceChatBtn.textContent = 'Voice 🎤';
            isVoiceJoined = false;
        }
    };

    document.getElementById('chat-input').addEventListener('keypress', e => {
        if(e.key === 'Enter') {
            const message = e.target.value.trim();
            if(message) {
                performAction(state => {
                    if(!state.chat) state.chat = [];
                    state.chat.push({ name: state.players[localPlayerId].name, msg: message });
                });
                e.target.value = '';
            }
        }
    });

    // --- GAME LOGIC ---
    function handleAutoStart(state) {
        if(autoStartTimer) clearTimeout(autoStartTimer);
        const onlinePlayers = Object.values(state.players).filter(p => p.status === 'online' || p.status === 'waiting');
        const hostId = Object.keys(state.players)[0];

        if(localPlayerId === hostId) {
            if(state.status === 'waiting' && onlinePlayers.length >= 2) {
                gameRef.child('message').set(`Game starting in 5 seconds...`);
                autoStartTimer = setTimeout(() => performAction(startGame), 5000);
            } else if (state.status === 'showdown') {
                gameRef.child('message').set(`Next round in 5 seconds...`);
                autoStartTimer = setTimeout(() => performAction(startGame), 5000);
            }
        }
    }
    
    function startGame(newState) {
        const playerIds = Object.keys(newState.players);
        newState.status = 'playing';
        newState.pot = 0;
        newState.deck = createDeck();
        newState.log = [];
        addLog("New round started!", newState);
        
        playerIds.forEach(pid => {
            const player = newState.players[pid];
            if (player.status !== 'packed') { // Reset all non-packed players
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
        addLog(`🎉 ${winner.name} wins the pot of ₹${state.pot} with a ${winner.hand.name}! 🎉`, state);
        winner.balance += state.pot; 
        state.status = 'showdown';
    }

    function addLog(message, state) { 
        if (!state.log) state.log = []; 
        state.log.unshift(message); // Add to the beginning
        state.log = state.log.slice(0, 20); // Keep last 20 logs
        state.message = message;
    }
    
    // --- CHAT AND STICKERS ---
    function renderChat(chat) {
        const chatMessages = document.getElementById('chat-messages');
        chatMessages.innerHTML = (chat || []).slice(-10).map(m => `<div><strong>${m.name}:</strong> ${m.msg}</div>`).join('');
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function showStickerPopup(targetPlayerId) {
        if(targetPlayerId === localPlayerId) return;
        stickerPopup.innerHTML = STICKERS.map(s => `<div class="sticker">${s}</div>`).join('');
        stickerPopup.classList.add('active');
        const targetAvatar = document.querySelector(`#slot-${targetPlayerId} .player-avatar`);
        if (!targetAvatar) return;
        const rect = targetAvatar.getBoundingClientRect();
        stickerPopup.style.top = `${rect.top - 60}px`; // Adjust position
        stickerPopup.style.left = `${rect.left}px`;
        stickerPopup.onclick = e => {
            if(e.target.classList.contains('sticker')) {
                const sticker = e.target.textContent;
                performAction(state => {
                    state.stickerEvent = { from: localPlayerId, to: targetPlayerId, sticker, id: Date.now() };
                });
            }
            stickerPopup.classList.remove('active');
        };
        // Hide popup if clicked outside
        setTimeout(() => document.body.addEventListener('click', () => stickerPopup.classList.remove('active'), { once: true }), 0);
    }
    
    function handleStickerAnimation(event) {
        if(!event) return;
        const fromAvatar = document.querySelector(`#slot-${event.from} .player-avatar`);
        const toAvatar = document.querySelector(`#slot-${event.to} .player-avatar`);
        if(!fromAvatar || !toAvatar) return;

        const stickerElem = document.createElement('div');
        stickerElem.className = 'sticker-animation';
        stickerElem.textContent = event.sticker;
        document.getElementById('game-container').appendChild(stickerElem);

        const fromRect = fromAvatar.getBoundingClientRect();
        const toRect = toAvatar.getBoundingClientRect();
        
        stickerElem.style.top = `${fromRect.top + (fromRect.height / 2)}px`;
        stickerElem.style.left = `${fromRect.left + (fromRect.width / 2)}px`;

        setTimeout(() => {
            stickerElem.style.transform = `translate(${toRect.left - fromRect.left}px, ${toRect.top - fromRect.top}px) scale(1.5)`;
        }, 10);
        
        setTimeout(() => {
            stickerElem.style.opacity = '0';
            stickerElem.remove();
        }, 1500);
    }
    
    // --- CARD LOGIC ---
    function createDeck() { 
        const suits = ['♠', '♥', '♦', '♣']; 
        const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']; 
        let deck = []; 
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
        const isNormalSeq = (values[0] - 1 === values[1] && values[1] - 1 === values[2]);
        const isSpecialSeq = values.includes(12) && values.includes(1) && values.includes(0); // A, 2, 3 sequence
        const isSeq = isNormalSeq || isSpecialSeq;
        const isTrail = values[0] === values[1] && values[1] === values[2];
        
        let pairValue = -1;
        if (values[0] === values[1] || values[1] === values[2]) {
            pairValue = values[1];
        } else if (values[0] === values[2]) {
            pairValue = values[0];
        }
        const isPair = pairValue !== -1;
        
        const handValues = isSpecialSeq ? [12, 1, 0].sort((a, b) => b - a) : values;

        if (isTrail) return { rank: HAND_RANKS.TRAIL, name: "Trail", values: handValues };
        if (isColor && isSeq) return { rank: HAND_RANKS.PURE_SEQ, name: "Pure Sequence", values: handValues };
        if (isSeq) return { rank: HAND_RANKS.SEQ, name: "Sequence", values: handValues };
        if (isColor) return { rank: HAND_RANKS.COLOR, name: "Color", values: handValues };
        if (isPair) {
            const kicker = values.find(v => v !== pairValue);
            return { rank: HAND_RANKS.PAIR, name: "Pair", values: [pairValue, pairValue, kicker] };
        }
        return { rank: HAND_RANKS.HIGH_CARD, name: "High Card", values: handValues };
    }

    function compareHands(handA, handB) {
        if (handA.rank !== handB.rank) {
            return handA.rank - handB.rank;
        }
        for (let i = 0; i < handA.values.length; i++) {
            if (handA.values[i] !== handB.values[i]) {
                return handA.values[i] - handB.values[i];
            }
        }
        return 0; // It's a tie
    }

    // --- START LISTENING TO FIREBASE ---
    gameRef.on('value', (snapshot) => {
        const state = snapshot.val();
        updateUI(state || {});
    });
};
