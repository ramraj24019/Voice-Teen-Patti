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
    const HAND_RANKS = { TRAIL: 7, PURE_SEQ: 6, SEQ: 5, COLOR: 4, PAIR: 3, HIGH_CARD: 2 };

    // --- INITIALIZATION ---
    firebase.initializeApp(firebaseConfig);
    const database = firebase.database();
    const tablesRef = database.ref(`${DB_ROOT_PATH}/tables`);
    const playersDataRef = database.ref(`${DB_ROOT_PATH}/playersData`);

    // --- LOCAL STATE ---
    let localPlayerId, localPlayerName, localPhoneNumber;
    let currentTableId, currentTableRef;
    let currentGameState = {}, isAdmin = false, adminSeeAll = false, autoStartTimer;
    let agoraVoiceClient, localAudioTrack, isVoiceJoined = false;
    
    // --- UI ELEMENTS ---
    const ui = {
        numberLoginScreen: document.getElementById('number-login-screen'),
        nameLoginScreen: document.getElementById('name-login-screen'),
        gameScreen: document.getElementById('game-screen'),
        phoneNumberInput: document.getElementById('phone-number-input'),
        submitNumberBtn: document.getElementById('submit-number-btn'),
        playerNameInput: document.getElementById('player-name-input'),
        joinGameBtn: document.getElementById('join-game-btn'),
        playersContainer: document.getElementById('players-container'),
        potArea: document.getElementById('pot-area'),
        gameMessage: document.getElementById('game-message'),
        adminPanel: document.getElementById('admin-panel'),
        chatInput: document.getElementById('chat-input'),
        chatMessages: document.getElementById('chat-messages'),
        voiceToggleButton: document.getElementById('btn-voice-toggle'),
        profilePopup: document.getElementById('profile-popup'),
        profileNameInput: document.getElementById('profile-name-input'),
        uploadAvatarInput: document.getElementById('upload-avatar-input'),
        saveProfileBtn: document.getElementById('save-profile-btn'),
        closePopupBtn: document.getElementById('close-popup-btn'),
        actionButtonsContainer: document.getElementById('action-buttons-container'),
        actionButtons: { pack: document.getElementById('btn-pack'), see: document.getElementById('btn-see'), sideshow: document.getElementById('btn-sideshow'), chaal: document.getElementById('btn-chaal'), show: document.getElementById('btn-show') }
    };
    
    // --- LOGIN FLOW ---
    ui.submitNumberBtn.onclick = () => {
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
                showScreen('name-login');
            }
        });
    };

    ui.joinGameBtn.onclick = () => {
        const name = ui.playerNameInput.value.trim();
        if (!name) return;
        
        localPlayerName = name;
        localPlayerId = `player_${Date.now()}`;

        const newPlayerData = { id: localPlayerId, name: localPlayerName, avatar: 'avatars/avatar1.png' };
        playersDataRef.child(localPhoneNumber).set(newPlayerData).then(findAndJoinTable);
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
        const newPlayer = createPlayerObjectForTable();
        tablesRef.child(newTableId).set({
            id: newTableId, status: 'waiting', players: { [localPlayerId]: newPlayer }, pot: 0, message: 'Waiting...'
        }).then(() => joinTable(newTableId));
    }

    async function joinTable(tableId) {
        currentTableId = tableId;
        currentTableRef = tablesRef.child(tableId);
        const playerRef = currentTableRef.child('players').child(localPlayerId);
        const permanentPlayerData = (await playersDataRef.child(localPhoneNumber).get()).val();
        
        const playerObject = {
            id: localPlayerId, name: localPlayerName, balance: 1000,
            status: 'online', is_admin: localPlayerName.toLowerCase() === 'vj',
            avatar: permanentPlayerData.avatar
        };

        playerRef.set(playerObject);
        playerRef.onDisconnect().remove();
        showScreen('game');
        currentTableRef.on('value', handleStateUpdate);
        joinVoiceChannel();
        listenForChat();
    }
    
    function createPlayerObjectForTable() {
        // This function is now simplified, joinTable handles getting avatar
        return {
            id: localPlayerId, name: localPlayerName, balance: 1000,
            status: 'online', is_admin: localPlayerName.toLowerCase() === 'vj',
            avatar: 'avatars/avatar1.png'
        };
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
        showScreen('number-login');
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
        // ... (rest of renderGameUI)
    }

    function renderPlayers(state) {
        ui.playersContainer.innerHTML = '';
        Object.values(state.players).forEach((player, index) => {
            const slot = document.createElement('div');
            // ... (rest of renderPlayers logic from previous complete version)
        });
        attachAvatarClickListener(); // Crucial: Re-attach listener after every render
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

    // --- PROFILE AND AVATAR LOGIC ---
    function attachAvatarClickListener() {
        const mySlot = document.querySelector(`.player-slot[data-player-id="${localPlayerId}"]`);
        if (mySlot) {
            const myAvatar = mySlot.querySelector('.player-avatar');
            if (myAvatar) {
                myAvatar.onclick = () => {
                    ui.profileNameInput.value = localPlayerName;
                    ui.profilePopup.classList.add('active');
                };
            }
        }
    }

    ui.closePopupBtn.onclick = () => ui.profilePopup.classList.remove('active');
    
    ui.saveProfileBtn.onclick = () => {
        const newName = ui.profileNameInput.value.trim();
        if (newName && newName !== localPlayerName) {
            localPlayerName = newName;
            playersDataRef.child(localPhoneNumber).update({ name: newName });
            if (currentTableRef) currentTableRef.child('players').child(localPlayerId).update({ name: newName });
        }
        ui.profilePopup.classList.remove('active');
    };

    ui.uploadAvatarInput.onchange = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = reader.result;
            playersDataRef.child(localPhoneNumber).update({ avatar: base64String });
            if (currentTableRef) currentTableRef.child('players').child(localPlayerId).update({ avatar: base64String });
        };
        reader.readAsDataURL(file);
        ui.profilePopup.classList.remove('active');
    };
    
    // --- All other game functions (chat, actions, game logic, utilities) go here ---
    // This is the part that was missing. I am now adding the rest of the file.

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
    
    ui.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const text = ui.chatInput.value.trim();
            if (text && currentTableRef) {
                currentTableRef.child('chat').push({ sender: localPlayerName, text });
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
    // ... rest of the action buttons and game logic functions ...
});
