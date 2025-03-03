'use strict';
const fetchJsonFile = await fetch('./api.json');
const DID_API = await fetchJsonFile.json();

if (DID_API.key == '🤫') alert('Please put your api key inside ./api.json and restart..');

const RTCPeerConnection = (
  window.RTCPeerConnection ||
  window.webkitRTCPeerConnection ||
  window.mozRTCPeerConnection
).bind(window);

let peerConnection;
let streamId;
let sessionId;
let sessionClientAnswer;
let statsIntervalId;
let videoIsPlaying;
let lastBytesReceived;
let agentId;
let chatId;

const videoElement = document.getElementById('video-element');
videoElement.setAttribute('playsinline', '');
const peerStatusLabel = document.getElementById('peer-status-label');
const iceStatusLabel = document.getElementById('ice-status-label');
const iceGatheringStatusLabel = document.getElementById('ice-gathering-status-label');
const signalingStatusLabel = document.getElementById('signaling-status-label');
const streamingStatusLabel = document.getElementById('streaming-status-label');
const agentIdLabel = document.getElementById('agentId-label');
const chatIdLabel = document.getElementById('chatId-label');
const textArea = document.getElementById('textArea');

// Play the idle video when the page is loaded
window.onload = (event) => {
  playIdleVideo();

  if (agentId == '' || agentId == undefined) {
    console.log(
      "Empty 'agentID' and 'chatID' variables\n\n1. Click on the 'Create new Agent with Knowledge' button\n2. Open the Console and wait for the process to complete\n3. Press on the 'Connect' button\n4. Type and send a message to the chat\nNOTE: You can store the created 'agentID' and 'chatId' variables at the bottom of the JS file for future chats"
    );
  } else {
    console.log(
      "You are good to go!\nClick on the 'Connect Button', Then send a new message\nAgent ID: ",
      agentId,
      '\nChat ID: ',
      chatId
    );
    agentIdLabel.innerHTML = agentId;
    chatIdLabel.innerHTML = chatId;
  }
};
async function createPeerConnection(offer, iceServers) {
  if (!peerConnection) {
    peerConnection = new RTCPeerConnection({ iceServers });
    peerConnection.addEventListener('icegatheringstatechange', onIceGatheringStateChange, true);
    peerConnection.addEventListener('icecandidate', onIceCandidate, true);
    peerConnection.addEventListener('iceconnectionstatechange', onIceConnectionStateChange, true);
    peerConnection.addEventListener('connectionstatechange', onConnectionStateChange, true);
    peerConnection.addEventListener('signalingstatechange', onSignalingStateChange, true);
    peerConnection.addEventListener('track', onTrack, true);
  }

  await peerConnection.setRemoteDescription(offer);
  console.log('set remote sdp OK');

  const sessionClientAnswer = await peerConnection.createAnswer();
  console.log('create local sdp OK');

  await peerConnection.setLocalDescription(sessionClientAnswer);
  console.log('set local sdp OK');

  // Data Channel creation (for dispalying the Agent's responses as text)
  let dc = await peerConnection.createDataChannel('JanusDataChannel');
  dc.onopen = () => {
    console.log('datachannel open');
  };

  let decodedMsg;
  // Agent Text Responses - Decoding the responses, pasting to the HTML element
  dc.onmessage = (event) => {
    let msg = event.data;
    let msgType = 'chat/answer:';
    if (msg.includes(msgType)) {
      msg = decodeURIComponent(msg.replace(msgType, ''));
      console.log('Full agent response:', msg);
      try {
        // Try to parse the response as JSON to see if it contains knowledge base citations
        const parsedMsg = JSON.parse(msg);
        if (parsedMsg.citations) {
          console.log('Knowledge base citations:', parsedMsg.citations);
        }
      } catch (e) {
        // If parsing fails, it's just a plain text response
        console.log('Plain text response (no citations detected)');
      }
      decodedMsg = msg;
      return decodedMsg;
    }
    if (msg.includes('stream/started')) {
      console.log(msg);
      document.getElementById('msgHistory').innerHTML += `<span>${decodedMsg}</span><br><br>`;
    } else {
      console.log(msg);
    }
  };

  dc.onclose = () => {
    console.log('datachannel close');
  };

  return sessionClientAnswer;
}
function onIceGatheringStateChange() {
  iceGatheringStatusLabel.innerText = peerConnection.iceGatheringState;
  iceGatheringStatusLabel.className = 'iceGatheringState-' + peerConnection.iceGatheringState;
}
function onIceCandidate(event) {
  if (event.candidate) {
    const { candidate, sdpMid, sdpMLineIndex } = event.candidate;

    // WEBRTC API CALL 3 - Submit network information
    fetch(`${DID_API.url}/${DID_API.service}/streams/${streamId}/ice`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${DID_API.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        candidate,
        sdpMid,
        sdpMLineIndex,
        session_id: sessionId,
      }),
    });
  }
}
function onIceConnectionStateChange() {
  iceStatusLabel.innerText = peerConnection.iceConnectionState;
  iceStatusLabel.className = 'iceConnectionState-' + peerConnection.iceConnectionState;
  if (peerConnection.iceConnectionState === 'failed' || peerConnection.iceConnectionState === 'closed') {
    stopAllStreams();
    closePC();
  }
}
function onConnectionStateChange() {
  // not supported in firefox
  peerStatusLabel.innerText = peerConnection.connectionState;
  peerStatusLabel.className = 'peerConnectionState-' + peerConnection.connectionState;
}
function onSignalingStateChange() {
  signalingStatusLabel.innerText = peerConnection.signalingState;
  signalingStatusLabel.className = 'signalingState-' + peerConnection.signalingState;
}
function onVideoStatusChange(videoIsPlaying, stream) {
  let status;
  if (videoIsPlaying) {
    status = 'streaming';

    const remoteStream = stream;
    setVideoElement(remoteStream);
  } else {
    status = 'empty';
    playIdleVideo();
  }
  streamingStatusLabel.innerText = status;
  streamingStatusLabel.className = 'streamingState-' + status;
}
function onTrack(event) {
  /**
   * The following code is designed to provide information about wether currently there is data
   * that's being streamed - It does so by periodically looking for changes in total stream data size
   *
   * This information in our case is used in order to show idle video while no video is streaming.
   * To create this idle video use the POST https://api.d-id.com/talks (or clips) endpoint with a silent audio file or a text script with only ssml breaks
   * https://docs.aws.amazon.com/polly/latest/dg/supportedtags.html#break-tag
   * for seamless results use `config.fluent: true` and provide the same configuration as the streaming video
   */

  if (!event.track) return;

  statsIntervalId = setInterval(async () => {
    const stats = await peerConnection.getStats(event.track);
    stats.forEach((report) => {
      if (report.type === 'inbound-rtp' && report.kind === 'video') {
        const videoStatusChanged = videoIsPlaying !== report.bytesReceived > lastBytesReceived;

        if (videoStatusChanged) {
          videoIsPlaying = report.bytesReceived > lastBytesReceived;
          onVideoStatusChange(videoIsPlaying, event.streams[0]);
        }
        lastBytesReceived = report.bytesReceived;
      }
    });
  }, 500);
}
function setVideoElement(stream) {
  if (!stream) return;
  // Add Animation Class
  videoElement.classList.add('animated');

  // Removing browsers' autoplay's 'Mute' Requirement
  videoElement.muted = false;

  videoElement.srcObject = stream;
  videoElement.loop = false;

  // Remove Animation Class after it's completed
  setTimeout(() => {
    videoElement.classList.remove('animated');
  }, 1000);

  // safari hotfix
  if (videoElement.paused) {
    videoElement
      .play()
      .then((_) => {})
      .catch((e) => {});
  }
}
function playIdleVideo() {
  // Add Animation Class
  videoElement.classList.toggle('animated');

  videoElement.srcObject = undefined;
  videoElement.src = 'emma_idle.mp4';
  videoElement.loop = true;

  // Remove Animation Class after it's completed
  setTimeout(() => {
    videoElement.classList.remove('animated');
  }, 1000);
}
function stopAllStreams() {
  if (videoElement.srcObject) {
    console.log('stopping video streams');
    videoElement.srcObject.getTracks().forEach((track) => track.stop());
    videoElement.srcObject = null;
  }
}
function closePC(pc = peerConnection) {
  if (!pc) return;
  console.log('stopping peer connection');
  pc.close();
  pc.removeEventListener('icegatheringstatechange', onIceGatheringStateChange, true);
  pc.removeEventListener('icecandidate', onIceCandidate, true);
  pc.removeEventListener('iceconnectionstatechange', onIceConnectionStateChange, true);
  pc.removeEventListener('connectionstatechange', onConnectionStateChange, true);
  pc.removeEventListener('signalingstatechange', onSignalingStateChange, true);
  pc.removeEventListener('track', onTrack, true);
  clearInterval(statsIntervalId);
  iceGatheringStatusLabel.innerText = '';
  signalingStatusLabel.innerText = '';
  iceStatusLabel.innerText = '';
  peerStatusLabel.innerText = '';
  console.log('stopped peer connection');
  if (pc === peerConnection) {
    peerConnection = null;
  }
}
const maxRetryCount = 3;
const maxDelaySec = 4;
async function fetchWithRetries(url, options, retries = 1) {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (retries <= maxRetryCount) {
      const delay = Math.min(Math.pow(2, retries) / 4 + Math.random(), maxDelaySec) * 1000;

      await new Promise((resolve) => setTimeout(resolve, delay));

      console.log(`Request failed, retrying ${retries}/${maxRetryCount}. Error ${err}`);
      return fetchWithRetries(url, options, retries + 1);
    } else {
      throw new Error(`Max retries exceeded. error: ${err}`);
    }
  }
}

