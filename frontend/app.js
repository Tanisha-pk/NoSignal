'use strict';

const queueKey = 'resilinet.pending-events.v1';
const contactsKey = 'resilinet.contacts.v1';
const guidesKey = 'resilinet.guides.v1';
const sheltersKey = 'resilinet.shelters.v1';
const shelterStatusesKey = 'resilinet.shelter-statuses.v1';
const locationKey = 'resilinet.location.v1';
const medicalCardKey = 'resilinet.medical-card.v1';
const timerKey = 'resilinet.timer.v1';

const logElement = document.querySelector('#system-log');
const networkStatus = document.querySelector('#network-status');
const networkLabel = document.querySelector('#network-label');
const primaryNavLinks = [...document.querySelectorAll('.primary-nav a')];
const checkinButton = document.querySelector('#checkin-button');
const sosButton = document.querySelector('#sos-button');
const contactForm = document.querySelector('#contact-form');
const contactList = document.querySelector('#contact-list');
const guideSearch = document.querySelector('#guide-search');
const guideList = document.querySelector('#guide-list');
const shelterList = document.querySelector('#shelter-list');
const shelterMapWrap = document.querySelector('#shelter-map-wrap');
const shelterMapEmpty = document.querySelector('#shelter-map-empty');
const shelterMapNote = document.querySelector('.map-note');
const shelterMap = document.querySelector('#shelter-map');
const mapSelection = document.querySelector('#map-selection');
const languageSelect = document.querySelector('#language-select');
const strobeButton = document.querySelector('#strobe-button');
const strobeDisplay = document.querySelector('#strobe-display');
const strobeLabel = document.querySelector('#strobe-label');
const timerForm = document.querySelector('#timer-form');
const timerDuration = document.querySelector('#timer-duration');
const timerStartButton = document.querySelector('#timer-start-button');
const timerCountdown = document.querySelector('#timer-countdown');
const timerStatus = document.querySelector('#timer-status');
const timerCard = document.querySelector('.timer-card');
const timerProgress = document.querySelector('#timer-progress');
const timerProgressFill = document.querySelector('#timer-progress-fill');
const timerAckButton = document.querySelector('#timer-ack-button');
const useLocationButton = document.querySelector('#use-location-button');
const medicalCardForm = document.querySelector('#medical-card-form');
const medicalQr = document.querySelector('#medical-qr');
const medicalQrError = document.querySelector('#medical-qr-error');
const whistleButton = document.querySelector('#whistle-button');
const dashboard = document.querySelector('#dashboard');
const respondersView = document.querySelector('#responders-view');
const triageRows = document.querySelector('#triage-rows');
const actionButtons = [checkinButton, sosButton];
const isRespondersRoute = window.location.pathname === '/responders';

