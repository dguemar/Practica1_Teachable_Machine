"use strict";

const MODEL_URL = "./modelo/model.json";
const METADATA_URL = "./modelo/metadata.json";
const HISTORY_KEY = "clasificadorIA.historial";
const MAX_HISTORY_ITEMS = 50;
const EXPECTED_LABELS = ["Mando de aire acondicionado", "Pajarita"];

const elements = {
  modelStatusIcon: document.getElementById("modelStatusIcon"),
  modelStatusTitle: document.getElementById("modelStatusTitle"),
  modelStatusMessage: document.getElementById("modelStatusMessage"),
  startCameraButton: document.getElementById("startCameraButton"),
  stopCameraButton: document.getElementById("stopCameraButton"),
  cameraVideo: document.getElementById("cameraVideo"),
  cameraPlaceholder: document.getElementById("cameraPlaceholder"),
  cameraMessage: document.getElementById("cameraMessage"),
  cameraResult: document.getElementById("cameraResult"),
  cameraCustomMessage: document.getElementById("cameraCustomMessage"),
  cameraConfidence: document.getElementById("cameraConfidence"),
  cameraConfidenceBar: document.getElementById("cameraConfidenceBar"),
  imageInput: document.getElementById("imageInput"),
  imagePreview: document.getElementById("imagePreview"),
  imagePlaceholder: document.getElementById("imagePlaceholder"),
  classifyImageButton: document.getElementById("classifyImageButton"),
  imageMessage: document.getElementById("imageMessage"),
  imageResult: document.getElementById("imageResult"),
  imageCustomMessage: document.getElementById("imageCustomMessage"),
  imageConfidence: document.getElementById("imageConfidence"),
  imageConfidenceBar: document.getElementById("imageConfidenceBar"),
  confidenceThreshold: document.getElementById("confidenceThreshold"),
  thresholdValue: document.getElementById("thresholdValue"),
  clearHistoryButton: document.getElementById("clearHistoryButton"),
  historyMessage: document.getElementById("historyMessage"),
  historyBody: document.getElementById("historyBody")
};

let model = null;
let cameraStream = null;
let cameraStarting = false;
let cameraFrameId = null;
let cameraSession = 0;
let predictionInProgress = false;
let currentImageUrl = null;
let historyItems = loadHistory();
let cameraSessionLabels = new Set();

function setModelStatus(state, title, message) {
  elements.modelStatusIcon.className = `status-icon is-${state}`;
  elements.modelStatusTitle.textContent = title;
  elements.modelStatusMessage.textContent = message;
}

function setButtonsEnabled() {
  const modelReady = Boolean(model);
  const cameraAvailable = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  elements.startCameraButton.disabled = !modelReady || !cameraAvailable || Boolean(cameraStream) || cameraStarting;
  elements.stopCameraButton.disabled = !cameraStream;
  elements.classifyImageButton.disabled = !modelReady || !elements.imageInput.files.length || predictionInProgress;
}

async function loadModel() {
  if (!window.tmImage) {
    throw new Error("No se pudo cargar la librería de Teachable Machine. Comprueba tu conexión y que la CDN no esté bloqueada.");
  }

  model = await window.tmImage.load(MODEL_URL, METADATA_URL);
  const labels = model.getClassLabels();
  const hasExpectedLabels = EXPECTED_LABELS.every((label) => labels.includes(label));

  if (labels.length !== EXPECTED_LABELS.length || !hasExpectedLabels) {
    model = null;
    throw new Error("Las clases del modelo no coinciden con «Mando de aire acondicionado» y «Pajarita». Comprueba modelo/metadata.json.");
  }

  setModelStatus("ready", "Modelo listo", "Ya puedes iniciar la cámara o seleccionar una imagen.");
  setButtonsEnabled();
}

function getThreshold() {
  return Number(elements.confidenceThreshold.value) / 100;
}

function getTopPrediction(predictions) {
  if (!Array.isArray(predictions) || predictions.length === 0) {
    throw new Error("El modelo no devolvió ninguna predicción.");
  }

  return predictions.reduce((top, prediction) => {
    if (!prediction || typeof prediction.className !== "string" || !Number.isFinite(prediction.probability)) {
      throw new Error("El modelo devolvió una predicción con un formato no válido.");
    }
    return prediction.probability > top.probability ? prediction : top;
  });
}

