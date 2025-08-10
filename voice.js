// This file handles all Agora Voice Chat logic.

const AGORA_APP_ID_VOICE = "f33cf29d42264f55b5130f61686e77a2"; // Your correct App ID
const voiceToggleButton = document.getElementById('btn-voice-toggle');

let agoraVoiceClient = null;
let localAudioTrack = null;
let isVoiceJoined = false;

// These variables will store the current channel info provided by game.js
let currentVoiceChannel = null;
let localPlayerIdForVoice = null;

// This function is called by game.js to set the channel details
function initializeVoice(channelId, playerId) {
    currentVoiceChannel = channelId;
    localPlayerIdForVoice = playerId;
    // Automatically try to join voice when table is joined
    joinVoiceChannel(); 
}

async function joinVoiceChannel() {
    // We only proceed if we have a channel name and are not already connected.
    if (!currentVoiceChannel || isVoiceJoined) return;

    try {
        agoraVoiceClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

        agoraVoiceClient.on("user-published", async (user, mediaType) => {
            await agoraVoiceClient.subscribe(user, mediaType);
            if (mediaType === "audio") {
                user.audioTrack.play();
            }
        });
        
        await agoraVoiceClient.join(AGORA_APP_ID_VOICE, currentVoiceChannel, null, localPlayerIdForVoice);
        localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
        await agoraVoiceClient.publish([localAudioTrack]);

        isVoiceJoined = true;
        voiceToggleButton.textContent = "Voice OFF 🔇";
        voiceToggleButton.classList.add('active');
    } catch (error) {
        console.error("Agora Join Error:", error);
    }
}

async function leaveVoiceChannel(isPermanent = false) {
    if (!isVoiceJoined) return;

    try {
        if (localAudioTrack) {
            localAudioTrack.stop();
            localAudioTrack.close();
            localAudioTrack = null;
        }
        await agoraVoiceClient.leave();
        
    } catch (error) {
        console.error("Agora Leave Error:", error);
    } finally {
        isVoiceJoined = false;
        voiceToggleButton.textContent = "Voice ON 🎤";
        voiceToggleButton.classList.remove('active');
        
        // If leaving permanently (quitting game), forget the channel name.
        if(isPermanent) {
            currentVoiceChannel = null;
            localPlayerIdForVoice = null;
        }
    }
}

// The toggle button now works correctly
voiceToggleButton.addEventListener('click', () => {
    if (isVoiceJoined) {
        // Just leave temporarily, don't forget the channel name
        leaveVoiceChannel(false); 
    } else {
        // Rejoin using the stored channel name
        joinVoiceChannel();
    }
});