function updateActiveNavigation() {
  primaryNavLinks.forEach((link) => {
    if (link.pathname === window.location.pathname &&
        (!link.hash || link.hash === window.location.hash)) {
      link.setAttribute('aria-current', 'location');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

primaryNavLinks.forEach((link) => {
  link.addEventListener('click', updateActiveNavigation);
});
window.addEventListener('hashchange', updateActiveNavigation);
updateActiveNavigation();

let pendingEvents = [];
let contacts = [];
let guides = [];
let shelters = [];
let shelterStatuses = [];
let currentLocation = null;
let timerState = null;
let selectedLanguage = 'en';
let selectedShelterId = '';
let selectedMapPoint = '';
let queueAvailable = true;
let isSyncing = false;
let timerInterval = null;
let strobeTimeout = null;
let strobeRunning = false;
let isExpiringTimer = false;
let batteryManager = null;
let whistleContext = null;
let whistleOscillator = null;
let cameraStream = null;
let triageSource = null;
let liveEventWarningLogged = false;

function translate(key) {
  const language = window.NoSignalTranslations[selectedLanguage] ||
    window.NoSignalTranslations.en;
  return language[key] || window.NoSignalTranslations.en[key] || key;
}

function applyLanguage(languageCode) {
  const translations = window.NoSignalTranslations;
  selectedLanguage = Object.hasOwn(translations, languageCode) ? languageCode : 'en';
  document.documentElement.lang = selectedLanguage;
  languageSelect.value = selectedLanguage;

  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = translate(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.placeholder = translate(element.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((element) => {
    element.setAttribute('aria-label', translate(element.dataset.i18nAria));
  });

  updateNetworkStatus();
  renderContacts();
  renderGuides();
  renderShelters(shelters);
  renderMedicalCard();
  updateTimerDisplay();
  if (strobeRunning) {
    strobeButton.textContent = `${translate('stopPulse')} ■`;
  } else {
    strobeButton.textContent = translate('playPulse');
  }
}

function addLog(message, level = 'info') {
  const emptyRow = logElement.querySelector('.log-empty');
  if (emptyRow) {
    emptyRow.remove();
  }

  const row = document.createElement('li');
  row.dataset.level = level;
  const time = document.createElement('time');
  const text = document.createElement('span');

  time.className = 'log-time';
  time.dateTime = new Date().toISOString();
  time.textContent = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date());

  text.className = 'log-message';
  text.dataset.level = level;
  text.textContent = message;

  row.append(time, text);
  logElement.prepend(row);

  while (logElement.children.length > 50) {
    logElement.lastElementChild.remove();
  }
}

function readStoredValue(key, fallback, label) {
  try {
    const storedValue = localStorage.getItem(key);
    return storedValue === null ? fallback : JSON.parse(storedValue);
  } catch (error) {
    addLog(`${label} could not be loaded from this device: ${error.message}`, 'error');
    return fallback;
  }
}

function writeStoredValue(key, value, label) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    addLog(`${label} could not be saved on this device: ${error.message}`, 'error');
    return false;
  }
}

function readQueue() {
  try {
    const storedQueue = localStorage.getItem(queueKey);
    if (!storedQueue) {
      return [];
    }

    const parsedQueue = JSON.parse(storedQueue);
    if (!Array.isArray(parsedQueue)) {
      throw new Error('Stored offline queue is not a list.');
    }
    return parsedQueue;
  } catch (error) {
    queueAvailable = false;
    addLog(`Offline queue could not be loaded: ${error.message}`, 'error');
    return [];
  }
}

function saveQueue() {
  if (!queueAvailable) {
    return false;
  }

  try {
    localStorage.setItem(queueKey, JSON.stringify(pendingEvents));
    updateNetworkStatus();
    return true;
  } catch (error) {
    queueAvailable = false;
    addLog(`Offline queue could not be saved: ${error.message}`, 'error');
    return false;
  }
}

function updateNetworkStatus() {
  const online = navigator.onLine;
  const queuedCount = pendingEvents.filter((event) =>
    event.endpoint === '/api/checkin' || event.endpoint === '/api/sos'
  ).length;
  networkStatus.classList.toggle('is-offline', !online);
  networkLabel.textContent = `${translate(online ? 'networkOnline' : 'networkOffline')} · ${queuedCount} ${translate('queuedOffline')}`;
}

function createEventId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `event-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function enqueueEvent(event) {
  if (!queueAvailable) {
    addLog('This browser cannot save the offline queue; action was not recorded.', 'error');
    return false;
  }

  pendingEvents.push(event);
  if (!saveQueue()) {
    pendingEvents.pop();
    return false;
  }

  addLog(`${event.description} Saved on this device.`, 'success');
  await syncQueue();
  return true;
}

async function refreshContacts() {
  const response = await fetch('/api/contacts');
  if (!response.ok) {
    throw new Error(`Contacts request failed (HTTP ${response.status}).`);
  }
  const result = await response.json();
  if (!Array.isArray(result)) {
    throw new Error('Contacts response was not a list.');
  }
  contacts = result;
  writeStoredValue(contactsKey, contacts, 'Contacts');
  renderContacts();
}

async function syncQueue() {
  if (isSyncing || !navigator.onLine || pendingEvents.length === 0) {
    return;
  }

  isSyncing = true;
  try {
    while (navigator.onLine && pendingEvents.length > 0) {
      const event = pendingEvents[0];
      let response;

      try {
        response = await fetch(event.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event.payload)
        });
      } catch (error) {
        addLog(`Sync paused; ${pendingEvents.length} action(s) remain queued (${error.message}).`, 'warning');
        return;
      }

      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const result = await response.json();
          if (typeof result.error === 'string') {
            detail = result.error;
          }
        } catch {
          // Keep the HTTP status when the server does not return JSON.
        }
        addLog(`Sync failed; action remains queued (${detail}).`, 'error');
        return;
      }

      pendingEvents.shift();
      if (!saveQueue()) {
        addLog('The server accepted an action, but the local queue could not be updated.', 'error');
        return;
      }
      addLog(`${event.description} Synced to the response hub.`, 'success');

      if (event.resource === 'contacts') {
        try {
          await refreshContacts();
        } catch (error) {
          addLog(`Saved contact list could not be refreshed: ${error.message}`, 'warning');
        }
        if (event.resource === 'shelter-status') {
          await loadShelterStatuses();
        }
      }
    }
  } finally {
    isSyncing = false;
  }
}

async function loadCollection(endpoint, storageKey, label, render, getCached, emptyMessage) {
  if (navigator.onLine) {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(`${label} request failed (HTTP ${response.status}).`);
      }
      const result = await response.json();
      if (!Array.isArray(result)) {
        throw new Error(`${label} response was not a list.`);
      }
      writeStoredValue(storageKey, result, label);
      render(result);
      return;
    } catch (error) {
      addLog(`${label} could not be refreshed: ${error.message}`, 'warning');
    }
  }

  const cached = getCached();
  render(cached);
  if (cached.length > 0) {
    addLog(`${label} loaded from this device's offline cache.`);
  } else {
    emptyMessage();
  }
}

function addEmptyItem(list, message) {
  const item = document.createElement('li');
  item.className = 'list-empty';
  item.textContent = message;
  list.replaceChildren(item);
}

function renderContacts() {
  if (contacts.length === 0) {
    addEmptyItem(contactList, translate('contactsEmpty'));
    return;
  }

  const fragment = document.createDocumentFragment();
  contacts.forEach((contact) => {
    const item = document.createElement('li');
    item.className = 'contact-item';
    const topLine = document.createElement('div');
    topLine.className = 'contact-topline';
    const identity = document.createElement('div');
    identity.className = 'contact-identity';
    const avatar = document.createElement('span');
    avatar.className = 'contact-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = contact.name.trim().split(/\s+/).slice(0, 2)
      .map((part) => Array.from(part)[0] || '')
      .join('')
      .toLocaleUpperCase();
    const name = document.createElement('h3');
    name.className = 'item-title';
    name.textContent = contact.name;
    const relationship = document.createElement('span');
    relationship.className = 'shelter-location';
    relationship.textContent = contact.relationship;
    const phone = document.createElement('a');
    phone.className = 'item-meta contact-phone';
    phone.href = `tel:${contact.phone.replace(/[^\d+]/g, '')}`;
    phone.textContent = contact.phone;

    identity.append(avatar, name);
    topLine.append(identity, relationship);
    item.append(topLine, phone);
    fragment.append(item);
  });
  contactList.replaceChildren(fragment);
}

function getMedicalPayload(card) {
  return `Name:${card.name}|Blood:${card.bloodType}|Allergies:${card.allergies}|ICE:${card.emergencyContact}`;
}

function multiplyGaloisField(left, right) {
  if (left === 0 || right === 0) {
    return 0;
  }
  let product = 0;
  let value = left;
  for (let bit = 0; bit < 8; bit += 1) {
    if ((right >> bit) & 1) {
      product ^= value;
    }
    value <<= 1;
    if (value & 0x100) {
      value ^= 0x11d;
    }
  }
  return product;
}

function createMedicalQrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  if (bytes.length > 105) {
    throw new Error(translate('qrTooLong'));
  }
  const version = bytes.length <= 77 ? 4 : 5;
  const dataCodewordCount = version === 4 ? 80 : 108;
  const errorCorrectionCodewordCount = version === 4 ? 20 : 26;

  const bits = [];
  const appendBits = (value, length) => {
    for (let index = length - 1; index >= 0; index -= 1) {
      bits.push((value >>> index) & 1);
    }
  };
  appendBits(0b0111, 4);
  appendBits(26, 8);
  appendBits(0b0100, 4);
  appendBits(bytes.length, 8);
  bytes.forEach((byte) => appendBits(byte, 8));
  const dataCapacity = dataCodewordCount * 8;
  for (let index = 0; index < Math.min(4, dataCapacity - bits.length); index += 1) {
    bits.push(0);
  }
  while (bits.length % 8) {
    bits.push(0);
  }
  const data = [];
  for (let index = 0; index < bits.length; index += 8) {
    data.push(bits.slice(index, index + 8).reduce((value, bit) => (value << 1) | bit, 0));
  }
  for (let pad = 0; data.length < dataCodewordCount; pad += 1) {
    data.push(pad % 2 === 0 ? 0xec : 0x11);
  }

  let generator = [1];
  let rootValue = 1;
  for (let root = 0; root < errorCorrectionCodewordCount; root += 1) {
    const next = new Array(generator.length + 1).fill(0);
    generator.forEach((coefficient, index) => {
      next[index] ^= coefficient;
      next[index + 1] ^= multiplyGaloisField(coefficient, rootValue);
    });
    generator = next;
    rootValue = multiplyGaloisField(rootValue, 2);
  }
  const remainder = [...data, ...new Array(errorCorrectionCodewordCount).fill(0)];
  for (let index = 0; index < data.length; index += 1) {
    const factor = remainder[index];
    generator.forEach((coefficient, offset) => {
      remainder[index + offset] ^= multiplyGaloisField(coefficient, factor);
    });
  }
  const codewords = [...data, ...remainder.slice(data.length)];

  const size = version === 4 ? 33 : 37;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(null));
  const drawFinder = (top, left) => {
    for (let row = -1; row <= 7; row += 1) {
      for (let column = -1; column <= 7; column += 1) {
        const y = top + row;
        const x = left + column;
        if (y >= 0 && y < size && x >= 0 && x < size) {
          const distance = Math.max(Math.abs(row - 3), Math.abs(column - 3));
          matrix[y][x] = distance !== 2 && distance <= 3;
        }
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);
  for (let index = 8; index < size - 8; index += 1) {
    matrix[6][index] = index % 2 === 0;
    matrix[index][6] = index % 2 === 0;
  }
  for (let row = -2; row <= 2; row += 1) {
    for (let column = -2; column <= 2; column += 1) {
      matrix[size - 7 + row][size - 7 + column] =
        Math.max(Math.abs(row), Math.abs(column)) !== 1;
    }
  }

  const formatData = (1 << 3);
  let formatRemainder = formatData << 10;
  for (let bit = 14; bit >= 10; bit -= 1) {
    if ((formatRemainder >>> bit) & 1) {
      formatRemainder ^= 0x537 << (bit - 10);
    }
  }
  const formatBits = ((formatData << 10) | formatRemainder) ^ 0x5412;
  for (let index = 0; index <= 5; index += 1) {
    matrix[8][index] = ((formatBits >>> index) & 1) !== 0;
  }
  matrix[8][7] = ((formatBits >>> 6) & 1) !== 0;
  matrix[8][8] = ((formatBits >>> 7) & 1) !== 0;
  matrix[7][8] = ((formatBits >>> 8) & 1) !== 0;
  for (let index = 9; index < 15; index += 1) {
    matrix[14 - index][8] = ((formatBits >>> index) & 1) !== 0;
  }
  for (let index = 0; index < 8; index += 1) {
    matrix[size - 1 - index][8] = ((formatBits >>> index) & 1) !== 0;
  }
  for (let index = 8; index < 15; index += 1) {
    matrix[8][size - 15 + index] = ((formatBits >>> index) & 1) !== 0;
  }
  matrix[size - 8][8] = true;

  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right -= 1;
    }
    for (let vertical = 0; vertical < size; vertical += 1) {
      const row = upward ? size - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const column = right - offset;
        if (matrix[row][column] !== null) {
          continue;
        }
        const value = bitIndex < codewords.length * 8
          ? (codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1
          : 0;
        matrix[row][column] = Boolean(value ^ Number((row + column) % 2 === 0));
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
  return matrix;
}

function drawMedicalQr(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0 ||
      matrix.some((row) => !Array.isArray(row) || row.length !== matrix.length ||
        row.some((module) => typeof module !== 'boolean')) ||
      !matrix.some((row) => row.some(Boolean))) {
    throw new Error(translate('qrUnavailable'));
  }
  const context = medicalQr.getContext('2d');
  if (!context) {
    throw new Error(translate('qrUnavailable'));
  }
  const moduleSize = Math.floor(medicalQr.width / (matrix.length + 8));
  const quietZone = Math.floor((medicalQr.width - matrix.length * moduleSize) / 2);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, medicalQr.width, medicalQr.height);
  context.fillStyle = '#000';
  matrix.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) {
      context.fillRect(quietZone + x * moduleSize, quietZone + y * moduleSize, moduleSize, moduleSize);
    }
  }));
  medicalQr.setAttribute('role', 'img');
  medicalQr.setAttribute('aria-label', translate('medicalQrLabel'));
  medicalQr.hidden = false;
  medicalQrError.hidden = true;
}

