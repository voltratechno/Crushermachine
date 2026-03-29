// Crusher Machine Monitor - JavaScript with MQTT

// ===== GLOBAL VARIABLES =====
let vibrationChart = null;
let currentAxis = 'x';
let chartData = {
    x: [],
    y: [],
    z: []
};
const maxDataPoints = 20;

// ===== MQTT VARIABLES =====
let mqttClient = null;
let isConnected = false;
let lastDataReceivedTime = 0;
const CONNECTION_TIMEOUT = 10000; // 10 seconds without data = disconnected
const MQTT_BROKER = 'broker.emqx.io';
const MQTT_PORT = 8083;  // WebSocket port
const MQTT_PATH = '/mqtt';
const MQTT_TOPICS = {
    temp: 'crusher/sensor/temperature',
    accel: 'crusher/sensor/accelerometer',
    all: 'crusher/sensor/all',
    alert: 'crusher/alert',
    status: 'crusher/status'
};

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    // Initialize login form
    initLoginForm();

    // Check if user is logged in
    checkLoginState();

    // Initialize chart tabs
    initChartTabs();
});

// ===== LOGIN SYSTEM =====
function initLoginForm() {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    // Check for saved credentials
    const savedUsername = localStorage.getItem('crusher_username');
    const rememberMe = localStorage.getItem('crusher_remember');

    if (savedUsername && rememberMe === 'true') {
        document.getElementById('username').value = savedUsername;
        document.getElementById('rememberMe').checked = true;
    }
}

function handleLogin(e) {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const rememberMe = document.getElementById('rememberMe').checked;

    // Simple validation (in production, use proper authentication)
    if (username && password) {
        // Save credentials if remember me is checked
        if (rememberMe) {
            localStorage.setItem('crusher_username', username);
            localStorage.setItem('crusher_remember', 'true');
        } else {
            localStorage.removeItem('crusher_username');
            localStorage.removeItem('crusher_remember');
        }

        // Save session
        sessionStorage.setItem('crusher_logged_in', 'true');
        sessionStorage.setItem('crusher_username', username);

        // Show dashboard
        showDashboard();
    } else {
        alert('Silakan masukkan username dan password');
    }
}

function checkLoginState() {
    const isLoggedIn = sessionStorage.getItem('crusher_logged_in');

    if (isLoggedIn === 'true') {
        showDashboard();
    }
}

function showDashboard() {
    document.getElementById('loginPage').classList.remove('active');
    document.getElementById('dashboardPage').classList.add('active');

    // Initialize lastDataReceivedTime to 0 (not connected yet)
    lastDataReceivedTime = 0;

    // Set initial connection status
    updateConnectionStatus('connecting');

    // Connect to MQTT and start sensor updates
    connectMQTT();
}

function logout() {
    if (confirm('Apakah Anda yakin ingin keluar?')) {
        sessionStorage.removeItem('crusher_logged_in');
        sessionStorage.removeItem('crusher_username');

        // Disconnect MQTT
        disconnectMQTT();

        // Show login page
        document.getElementById('dashboardPage').classList.remove('active');
        document.getElementById('loginPage').classList.add('active');

        // Clear form
        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
    }
}

function togglePassword() {
    const passwordInput = document.getElementById('password');
    const toggleBtn = document.querySelector('.toggle-password i');

    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggleBtn.classList.remove('fa-eye');
        toggleBtn.classList.add('fa-eye-slash');
    } else {
        passwordInput.type = 'password';
        toggleBtn.classList.remove('fa-eye-slash');
        toggleBtn.classList.add('fa-eye');
    }
}