function resultMessage(className, identified) {
  if (!identified) {
    return "No se ha identificado el objeto con suficiente confianza.";
  }

  if (className === "Mando de aire acondicionado") {
    return "¡Es un mando de aire acondicionado! Apunta con él hacia el equipo para ajustar la temperatura.";
  }

  if (className === "Pajarita") {
    return "¡Es una pajarita! Un toque elegante para completar cualquier conjunto.";
  }

  return "El modelo ha detectado un objeto.";
}

function renderPrediction(prediction, target) {
  const identified = prediction.probability >= getThreshold();
  const className = identified ? prediction.className : "No identificado";
  const confidencePercent = Math.round(prediction.probability * 100);

  elements[`${target}Result`].textContent = className;
  elements[`${target}CustomMessage`].textContent = resultMessage(prediction.className, identified);
  elements[`${target}Confidence`].textContent = `${confidencePercent} %`;
  elements[`${target}ConfidenceBar`].style.width = `${Math.min(100, Math.max(0, confidencePercent))}%`;
  return { className, confidence: prediction.probability, identified };
}

function loadHistory() {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      throw new Error("El historial guardado no tiene un formato válido.");
    }

    return parsed
      .filter((item) => item && typeof item.label === "string" && Number.isFinite(item.confidence) && typeof item.date === "string")
      .slice(0, MAX_HISTORY_ITEMS);
  } catch (error) {
    console.error("No se pudo cargar el historial:", error);
    elements.historyMessage.textContent = "No se pudo leer el historial guardado en este navegador.";
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(historyItems));
    elements.historyMessage.textContent = "";
  } catch (error) {
    console.error("No se pudo guardar el historial:", error);
    elements.historyMessage.textContent = "No se pudo guardar el historial. Comprueba el espacio disponible en el navegador.";
  }
}

function renderHistory() {
  elements.historyBody.replaceChildren();

  if (historyItems.length === 0) {
    const row = document.createElement("tr");
    row.className = "empty-history";
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = "Todavía no hay clasificaciones guardadas.";
    row.append(cell);
    elements.historyBody.append(row);
    return;
  }

  historyItems.forEach((item) => {
    const row = document.createElement("tr");
    const dateCell = document.createElement("td");
    const labelCell = document.createElement("td");
    const confidenceCell = document.createElement("td");
    const date = new Date(item.date);

    dateCell.textContent = Number.isNaN(date.getTime()) ? "Fecha no disponible" : date.toLocaleString("es-ES");
    labelCell.textContent = item.label;
    confidenceCell.textContent = `${Math.round(item.confidence * 100)} %`;
    row.append(dateCell, labelCell, confidenceCell);
    elements.historyBody.append(row);
  });
}

function addHistoryItem(label, confidence) {
  historyItems.unshift({ date: new Date().toISOString(), label, confidence });
  historyItems = historyItems.slice(0, MAX_HISTORY_ITEMS);
  renderHistory();
  saveHistory();
}

function stopCamera() {
  cameraSession += 1;
  if (cameraFrameId !== null) {
    cancelAnimationFrame(cameraFrameId);
    cameraFrameId = null;
  }

  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }

  elements.cameraVideo.srcObject = null;
  elements.cameraVideo.hidden = true;
  elements.cameraPlaceholder.hidden = false;
  elements.startCameraButton.disabled = !model || !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || cameraStarting;
  elements.stopCameraButton.disabled = true;
}

async function runCameraPrediction(session) {
  if (session !== cameraSession || !cameraStream) {
    return;
  }

  if (!predictionInProgress && elements.cameraVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    predictionInProgress = true;
    try {
      const prediction = getTopPrediction(await model.predict(elements.cameraVideo));
      if (session !== cameraSession) {
        return;
      }

      const result = renderPrediction(prediction, "camera");
      if (result.identified && !cameraSessionLabels.has(result.className)) {
        cameraSessionLabels.add(result.className);
        addHistoryItem(result.className, result.confidence);
      }
    } catch (error) {
      console.error("Error al clasificar la imagen de la cámara:", error);
      stopCamera();
      elements.cameraMessage.textContent = "No se pudo analizar el vídeo. Detén la cámara e inténtalo de nuevo.";
      return;
    } finally {
      predictionInProgress = false;
    }
  }

  if (session === cameraSession && cameraStream) {
    cameraFrameId = requestAnimationFrame(() => runCameraPrediction(session));
  }
}