function showMedicalQrMessage(message = translate('medicalCardIncomplete')) {
  const context = medicalQr.getContext('2d');
  if (context) {
    context.clearRect(0, 0, medicalQr.width, medicalQr.height);
  }
  medicalQr.hidden = true;
  medicalQr.removeAttribute('role');
  medicalQr.removeAttribute('aria-label');
  medicalQrError.textContent = message;
  medicalQrError.hidden = false;
}

function isValidMedicalCard(card) {
  return Boolean(card &&
    typeof card.name === 'string' && card.name.trim() &&
    typeof card.emergencyContact === 'string' && card.emergencyContact.trim());
}

function renderMedicalCard() {
  const card = readStoredValue(medicalCardKey, null, 'Medical card');
  if (card && typeof card === 'object') {
    medicalCardForm.elements.name.value = typeof card.name === 'string' ? card.name : '';
    medicalCardForm.elements.bloodType.value = typeof card.bloodType === 'string'
      ? card.bloodType
      : '';
    medicalCardForm.elements.allergies.value = typeof card.allergies === 'string'
      ? card.allergies
      : '';
    medicalCardForm.elements.emergencyContact.value =
      typeof card.emergencyContact === 'string' ? card.emergencyContact : '';
  }
  if (!isValidMedicalCard(card)) {
    showMedicalQrMessage();
    return;
  }
  try {
    drawMedicalQr(createMedicalQrMatrix(getMedicalPayload(card)));
  } catch (error) {
    showMedicalQrMessage(error.message);
  }
}

medicalCardForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(medicalCardForm);
  const card = {
    name: String(formData.get('name')).trim(),
    bloodType: String(formData.get('bloodType')).trim(),
    allergies: String(formData.get('allergies')).trim(),
    emergencyContact: String(formData.get('emergencyContact')).trim()
  };
  if (!isValidMedicalCard(card)) {
    showMedicalQrMessage();
    return;
  }
  try {
    const matrix = createMedicalQrMatrix(getMedicalPayload(card));
    if (!writeStoredValue(medicalCardKey, card, 'Medical card')) {
      return;
    }
    drawMedicalQr(matrix);
    addLog('Offline medical and ID QR card saved on this device.', 'success');
  } catch (error) {
    showMedicalQrMessage(error.message);
  }
});

const guideIconPaths = {
  'emergency basics': 'M12 3 21 8v5c0 4-3.7 6.8-9 9-5.3-2.2-9-5-9-9V8l9-5Zm-4 9 2.5 2.5L16 9',
  'first aid': 'M12 3v18M3 12h18',
  'natural hazards': 'M12 3 22 20H2L12 3Zm0 6v5m0 3h.01',
  preparedness: 'M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Zm0 0 8 4.5 8-4.5M12 12v9'
};

