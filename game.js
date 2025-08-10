// This is the main game logic controller.
document.addEventListener('DOMContentLoaded', () => {
    if (typeof firebase === 'undefined') return;

    const firebaseConfig = { /* ... आपकी Firebase कॉन्फ़िगरेशन ... */ };
    firebase.initializeApp(firebaseConfig);
    const database = firebase.database();
    
    const DB_ROOT_PATH = 'teenpatti-no-bot';
    const globalPlayersRef = database.ref(`${DB_ROOT_PATH}/globalPlayers`);
    const tablesRef = database.ref(`${DB_ROOT_PATH}/tables`);
    
    let localPlayerId, localPlayerName, currentTableId, currentTableRef;
    let currentGameState = {}, isAdmin = false, adminSeeAll = false, autoStartTimer;

    const playerNameInput = document.getElementById('player-name-input');
    const joinGameBtn = document.getElementById('join-game-btn');
    
    joinGameBtn.onclick = () => {
        const name = playerNameInput.value.trim();
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
                const table = allTables[tableId];
                if ((table.players ? Object.keys(table.players).length : 0) < 4) {
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
        playerRef.set({ id: localPlayerId, name: localPlayerName, balance: 1000, status: 'online', is_admin: isAdmin, avatar: 'avatars/avatar1.png' });
        playerRef.onDisconnect().remove();
        globalPlayersRef.child(localPlayerId).update({ tableId });
        showScreen('game');
        currentTableRef.on('value', handleStateUpdate);
        initializeVoice(tableId, localPlayerId);
        initializeActions(performAction, () => currentGameState, () => localPlayerId);
    }
    
    function handleStateUpdate(snapshot) {
        if (!snapshot.exists() || !snapshot.val().players?.[localPlayerId]) {
            goBackToLogin(); return;
        }
        currentGameState = snapshot.val();
        renderGameUI(currentGameState, localPlayerId, adminSeeAll);
        handleAutoStart(currentGameState);
    }

    function goBackToLogin() {
        if (currentTableRef) currentTableRef.off('value', handleStateUpdate);
        leaveVoiceChannel(true);
        showScreen('login');
    }

    function handleAutoStart(state) {
        if(autoStartTimer) clearTimeout(autoStartTimer);
        const hostId = Object.keys(state.players)[0];
        if (localPlayerId !== hostId) return;
        if ((state.status === 'waiting' || state.status === 'showdown') && Object.keys(state.players).length >= 2) {
            autoStartTimer = setTimeout(() => performAction(startGame), 5000);
        }
    }

    function performAction(actionFunc) {
        const stateCopy = JSON.parse(JSON.stringify(currentGameState));
        actionFunc(stateCopy);
        currentTableRef.set(stateCopy);
    }
});

// --- UTILITY FUNCTIONS (Can be accessed by other files as they are in global scope before DOMContentLoaded finishes)
const BOOT_AMOUNT=10,HAND_RANKS={TRAIL:7,PURE_SEQ:6,SEQ:5,COLOR:4,PAIR:3,HIGH_CARD:2};
function createDeck(){const s="♠♥♦♣",r="23456789TJQKA",d=[];for(const t of s)for(const o of r)d.push(o+t);return d.sort(()=>.5-Math.random())}
function getHandDetails(c){if(!c||c.length!==3)return{rank:1,name:"Invalid",values:[]};const o="23456789TJQKA",p=c.map(e=>({rank:o.indexOf(e[0]),suit:e[1]})).sort((a,b)=>b.rank-a.rank),v=p.map(e=>e.rank),s=p.map(e=>e.suit),l=s[0]===s[1]&&s[1]===s[2],t=v.includes(12)&&v.includes(1)&&v.includes(0),q=v[0]-1===v[1]&&v[1]-1===v[2],u=q||t,n=v[0]===v[1]&&v[1]===v[2];let a=-1;v[0]===v[1]||v[1]===v[2]?a=v[1]:v[0]===v[2]&&(a=v[0]);const i=a!==-1,d=t?[12,1,0].sort((e,r)=>r-e):v;return n?{rank:7,name:"Trail",values:d}:l&&u?{rank:6,name:"Pure Seq",values:d}:u?{rank:5,name:"Sequence",values:d}:l?{rank:4,name:"Color",values:d}:i?{rank:3,name:"Pair",values:function(e,r){const t=e.find(t=>t!==r);return[r,r,t]}(v,a)}:{rank:2,name:"High Card",values:d}}
function compareHands(a,b){if(a.rank!==b.rank)return a.rank-b.rank;for(let e=0;e<a.values.length;e++)if(a.values[e]!==b.values[e])return a.values[e]-b.values[e];return 0}
function startGame(s){s.status="playing",s.pot=0,s.deck=createDeck(),s.message="New round!",Object.values(s.players).forEach(p=>{p.balance>=BOOT_AMOUNT?(p.balance-=BOOT_AMOUNT,s.pot+=BOOT_AMOUNT,p.cards=[s.deck.pop(),s.deck.pop(),s.deck.pop()],p.status="blind",p.hand=getHandDetails(p.cards)):p.status="spectating"}),s.currentStake=BOOT_AMOUNT,s.currentTurn=Object.keys(s.players).find(p=>"blind"===s.players[p].status)}
function moveToNextPlayer(s){const p=Object.keys(s.players).sort();let t=p.indexOf(s.currentTurn);if(-1===t)return;for(let o=0;o<p.length;o++){t=(t+1)%p.length;const a=p[t];if("packed"!==s.players[a]?.status&&"spectating"!==s.players[a]?.status)return void(s.currentTurn=a)}}
function checkForWinner(s){const p=Object.values(s.players).filter(p=>"packed"!==p.status&&"spectating"!==p.status);return p.length<=1?(distributePot(p[0]?.id,s),!0):!1}
function endGame(s){const p=Object.values(s.players).filter(p=>"packed"!==p.status&&"spectating"!==p.status);if(p.length<1)return s.status="showdown",void(s.message="No active players.");const t=p.reduce((s,p)=>compareHands(s.hand,p.hand)>=0?s:p);distributePot(t.id,s)}
function distributePot(s,p){if(s){const t=p.players[s];t.balance+=p.pot,p.message=`🎉 ${t.name} wins ₹${p.pot}!`}"showdown"===p.status}