const connectButton = document.getElementById('connect-button');
connectButton.onclick = async () => {
  if (agentId == '' || agentId === undefined) {
    return alert(
      "1. Click on the 'Create new Agent with Knowledge' button\n2. Open the Console and wait for the process to complete\n3. Press on the 'Connect' button\n4. Type and send a message to the chat\nNOTE: You can store the created 'agentID' and 'chatId' variables at the bottom of the JS file for future chats"
    );
  }

  if (peerConnection && peerConnection.connectionState === 'connected') {
    return;
  }
  stopAllStreams();
  closePC();

  // WEBRTC API CALL 1 - Create a new stream
  const sessionResponse = await fetchWithRetries(`${DID_API.url}/${DID_API.service}/streams`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${DID_API.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source_url: 'https://create-images-results.d-id.com/DefaultPresenters/Emma_f/v1_image.jpeg',
    }),
  });

  const { id: newStreamId, offer, ice_servers: iceServers, session_id: newSessionId } = await sessionResponse.json();
  streamId = newStreamId;
  sessionId = newSessionId;
  try {
    sessionClientAnswer = await createPeerConnection(offer, iceServers);
  } catch (e) {
    console.log('error during streaming setup', e);
    stopAllStreams();
    closePC();
    return;
  }

  // WEBRTC API CALL 2 - Start a stream
  const sdpResponse = await fetch(`${DID_API.url}/${DID_API.service}/streams/${streamId}/sdp`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${DID_API.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      answer: sessionClientAnswer,
      session_id: sessionId,
    }),
  });
};