async function startCamera() {
  if (!model || cameraStream || cameraStarting) {
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    elements.cameraMessage.textContent = "Este navegador no permite usar la cámara aquí. Prueba en un navegador actualizado mediante localhost o HTTPS.";
    return;
  }

  cameraStarting = true;
  elements.cameraMessage.textContent = "";
  setButtonsEnabled();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "environment" }
    });

    cameraStream = stream;
    cameraSession += 1;
    cameraSessionLabels = new Set();
    elements.cameraVideo.srcObject = stream;
    elements.cameraVideo.hidden = false;
    elements.cameraPlaceholder.hidden = true;
    await elements.cameraVideo.play();
    elements.stopCameraButton.disabled = false;
    cameraFrameId = requestAnimationFrame(() => runCameraPrediction(cameraSession));
  } catch (error) {
    stopCamera();
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      elements.cameraMessage.textContent = "No se concedió permiso para usar la cámara. Permite el acceso desde los ajustes del navegador.";
    } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      elements.cameraMessage.textContent = "No se encontró ninguna cámara conectada o disponible.";
    } else if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      elements.cameraMessage.textContent = "La cámara está ocupada por otra aplicación. Ciérrala e inténtalo de nuevo.";
    } else {
      console.error("No se pudo iniciar la cámara:", error);
      elements.cameraMessage.textContent = "No se pudo iniciar la cámara. Comprueba que esté conectada y vuelve a intentarlo.";
    }
  } finally {
    cameraStarting = false;
    setButtonsEnabled();
  }
}

async function classifySelectedImage() {
  if (!model || !elements.imageInput.files.length) {
    return;
  }

  if (predictionInProgress) {
    elements.imageMessage.textContent = "Espera a que termine la predicción actual y vuelve a intentarlo.";
    return;
  }

  predictionInProgress = true;
  setButtonsEnabled();
  elements.imageMessage.textContent = "";
  try {
    if (!elements.imagePreview.complete || elements.imagePreview.naturalWidth === 0) {
      await elements.imagePreview.decode();
    }
    const prediction = getTopPrediction(await model.predict(elements.imagePreview));
    const result = renderPrediction(prediction, "image");
    addHistoryItem(result.className, result.confidence);
  } catch (error) {
    console.error("Error al clasificar la imagen seleccionada:", error);
    elements.imageMessage.textContent = "No se pudo abrir o clasificar la imagen. Prueba con otro archivo de imagen.";
  } finally {
    predictionInProgress = false;
    setButtonsEnabled();
  }
}

function handleImageSelection() {
  const file = elements.imageInput.files[0];
  elements.imageMessage.textContent = "";

  if (!file) {
    setButtonsEnabled();
    return;
  }

  if (!file.type.startsWith("image/")) {
    elements.imageInput.value = "";
    elements.imageMessage.textContent = "El archivo seleccionado no parece ser una imagen. Elige un archivo de imagen.";
    setButtonsEnabled();
    return;
  }

  if (currentImageUrl) {
    URL.revokeObjectURL(currentImageUrl);
  }

  currentImageUrl = URL.createObjectURL(file);
  elements.imagePreview.src = currentImageUrl;
  elements.imagePreview.hidden = false;
  elements.imagePlaceholder.hidden = true;
  elements.imageResult.textContent = "Imagen lista";
  elements.imageCustomMessage.textContent = "Pulsa «Clasificar imagen» para obtener el resultado.";
  elements.imageConfidence.textContent = "—";
  elements.imageConfidenceBar.style.width = "0";
  setButtonsEnabled();
}

elements.startCameraButton.addEventListener("click", startCamera);
elements.stopCameraButton.addEventListener("click", stopCamera);
elements.imageInput.addEventListener("change", handleImageSelection);
elements.classifyImageButton.addEventListener("click", classifySelectedImage);
elements.confidenceThreshold.addEventListener("input", () => {
  elements.thresholdValue.value = `${elements.confidenceThreshold.value} %`;
  elements.thresholdValue.textContent = `${elements.confidenceThreshold.value} %`;
});
elements.clearHistoryButton.addEventListener("click", () => {
  historyItems = [];
  renderHistory();
  saveHistory();
});

renderHistory();
elements.thresholdValue.value = `${elements.confidenceThreshold.value} %`;
elements.thresholdValue.textContent = `${elements.confidenceThreshold.value} %`;
setButtonsEnabled();

loadModel().catch((error) => {
  console.error("No se pudo cargar el modelo:", error);
  setModelStatus("error", "No se pudo cargar el modelo", error.message || "Comprueba los archivos del modelo y vuelve a cargar la página.");
});
