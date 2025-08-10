// This file handles all Agora Voice Chat logic.

const AGORA_APP_ID_VOICE = "f33cf29d42264f55b5130f61686e77a2"; // Your new, correct App ID
const voiceToggleButton = document.getElementById('btn-voice-toggle');

let agoraVoiceClient = null;
let localAudioTrack = null;
let isVoiceJoined = false;
let currentVoiceChannel = null;

async function joinVoiceChannel(channelName, localPlayerId) {
    if (isVoiceJoined) return; // Already joined

    try {
        currentVoiceChannel = channelName;
        agoraVoiceClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

        agoraVoiceClient.on("user-published", async (user, mediaType) => {
            await agoraVoiceClient.subscribe(user, mediaType);
            if (mediaType === "audio") {
                user.audioTrack.play();
            }
        });

        const uid = await agoraVoiceClient.join(AGORA_APP_ID_VOICE, channelName, null, localPlayerId);
        
        localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
        await agoraVoiceClient.publish([localAudioTrack]);

        isVoiceJoined = true;
        voiceToggleButton.textContent = "Voice OFF 🔇";
        voiceToggleButton.classList.add('active');

    } catch (error) {
        console.error("Agora Join Error:", error);
    }
}

async function leaveVoiceChannel() {
    if (!isVoiceJoined) return;

    try {
        if (localAudioTrack) {
            localAudioTrack.close();
            localAudioTrack = null;
        }
        await agoraVoiceClient.leave();
        isVoiceJoined = false;
        voiceToggleButton.textContent = "Voice ON 🎤";
        voiceToggleButton.classList.remove('active');
    } catch (error) {
        console.error("Agora Leave Error:", error);
    }
}

voiceToggleButton.addEventListener('click', () => {
    if (isVoiceJoined) {
        leaveVoiceChannel();
    } else if (currentVoiceChannel) { // Only join if we know the channel name
        joinVoiceChannel(currentVoiceChannel, null); // We need the localPlayerId here, game.js will provide it
    }
});
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
                const shouldShowMyCards = isMe && player.status === 'seen';
                const isShowdown = status === 'showdown';
                
                cardsHTML = player.cards.map(cardStr => {
                    let cardClass = 'card';
                    if (shouldShowMyCards || adminSeeAll || (isShowdown && player.status !== 'packed')) {
                        cardClass += ' seen showdown'; 
                    }
                    return `<div class="${cardClass}">
                                <div class="card-face card-back"></div>
                                <div class="card-face card-front">${cardStr}</div>
                            </div>`;
                }).join('');
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
    function getHandDetails(c){if(!c||c.length!==3)return{rank:1,name:"Invalid",values:[]};const o='23456789TJQKA',p=c.map(e=>({rank:o.indexOf(e[0]),suit:e[1]})).sort((a,b)=>b.rank-a.r),v=p.map(e=>e.rank),s=p.map(e=>e.suit),l=s[0]===s[1]&&s[1]===s[2],t=v.includes(12)&&v.includes(1)&&v.includes(0),q=v[0]-1===v[1]&&v[1]-1===v[2],u=q||t,n=v[0]===v[1]&&v[1]===v[2];let a=-1;v[0]===v[1]||v[1]===v[2]?a=v[1]:v[0]===v[2]&&(a=v[0]);const i=a!==-1,d=t?[12,1,0].sort((e,r)=>r-e):v;return n?{rank:7,name:"Trail",values:d}:l&&u?{rank:6,name:"Pure Seq",values:d}:u?{rank:5,name:"Sequence",values:d}:l?{rank:4,name:"Color",values:d}:i?{rank:3,name:"Pair",values:function(e,r){const t=e.find(t=>t!==r);return[r,r,t]}(v,a)}:{rank:2,name:"High Card",values:d}}
    function compareHands(a,b){if(a.rank!==b.rank)return a.rank-b.rank;for(let e=0;e<a.v.length;e++)if(a.v[e]!==b.v[e])return a.v[e]-b.v[e];return 0}

    // --- OTHER FEATURE LISTENERS ---
    ui.themeBtn.onclick = () => ui.themePopup.classList.toggle('active');
    document.querySelector('.theme-options').addEventListener('click', e => {
        if(e.target.matches('.theme-option')){
            ui.tableArea.className = `theme-${e.target.dataset.theme}`;
            ui.themePopup.classList.remove('active');
        }
    });
    globalPlayersRef.on('value', snapshot => {
        const players = snapshot.val() || {};
        ui.totalPlayersCount.textContent = `Online: ${Object.keys(players).length}`;
    });
});