// ===== MQTT CONNECTION =====
function connectMQTT() {
    const clientId = 'crusher_web_' + Math.random().toString(16).substr(2, 8);
    const connectUrl = `ws://${MQTT_BROKER}:${MQTT_PORT}${MQTT_PATH}`;

    console.log('Connecting to MQTT broker:', connectUrl);

    const options = {
        clientId: clientId,
        clean: true,
        connectTimeout: 30 * 1000,
        reconnectPeriod: 5000,
    };

    mqttClient = mqtt.connect(connectUrl, options);

    mqttClient.on('connect', () => {
        console.log('✓ MQTT Connected!');
        isConnected = true;
        updateConnectionStatus('connected');

        // Subscribe to all topics
        mqttClient.subscribe(MQTT_TOPICS.temp, { qos: 0 });
        mqttClient.subscribe(MQTT_TOPICS.accel, { qos: 0 });
        mqttClient.subscribe(MQTT_TOPICS.all, { qos: 0 });
        mqttClient.subscribe(MQTT_TOPICS.alert, { qos: 0 });
        mqttClient.subscribe(MQTT_TOPICS.status, { qos: 0 });

        console.log('Subscribed to topics:');
        console.log(' -', MQTT_TOPICS.temp);
        console.log(' -', MQTT_TOPICS.accel);
        console.log(' -', MQTT_TOPICS.all);
        console.log(' -', MQTT_TOPICS.alert);
        console.log(' -', MQTT_TOPICS.status);
    });

    mqttClient.on('message', (topic, message) => {
        const payload = message.toString();
        console.log('Received:', topic, payload);

        // Update last data received time
        lastDataReceivedTime = Date.now();

        if (topic === MQTT_TOPICS.all) {
            // Parse all sensor data
            try {
                const data = JSON.parse(payload);
                if (data.temperature && data.accel) {
                    updateSensorData(data.temperature, data.accel.x, data.accel.y, data.accel.z);
                }
            } catch (e) {
                console.error('Error parsing all data:', e);
            }
        } else if (topic === MQTT_TOPICS.temp) {
            // Temperature only - store for later use
            sessionStorage.setItem('last_temp', payload);
        } else if (topic === MQTT_TOPICS.accel) {
            // Accelerometer only - store for later use
            sessionStorage.setItem('last_accel', payload);
        } else if (topic === MQTT_TOPICS.alert) {
            // Alert message - show popup
            try {
                const alertData = JSON.parse(payload);
                handleAlertMessage(alertData);
            } catch (e) {
                console.error('Error parsing alert data:', e);
            }
        } else if (topic === MQTT_TOPICS.status) {
            // Status update
            try {
                const statusData = JSON.parse(payload);
                console.log('Status:', statusData.status);
            } catch (e) {
                console.error('Error parsing status data:', e);
            }
        }
    });

    mqttClient.on('error', (err) => {
        console.error('MQTT Error:', err);
        isConnected = false;
        updateConnectionStatus('error');
    });

    mqttClient.on('close', () => {
        console.log('MQTT Connection closed');
        isConnected = false;
        updateConnectionStatus('error');
    });

    mqttClient.on('reconnect', () => {
        console.log('MQTT Reconnecting...');
        updateConnectionStatus('connecting');
    });
}

function disconnectMQTT() {
    if (mqttClient) {
        mqttClient.end();
        mqttClient = null;
        console.log('MQTT Disconnected');
    }
}

// ===== SENSOR DATA UPDATES =====
let sensorUpdateInterval = null;
let currentMachineStatus = 'normal'; // Track current status
let lastPopupTime = 0;
const POPUP_COOLDOWN = 30000; // 30 seconds cooldown between popups

// Thresholds (sesuai ESP32)
const THRESHOLDS = {
    temp: {
        warning: 80.0,
        critical: 90.0
    },
    vibration: {
        warning: 3.0,
        critical: 8.0
    }
};

function updateSensorData(temp, vibX, vibY, vibZ) {
    // Update display values
    document.getElementById('vibX').textContent = vibX.toFixed(2);
    document.getElementById('vibY').textContent = vibY.toFixed(2);
    document.getElementById('vibZ').textContent = vibZ.toFixed(2);

    // Update sensor statuses dengan threshold sesuai ESP32
    updateSensorStatus('vibX', vibX, THRESHOLDS.vibration.warning, THRESHOLDS.vibration.critical);
    updateSensorStatus('vibY', vibY, THRESHOLDS.vibration.warning, THRESHOLDS.vibration.critical);
    updateSensorStatus('vibZ', vibZ, THRESHOLDS.vibration.warning, THRESHOLDS.vibration.critical);

    // Update gauge
    updateGauge(temp);

    // Update chart data
    updateChartData(vibX, vibY, vibZ);

    // Update machine status - simpan status sebelumnya untuk deteksi perubahan
    const previousStatus = currentMachineStatus;
    updateMachineStatus();

    // Check untuk popup hanya saat status BERUBAH dari normal ke warning/critical
    // atau sebaliknya dari warning/critical ke normal
    const newStatus = currentMachineStatus;
    if (newStatus !== previousStatus) {
        console.log('Status changed from', previousStatus, 'to', newStatus);

        // Tampilkan popup saat status berubah ke warning atau critical
        if (newStatus === 'warning' || newStatus === 'critical') {
            showAlertPopup(newStatus, temp, vibX, vibY, vibZ);
        }
    }

    // Check for alerts di list notifikasi
    checkForAlerts(temp, vibX, vibY, vibZ);
}

