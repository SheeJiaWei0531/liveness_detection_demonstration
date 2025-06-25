import { saveResult } from './api.js';

let backend = 'wasm';
let timerId = null;                 // ⏱ NEW
let timeLeft = 10;                   // ⏱ NEW
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
let recorder;               // MediaRecorder instance
let recordedChunks = [];    // bytes that arrive while recording
let recordedBase64 = '';    // final string you want
const instructionEl = document.getElementById('instruction');   
const time_counter = document.getElementById('time');   
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
    <p>Due to resource constraints, kindly complete the session within 10 seconds.</p>
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
    { action: "eye", name: "Please Blink Your Eyes",   fn: check_eye  },
    { action: "mouth", name: "Please Open Mouth", fn: check_mouth },
    { action: "head", name: "Please Slightly Turn Your Head Left/Right",  fn: check_head},
  ];
  
  function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }
  
  const [firstAction, secondAction] = shuffle(CHECKERS).slice(0, 2);
  instructionEl.textContent = firstAction.name;
  instructionEl.style.display = 'block';   
  
  timerId = setInterval(() => {                             // ⏱ NEW
    
    timeLeft--;                                        // ⏱ NEW
    if (timeLeft <= 0) {                                    // ⏱ NEW
      clearInterval(timerId);                               // ⏱ NEW
      instructionEl.textContent = '⏰ Time expired!';        // ⏱ NEW
      stopProcessing = true; 
      recorder.stop();
    }  
    time_counter.textContent = `Time left: ${timeLeft}`;
    time_counter.style.display = 'block';                                                       // ⏱ NEW
  }, 1000);    


  DetectAndProcess(video, faceDetector, lmModel, firstAction, secondAction);
  recorder.onstop = async () => {
    let blob = new Blob(recordedChunks, { type: "video/mp4" });
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
    video: { width: { ideal: 270 }, height: { ideal: 360 }, frameRate: { ideal: 30 } }
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      video.style.display = 'block';
      if (!recorder) {
        recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
        recorder.ondataavailable = e => recordedChunks.push(e.data);
        recorder.start();                 // begins capturing immediately
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

                    // Extract the face region from the bounding box
                    const faceImageData = videoCtx.getImageData(
                        boundingBox.xMin, 
                        boundingBox.yMin, 
                        boundingBox.width, 
                        boundingBox.height
                    );
                    // console.log(faceImageData)
                    
                    // Convert the image data to a tensor and preprocess it to match the model's input shape
                    let input = tf.tidy(() => {
                        let tempInput = tf.browser.fromPixels(faceImageData).toFloat();  // [360, 270, 3]
                        tempInput = tf.image.resizeBilinear(tempInput, [112, 112]);  // Resize to [112, 112, 3]
                        tempInput = tempInput.div(tf.scalar(255));  // Normalize the pixel values to [0, 1]
                        tempInput = tempInput.transpose([2, 0, 1]);  // Rearrange dimensions to [3, 112, 112]
                        return tempInput.expandDims(0);  // Add batch dimension to get [1, 3, 112, 112]
                    })

                    const predictions = lmModel.predict(input);
                    const normalized_landmarks_tfjs = await predictions[0].data();
                    const landmarks_tfjs = normalizeLandmarksArray(normalized_landmarks_tfjs);


                    const { valueleft, valueright } = EyeAspectRatio(landmarks_tfjs);
                    const mar = MouthAspectRatio(landmarks_tfjs)
                    const yaw = calculateYaw(landmarks_tfjs)
                    const metrics = { eyeL: valueleft, eyeR: valueright, mar, yaw};
                    // console.log(metrics)


                    if (!first_action && firstaction_fn(metrics)) {
                        first_action = true;
                        instructionEl.textContent = secondAction.name
                    }

                    if (!second_action && first_action && secondaction_fn(metrics)) {
                        second_action = true;

                    }

                    if (first_action && second_action) {
                        action_status = true;
                        instructionEl.textContent = '✅ All actions done. Result will be sent to your provided gmail. Please check.';  
                        clearInterval(timerId);           // ⏱ NEW
                        stopProcessing = true;
                        setTimeout(() => recorder.stop(), 1000);
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
    const eye_threshold = 0.15;
    
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
    const first_threshold = 0.75;
    const second_threshold = 0.25;

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
        landmarks.push({
            x: normalized_landmarks[i],
            y: normalized_landmarks[i + 1]
        });
    }
    return landmarks;
}


function EyeAspectRatio(landmarks) {
    // Left eye landmarks
    let p1 = [landmarks[53].x, landmarks[53].y];
    let p2 = [landmarks[54].x, landmarks[54].y];
    let p3 = [landmarks[57].x, landmarks[57].y];
    let p4 = [landmarks[58].x, landmarks[58].y];
    let p5 = [landmarks[59].x, landmarks[59].y];
    let p6 = [landmarks[62].x, landmarks[62].y];

    // Right eye landmarks
    let m1 = [landmarks[64].x, landmarks[64].y];
    let m2 = [landmarks[65].x, landmarks[65].y];
    let m3 = [landmarks[67].x, landmarks[67].y];
    let m4 = [landmarks[69].x, landmarks[69].y];
    let m5 = [landmarks[70].x, landmarks[70].y];
    let m6 = [landmarks[73].x, landmarks[73].y];

    // Calculate distances for the right eye
    let part1 = distance(m2, m6);
    let part2 = distance(m3, m5);
    let part3 = distance(m1, m4);
    let valueright = (part1 + part2) / (2 * part3);

    // Calculate distances for the left eye
    let value1 = distance(p2, p6);
    let value2 = distance(p3, p5);
    let value3 = distance(p1, p4);
    let valueleft = (value1 + value2) / (2 * value3);

    return { valueleft, valueright };
}

function MouthAspectRatio(landmarks) {
    // Left eye landmarks
    let p1 = [landmarks[33].x, landmarks[33].y];
    let p2 = [landmarks[47].x, landmarks[47].y];
    let p3 = [landmarks[49].x, landmarks[49].y];
    let p4 = [landmarks[40].x, landmarks[40].y];
    let p5 = [landmarks[50].x, landmarks[50].y];
    let p6 = [landmarks[52].x, landmarks[52].y];



    // Calculate distances for the left eye
    let value1 = distance(p2, p6);
    let value2 = distance(p3, p5);
    let value3 = distance(p1, p4);
    let mar = (value1 + value2) / (2 * value3);


    return mar ;
}

function calculateYaw(landmarks) {
    // Extract the required landmarks
    let p1 = [landmarks[95].x, landmarks[95].y];
    let p2 = [landmarks[25].x, landmarks[25].y];
    let p3 = [landmarks[9].x, landmarks[9].y];

    // Calculate distances
    let value1 = Math.abs(p1[0] - p2[0]);
    let value2 = Math.abs(p2[0] - p3[0]);

    // Calculate the final value
    let value = value1 / value2;
    return value ;
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('blobToBase64 error'));
      fr.onload  = () => {
        // fr.result is "data:…;base64,<payload>"
        resolve(fr.result.split(',')[1]);     // remove the MIME prefix (optional)
      };
      fr.readAsDataURL(blob);
    });
  }

  export async function requestCameraAndMaybeLocation () {
    /* 1️⃣  CAMERA (mandatory) */
    try {
      // Prompt only if not already granted
      const camPerm = await navigator.permissions.query({ name: 'camera' });
      if (camPerm.state !== 'granted') {
        await navigator.mediaDevices.getUserMedia({ video: true });
      }
      console.log('[perm] camera:', camPerm.state);
    } catch (e) {
      alert('❌ Camera permission is required for liveness detection.');
      throw new Error('Camera permission denied');
    }
  
    /* 2️⃣  LOCATION (best-effort) */
    let coords = null;
    try {
      if ('geolocation' in navigator) {
        const geoPerm = await navigator.permissions.query({ name: 'geolocation' });
        if (geoPerm.state === 'granted' || geoPerm.state === 'prompt') {
          coords = await new Promise((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(
              pos => resolve(pos.coords),
              err => reject(err),
              { enableHighAccuracy: false, timeout: 5000 }
            ));
        }
        console.log('[perm] geolocation:', geoPerm.state);
      }
    } catch (err) {
      console.info('Location unavailable or denied — continuing without it.');
    }
    return coords;                    // may be null
  }