function createGuideIcon(category) {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.8');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', guideIconPaths[category.toLocaleLowerCase()] ||
    'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5');
  icon.append(path);
  return icon;
}

function renderGuides() {
  const query = guideSearch.value.trim().toLocaleLowerCase();
  const matchingGuides = guides.filter((guide) =>
    `${guide.title} ${guide.category} ${guide.content}`.toLocaleLowerCase().includes(query)
  );

  if (matchingGuides.length === 0) {
    addEmptyItem(guideList, guides.length
      ? translate('noSearch')
      : translate('noGuides'));
    return;
  }

  const fragment = document.createDocumentFragment();
  matchingGuides.forEach((guide) => {
    const item = document.createElement('li');
    item.className = 'guide-item';
    const categoryKey = guide.category.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    item.classList.add(`guide-${categoryKey}`);
    const heading = document.createElement('div');
    heading.className = 'guide-heading';
    const icon = document.createElement('span');
    icon.className = 'guide-icon';
    icon.append(createGuideIcon(guide.category));
    const headingCopy = document.createElement('div');
    headingCopy.className = 'guide-heading-copy';
    const category = document.createElement('span');
    category.className = 'guide-category';
    category.textContent = guide.category;
    const title = document.createElement('h3');
    title.className = 'item-title';
    title.textContent = guide.title;
    const content = document.createElement('p');
    content.className = 'guide-content';
    content.textContent = guide.content;
    const readAloud = document.createElement('button');
    readAloud.type = 'button';
    readAloud.className = 'small-button outline-button read-aloud-button';
    readAloud.textContent = translate('readAloud');
    readAloud.addEventListener('click', () => {
      if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== 'function') {
        addLog(translate('speechUnavailable'), 'warning');
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new window.SpeechSynthesisUtterance(`${guide.title}. ${guide.content}`);
      utterance.lang = selectedLanguage;
      window.speechSynthesis.speak(utterance);
    });
    headingCopy.append(category, title);
    heading.append(icon, headingCopy);
    item.append(heading, content, readAloud);
    fragment.append(item);
  });
  guideList.replaceChildren(fragment);
}

function setShelterMap(shelter) {
  const latitude = Number(shelter.latitude);
  const longitude = Number(shelter.longitude);
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    shelterMapWrap.hidden = true;
    shelterMapEmpty.hidden = false;
    mapSelection.textContent = '';
    addLog(`Map unavailable for ${shelter.name}: invalid coordinates.`, 'warning');
    return;
  }

  const point = `${latitude},${longitude}`;
  const mapUrl = new URL('https://www.google.com/maps');
  mapUrl.searchParams.set('q', point);
  mapUrl.searchParams.set('z', '14');
  mapUrl.searchParams.set('output', 'embed');
  if (selectedMapPoint !== point || shelterMapWrap.hidden) {
    shelterMap.src = mapUrl.toString();
    selectedMapPoint = point;
  }
  shelterMap.title = `${translate('mapTitle')}: ${shelter.name}`;
  mapSelection.textContent = shelter.name;
  shelterMapWrap.hidden = false;
  shelterMapEmpty.hidden = true;
  selectedShelterId = String(shelter.id);
}

function renderShelters(items) {
  shelters = items;
  if (shelters.length === 0) {
    shelterMapWrap.hidden = true;
    shelterMapEmpty.hidden = false;
    shelterMapNote.hidden = true;
    mapSelection.textContent = '';
    selectedMapPoint = '';
    addEmptyItem(
      shelterList,
      translate('shelterEmpty')
    );
    return;
  }

  shelterMapNote.hidden = false;
  if (!shelters.some((shelter) => String(shelter.id) === selectedShelterId)) {
    selectedShelterId = String(shelters[0].id);
  }

  const fragment = document.createDocumentFragment();
  shelters.forEach((shelter) => {
    const item = document.createElement('li');
    item.className = 'shelter-item';
    const topLine = document.createElement('div');
    topLine.className = 'shelter-topline';
    const name = document.createElement('h3');
    name.className = 'item-title';
    name.textContent = shelter.name;
    const coordinates = document.createElement('span');
    coordinates.className = 'shelter-location';
    coordinates.textContent = `${Number(shelter.latitude).toFixed(4)}, ${Number(shelter.longitude).toFixed(4)}`;
    const address = document.createElement('p');
    address.className = 'item-meta';
    address.textContent = shelter.address;
    const supplies = document.createElement('p');
    supplies.className = 'item-meta';
    supplies.textContent = `${translate('supplies')}: ${shelter.supplies}`;
    const report = shelterStatuses.find((entry) => Number(entry.shelterId) === Number(shelter.id));
    const status = document.createElement('p');
    status.className = 'item-meta shelter-status-summary';
    status.textContent = report
      ? `${translate('shelterStatus')}: ${translate(`shelter${report.status}`)} · ${translate('water')}: ${report.water ? translate('available') : translate('unavailable')} · ${translate('power')}: ${report.power ? translate('available') : translate('unavailable')}`
      : translate('noShelterReport');
    const actions = document.createElement('div');
    actions.className = 'shelter-actions';
    const showMapButton = document.createElement('button');
    showMapButton.type = 'button';
    showMapButton.className = 'small-button outline-button shelter-map-button';
    showMapButton.textContent = translate('showMap');
    showMapButton.addEventListener('click', () => setShelterMap(shelter));
    actions.append(showMapButton);

    const latitude = Number(shelter.latitude);
    const longitude = Number(shelter.longitude);
    if (
      Number.isFinite(latitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      Number.isFinite(longitude) &&
      longitude >= -180 &&
      longitude <= 180
    ) {
      const directionsUrl = new URL('https://www.google.com/maps/dir/');
      directionsUrl.searchParams.set('api', '1');
      directionsUrl.searchParams.set('destination', `${latitude},${longitude}`);
      const directions = document.createElement('a');
      directions.className = 'small-button safe-button shelter-directions';
      directions.href = directionsUrl.toString();
      directions.target = '_blank';
      directions.rel = 'noopener noreferrer';
      directions.textContent = translate('openMaps');
      actions.append(directions);
    }

    if (currentLocation &&
        Number.isFinite(currentLocation.latitude) &&
        currentLocation.latitude >= -90 && currentLocation.latitude <= 90 &&
        Number.isFinite(currentLocation.longitude) &&
        currentLocation.longitude >= -180 && currentLocation.longitude <= 180 &&
        Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
        Number.isFinite(longitude) && longitude >= -180 && longitude <= 180) {
      const { distance, bearing } = calculateShelterDirection(
        currentLocation.latitude,
        currentLocation.longitude,
        latitude,
        longitude
      );
      const direction = document.createElement('p');
      direction.className = 'item-meta';
      direction.textContent = `${translate('distance')}: ${distance.toFixed(1)} km · ${translate('bearing')}: ${bearing}° ${bearingToDirection(bearing)}`;
      item.append(direction);
    }

    const reportForm = document.createElement('form');
    reportForm.className = 'shelter-report-form';
    const statusLabel = document.createElement('label');
    statusLabel.textContent = translate('shelterStatus');
    const statusSelect = document.createElement('select');
    statusSelect.name = 'status';
    [['Open', 'shelterOpen'], ['Full', 'shelterFull'], ['Closed', 'shelterClosed']]
      .forEach(([value, key]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = translate(key);
        statusSelect.append(option);
      });
    statusLabel.append(statusSelect);
    const waterLabel = document.createElement('label');
    const waterInput = document.createElement('input');
    waterInput.type = 'checkbox';
    waterInput.name = 'water';
    waterInput.checked = report ? Boolean(report.water) : false;
    waterLabel.append(waterInput, document.createTextNode(translate('water')));
    const powerLabel = document.createElement('label');
    const powerInput = document.createElement('input');
    powerInput.type = 'checkbox';
    powerInput.name = 'power';
    powerInput.checked = report ? Boolean(report.power) : false;
    powerLabel.append(powerInput, document.createTextNode(translate('power')));
    const reportButton = document.createElement('button');
    reportButton.type = 'submit';
    reportButton.className = 'small-button outline-button';
    reportButton.textContent = translate('reportStatus');
    reportForm.append(statusLabel, waterLabel, powerLabel, reportButton);
    reportForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const nextReport = {
        shelterId: Number(shelter.id),
        status: statusSelect.value,
        water: waterInput.checked,
        power: powerInput.checked
      };
      const previousReports = shelterStatuses;
      shelterStatuses = [
        { ...nextReport, reportedAt: new Date().toISOString() },
        ...shelterStatuses.filter((entry) => Number(entry.shelterId) !== nextReport.shelterId)
      ];
      if (!writeStoredValue(shelterStatusesKey, shelterStatuses, 'Shelter reports')) {
        shelterStatuses = previousReports;
        return;
      }
      renderShelters(shelters);
      await enqueueEvent({
        endpoint: '/api/shelters/status',
        resource: 'shelter-status',
        description: `${translate('shelterStatus')} ${shelter.name}.`,
        payload: nextReport
      });
    });

    topLine.append(name, coordinates);
    item.append(topLine, address, supplies, status, actions, reportForm);
    fragment.append(item);
  });
  shelterList.replaceChildren(fragment);
  const selectedShelter = shelters.find((shelter) => String(shelter.id) === selectedShelterId);
  if (selectedShelter) {
    setShelterMap(selectedShelter);
  }
}