function updateSensorStatus(sensorId, value, warningThreshold, criticalThreshold) {
    const statusElement = document.getElementById(sensorId + 'Status');
    const numValue = parseFloat(value);

    if (numValue >= criticalThreshold) {
        statusElement.textContent = 'CRITICAL';
        statusElement.className = 'sensor-status critical';
    } else if (numValue >= warningThreshold) {
        statusElement.textContent = 'WARNING';
        statusElement.className = 'sensor-status warning';
    } else {
        statusElement.textContent = 'Normal';
        statusElement.className = 'sensor-status';
    }
}

function updateMachineStatus() {
    const statusBadge = document.getElementById('machineStatus');
    const statusText = statusBadge.querySelector('.status-text');

    // Check if any sensor is in critical, danger, or warning
    const hasCritical = document.querySelectorAll('.sensor-status.critical').length > 0;
    const hasDanger = document.querySelectorAll('.sensor-status.danger').length > 0;
    const hasWarning = document.querySelectorAll('.sensor-status.warning').length > 0;

    if (hasCritical || hasDanger) {
        statusText.textContent = 'CRITICAL';
        statusBadge.className = 'status-badge critical';
        currentMachineStatus = 'critical';
    } else if (hasWarning) {
        statusText.textContent = 'WARNING';
        statusBadge.className = 'status-badge warning';
        currentMachineStatus = 'warning';
    } else {
        statusText.textContent = 'NORMAL';
        statusBadge.className = 'status-badge';
        currentMachineStatus = 'normal';
    }
}

// ===== TEMPERATURE GAUGE =====
function updateGauge(temp) {
    const gaugeFill = document.getElementById('gaugeFill');
    const gaugeValue = document.getElementById('gaugeValue');

    // Update value display
    gaugeValue.textContent = temp.toFixed(0);

    // Calculate percentage (max 100°C)
    const percentage = Math.min(temp / 100, 1);

    // Semi-circle arc length (π * radius) where radius = 80
    const arcLength = Math.PI * 80;
    const drawLength = arcLength * percentage;

    // Update gauge stroke (from 0 to full arc)
    gaugeFill.style.strokeDasharray = `${drawLength} ${arcLength}`;
}

// ===== VIBRATION CHART =====
function initChartTabs() {
    const tabs = document.querySelectorAll('.chart-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active class from all tabs
            tabs.forEach(t => t.classList.remove('active'));
            // Add active class to clicked tab
            tab.classList.add('active');
            // Update current axis
            currentAxis = tab.dataset.axis;
            // Update chart
            if (vibrationChart) {
                vibrationChart.data.datasets[0].data = chartData[currentAxis];
                vibrationChart.data.datasets[0].label = `Vibrasi ${currentAxis.toUpperCase()} (m/s²)`;
                vibrationChart.data.datasets[0].borderColor = getAxisColor(currentAxis);
                vibrationChart.data.datasets[0].backgroundColor = getAxisColor(currentAxis) + '33';
                vibrationChart.update('none');
            }
        });
    });

    // Initialize chart
    initVibrationChart();
}

function getAxisColor(axis) {
    const colors = {
        x: '#00d4ff',
        y: '#7c3aed',
        z: '#10b981'
    };
    return colors[axis] || '#00d4ff';
}

function updateChartData(vibX, vibY, vibZ) {
    // Add new data points
    chartData.x.push(parseFloat(vibX));
    chartData.y.push(parseFloat(vibY));
    chartData.z.push(parseFloat(vibZ));

    // Keep only the last maxDataPoints
    if (chartData.x.length > maxDataPoints) {
        chartData.x.shift();
        chartData.y.shift();
        chartData.z.shift();
    }

    // Update chart if it exists
    if (vibrationChart) {
        vibrationChart.data.datasets[0].data = chartData[currentAxis];
        vibrationChart.update('none');
    }
}

