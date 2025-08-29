import { saveResult } from './api.js';

let backend = 'wasm';
let timerId = null;                 
let timeLeft = 12;                   
let userName = '';
let userEmail = '';
let coordinateX = null;
let coordinateY = null;
let network_type = null;
let eff_type = null;
let memory_info = null;
let eye_counter = 0;
let eye_action = false;
let mouth_counter = 0;
let mouth_action = false;
let turn_counter = 0;
let yaw_action = false;
let recorder;               
let recordedChunks = [];    
let recordedBase64 = '';    
const instructionEl = document.getElementById('instruction');   
const time_counter = document.getElementById('time');   

// ✅ keep the recorder's chosen mime around so Blob matches actual recording
let recorderMime = 'video/webm';

// ✅ tiny helper to pick a supported mime (no logic changes elsewhere)
function pickSupportedMime() {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4' // Safari 17+
  ];
  if (!window.MediaRecorder || !window.MediaRecorder.isTypeSupported) return candidates[0];
  for (const m of candidates) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {}
  }
  return candidates[0];
}

document.addEventListener('DOMContentLoaded', () => {
  const savedName = localStorage.getItem('userName');
  const savedEmail = localStorage.getItem('userEmail');
  if (savedName && savedEmail) {
    showCompletionUI(savedName, savedEmail);
    userName = savedName;
    userEmail = savedEmail;
  }
});

document.addEventListener('click', (e) => {
  if (e.target.id === 'restartBtn') {
    document.getElementById('container').style.display = 'none';
    userName = e.target.dataset.name;
    userEmail = e.target.dataset.email;
    initLivenessDetection();
  }
});

function showCompletionUI(name, email) {
  const container = document.getElementById('container');
  container.innerHTML = `
    <h1>Thank you, ${name}!</h1>
    <p>Email received: <strong>${email}</strong></p>
    <p>Due to resource constraints, kindly complete the session within 12 seconds.</p>
    <button id="restartBtn" data-name="${name}" data-email="${email}">Start liveness detection</button>
  `;
}

async function initLivenessDetection() {
  const location = await requestCameraAndMaybeLocation();
  console.log(location)
  if (location){
    coordinateX = location.latitude;
    coordinateY = location.longitude;
  }
  if (navigator.connection) {
    eff_type = navigator.connection.effectiveType;
    network_type = navigator.connection.type;
  }
  if (navigator.deviceMemory) {
    memory_info = navigator.deviceMemory;
  }

  await tf.ready();
  await tf.setBackend(backend);
  console.log('TFJS Backend:', tf.getBackend());

  const video = await setupCamera();
  console.log('Camera initialized');

  const faceDetector = await initializeMediaPipe();
  const lmModel = await loadModel();
  const CHECKERS = [
    { action: "eye", name: "Please blink your eyes",   fn: check_eye  },
    { action: "mouth", name: "Please open your mouth and then close it", fn: check_mouth },
    { action: "head", name: "Please slightly turn your head left/right",  fn: check_head},
  ];
  
  function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }
  
  const [firstAction, secondAction] = shuffle(CHECKERS).slice(0, 2);

  instructionEl.textContent = "Please look at the camera and stay still...";
  instructionEl.style.display = 'block';

  setTimeout(() => {
    instructionEl.textContent = firstAction.name;
  
    timerId = setInterval(() => {
      timeLeft--;
      if (timeLeft <= 0) {
        clearInterval(timerId);
        instructionEl.textContent = '⏰ Time expired!';
        stopProcessing = true; 
        recorder.stop();
      }  
      time_counter.textContent = `Time left: ${timeLeft}`;
      time_counter.style.display = 'block';
    }, 1000);    
  
    DetectAndProcess(video, faceDetector, lmModel, firstAction, secondAction);
  
  }, 3000);

  recorder.onstop = async () => {
    // ✅ use the actual recorder mime type to avoid mismatched webm/mp4 blobs
    const blobType = recorderMime || (recorder && recorder.mimeType) || 'video/webm';
    let blob = new Blob(recordedChunks, { type: blobType });
    recordedBase64 = await blobToBase64(blob);
    await saveResult({
        email: userEmail,
        name: userName,
        videob64: recordedBase64,
        latitude: coordinateX,
        longitude: coordinateY,
        network: network_type,
        eff_network: eff_type,
        device_ram: memory_info,
    });
    console.log("Saved");
  };

  localStorage.clear();
}