function calculateShelterDirection(latitude, longitude, destinationLatitude, destinationLongitude) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const deltaLatitude = radians(destinationLatitude - latitude);
  const deltaLongitude = radians(destinationLongitude - longitude);
  const a = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(radians(latitude)) * Math.cos(radians(destinationLatitude)) *
    Math.sin(deltaLongitude / 2) ** 2;
  const boundedA = Math.min(1, Math.max(0, a));
  const distance = 6371 * 2 * Math.atan2(Math.sqrt(boundedA), Math.sqrt(1 - boundedA));
  const y = Math.sin(deltaLongitude) * Math.cos(radians(destinationLatitude));
  const x = Math.cos(radians(latitude)) * Math.sin(radians(destinationLatitude)) -
    Math.sin(radians(latitude)) * Math.cos(radians(destinationLatitude)) *
    Math.cos(deltaLongitude);
  const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return { distance, bearing: Math.round(bearing) };
}

function bearingToDirection(bearing) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][
    Math.round(bearing / 45) % 8
  ];
}

async function loadShelterStatuses() {
  if (!navigator.onLine) {
    shelterStatuses = readStoredValue(shelterStatusesKey, [], 'Shelter reports');
    renderShelters(shelters);
    return;
  }
  try {
    const response = await fetch('/api/shelters/status');
    if (!response.ok) {
      throw new Error(`Shelter status request failed (HTTP ${response.status}).`);
    }
    const result = await response.json();
    if (!Array.isArray(result)) {
      throw new Error('Shelter status response was not a list.');
    }
    shelterStatuses = result;
    writeStoredValue(shelterStatusesKey, shelterStatuses, 'Shelter reports');
    renderShelters(shelters);
  } catch (error) {
    addLog(`Shelter reports could not be refreshed: ${error.message}`, 'warning');
  }
}

function isValidLocation(location) {
  return Boolean(location &&
    Number.isFinite(location.latitude) && location.latitude >= -90 && location.latitude <= 90 &&
    Number.isFinite(location.longitude) && location.longitude >= -180 && location.longitude <= 180);
}

async function getLocation() {
  const cachedLocation = currentLocation || readStoredValue(locationKey, null, 'Location');
  const cached = isValidLocation(cachedLocation) ? cachedLocation : null;
  if (!navigator.geolocation) {
    return cached ? { ...cached, simulated: false } : { latitude: 37.7749, longitude: -122.4194, simulated: true };
  }

  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        maximumAge: 60_000,
        timeout: 8_000
      });
    });
    const location = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      simulated: false
    };
    currentLocation = location;
    writeStoredValue(locationKey, location, 'Location');
    renderShelters(shelters);
    return location;
  } catch (error) {
    addLog(`Device location could not be refreshed; ${cached ? 'using its saved location' : 'using simulated coordinates'} (${error.message}).`, 'warning');
    return cached ? { ...cached, simulated: false } : { latitude: 37.7749, longitude: -122.4194, simulated: true };
  }
}

useLocationButton.addEventListener('click', async () => {
  if (!navigator.geolocation) {
    addLog(translate('locationUnavailable'), 'warning');
    return;
  }
  useLocationButton.disabled = true;
  try {
    const location = await getLocation();
    if (location.simulated) {
      addLog(translate('locationUnavailable'), 'warning');
      return;
    }
    addLog(translate('locationUpdated'), 'success');
  } finally {
    useLocationButton.disabled = false;
  }
});

async function getBatteryPercentage() {
  if (batteryManager) {
    return { percentage: Math.round(batteryManager.level * 100), simulated: false };
  }
  if (typeof navigator.getBattery === 'function') {
    try {
      const battery = await navigator.getBattery();
      batteryManager = battery;
      return { percentage: Math.round(battery.level * 100), simulated: false };
    } catch {
      addLog('Battery telemetry is unavailable; using the documented fallback value.', 'warning');
    }
  }
  if (navigator.battery && Number.isFinite(navigator.battery.level)) {
    return { percentage: Math.round(navigator.battery.level * 100), simulated: false };
  }
  return { percentage: 85, simulated: true };
}

