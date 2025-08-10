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
        localPlayerId = `player_${Date.now()}`;
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
        const playerRef = currentTableRef.child('players').child(localPlayerId);
        const newPlayer = { id: localPlayerId, name: localPlayerName, balance: 1000, status: 'online', is_admin: isAdmin, avatar: 'avatars/avatar1.png' };
        playerRef.set(newPlayer);
        playerRef.child('cards').remove();   // Purane cards hatao
        playerRef.child('status').remove();  // Purana status hatao
        playerRef.child('hand').remove();    // Purana hand data hatao
        playerRef.onDisconnect().remove();
        showScreen('game');
        currentTableRef.on('value', handleStateUpdate);
        joinVoiceChannel();
        listenForChat();
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

    // --- UI FUNCTIONS ---
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

    function updateActionButtons(state) {
        const myPlayer = state.players[localPlayerId];
        if (!myPlayer) return;
        const isMyTurn = state.currentTurn === localPlayerId;
        const canPlay = state.status === 'playing' && myPlayer.status !== 'packed' && myPlayer.status !== 'spectating';
        ui.actionButtonsContainer.style.visibility = canPlay ? 'visible' : 'hidden';
        if (!canPlay) return;

        Object.values(ui.actionButtons).forEach(btn => btn.disabled = !isMyTurn);
        if (isMyTurn) {
            ui.actionButtons.see.disabled = myPlayer.status !== 'blind';
            const activePlayersCount = Object.values(state.players).filter(p => p.status !== 'packed' && p.status !== 'spectating').length;
            ui.actionButtons.show.disabled = (activePlayersCount > 2);
            const stake = myPlayer.status === 'seen' ? (state.currentStake * 2) : state.currentStake;
            ui.actionButtons.chaal.textContent = `Chaal (₹${stake})`;
            ui.actionButtons.chaal.disabled = myPlayer.balance < stake;
        }
    }
    
    // --- VOICE CHAT FUNCTIONS ---
    async function joinVoiceChannel() {
        if (!currentTableId || isVoiceJoined) return;
        try {
            agoraVoiceClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
            agoraVoiceClient.on("user-published", async (user, mediaType) => {
                await agoraVoiceClient.subscribe(user, mediaType);
                if (mediaType === "audio") user.audioTrack.play();
            });
            await agoraVoiceClient.join(AGORA_APP_ID, currentTableId, null, localPlayerId);
            localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
            await agoraVoiceClient.publish([localAudioTrack]);
            isVoiceJoined = true;
            ui.voiceToggleButton.textContent = "Voice OFF 🔇";
            ui.voiceToggleButton.classList.add('active');
        } catch (error) { console.error("Agora Join Error:", error); }
    }

    async function leaveVoiceChannel(isPermanent = false) {
        if (!isVoiceJoined) return;
        try {
            if (localAudioTrack) { localAudioTrack.stop(); localAudioTrack.close(); localAudioTrack = null; }
            if (agoraVoiceClient) await agoraVoiceClient.leave();
        } catch (error) { console.error("Agora Leave Error:", error); }
        finally {
            isVoiceJoined = false;
            ui.voiceToggleButton.textContent = "Voice ON 🎤";
            ui.voiceToggleButton.classList.remove('active');
            if (isPermanent) currentTableId = null;
        }
    }

    ui.voiceToggleButton.addEventListener('click', () => {
        if (isVoiceJoined) leaveVoiceChannel(false); 
        else joinVoiceChannel();
    });

    // --- CHAT FUNCTIONS ---
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
            const chatRef = currentTableRef.child('chat').limitToLast(15);
            ui.chatMessages.innerHTML = ''; 
            chatRef.on('child_added', snapshot => {
                const msg = snapshot.val();
                const msgDiv = document.createElement('div');
                msgDiv.innerHTML = `<strong>${msg.sender}:</strong> ${msg.text}`;
                ui.chatMessages.appendChild(msgDiv);
                ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
            });
        }
    }

    // --- ACTION BUTTON LISTENERS ---
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
    ui.actionButtons.see.onclick = () => performAction(state => { state.players[localPlayerId].status = 'seen'; state.message = `${localPlayerName} has seen cards.`; });
    ui.actionButtons.chaal.onclick = () => performAction(state => {
        const myPlayer = state.players[localPlayerId];
        const stake = myPlayer.status === 'seen' ? (currentGameState.currentStake * 2) : currentGameState.currentStake;
        myPlayer.balance -= stake;
        state.pot += stake;
        state.currentStake = myPlayer.status === 'blind' ? stake : stake / 2;
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

    // --- GAME LOGIC FUNCTIONS ---
    function handleAutoStart(state) {
        if(autoStartTimer) clearTimeout(autoStartTimer);
        const hostId = Object.keys(state.players)[0];
        if (localPlayerId !== hostId) return;
        if ((state.status === 'waiting' || state.status === 'showdown') && Object.keys(state.players).length >= 2) {
            autoStartTimer = setTimeout(() => performAction(startGame), GAME_START_DELAY);
        }
    }
    function startGame(s){s.status="playing",s.pot=0,s.deck=createDeck(),s.message="New round!",Object.values(s.players).forEach(p=>{p.balance>=BOOT_AMOUNT?(p.balance-=BOOT_AMOUNT,s.pot+=BOOT_AMOUNT,p.cards=[s.deck.pop(),s.deck.pop(),s.deck.pop()],p.status="blind",p.hand=getHandDetails(p.cards)):p.status="spectating"}),s.currentStake=BOOT_AMOUNT,s.currentTurn=Object.keys(s.players).find(p=>"blind"===s.players[p].status)}
    function moveToNextPlayer(s){const p=Object.keys(s.players).sort();let t=p.indexOf(s.currentTurn);if(-1===t)return;for(let o=0;o<p.length;o++){t=(t+1)%p.length;const a=p[t];if("packed"!==s.players[a]?.status&&"spectating"!==s.players[a]?.status)return void(s.currentTurn=a)}}
    function checkForWinner(s){const p=Object.values(s.players).filter(p=>"packed"!==p.status&&"spectating"!==p.status);if(p.length<=1){distributePot(p[0]?.id,s);return true}return false}
    function endGame(s){const p=Object.values(s.players).filter(p=>"packed"!==p.status&&"spectating"!==p.status);if(p.length<1){s.status="showdown",s.message="No active players.";return}const t=p.reduce((s,p)=>compareHands(s.hand,p.hand)>=0?s:p);distributePot(t.id,s)}
    function distributePot(s,p){if(s){const t=p.players[s];t.balance+=p.pot;p.message=`🎉 ${t.name} wins ₹${p.pot}!`}p.status="showdown"}
    function createDeck(){const s="♠♥♦♣",r="23456789TJQKA",d=[];for(const t of s)for(const o of r)d.push(o+t);return d.sort(()=>.5-Math.random())}
    function getHandDetails(c){if(!c||c.length!==3)return{rank:1,name:"Invalid",values:[]};const o="23456789TJQKA",p=c.map(e=>({rank:o.indexOf(e[0]),suit:e[1]})).sort((a,b)=>b.rank-a.rank),v=p.map(e=>e.rank),s=p.map(e=>e.suit),l=s[0]===s[1]&&s[1]===s[2],t=v.includes(12)&&v.includes(1)&&v.includes(0),q=v[0]-1===v[1]&&v[1]-1===v[2],u=q||t,n=v[0]===v[1]&&v[1]===v[2];let a=-1;v[0]===v[1]||v[1]===v[2]?a=v[1]:v[0]===v[2]&&(a=v[0]);const i=a!==-1,d=t?[12,1,0].sort((e,r)=>r-e):v;return n?{rank:7,name:"Trail",values:d}:l&&u?{rank:6,name:"Pure Seq",values:d}:u?{rank:5,name:"Sequence",values:d}:l?{rank:4,name:"Color",values:d}:i?{rank:3,name:"Pair",values:function(e,r){const t=e.find(t=>t!==r);return[r,r,t]}(v,a)}:{rank:2,name:"High Card",values:d}}
    function compareHands(a,b){if(a.rank!==b.rank)return a.rank-b.rank;for(let e=0;e<a.values.length;e++)if(a.values[e]!==b.values[e])return a.values[e]-b.values[e];return 0}
});
                          
