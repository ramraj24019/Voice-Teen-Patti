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
    if (state.players[localPlayerId]) {
        ui.adminPanel.style.display = state.players[localPlayerId].is_admin ? 'flex' : 'none';
    }
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
            <div class="player-avatar" style="background-image: url('${player.avatar || 'avatars/avatar1.png'}')"></div>
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