function updateUltraSurvivalMode(level) {
  const wasEnabled = document.documentElement.dataset.ultraSurvival === 'true';
  document.documentElement.dataset.ultraSurvival = level < 0.15 ? 'true' : 'false';
  if (level < 0.15 && !wasEnabled) {
    addLog(translate('ultraSurvivalEnabled'), 'warning');
  }
}

async function monitorBattery() {
  if (typeof navigator.getBattery !== 'function' && !navigator.battery) {
    return;
  }
  try {
    batteryManager = typeof navigator.getBattery === 'function'
      ? await navigator.getBattery()
      : navigator.battery;
    updateUltraSurvivalMode(batteryManager.level);
    batteryManager.addEventListener('levelchange', () => {
      updateUltraSurvivalMode(batteryManager.level);
    });
  } catch (error) {
    addLog(`Battery saver mode could not be monitored: ${error.message}`, 'warning');
  }
}

async function queueSos(description) {
  addLog('Collecting location and battery telemetry…');
  const [location, battery] = await Promise.all([
    getLocation(),
    getBatteryPercentage()
  ]);
  const eventId = createEventId();
  const telemetry = [
    location.simulated ? 'simulated location' : 'device location',
    battery.simulated ? 'simulated battery' : 'device battery'
  ].join(', ');

  const saved = await enqueueEvent({
    eventId,
    endpoint: '/api/sos',
    description: `${description} (${telemetry}; ${battery.percentage}% battery).`,
    payload: {
      eventId,
      latitude: location.latitude,
      longitude: location.longitude,
      batteryPercentage: battery.percentage
    }
  });
  if (!saved) {
    addLog('SOS beacon could not be saved to the offline queue.', 'error');
  }
}

checkinButton.addEventListener('click', async () => {
  actionButtons.forEach((button) => { button.disabled = true; });
  try {
    const eventId = createEventId();
    await enqueueEvent({
      eventId,
      endpoint: '/api/checkin',
      description: 'Safety check-in.',
      payload: { eventId, message: 'I am safe and accounted for.' }
    });
  } finally {
    actionButtons.forEach((button) => { button.disabled = false; });
  }
});

sosButton.addEventListener('click', async () => {
  actionButtons.forEach((button) => { button.disabled = true; });
  try {
    await queueSos('SOS beacon recorded');
  } finally {
    actionButtons.forEach((button) => { button.disabled = false; });
  }
});

contactForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(contactForm);
  const contact = {
    clientId: createEventId(),
    name: String(formData.get('name')).trim(),
    phone: String(formData.get('phone')).trim(),
    relationship: String(formData.get('relationship')).trim()
  };
  const submitButton = contactForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    contacts.unshift(contact);
    if (!writeStoredValue(contactsKey, contacts, 'Contacts')) {
      contacts.shift();
      return;
    }
    renderContacts();
    contactForm.reset();
    await enqueueEvent({
      endpoint: '/api/contacts',
      resource: 'contacts',
      description: `Emergency contact saved for ${contact.name}.`,
      payload: contact
    });
  } finally {
    submitButton.disabled = false;
  }
});

guideSearch.addEventListener('input', renderGuides);

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const dotDuration = 180;
const morsePattern = [];
['...', '---', '...'].forEach((letter) => {
  [...letter].forEach((mark, index, marks) => {
    morsePattern.push({
      lit: true,
      duration: mark === '.' ? dotDuration : dotDuration * 3
    });
    morsePattern.push({
      lit: false,
      duration: index === marks.length - 1 ? dotDuration * 3 : dotDuration
    });
  });
});

function stopStrobe(message = 'SIMULATOR IDLE') {
  strobeRunning = false;
  window.clearTimeout(strobeTimeout);
  strobeDisplay.classList.remove('is-lit');
  strobeDisplay.setAttribute('aria-label', 'Strobe simulator idle');
  strobeLabel.textContent = message === 'SIMULATOR IDLE'
    ? translate('strobeIdle')
    : message === 'SOS PULSE COMPLETE'
      ? translate('pulseComplete')
      : message;
  strobeButton.textContent = translate('playPulse');
  releaseCameraTorch();
}

function playMorsePulse(index = 0) {
  if (!strobeRunning || index >= morsePattern.length) {
    stopStrobe('SOS PULSE COMPLETE');
    return;
  }

  const pulse = morsePattern[index];
  strobeDisplay.classList.toggle('is-lit', pulse.lit);
  void applyCameraTorch(pulse.lit);
  strobeDisplay.setAttribute('aria-label', pulse.lit ? 'SOS pulse on' : 'SOS pulse off');
  strobeLabel.textContent = translate(pulse.lit ? 'pulseOn' : 'pulseOff');
  strobeTimeout = window.setTimeout(() => playMorsePulse(index + 1), pulse.duration);
}

strobeButton.addEventListener('click', async () => {
  if (strobeRunning) {
    stopStrobe();
    addLog('Visual SOS pulse stopped.');
    return;
  }

  if (reducedMotion.matches) {
    strobeLabel.textContent = 'SOS ··· −−− ··· · REDUCED MOTION';
    addLog('Visual flashing is disabled by the reduced-motion preference.', 'warning');
    return;
  }

  strobeRunning = true;
  strobeButton.textContent = `${translate('stopPulse')} ■`;
  await prepareCameraTorch();
  addLog('SOS Morse pulse started on screen; camera torch activates only if supported and permitted.');
  playMorsePulse();
});

async function prepareCameraTorch() {
  if (cameraStream || !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function') {
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }
    });
    const track = cameraStream.getVideoTracks()[0];
    if (!track || !track.getCapabilities || !track.getCapabilities().torch) {
      addLog('Camera torch is not supported on this device; screen SOS remains available.', 'warning');
      releaseCameraTorch();
    }
  } catch (error) {
    addLog(`Camera torch unavailable; screen SOS remains available (${error.message}).`, 'warning');
  }
}

async function applyCameraTorch(enabled) {
  const track = cameraStream && cameraStream.getVideoTracks()[0];
  if (!track || !track.getCapabilities || !track.getCapabilities().torch) {
    return;
  }
  try {
    await track.applyConstraints({ advanced: [{ torch: enabled }] });
  } catch (error) {
    addLog(`Camera torch could not be switched: ${error.message}`, 'warning');
  }
}

function releaseCameraTorch() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
}

