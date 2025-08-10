// This is the main game logic file for Teen Patti.

document.addEventListener('DOMContentLoaded', () => {
    // --- Pre-boot check ---
    if (typeof firebase === 'undefined') {
        alert("CRITICAL ERROR: Firebase did not load.");
        return;
    }

    // --- CONFIGURATION ---
    const firebaseConfig = { /* आपकी Firebase कॉन्फ़िगरेशन यहाँ है */ };
    
    // --- INITIALIZATION ---
    firebase.initializeApp(firebaseConfig);
    // ... (बाकी का सारा game.js का कोड जो मैंने पिछले फाइनल जवाब में दिया था, वह यहाँ आएगा)
    // ... (The rest of the game.js code from the last final response goes here)
    
    // --- `joinTable` फंक्शन में बदलाव ---
    function joinTable(tableId) {
        // ... (पुराना joinTable का कोड)
        
        // --- यह लाइन जोड़ें ---
        // Join the voice channel for this table
        joinVoiceChannel(tableId, localPlayerId); 
    }
    
    // --- `goBackToLogin` फंक्शन में बदलाव ---
    function goBackToLogin() {
        // ... (पुराना goBackToLogin का कोड)
        
        // --- यह लाइन जोड़ें ---
        // Leave the voice channel when leaving the table
        leaveVoiceChannel();
    }
    
    // --- `renderPlayers` फंक्शन में बदलाव ---
    function renderPlayers(players, status, currentTurn) {
        ui.playersContainer.innerHTML = '';
        Object.values(players).forEach((player, index) => {
            const slot = document.createElement('div');
            // ... (बाकी का renderPlayers का कोड)
            
            if (player.cards) {
                const isMe = player.id === localPlayerId;
                const shouldShowMyCards = isMe && player.status === 'seen';
                const isShowdown = status === 'showdown';
                
                cardsHTML = player.cards.map(cardStr => {
                    let cardClass = 'card';
                    // This logic determines if cards are flipped or not
                    if (shouldShowMyCards || adminSeeAll || (isShowdown && player.status !== 'packed')) {
                        cardClass += ' seen'; 
                    }
                    return `<div class="${cardClass}">
                                <div class="card-face card-back"></div>
                                <div class="card-face card-front">${cardStr}</div>
                            </div>`;
                }).join('');
            }
            
            slot.innerHTML = `
                <!-- ... (बाकी का innerHTML) ... -->
                <div class="player-cards">${cardsHTML}</div>
            `;
            // ... (बाकी का renderPlayers का कोड)
        });
    }

});
