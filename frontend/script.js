const API_BASE = 'https://your-render-app.onrender.com'; // Replace with your Render URL
const FRONTEND_BASE = 'https://yourusername.github.io/cosmic-uploads'; // Replace with your GitHub Pages URL

const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const progressSection = document.getElementById('progressSection');
const resultSection = document.getElementById('resultSection');
const errorSection = document.getElementById('errorSection');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

// File upload handling
uploadZone.addEventListener('click', () => {
    fileInput.click();
});

uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
});

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        uploadFile(files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        uploadFile(e.target.files[0]);
    }
});

function uploadFile(file) {
    // Check file size (1GB limit)
    const maxSize = 1024 * 1024 * 1024; // 1GB
    if (file.size > maxSize) {
        showError('File size exceeds 1GB limit');
        return;
    }

    // Show progress
    uploadZone.style.display = 'none';
    progressSection.style.display = 'block';

    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();

    // Progress tracking
    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
            const percentComplete = (e.loaded / e.total) * 100;
            progressFill.style.width = percentComplete + '%';
            progressText.textContent = `Uploading... ${Math.round(percentComplete)}%`;
        }
    });

    // Upload complete
    xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
            const response = JSON.parse(xhr.responseText);
            showSuccess(response);
        } else {
            try {
                const error = JSON.parse(xhr.responseText);
                showError(error.error || 'Upload failed');
            } catch (e) {
                showError('Upload failed - Server error');
            }
        }
    });

    // Upload error
    xhr.addEventListener('error', () => {
        showError('Network error occurred - Please check your connection');
    });

    // Upload timeout
    xhr.addEventListener('timeout', () => {
        showError('Upload timed out - Please try again');
    });

    // Set timeout (10 minutes for large files)
    xhr.timeout = 600000;

    // Send request
    xhr.open('POST', `${API_BASE}/api/upload`);
    xhr.send(formData);
}

function showSuccess(response) {
    progressSection.style.display = 'none';
    resultSection.style.display = 'block';

    const fileId = response.fileId;
    const expiresAt = new Date(response.expiresAt).toLocaleString();

    document.getElementById('fileId').textContent = fileId;
    document.getElementById('expiresAt').textContent = expiresAt;
    document.getElementById('shareLink').value = `${FRONTEND_BASE}/file.html?id=${fileId}`;
    document.getElementById('downloadLink').value = `${FRONTEND_BASE}/download.html?id=${fileId}`;
}

function showError(message) {
    uploadZone.style.display = 'none';
    progressSection.style.display = 'none';
    errorSection.style.display = 'block';
    document.getElementById('errorText').textContent = message;
}

function resetUpload() {
    uploadZone.style.display = 'block';
    progressSection.style.display = 'none';
    resultSection.style.display = 'none';
    errorSection.style.display = 'none';
    progressFill.style.width = '0%';
    progressText.textContent = 'Uploading...';
    fileInput.value = '';
}

function copyLink(inputId) {
    const input = document.getElementById(inputId);
    input.select();
    input.setSelectionRange(0, 99999); // For mobile devices

    // Modern clipboard API with fallback
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(input.value).then(() => {
            showCopyFeedback(input);
        }).catch(() => {
            fallbackCopyTextToClipboard(input.value, input);
        });
    } else {
        fallbackCopyTextToClipboard(input.value, input);
    }
}

function fallbackCopyTextToClipboard(text, input) {
    try {
        document.execCommand('copy');
        showCopyFeedback(input);
    } catch (err) {
        console.error('Copy failed:', err);
        // Show manual copy instruction
        alert('Please manually copy the link: ' + text);
    }
}

function showCopyFeedback(input) {
    const button = input.nextElementSibling;
    const originalText = button.textContent;
    button.textContent = 'Copied!';
    button.style.background = '#4CAF50';

    setTimeout(() => {
        button.textContent = originalText;
        button.style.background = '';
    }, 2000);
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    // Check if API is reachable
    fetch(`${API_BASE}/api/health`)
    .then(response => {
        if (!response.ok) {
            console.warn('Backend API may not be available');
        }
    })
    .catch(error => {
        console.warn('Backend API connection failed:', error);
    });
});