whistleButton.addEventListener('click', async () => {
  if (whistleOscillator) {
    whistleOscillator.stop();
    whistleOscillator = null;
    await whistleContext.close();
    whistleContext = null;
    whistleButton.textContent = translate('startWhistle');
    addLog(translate('whistleStopped'));
    return;
  }
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      throw new Error(translate('audioUnavailable'));
    }
    whistleContext = new AudioContext();
    await whistleContext.resume();
    whistleOscillator = whistleContext.createOscillator();
    const gain = whistleContext.createGain();
    whistleOscillator.frequency.value = 3000;
    gain.gain.value = 0.15;
    whistleOscillator.connect(gain);
    gain.connect(whistleContext.destination);
    whistleOscillator.start();
    whistleButton.textContent = translate('stopWhistle');
    addLog(translate('whistleStarted'), 'warning');
  } catch (error) {
    addLog(`${translate('audioUnavailable')}: ${error.message}`, 'error');
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && strobeRunning) {
    stopStrobe('SIMULATOR PAUSED');
    addLog('Strobe simulator paused while the page is hidden.');
  }
  if (!document.hidden) {
    updateTimerDisplay();
  }
  if (document.hidden && whistleOscillator) {
    whistleOscillator.stop();
    whistleOscillator = null;
    void whistleContext.close();
    whistleContext = null;
    whistleButton.textContent = translate('startWhistle');
  }
});

function formatDuration(seconds) {
  const wholeSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(remainingMinutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function saveTimerState() {
  return writeStoredValue(timerKey, timerState, 'Safety countdown');
}

function setTimerProgress(percentage) {
  const boundedPercentage = Number.isFinite(percentage)
    ? Math.min(100, Math.max(0, percentage))
    : 0;
  timerProgress.setAttribute('aria-valuenow', String(Math.round(boundedPercentage)));
  timerProgressFill.style.width = `${boundedPercentage}%`;
}

function updateTimerDisplay() {
  if (!timerState) {
    timerCountdown.textContent = formatDuration(Number(timerDuration.value) || 300);
    timerStatus.textContent = translate('noTimer');
    timerAckButton.disabled = true;
    timerCard.dataset.state = 'idle';
    timerCard.dataset.urgency = 'inactive';
    setTimerProgress(100);
    return;
  }

  timerCard.dataset.state = timerState.status;
  timerAckButton.disabled = timerState.status !== 'active';
  timerStatus.textContent = {
    active: translate('timerActive'),
    acknowledged: translate('timerAcked'),
    triggered: translate('timerTriggered')
  }[timerState.status] || translate('noTimer');

  if (timerState.status === 'active') {
    const remainingSeconds = (Date.parse(timerState.deadlineAt) - Date.now()) / 1000;
    timerCountdown.textContent = formatDuration(remainingSeconds);
    const durationSeconds = Number(timerState.durationSeconds);
    const progress = Number.isFinite(durationSeconds) && durationSeconds > 0
      ? remainingSeconds / durationSeconds * 100
      : 0;
    timerCard.dataset.urgency = progress <= 10
      ? 'urgent'
      : progress <= 25 ? 'approaching' : 'active';
    setTimerProgress(progress);
    if (remainingSeconds <= 0) {
      void expireSafetyTimer();
    }
  } else {
    timerCountdown.textContent = timerState.status === 'acknowledged'
      ? 'SAFE'
      : 'SOS';
    timerCard.dataset.urgency = timerState.status === 'acknowledged'
      ? 'safe'
      : 'urgent';
    setTimerProgress(timerState.status === 'acknowledged' ? 100 : 0);
  }
}

timerDuration.addEventListener('input', updateTimerDisplay);

function startTimerTicker() {
  window.clearInterval(timerInterval);
  updateTimerDisplay();
  timerInterval = window.setInterval(updateTimerDisplay, 1000);
}

timerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const durationSeconds = Number(timerDuration.value);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 86400) {
    addLog('Countdown duration must be between 10 seconds and 24 hours.', 'error');
    return;
  }

  timerStartButton.disabled = true;
  try {
    const nextTimer = {
      timerId: createEventId(),
      status: 'active',
      durationSeconds,
      deadlineAt: new Date(Date.now() + durationSeconds * 1000).toISOString()
    };
    const previousTimer = timerState;
    timerState = nextTimer;
    if (!saveTimerState()) {
      timerState = previousTimer;
      return;
    }

    startTimerTicker();
    addLog(`Safety countdown started for ${formatDuration(durationSeconds)}.`);
    await enqueueEvent({
      endpoint: '/api/timer',
      resource: 'timer',
      description: 'Safety countdown configured.',
      payload: {
        action: 'configure',
        timerId: nextTimer.timerId,
        durationSeconds,
        deadlineAt: nextTimer.deadlineAt
      }
    });
  } finally {
    timerStartButton.disabled = false;
  }
});

timerAckButton.addEventListener('click', async () => {
  if (!timerState || timerState.status !== 'active') {
    return;
  }
  if (Date.parse(timerState.deadlineAt) <= Date.now()) {
    void expireSafetyTimer();
    return;
  }

  const acknowledgedTimer = { ...timerState, status: 'acknowledged' };
  timerState = acknowledgedTimer;
  if (!saveTimerState()) {
    timerState = { ...acknowledgedTimer, status: 'active' };
    return;
  }
  updateTimerDisplay();
  addLog('Safety countdown acknowledged.', 'success');
  await enqueueEvent({
    endpoint: '/api/timer',
    resource: 'timer',
    description: 'Safety countdown acknowledged.',
    payload: { action: 'acknowledge', timerId: timerState.timerId }
  });
});

async function expireSafetyTimer() {
  if (isExpiringTimer || !timerState || timerState.status !== 'active') {
    return;
  }
  isExpiringTimer = true;
  timerState = { ...timerState, status: 'triggered' };
  if (!saveTimerState()) {
    addLog('Countdown expired, but this device could not save the alert state; open storage is required for reliable alert queuing.', 'error');
    isExpiringTimer = false;
    return;
  }
  updateTimerDisplay();
  addLog('Safety countdown expired. Attempting to record an SOS beacon; no one is contacted automatically.', 'error');

  try {
    await enqueueEvent({
      endpoint: '/api/timer',
      resource: 'timer',
      description: 'Safety countdown expiry recorded.',
      payload: { action: 'trigger', timerId: timerState.timerId }
    });
    await queueSos('Automatic SOS beacon recorded after countdown expiry');
  } finally {
    isExpiringTimer = false;
  }
}

async function loadTimer() {
  const storedTimer = readStoredValue(timerKey, null, 'Safety countdown');
  if (storedTimer && typeof storedTimer.deadlineAt === 'string' &&
      ['active', 'acknowledged', 'triggered'].includes(storedTimer.status)) {
    timerState = storedTimer;
  }

  if (navigator.onLine) {
    try {
      const response = await fetch('/api/timer');
      if (!response.ok) {
        throw new Error(`Timer request failed (HTTP ${response.status}).`);
      }
      const result = await response.json();
      if (result.preferences && Number.isInteger(result.preferences.defaultDurationSeconds)) {
        timerDuration.value = String(result.preferences.defaultDurationSeconds);
      }
      if (!timerState && result.timer &&
          ['active', 'acknowledged', 'triggered'].includes(result.timer.status)) {
        timerState = result.timer;
        saveTimerState();
      }
    } catch (error) {
      addLog(`Saved countdown could not be loaded: ${error.message}`, 'warning');
    }
  }

  startTimerTicker();
}

function formatTriageTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

async function loadTriage() {
  try {
    const response = await fetch('/api/triage');
    if (!response.ok) {
      throw new Error(`Triage request failed (HTTP ${response.status}).`);
    }
    const items = await response.json();
    if (!Array.isArray(items)) {
      throw new Error('Triage response was not a list.');
    }
    items.sort((left, right) => {
      const leftPriority = (left.resolved ? 2 : 0) + (left.type === 'sos' ? 0 : 1);
      const rightPriority = (right.resolved ? 2 : 0) + (right.type === 'sos' ? 0 : 1);
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      if (left.type !== right.type) {
        return left.type === 'sos' ? -1 : 1;
      }
      if (left.type === 'sos' && left.batteryPercentage !== right.batteryPercentage) {
        return (left.batteryPercentage ?? Infinity) - (right.batteryPercentage ?? Infinity);
      }
      return Date.parse(left.createdAt) - Date.parse(right.createdAt);
    });

    if (items.length === 0) {
      const emptyRow = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = translate('noTriage');
      emptyRow.append(cell);
      triageRows.replaceChildren(emptyRow);
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((entry) => {
      const row = document.createElement('tr');
      row.dataset.type = entry.type;
      const typeCell = document.createElement('td');
      typeCell.textContent = translate(entry.type === 'sos' ? 'sosButton' : 'safeButton');
      const detailsCell = document.createElement('td');
      detailsCell.textContent = entry.type === 'sos'
        ? `${Number(entry.latitude).toFixed(5)}, ${Number(entry.longitude).toFixed(5)}`
        : entry.message;
      const batteryCell = document.createElement('td');
      batteryCell.textContent = entry.type === 'sos'
        ? `${entry.batteryPercentage}%`
        : '—';
      const timeCell = document.createElement('td');
      timeCell.textContent = formatTriageTime(entry.createdAt);
      const actionCell = document.createElement('td');
      if (entry.type === 'sos' && !entry.resolved) {
        const resolveButton = document.createElement('button');
        resolveButton.type = 'button';
        resolveButton.className = 'small-button safe-button';
        resolveButton.textContent = translate('markResolved');
        resolveButton.addEventListener('click', async () => {
          resolveButton.disabled = true;
          try {
            const result = await fetch(`/api/beacons/${encodeURIComponent(entry.id)}/resolve`, {
              method: 'PATCH'
            });
            if (!result.ok) {
              const details = await result.json().catch(() => ({}));
              throw new Error(details.error || `HTTP ${result.status}`);
            }
            await loadTriage();
          } catch (error) {
            resolveButton.disabled = false;
            addLog(`Beacon could not be resolved: ${error.message}`, 'error');
          }
        });
        actionCell.append(resolveButton);
      } else {
        actionCell.textContent = entry.resolved ? translate('resolved') : '—';
      }
      row.append(typeCell, detailsCell, batteryCell, timeCell, actionCell);
      fragment.append(row);
    });
    triageRows.replaceChildren(fragment);
  } catch (error) {
    addLog(`Responder triage could not be refreshed: ${error.message}`, 'warning');
  }
}

function connectLiveEvents() {
  if (!('EventSource' in window)) {
    addLog(translate('liveEventsUnavailable'), 'warning');
    return;
  }
  triageSource = new EventSource('/api/events');
  triageSource.addEventListener('open', () => {
    liveEventWarningLogged = false;
  });
  triageSource.addEventListener('update', (event) => {
    const update = JSON.parse(event.data);
    if (isRespondersRoute) {
      void loadTriage();
    }
    if (update.type === 'shelter-status') {
      void loadShelterStatuses();
    }
  });
  triageSource.addEventListener('error', () => {
    if (navigator.onLine && !liveEventWarningLogged) {
      liveEventWarningLogged = true;
      addLog(translate('liveEventsReconnecting'), 'warning');
    }
  });
}

if (isRespondersRoute) {
  dashboard.hidden = true;
  respondersView.hidden = false;
}

window.addEventListener('online', () => {
  updateNetworkStatus();
  addLog('Connection restored; syncing queued actions.');
  void syncQueue();
  void loadCollection('/api/guides', guidesKey, 'Survival guides', (items) => {
    guides = items;
    renderGuides();
  }, () => readStoredValue(guidesKey, [], 'Survival guides'), () => renderGuides());
  void loadCollection('/api/shelters', sheltersKey, 'Shelter directory', renderShelters,
    () => readStoredValue(sheltersKey, [], 'Shelter directory'),
    () => renderShelters([]));
  void loadShelterStatuses();
  if (isRespondersRoute) {
    void loadTriage();
  }
});

window.addEventListener('offline', () => {
  updateNetworkStatus();
  addLog('Connection lost; new actions will be queued on this device.', 'warning');
});

languageSelect.addEventListener('change', () => {
  const languageCode = languageSelect.value;
  if (!writeStoredValue('resilinet.language.v1', languageCode, 'Language preference')) {
    applyLanguage(selectedLanguage);
    return;
  }
  applyLanguage(languageCode);
  addLog(`Interface language changed to ${languageSelect.selectedOptions[0].textContent}.`);
});

applyLanguage(readStoredValue('resilinet.language.v1', 'en', 'Language preference'));
updateNetworkStatus();
pendingEvents = readQueue();
updateNetworkStatus();
currentLocation = readStoredValue(locationKey, null, 'Location');
if (!isValidLocation(currentLocation)) {
  currentLocation = null;
}
shelterStatuses = readStoredValue(shelterStatusesKey, [], 'Shelter reports');
contacts = readStoredValue(contactsKey, [], 'Contacts');
guides = readStoredValue(guidesKey, [], 'Survival guides');
renderContacts();
renderGuides();
void loadCollection('/api/contacts', contactsKey, 'Contacts', (items) => {
  contacts = items;
  renderContacts();
}, () => contacts, renderContacts);
void loadCollection('/api/guides', guidesKey, 'Survival guides', (items) => {
  guides = items;
  renderGuides();
}, () => guides, renderGuides);
void loadCollection('/api/shelters', sheltersKey, 'Shelter directory', renderShelters,
  () => readStoredValue(sheltersKey, [], 'Shelter directory'),
  () => renderShelters([]));
void loadShelterStatuses();
if (isRespondersRoute) {
  void loadTriage();
}
addLog(`Response hub ready. ${pendingEvents.length} action(s) waiting to sync.`);
void syncQueue();
void loadTimer();
void monitorBattery();
connectLiveEvents();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch((error) => {
    addLog(`Offline app shell could not be installed: ${error.message}`, 'warning');
  });
}