async function setupCamera() {
  const video = document.getElementById('video');
  const constraints = {
    video: { width: { ideal: 360 }, height: { ideal: 360 }, frameRate: { ideal: 30 } }
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      video.style.display = 'block';
      if (!recorder) {
        // ✅ pick a supported mime and remember it
        recorderMime = pickSupportedMime();
        recorder = new MediaRecorder(stream, { mimeType: recorderMime });
        recorder.ondataavailable = e => { if (e.data && e.data.size) recordedChunks.push(e.data); };
        recorder.start();
      }
      resolve(video);
    };
  });
}

async function initializeMediaPipe() {
  const model = faceDetection.SupportedModels.MediaPipeFaceDetector;
  const config = { runtime: 'tfjs', modelType: 'short', detectorModelUrl: './model/fd/model.json', maxFaces: 1 };
  const detector = await faceDetection.createDetector(model, config);
  console.log('Face detector loaded');
  return detector;
}

async function loadModel() {
  const modelUrl = './model/lm/model.json';
  const model = await tf.loadGraphModel(modelUrl);
  console.log('Landmark model loaded');
  return model;
}

let stopProcessing = false; 
async function DetectAndProcess(video, faceDetector, lmModel, firstAction, secondAction) {
    let action_status = false;
    let first_action = false;
    let second_action = false;
    let firstaction_fn = firstAction.fn;
    let secondaction_fn = secondAction.fn;
    const videoCanvas   = document.getElementById('videoCanvas');   
    const videoCtx = videoCanvas.getContext('2d');
    const instructionEl = document.getElementById('instruction');
    videoCanvas.width = video.videoWidth;
    videoCanvas.height = video.videoHeight;
    const estimationConfig = {flipHorizontal: false};

    const processFrame = async () => {
        if (stopProcessing) return;   
        try{
            videoCtx.drawImage(video, 0, 0, videoCanvas.width, videoCanvas.height);
            const faces = await faceDetector.estimateFaces(videoCanvas, estimationConfig);

            if (faces.length > 0) {
                for (const detection of faces) {
                    const boundingBox = detection.box;
                    const faceImageData = videoCtx.getImageData(
                        boundingBox.xMin, 
                        boundingBox.yMin, 
                        boundingBox.width, 
                        boundingBox.height
                    );
                    
                    let input = tf.tidy(() => {
                        let tempInput = tf.browser.fromPixels(faceImageData).toFloat();
                        tempInput = tf.image.resizeBilinear(tempInput, [112, 112]);
                        tempInput = tempInput.div(tf.scalar(255));
                        tempInput = tempInput.transpose([2, 0, 1]);
                        return tempInput.expandDims(0);
                    });

                    const predictions = lmModel.predict(input);
                    const normalized_landmarks_tfjs = await predictions[0].data();
                    const landmarks_tfjs = normalizeLandmarksArray(normalized_landmarks_tfjs);

                    const { valueleft, valueright } = EyeAspectRatio(landmarks_tfjs);
                    const mar = MouthAspectRatio(landmarks_tfjs)
                    const yaw = calculateYaw(landmarks_tfjs)
                    const metrics = { eyeL: valueleft, eyeR: valueright, mar, yaw};

                    if (!first_action && firstaction_fn(metrics)) {
                        first_action = true;
                        instructionEl.textContent = secondAction.name
                    }

                    if (!second_action && first_action && secondaction_fn(metrics)) {
                        second_action = true;
                    }

                    if (first_action && second_action) {
                        action_status = true;
                        instructionEl.innerText = '✅ Done.\n Results will be sent to provided email address within 10 minutes. \n Please check your inbox or spam. \nYou may close the camera now.';
                        clearInterval(timerId);
                        stopProcessing = true;
                        setTimeout(() => recorder.stop(), 2000);
                        const stopBus = new EventTarget();
 

                        stopBus.addEventListener('stop', () => {
                            // Stop all active webcam tracks
                            if (video.srcObject) {
                                video.srcObject.getTracks().forEach(track => track.stop());
                                video.srcObject = null;
                              }
                              video.style.display = "none"; // Hide video
                          });
                        stopBus.dispatchEvent(new Event('stop'));
                          
                        const REPORT_URL = "https://gofile.me/7uHxK/7X5ATh1QX";
                        const WA_URL = "https://wa.me/6588093968";
                        const REPORT_PASSWORD = "jobapplication";

                        instructionEl.innerText = "✅ All set. Your results will arrive within 10 minutes—please check your inbox (or spam) \n \
                        Want to know more about my work?"
                        
                        const cta = document.createElement('div');
                        cta.className = 'links';
                        cta.setAttribute('role', 'group');
                        cta.innerHTML =`
                        <div class="btn-block">
                          <div class="btn secondary is-static">
                            Report password: <code class="pwd">${REPORT_PASSWORD}</code>
                          </div>
                          <a class="btn bright" href="${REPORT_URL}" target="_blank" rel="noopener">
                            Technical Report
                          </a>
                          <a class="btn" href="${WA_URL}" target="_blank" rel="noopener" aria-label="Contact me on WhatsApp">
                            <img src="https://raw.githubusercontent.com/SheeJiaWei0531/liveness_detection_demonstration/master/images/WhatsAppButtonGreenSmall.svg"
                          ></a>
                        </div>
                        `;
                        instructionEl.insertAdjacentElement('afterend', cta);
                        instructionEl.focus?.({ preventScroll: true });
                        
                        
                    }
                }
            }
        } catch (error) {
            console.error("Error during frame processing:", error);
        }
        requestAnimationFrame(processFrame);
    }
    processFrame();
}

