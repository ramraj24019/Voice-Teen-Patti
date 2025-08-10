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
      storageBucket: "desi-teen-patti-c4639.appspot.com",
      messagingSenderId: "1007516567686",
      appId: "1:1007516567686:web:072f4172bda32d881de907"
    };
    const AGORA_APP_ID = "f33cf29d42264f55b5130f61686e77a2";
    const DB_ROOT_PATH = 'teenpatti-no-bot';
    const MAX_PLAYERS_PER_TABLE = 4;
    const GAME_START_DELAY = 5000;
    const BOOT_AMOUNT = 10;
    const HAND_RANKS = { TRAIL: 7, PURE_SEQ: 6, SEQ: 5, COLOR: 4, PAIR: 3, HIGH_CARD: 2 };

    // --- INITIALIZATION ---
    firebase.initializeApp(firebaseConfig);
    const database = firebase.database();
    const storage = firebase.storage();
    const tablesRef = database.ref(`${DB_ROOT_PATH}/tables`);
    const playersDataRef = database.ref(`${DB_ROOT_PATH}/playersData`);

    // --- LOCAL STATE ---
    let localPlayerId, localPlayerName, localPhoneNumber;
    let currentTableId, currentTableRef;
    let currentGameState = {};
    let agoraVoiceClient, localAudioTrack, isVoiceJoined = false;
    let adminSeeAll = false;
    let autoStartTimer;

    // --- UI ELEMENTS ---
    const ui = {
        loginScreen: document.getElementById('login-screen'),
        gameScreen: document.getElementById('game-screen'),
        phoneNumberInput: document.getElementById('phone-number-input'),
        joinGameBtn: document.getElementById('join-game-btn'),
        playersContainer: document.getElementById('players-container'),
        potArea: document.getElementById('pot-area'),
        gameMessage: document.getElementById('game-message'),
        profilePopup: document.getElementById('profile-popup'),
        profileNameInput: document.getElementById('profile-name-input'),
        uploadAvatarInput: document.getElementById('upload-avatar-input'),
        saveProfileBtn: document.getElementById('save-profile-btn'),
        closePopupBtn: document.getElementById('close-popup-btn'),
        voiceToggleButton: document.getElementById('btn-voice-toggle'),
        chatInput: document.getElementById('chat-input'),
        chatMessages: document.getElementById('chat-messages'),
        actionButtonsContainer: document.getElementById('action-buttons-container'),
        actionButtons: { pack: document.getElementById('btn-pack'), see: document.getElementById('btn-see'), sideshow: document.getElementById('btn-sideshow'), chaal: document.getElementById('btn-chaal'), show: document.getElementById('btn-show') },
        adminPanel: document.getElementById('admin-panel')
    };

    // --- SIMPLE LOGIN FLOW ---
    ui.joinGameBtn.onclick = () => {
        const phone = ui.phoneNumberInput.value.trim();
        if (phone.length !== 10 || !/^\d+$/.test(phone)) {
            alert("Please enter a valid 10-digit number.");
            return;
        }
        localPhoneNumber = phone;
        
        playersDataRef.child(localPhoneNumber).get().then(snapshot => {
            if (snapshot.exists()) {
                const playerData = snapshot.val();
                localPlayerId = playerData.id;
                localPlayerName = playerData.name;
                findAndJoinTable();
            } else {
                localPlayerId = `player_${Date.now()}`;
                localPlayerName = `Player${phone.slice(-4)}`; // Default name
                playersDataRef.child(localPhoneNumber).set({
                    id: localPlayerId,
                    name: localPlayerName,
                    avatarUrl: 'default_avatar.png'
                }).then(findAndJoinTable);
            }
        });
    };

    // --- CORE GAME LOGIC ---
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
        tablesRef.child(newTableId).set({
            id: newTableId, status: 'waiting', players: {}, pot: 0, message: 'Waiting...'
        }).then(() => joinTable(newTableId));
    }

    async function joinTable(tableId) {
        currentTableId = tableId;
        currentTableRef = tablesRef.child(tableId);
        const playerRef = currentTableRef.child('players').child(localPlayerId);
        const permanentPlayerData = (await playersDataRef.child(localPhoneNumber).get()).val();
        
        const playerObjectForTable = {
            id: localPlayerId, name: localPlayerName, balance: 1000,
            status: 'online', is_admin: localPlayerName.toLowerCase() === 'vj',
            avatarUrl: permanentPlayerData.avatarUrl
        };

        playerRef.set(playerObjectForTable);
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
        currentTableId = null;
        currentTableRef = null;
    }
    
    // --- UI FUNCTIONS ---
    function showScreen(screenName) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(`${screenName}-screen`).classList.add('active');
    }

    function renderGameUI(state) {
        renderPlayers(state);
        document.getElementById('pot-area').textContent = `Pot: ₹${state.pot || 0}`;
        document.getElementById('game-message').textContent = state.message || '...';
        if (state.players[localPlayerId]) {
            ui.adminPanel.style.display = state.players[localPlayerId].is_admin ? 'flex' : 'none';
        }
        updateActionButtons(state);
    }

    function renderPlayers(state) {
        const container = document.getElementById('players-container');
        container.innerHTML = '';
        Object.values(state.players).forEach((player, index) => {
            const slot = document.createElement('div');
            slot.className = 'player-slot';
            slot.dataset.playerId = player.id;
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
                <div class="player-avatar" style="background-image: url('${player.avatarUrl || 'default_avatar.png'}')"></div>
                <div class="player-name">${player.name}${isMe ? ' (You)' : ''}</div>
                <div class="player-balance">₹${player.balance}</div>
                <div class="player-status">${player.status}</div>
                <div class="player-cards">${cardsHTML}</div>`;
            if (state.currentTurn === player.id) slot.classList.add('current-turn');
            container.appendChild(slot);
        });
        attachAvatarClickListener();
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
    
    // --- VOICE CHAT ---
    ui.voiceToggleButton.onclick = () => {
        if (isVoiceJoined) leaveVoiceChannel();
        else joinVoiceChannel();
    };
    
    async function joinVoiceChannel() {
        if (!currentTableId || isVoiceJoined) return;
        try {
            agoraVoiceClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
            agoraVoiceClient.on("user-published", async (u,t) => { await agoraVoiceClient.subscribe(u,t); if(t==="audio") u.audioTrack.play(); });
            await agoraVoiceClient.join(AGORA_APP_ID, currentTableId, null, localPlayerId);
            localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
            await agoraVoiceClient.publish([localAudioTrack]);
            isVoiceJoined = true;
            ui.voiceToggleButton.textContent = "Voice OFF 🔇";
        } catch (e) { console.error("Agora Join Error:", e); }
    }

    async function leaveVoiceChannel(isPermanent = false) {
        if (!isVoiceJoined) return;
        try {
            localAudioTrack?.close();
            await agoraVoiceClient?.leave();
        } catch (e) { console.error("Agora Leave Error:", e); }
        finally {
            isVoiceJoined = false;
            ui.voiceToggleButton.textContent = "Voice ON 🎤";
            if (isPermanent) currentTableId = null;
        }
    }
    
    // --- PROFILE AND AVATAR LOGIC ---
    function attachAvatarClickListener() {
        const mySlot = document.querySelector(`.player-slot[data-player-id="${localPlayerId}"]`);
        mySlot?.querySelector('.player-avatar')?.addEventListener('click', () => {
            ui.profileNameInput.value = localPlayerName;
            ui.profilePopup.classList.add('active');
        });
    }

    ui.closePopupBtn.onclick = () => ui.profilePopup.classList.remove('active');
    
    ui.saveProfileBtn.onclick = () => {
        const newName = ui.profileNameInput.value.trim();
        if (newName && newName !== localPlayerName) {
            localPlayerName = newName;
            playersDataRef.child(localPhoneNumber).update({ name: newName });
            currentTableRef?.child('players').child(localPlayerId).update({ name: newName });
        }
        ui.profilePopup.classList.remove('active');
    };

    ui.uploadAvatarInput.onchange = (event) => {
        const file = event.target.files[0];
        if (!file || !file.type.startsWith('image/')) return;
        
        ui.gameMessage.textContent = "Uploading image...";
        const avatarRef = storage.ref(`avatars/${localPhoneNumber}`);
        avatarRef.put(file).then(() => {
            avatarRef.getDownloadURL().then(url => {
                playersDataRef.child(localPhoneNumber).update({ avatarUrl: url });
                currentTableRef?.child('players').child(localPlayerId).update({ avatarUrl: url });
                ui.gameMessage.textContent = "Profile updated!";
            });
        }).catch(err => {
            console.error("Upload error:", err);
            ui.gameMessage.textContent = "Upload failed.";
        });
        ui.profilePopup.classList.remove('active');
    };

    // --- CHAT AND ACTIONS ---
    function performAction(actionFunc) {
        const stateCopy = JSON.parse(JSON.stringify(currentGameState));
        actionFunc(stateCopy);
        currentTableRef.set(stateCopy);
    }
    
    // ... (All action button listeners: pack, see, chaal, show, sideshow)

    // --- GAME LOGIC ---
    function handleAutoStart(state) {
        if(autoStartTimer) clearTimeout(autoStartTimer);
        const hostId = Object.keys(state.players)[0];
        if (localPlayerId !== hostId) return;
        if ((state.status === 'waiting' || state.status === 'showdown') && Object.keys(state.players).length >= 2) {
            autoStartTimer = setTimeout(() => performAction(startGame), GAME_START_DELAY);
        }
    }
    
    // --- UTILITY FUNCTIONS ---
    // ... (All utility functions: createDeck, getHandDetails, compareHands, etc.)
});
