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
        state.currentStake = myPlayer.status === 'blind' ? state.currentStake : stake / 2;
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
        
        if (!opponent || myPlayer.status !== 'seen' || opponent.status !== 'seen') {
            state.message = "Side show is not possible.";
            return;
        }

        const result = compareHands(myPlayer.hand, opponent.hand);
        const loser = result >= 0 ? opponent : myPlayer;
        const winner = result >= 0 ? myPlayer : opponent;
        
        loser.status = 'packed';
        state.message = `Side show: ${winner.name} won against ${loser.name}`;
        if (!checkForWinner(state)) moveToNextPlayer(state);
    });
}