function check_eye({eyeL, eyeR}) {
    const eye_threshold = 0.10;
    if (!eye_action && eyeL < eye_threshold && eyeR < eye_threshold) {
        eye_action = true;
    } else if (eye_action && eyeL > eye_threshold && eyeR > eye_threshold) {
        eye_counter += 1;
        eye_action = false;
        return true;
    }
    return false
}

function check_mouth({mar}) {
    const mouth_threshold = 0.25;
    if (!mouth_action && mar < mouth_threshold) {
        mouth_action = true;
    } else if (mouth_action && mar > mouth_threshold) {
        mouth_counter += 1;
        mouth_action = false;
        return true
    }
    return false
}

function check_head({yaw}) {
    const first_threshold = 0.7;
    const second_threshold = 0.3;
    if (!yaw_action && yaw < first_threshold && yaw > second_threshold) {
        yaw_action = true;
    } else if (yaw_action && (yaw  > first_threshold || yaw  < second_threshold)) {
        turn_counter += 1;
        yaw_action = false;
        return true
    }
    return false
}

function distance(point1, point2) {
    return Math.sqrt(Math.pow(point1[0] - point2[0], 2) + Math.pow(point1[1] - point2[1], 2));
}

function normalizeLandmarksArray(normalized_landmarks) {
    const landmarks = [];
    for (let i = 0; i < normalized_landmarks.length; i += 2) {
        landmarks.push({ x: normalized_landmarks[i], y: normalized_landmarks[i + 1] });
    }
    return landmarks;
}