function initVibrationChart() {
    const ctx = document.getElementById('vibrationChart');
    if (!ctx) return;

    vibrationChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array(maxDataPoints).fill(''),
            datasets: [{
                label: `Vibrasi ${currentAxis.toUpperCase()} (m/s²)`,
                data: chartData[currentAxis],
                borderColor: getAxisColor(currentAxis),
                backgroundColor: getAxisColor(currentAxis) + '33',
                fill: true,
                tension: 0.4,
                pointRadius: 2,
                pointHoverRadius: 4,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: '#94a3b8',
                        font: {
                            size: 10
                        }
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        display: false
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: '#f1f5f9',
                        font: {
                            size: 11
                        },
                        boxWidth: 12
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            },
            animation: {
                duration: 0
            }
        }
    });
}

// ===== ALERTS =====
let lastAlertTime = {
    tempWarning: 0,
    tempCritical: 0,
    vibWarning: 0,
    vibCritical: 0
};
const alertCooldown = 10000; // 10 seconds cooldown for same alert type

function checkForAlerts(temp, vibX, vibY, vibZ) {
    const now = Date.now();

    // Hitung magnitude vibrasi (RMS-like calculation)
    const vibMagnitude = Math.sqrt(vibX * vibX + vibY * vibY + vibZ * vibZ);

    // Check temperature alerts dengan threshold baru
    if (temp > THRESHOLDS.temp.critical) {
        if (!lastAlertTime.tempCritical || now - lastAlertTime.tempCritical > alertCooldown) {
            addAlert('critical', 'Suhu CRITICAL: ' + temp.toFixed(1) + '°C');
            lastAlertTime.tempCritical = now;
        }
    } else if (temp > THRESHOLDS.temp.warning) {
        if (!lastAlertTime.tempWarning || now - lastAlertTime.tempWarning > alertCooldown) {
            addAlert('warning', 'Suhu WARNING: ' + temp.toFixed(1) + '°C');
            lastAlertTime.tempWarning = now;
        }
    }

    // Check vibration alerts dengan threshold baru
    if (vibMagnitude > THRESHOLDS.vibration.critical) {
        if (!lastAlertTime.vibCritical || now - lastAlertTime.vibCritical > alertCooldown) {
            addAlert('critical', 'Vibrasi CRITICAL: ' + vibMagnitude.toFixed(2) + 'g');
            lastAlertTime.vibCritical = now;
        }
    } else if (vibMagnitude > THRESHOLDS.vibration.warning) {
        if (!lastAlertTime.vibWarning || now - lastAlertTime.vibWarning > alertCooldown) {
            addAlert('warning', 'Vibrasi WARNING: ' + vibMagnitude.toFixed(2) + 'g');
            lastAlertTime.vibWarning = now;
        }
    }
}

function clearAlerts() {
    const alertsList = document.getElementById('alertsList');
    alertsList.innerHTML = `
        <div class="no-alerts">
            <i class="fas fa-check-circle"></i>
            <p>Sistem berjalan normal</p>
        </div>
    `;
    lastAlertTime = {};
}

