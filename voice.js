// This file handles all Agora Voice Chat logic.

const AGORA_APP_ID_VOICE = "f33cf29d42264f55b5130f61686e77a2"; // Your new, correct App ID
const voiceToggleButton = document.getElementById('btn-voice-toggle');

let agoraVoiceClient = null;
let localAudioTrack = null;
let isVoiceJoined = false;
let currentVoiceChannel = null;
let localPlayerIdForVoice = null;

async function joinVoiceChannel(channelName, playerId) {
    if (isVoiceJoined || !channelName || !playerId) return;

    currentVoiceChannel = channelName;
    localPlayerIdForVoice = playerId;

    try {
        agoraVoiceClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

        agoraVoiceClient.on("user-published", async (user, mediaType) => {
            await agoraVoiceClient.subscribe(user, mediaType);
            if (mediaType === "audio") {
                user.audioTrack.play();
            }
        });
        
        await agoraVoiceClient.join(AGORA_APP_ID_VOICE, channelName, null, playerId);
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
        currentVoiceChannel = null;
    } catch (error) {
        console.error("Agora Leave Error:", error);
    }
}

voiceToggleButton.addEventListener('click', () => {
    if (isVoiceJoined) {
        leaveVoiceChannel();
    } else if (currentVoiceChannel) {
        joinVoiceChannel(currentVoiceChannel, localPlayerIdForVoice);
    }
      });