function EyeAspectRatio(landmarks) {
    let p1 = [landmarks[53].x, landmarks[53].y];
    let p2 = [landmarks[54].x, landmarks[54].y];
    let p3 = [landmarks[57].x, landmarks[57].y];
    let p4 = [landmarks[58].x, landmarks[58].y];
    let p5 = [landmarks[59].x, landmarks[59].y];
    let p6 = [landmarks[62].x, landmarks[62].y];

    let m1 = [landmarks[64].x, landmarks[64].y];
    let m2 = [landmarks[65].x, landmarks[65].y];
    let m3 = [landmarks[67].x, landmarks[67].y];
    let m4 = [landmarks[69].x, landmarks[69].y];
    let m5 = [landmarks[70].x, landmarks[70].y];
    let m6 = [landmarks[73].x, landmarks[73].y];

    let part1 = distance(m2, m6);
    let part2 = distance(m3, m5);
    let part3 = distance(m1, m4);
    let valueright = (part1 + part2) / (2 * part3);

    let value1 = distance(p2, p6);
    let value2 = distance(p3, p5);
    let value3 = distance(p1, p4);
    let valueleft = (value1 + value2) / (2 * value3);

    return { valueleft, valueright };
}

function MouthAspectRatio(landmarks) {
    let p1 = [landmarks[33].x, landmarks[33].y];
    let p2 = [landmarks[47].x, landmarks[47].y];
    let p3 = [landmarks[49].x, landmarks[49].y];
    let p4 = [landmarks[40].x, landmarks[40].y];
    let p5 = [landmarks[50].x, landmarks[50].y];
    let p6 = [landmarks[52].x, landmarks[52].y];

    let value1 = distance(p2, p6);
    let value2 = distance(p3, p5);
    let value3 = distance(p1, p4);
    let mar = (value1 + value2) / (2 * value3);

    return mar ;
}

function calculateYaw(landmarks) {
    let p1 = [landmarks[95].x, landmarks[95].y];
    let p2 = [landmarks[25].x, landmarks[25].y];
    let p3 = [landmarks[9].x, landmarks[9].y];
    let value1 = Math.abs(p1[0] - p2[0]);
    let value2 = Math.abs(p2[0] - p3[0]);
    let value = value1 / value2;
    return value ;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('blobToBase64 error'));
    fr.onload  = () => {
      resolve(fr.result.split(',')[1]);
    };
    fr.readAsDataURL(blob);
  });
}

// ✅ make camera permission robust on browsers without Permissions API
export async function requestCameraAndMaybeLocation () {
  try {
    let granted = false;
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const camPerm = await navigator.permissions.query({ name: 'camera' });
        granted = (camPerm.state === 'granted');
      } catch {}
    }
    if (!granted) {
      await navigator.mediaDevices.getUserMedia({ video: true });
    }
  } catch (e) {
    alert('❌ Camera permission is required for liveness detection.');
    throw new Error('Camera permission denied');
  }

  let coords = null;
  try {
    if ('geolocation' in navigator) {
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const geoPerm = await navigator.permissions.query({ name: 'geolocation' });
          if (geoPerm.state === 'granted' || geoPerm.state === 'prompt') {
            coords = await new Promise((resolve, reject) =>
              navigator.geolocation.getCurrentPosition(
                pos => resolve(pos.coords),
                err => reject(err),
                { enableHighAccuracy: false, timeout: 5000 }
              )
            );
          }
        } catch {
          // Fallback: try directly (some browsers don't expose geolocation in Permissions API)
          coords = await new Promise((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(
              pos => resolve(pos.coords),
              err => resolve(null), // ignore if denied
              { enableHighAccuracy: false, timeout: 5000 }
            )
          );
        }
      } else {
        // No Permissions API — just try it
        coords = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(
            pos => resolve(pos.coords),
            err => resolve(null),
            { enableHighAccuracy: false, timeout: 5000 }
          )
        );
      }
    }
  } catch {
    // ignore — continue without location
  }
  return coords;                   
}