function addAlert(type, title) {
    const alertsList = document.getElementById('alertsList');

    // Remove no-alerts if present
    const noAlerts = alertsList.querySelector('.no-alerts');
    if (noAlerts) {
        noAlerts.remove();
    }

    const alertItem = document.createElement('div');
    alertItem.className = `alert-item ${type}`;

    let iconClass = 'exclamation-circle';
    if (type === 'danger' || type === 'critical') {
        iconClass = 'exclamation-triangle';
    }

    alertItem.innerHTML = `
        <div class="alert-icon">
            <i class="fas fa-${iconClass}"></i>
        </div>
        <div class="alert-content">
            <div class="alert-title">${title}</div>
            <div class="alert-time">${new Date().toLocaleTimeString('id-ID')}</div>
        </div>
        <button class="alert-dismiss" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;

    alertsList.insertBefore(alertItem, alertsList.firstChild);

    // Keep only the last 10 alerts
    while (alertsList.children.length > 10) {
        alertsList.removeChild(alertsList.lastChild);
    }
}

// ===== ALERT POPUP FUNCTIONS =====

// ===== CONNECTION STATUS =====
function updateConnectionStatus(status) {
    const connectionStatus = document.getElementById('connectionStatus');
    const statusDot = connectionStatus.querySelector('.status-dot');
    const statusText = connectionStatus.querySelector('.status-text');

    // Reset all classes
    connectionStatus.className = 'connection-status';
    statusDot.className = 'status-dot';

    switch (status) {
        case 'connected':
            connectionStatus.classList.add('connected');
            statusDot.classList.add('connected');
            statusText.textContent = 'Terhubung ke ESP32';
            statusText.style.color = 'var(--success)';
            break;
        case 'connecting':
            statusText.textContent = 'Menghubungkan...';
            statusText.style.color = 'var(--text-secondary)';
            break;
        case 'error':
        default:
            connectionStatus.classList.add('error');
            statusDot.classList.add('error');
            statusText.textContent = 'Terputus';
            statusText.style.color = 'var(--danger)';
            break;
    }
}

// Check connection status periodically
function checkConnectionStatus() {
    const now = Date.now();

    // Only check if we've received data before
    if (lastDataReceivedTime === 0) {
        // First time, no data yet - keep as connecting
        return;
    }

    if (!isConnected || (now - lastDataReceivedTime > CONNECTION_TIMEOUT)) {
        if (isConnected) {
            console.log('Connection timeout - no data received');
            isConnected = false;
        }
        updateConnectionStatus('error');
    } else if (isConnected) {
        // Make sure status is connected if we have recent data
        updateConnectionStatus('connected');
    }
}

// Start connection check interval
setInterval(checkConnectionStatus, 2000); // Check every 2 seconds

function handleAlertMessage(alertData) {
    console.log('Alert received:', alertData);

    const status = alertData.status;
    const temp = alertData.temp || 0;
    const vibration = alertData.vibration || 0;

    // Determine alert type from status
    if (status === 'critical' || status === 'warning') {
        // Show popup alert
        showAlertPopupFromMQTT(status, temp, vibration);
    }
}

function showAlertPopupFromMQTT(status, temp, vibration) {
    const now = Date.now();

    // Check cooldown
    if (now - lastPopupTime < POPUP_COOLDOWN) {
        return;
    }
    lastPopupTime = now;

    const popup = document.getElementById('alertPopup');
    const popupTitle = document.getElementById('alertPopupTitle');
    const popupMessage = document.getElementById('alertPopupMessage');
    const popupTemp = document.getElementById('popupTemp');
    const popupVib = document.getElementById('popupVib');

    // Set content berdasarkan tipe alert
    popup.className = 'alert-popup show ' + status;

    if (status === 'critical') {
        popupTitle.textContent = '⚠️ CRITICAL ALERT';

        // Tentukan penyebab critical
        let causes = [];
        if (temp > THRESHOLDS.temp.critical) {
            causes.push('Suhu mesin berbahaya!');
        }
        if (vibration > THRESHOLDS.vibration.critical) {
            causes.push('Vibrasi berlebihan!');
        }

        popupMessage.textContent = causes.length > 0 ? causes.join(' ') : 'Mesin dalam kondisi CRITICAL!';
    } else {
        popupTitle.textContent = '⚠️ WARNING';

        // Tentukan penyebab warning
        let causes = [];
        if (temp > THRESHOLDS.temp.warning) {
            causes.push('Suhu meningkat');
        }
        if (vibration > THRESHOLDS.vibration.warning) {
            causes.push('Vibrasi tinggi');
        }

        popupMessage.textContent = causes.length > 0 ? causes.join(' & ') : 'Perhatikan mesin!';
    }

    // Update nilai
    popupTemp.textContent = temp.toFixed(1) + '°C';
    popupVib.textContent = vibration.toFixed(2) + 'g';

    // Play sound
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        if (status === 'critical') {
            // Triple beep for critical
            oscillator.frequency.value = 1000;
            gainNode.gain.value = 0.3;

            const now = audioCtx.currentTime;
            oscillator.start(now);
            oscillator.stop(now + 0.1);
            setTimeout(() => {
                const osc2 = audioCtx.createOscillator();
                const gain2 = audioCtx.createGain();
                osc2.connect(gain2);
                gain2.connect(audioCtx.destination);
                osc2.frequency.value = 1000;
                gain2.gain.value = 0.3;
                osc2.start(audioCtx.currentTime);
                osc2.stop(audioCtx.currentTime + 0.1);
            }, 150);
            setTimeout(() => {
                const osc3 = audioCtx.createOscillator();
                const gain3 = audioCtx.createGain();
                osc3.connect(gain3);
                gain3.connect(audioCtx.destination);
                osc3.frequency.value = 1000;
                gain3.gain.value = 0.3;
                osc3.start(audioCtx.currentTime);
                osc3.stop(audioCtx.currentTime + 0.1);
            }, 300);
        } else {
            // Single beep for warning
            oscillator.frequency.value = 800;
            gainNode.gain.value = 0.2;
            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + 0.15);
        }
    } catch (e) {
        console.log('Audio not supported or blocked:', e);
    }
}

function showAlertPopup(type, temp, vibX, vibY, vibZ) {
    const now = Date.now();

    // Check cooldown
    if (now - lastPopupTime < POPUP_COOLDOWN) {
        return;
    }
    lastPopupTime = now;

    const popup = document.getElementById('alertPopup');
    const popupTitle = document.getElementById('alertPopupTitle');
    const popupMessage = document.getElementById('alertPopupMessage');
    const popupTemp = document.getElementById('popupTemp');
    const popupVib = document.getElementById('popupVib');

    // Hitung magnitude vibrasi
    const vibMagnitude = Math.sqrt(vibX * vibX + vibY * vibY + vibZ * vibZ);

    // Set content berdasarkan tipe alert
    popup.className = 'alert-popup show ' + type;

    if (type === 'critical') {
        popupTitle.textContent = '⚠️ CRITICAL ALERT';

        // Tentukan penyebab critical
        let causes = [];
        if (temp > THRESHOLDS.temp.critical) {
            causes.push('Suhu mesin berbahaya!');
        }
        if (vibMagnitude > THRESHOLDS.vibration.critical) {
            causes.push('Vibrasi berlebihan!');
        }

        popupMessage.textContent = causes.length > 0 ? causes.join(' ') : 'Mesin dalam kondisi CRITICAL!';
    } else {
        popupTitle.textContent = '⚠️ WARNING';

        // Tentukan penyebab warning
        let causes = [];
        if (temp > THRESHOLDS.temp.warning) {
            causes.push('Suhu meningkat');
        }
        if (vibMagnitude > THRESHOLDS.vibration.warning) {
            causes.push('Vibrasi tinggi');
        }

        popupMessage.textContent = causes.length > 0 ? causes.join(' & ') : 'Perhatikan mesin!';
    }

    // Update nilai
    popupTemp.textContent = temp.toFixed(1) + '°C';
    popupVib.textContent = vibMagnitude.toFixed(2) + 'g';

    // Play sound if supported (optional - browser may block without user interaction)
    try {
        // Create audio context for beep sound
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        if (type === 'critical') {
            // Triple beep for critical
            oscillator.frequency.value = 1000;
            gainNode.gain.value = 0.3;

            const now = audioCtx.currentTime;
            oscillator.start(now);
            oscillator.stop(now + 0.1);
            setTimeout(() => {
                const osc2 = audioCtx.createOscillator();
                const gain2 = audioCtx.createGain();
                osc2.connect(gain2);
                gain2.connect(audioCtx.destination);
                osc2.frequency.value = 1000;
                gain2.gain.value = 0.3;
                osc2.start(audioCtx.currentTime);
                osc2.stop(audioCtx.currentTime + 0.1);
            }, 150);
            setTimeout(() => {
                const osc3 = audioCtx.createOscillator();
                const gain3 = audioCtx.createGain();
                osc3.connect(gain3);
                gain3.connect(audioCtx.destination);
                osc3.frequency.value = 1000;
                gain3.gain.value = 0.3;
                osc3.start(audioCtx.currentTime);
                osc3.stop(audioCtx.currentTime + 0.1);
            }, 300);
        } else {
            // Single beep for warning
            oscillator.frequency.value = 800;
            gainNode.gain.value = 0.2;
            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + 0.15);
        }
    } catch (e) {
        console.log('Audio not supported or blocked:', e);
    }
}

function closeAlertPopup() {
    const popup = document.getElementById('alertPopup');
    popup.classList.remove('show');
    popup.classList.remove('warning');
    popup.classList.remove('critical');
}

// Close popup when clicking outside
document.addEventListener('click', (e) => {
    const popup = document.getElementById('alertPopup');
    if (popup.classList.contains('show')) {
        if (e.target === popup) {
            closeAlertPopup();
        }
    }
});

// Close popup with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeAlertPopup();
    }
});
