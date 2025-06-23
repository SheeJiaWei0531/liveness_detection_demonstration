

let backend = 'wasm';
let userName = '';
let userEmail = '';

// On load, render cached UI if present
document.addEventListener('DOMContentLoaded', () => {
  const savedName = localStorage.getItem('userName');
  const savedEmail = localStorage.getItem('userEmail');
  if (savedName && savedEmail) {
    showCompletionUI(savedName, savedEmail);
    userName = savedName;
    userEmail = savedEmail;
  }
});

// Delegate restart button click to start detection
document.addEventListener('click', (e) => {
  if (e.target.id === 'restartBtn') {
    // hide form container
    document.getElementById('container').style.display = 'none';
    // retrieve data attributes
    userName = e.target.dataset.name;
    userEmail = e.target.dataset.email;
    initLivenessDetection();
  }
});

/**
 * Display the "thank you" screen with start button
 */
function showCompletionUI(name, email) {
  const container = document.getElementById('container');
  container.innerHTML = `
    <h1>Thank you, ${name}!</h1>
    <p>Email received: <strong>${email}</strong></p>
    <p>…complete within 8 seconds.</p>
    <button id="restartBtn" data-name="${name}" data-email="${email}">Start liveness detection</button>
  `;
}

/**
 * Main entry for liveness detection
 */
async function initLivenessDetection() {
  await tf.ready();
  await tf.setBackend(backend);
  console.log('TFJS Backend:', tf.getBackend());

  // Start camera and reveal video element
  const video = await setupCamera();
  console.log('Camera initialized');

  // Load models
  const faceDetector = await initializeMediaPipe();
  const lmModel = await loadModel();

  // Begin your pipeline
  runLivenessPipeline(video, faceDetector, lmModel, userName, userEmail);
}

/**
 * Access webcam, unhide video element
 */
async function setupCamera() {
  const video = document.getElementById('video');
  const constraints = {
    video: { width: { ideal: 360 }, height: { ideal: 270 }, frameRate: { ideal: 30 } }
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      video.style.display = 'block';
      resolve(video);
    };
  });
}

/**
 * Load MediaPipe face detector
 */
async function initializeMediaPipe() {
  const model = faceDetection.SupportedModels.MediaPipeFaceDetector;
  const config = { runtime: 'tfjs', modelType: 'short', detectorModelUrl: './model/fd/model.json', maxFaces: 1 };
  const detector = await faceDetection.createDetector(model, config);
  console.log('Face detector loaded');
  return detector;
}

/**
 * Load landmark model
 */
async function loadModel() {
  const modelUrl = './model/lm/model.json';
  const model = await tf.loadGraphModel(modelUrl);
  console.log('Landmark model loaded');
  return model;
}

/**
 * Stub for pipeline
 */
function runLivenessPipeline(video, faceDetector, lmModel, name, email) {
  console.log(`Running pipeline for ${name} (${email})`);
  // TODO: detection + inference loop
}
