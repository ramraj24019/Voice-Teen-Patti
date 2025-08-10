// This file handles all UI rendering and updates.
const ui = {
    loginScreen: document.getElementById('login-screen'),
    gameScreen: document.getElementById('game-screen'),
    totalPlayersCount: document.getElementById('total-players-count'),
    playersContainer: document.getElementById('players-container'),
    potArea: document.getElementById('pot-area'),
    gameMessage: document.getElementById('game-message'),
    adminPanel: document.getElementById('admin-panel'),
    actionButtonsContainer: document.getElementById('action-buttons-container'),
    actionButtons: { pack: document.getElementById('btn-pack'), see: document.getElementById('btn-see'), sideshow: document.getElementById('btn-sideshow'), chaal: document.getElementById('btn-chaal'), show: document.getElementById('btn-show') }
};

function showScreen(screenName) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`${screenName}-screen`).classList.add('active');
}

function renderGameUI(state, localPlayerId, adminSeeAll) {
    renderPlayers(state, localPlayerId, adminSeeAll);
    ui.potArea.textContent = `Pot: ₹${state.pot || 0}`;
    ui.gameMessage.textContent = state.message || '...';
    ui.adminPanel.style.display = state.players[localPlayerId].is_admin ? 'flex' : 'none';
    updateActionButtons(state, localPlayerId);
}

function renderPlayers(state, localPlayerId, adminSeeAll) {
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
            <div class="player-avatar" style="background-image: url('${player.avatar}')"></div>
            <div class="player-name">${player.name}${isMe ? ' (You)' : ''}</div>
            <div class="player-balance">₹${player.balance}</div>
            <div class="player-status">${player.status}</div>
            <div class="player-cards">${cardsHTML}</div>`;
        if (state.currentTurn === player.id) slot.classList.add('current-turn');
        ui.playersContainer.appendChild(slot);
    });
}

function updateActionButtons(state, localPlayerId) {
    const myPlayer = state.players[localPlayerId];
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
}```

---

#### **फाइल 6: `actions.js` (नई फाइल)**

```javascript
// This file handles all game action button logic.
function initializeActions(performAction, getGameState, getLocalPlayerId) {
    const actionButtons = {
        pack: document.getElementById('btn-pack'),
        see: document.getElementById('btn-see'),
        sideshow: document.getElementById('btn-sideshow'),
        chaal: document.getElementById('btn-chaal'),
        show: document.getElementById('btn-show')
    };

    actionButtons.pack.onclick = () => performAction(state => {
        state.players[getLocalPlayerId()].status = 'packed';
        state.message = `${state.players[getLocalPlayerId()].name} packed.`;
        if (!checkForWinner(state)) moveToNextPlayer(state);
    });

    actionButtons.see.onclick = () => performAction(state => {
        state.players[getLocalPlayerId()].status = 'seen';
        state.message = `${state.players[getLocalPlayerId()].name} has seen their cards.`;
    });
    
    actionButtons.chaal.onclick = () => performAction(state => {
        const myPlayer = state.players[getLocalPlayerId()];
        const stake = myPlayer.status === 'seen' ? (state.currentStake * 2) : state.currentStake;
        myPlayer.balance -= stake;
        state.pot += stake;
        state.currentStake = myPlayer.status === 'blind' ? stake : stake / 2;
        state.message = `${myPlayer.name} bets ₹${stake}.`;
        moveToNextPlayer(state);
    });

    actionButtons.show.onclick = () => performAction(endGame);
    
    actionButtons.sideshow.onclick = () => performAction(state => {
        const myPlayer = state.players[getLocalPlayerId()];
        const playerIds = Object.keys(state.players).filter(pid => state.players[pid].status !== 'packed' && state.players[pid].status !== 'spectating');
        const myIndex = playerIds.indexOf(getLocalPlayerId());
        const prevPlayerIndex = (myIndex - 1 + playerIds.length) % playerIds.length;
        const opponent = state.players[playerIds[prevPlayerIndex]];
        
        // Add more checks for sideshow validity if needed
        const result = compareHands(myPlayer.hand, opponent.hand);
        const loser = result >= 0 ? opponent : myPlayer;
        loser.status = 'packed';
        state.message = `Side show: ${myPlayer.name} won against ${opponent.name}`;
        if (!checkForWinner(state)) moveToNextPlayer(state);
    });
}