const startButton = document.getElementById('start-button');
startButton.onclick = async () => {
  // connectionState not supported in firefox
  if (peerConnection?.signalingState === 'stable' || peerConnection?.iceConnectionState === 'connected') {
    // Pasting the user's message to the Chat History element
    document.getElementById(
      'msgHistory'
    ).innerHTML += `<span style='opacity:0.5'><u>User:</u> ${textArea.value}</span><br>`;

    // Storing the Text Area value
    let txtAreaValue = document.getElementById('textArea').value;

    // Clearing the text-box element
    document.getElementById('textArea').value = '';

    // Agents Overview - Step 3: Send a Message to a Chat session - Send a message to a Chat
    const playResponse = await fetchWithRetries(`${DID_API.url}/agents/${agentId}/chat/${chatId}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${DID_API.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        streamId: streamId,
        sessionId: sessionId,
        messages: [
          {
            role: 'user',
            content: txtAreaValue,
            created_at: new Date().toString(),
          },
        ],
      }),
    });
    const playResponseData = await playResponse.json();
    if (playResponse.status === 200 && playResponseData.chatMode === 'TextOnly') {
      console.log('User is out of credit, API only return text messages');
      document.getElementById(
        'msgHistory'
      ).innerHTML += `<span style='opacity:0.5'> ${playResponseData.result}</span><br>`;
    }
  }
};

const destroyButton = document.getElementById('destroy-button');
destroyButton.onclick = async () => {
  await fetch(`${DID_API.url}/${DID_API.service}/streams/${streamId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Basic ${DID_API.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ session_id: sessionId }),
  });

  stopAllStreams();
  closePC();
};

// Agents API Workflow
async function agentsAPIworkflow() {
  agentIdLabel.innerHTML = `<span style='color:orange'>Processing...<style='color:orange'>`;
  chatIdLabel.innerHTML = `<span style='color:orange'>Processing...<style='color:orange'>`;
  axios.defaults.baseURL = `${DID_API.url}`;
  axios.defaults.headers.common['Authorization'] = `Basic ${DID_API.key}`;
  axios.defaults.headers.common['content-type'] = 'application/json';

  // Retry Mechanism (Polling) for this demo only - Please use Webhooks in real life applications!
  // as described in https://docs.d-id.com/reference/knowledge-overview#%EF%B8%8F-step-2-add-documents-to-the-knowledge-base
  async function retry(url, retries = 1) {
    const maxRetryCount = 10; // Increased from 5 to 10
    const maxDelaySec = 20; // Increased from 10 to 20 seconds
    try {
      let response = await axios.get(`${url}`);
      if (response.data.status == 'done') {
        return console.log(response.data.id + ': ' + response.data.status);
      } else {
        console.log(`Current status: ${response.data.status} (Attempt ${retries}/${maxRetryCount})`);
        throw new Error("Status is not 'done'");
      }
    } catch (err) {
      if (retries <= maxRetryCount) {
        const delay = Math.min(Math.pow(2, retries) / 4 + Math.random(), maxDelaySec) * 1000;

        console.log(`Waiting ${Math.round(delay/1000)} seconds before next retry...`);
        await new Promise((resolve) => setTimeout(resolve, delay));

        console.log(`Retrying ${retries}/${maxRetryCount}. ${err}`);
        return retry(url, retries + 1);
      } else {
        agentIdLabel.innerHTML = `<span style='color:red'>Failed</span>`;
        chatIdLabel.innerHTML = `<span style='color:red'>Failed</span>`;
        throw new Error(`Max retries exceeded. error: ${err}`);
      }
    }
  }

  // Knowledge Overview - Step 1: Create a new Knowledge Base
  // https://docs.d-id.com/reference/knowledge-overview#%EF%B8%8F-step-1-create-a-new-knowledge-base
  const createKnowledge = await axios.post('/knowledge', {
    name: 'knowledge',
    description: 'D-ID Agents API',
  });
  console.log('Create Knowledge:', createKnowledge.data);

  let knowledgeId = createKnowledge.data.id;
  console.log('Knowledge ID: ' + knowledgeId);

  // Knowledge Overview - Step 2: Add Documents to the Knowledge Base
  // https://docs.d-id.com/reference/knowledge-overview#%EF%B8%8F-step-2-add-documents-to-the-knowledge-base

  const createDocument = await axios.post(`/knowledge/${knowledgeId}/documents`, {
    documentType: 'text',
    source_url: 'https://docs.google.com/document/d/186EfDbCjE6AJbjYDylkR4bCK6tqlJI9R/edit?usp=sharing&ouid=113772429239220858827&rtpof=true&sd=true',
    title: 'Acolyte-1',
  });
  console.log('Create Document: ', createDocument.data);

  // Split the # to use in documentID
  let documentId = createDocument.data.id;
  let splitArr = documentId.split('#');
  documentId = splitArr[1];
  console.log('Document ID: ' + documentId);

  // Knowledge Overview - Step 3: Retrieving the Document and Knowledge status
  // https://docs.d-id.com/reference/knowledge-overview#%EF%B8%8F-step-3-retrieving-the-document-and-knowledge-status
  await retry(`https://api.d-id.com/knowledge/${knowledgeId}/documents/${documentId}`);
  //https://api.d-id.com/knowledge/knl_6nDc-Fh6eiNx2Cko95qwy/documents
  await retry(`https://api.d-id.com/knowledge/${knowledgeId}`);

  // Agents Overview - Step 1: Create an Agent
  // https://docs.d-id.com/reference/agents-overview#%EF%B8%8F-step-1-create-an-agent
  const createAgent = await axios.post('/agents', {
    knowledge: {
      provider: 'pinecone',
      embedder: {
        provider: 'azure-open-ai',
        model: 'text-embedding-ada-002',
      },
      id: knowledgeId,
    },
    presenter: {
      type: 'talk',
      voice: {
        type: 'microsoft',
        voice_id: 'en-US-JennyMultilingualV2Neural',
      },
      thumbnail: 'https://create-images-results.d-id.com/DefaultPresenters/Emma_f/v1_image.jpeg',
      source_url: 'https://create-images-results.d-id.com/DefaultPresenters/Emma_f/v1_image.jpeg',
    },
    llm: {
      type: 'openai',
      provider: 'openai',
      model: 'gpt-4o-mini',
      instructions: `This Teach-Back is an activity where the user practices a skill they just learned in an online course. Refer to the course storyboard as well as the course assessment to provide you with context. This activity will be scored and should reference only the material in the uploaded documents. You may reference other material in your feedback, but the scoring should be based solely on the course content. This activity is in section 2.2 of course 103. I have outlined how the activity is structured below.

When the user clicks "begin," briefly describe the activity as a teach-back in which they'll receive personalized feedback based on their answer. Also, state the two rubric areas (Comprehensiveness and Clarity & Structure, each accounting for 4 points) and what a passing score is. Then, show the question: "Explain how drug pricing benchmarks impact pharmacy costs and reimbursement, and why this matters in pharmacy benefits consulting."

After they submit their answer, grade them based on the rubric below and show them their score in each rubric area, along with what could be improved. Continue providing guidance to refine their answer until they achieve a score of 8/8, then summarize their response into a final statement and congratulate them. Instruct them to proceed in the course.

When a user clicks "instructions," explain in detail how the activity works and highlight that they are aiming for mastery, and you will support them in achieving it. Show the full rubric and what their response should include (the 3 bullets below).

The user's response should include:

✔ A clear explanation of key drug pricing benchmarks (AWP, WAC, MAC, NADAC) and how they function.

✔ An analysis of how these benchmarks influence pharmacy costs and reimbursement structures.

✔ A connection to pharmacy benefits consulting, including how understanding benchmarks supports cost management and plan design.

Evaluation Criteria: The user's response will be scored based on the rubric below, with a total of 8 possible points. To pass, they need at least 6 points.

Scoring Rubric (8 Points Total)

Comprehensiveness

4: Clearly defines key drug pricing benchmarks, explains their role in pharmacy costs and reimbursement, and connects them to pharmacy benefits consulting.

3: Mentions key drug pricing benchmarks and cost impact but lacks a full explanation or consulting connection.

2: Provides a vague or incomplete definition of drug pricing benchmarks with little explanation of cost impact or relevance to consulting.

1: Response is unclear, incorrect, or missing key details.

Clarity & Structure

4: Explanation is clear, well-organized, and easy to follow.

3: Mostly clear but could be better structured or more concise.

2: Somewhat unclear or disorganized.

1: Hard to follow or confusing.

✅ Passing Score: 6+ out of 

Example Response: 
Drug pricing benchmarks are essential in pharmacy benefits consulting as they determine how pharmacies are reimbursed and influence overall drug costs. AWP (Average Wholesale Price) is a benchmark for estimating drug prices, though often inflated. WAC (Wholesale Acquisition Cost) is the manufacturer's list price before rebates. MAC (Maximum Allowable Cost) limits reimbursement for generics, while NADAC (National Average Drug Acquisition Cost) reflects actual pharmacy costs. Consultants use these benchmarks to negotiate pricing, optimize formulary management, and control plan costs effectively.`,
      template: 'rag-grounded',
    },
    preview_name: 'Emma',
  });
  console.log('Create Agent: ', createAgent.data);
  let agentId = createAgent.data.id;
  console.log('Agent ID: ' + agentId);

  // Agents Overview - Step 2: Create a new Chat session with the Agent
  // https://docs.d-id.com/reference/agents-overview#%EF%B8%8F-step-2-create-a-new-chat-session-with-the-agent
  const createChat = await axios.post(`/agents/${agentId}/chat`);
  console.log('Create Chat: ', createChat.data);
  let chatId = createChat.data.id;
  console.log('Chat ID: ' + chatId);

  // Agents Overview - Step 3: Send a Message to a Chat session
  // https://docs.d-id.com/reference/agents-overview#%EF%B8%8F-step-3--send-a-message-to-a-chat-session
  // The WebRTC steps are called in the functions: 'connectButton.onclick', onIceCandidate(event), 'startButton.onclick'

  console.log(
    "Create new Agent with Knowledge - DONE!\n Press on the 'Connect' button to proceed.\n Store the created 'agentID' and 'chatId' variables at the bottom of the JS file for future chats"
  );
  agentIdLabel.innerHTML = agentId;
  chatIdLabel.innerHTML = chatId;
  return { agentId: agentId, chatId: chatId };
}

const agentsButton = document.getElementById('agents-button');
agentsButton.onclick = async () => {
  try {
    const agentsIds = ({} = await agentsAPIworkflow());
    console.log(agentsIds);
    agentId = agentsIds.agentId;
    chatId = agentsIds.chatId;
    return;
  } catch (err) {
    agentIdLabel.innerHTML = `<span style='color:red'>Failed</span>`;
    chatIdLabel.innerHTML = `<span style='color:red'>Failed</span>`;
    throw new Error(err);
  }
};

// Paste Your Created Agent and Chat IDs Here:
agentId = '';
chatId = '';
