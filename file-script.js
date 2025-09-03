const API_BASE_FILE = 'https://your-render-app.onrender.com'; // Replace with your Render URL
const FRONTEND_BASE_FILE = 'https://lucasnegerson-eng.github.io/cosmic-uploads'; // Replace with your GitHub Pages URL

// Get file ID from URL
const urlParams = new URLSearchParams(window.location.search);
const fileId = urlParams.get('id');

const loading = document.getElementById('loading');
const fileInfoSection = document.getElementById('fileInfoSection');
const errorSection = document.getElementById('errorSection');

if (!fileId) {
    showError('No file ID provided in URL');
} else {
    loadFileInfo();
}

async function loadFileInfo() {
    try {
        const response = await fetch(`${API_BASE_FILE}/api/file/${fileId}`);

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Failed to load file' }));
            throw new Error(error.error || `HTTP ${response.status}: Failed to load file`);
        }

        const fileInfo = await response.json();
        displayFileInfo(fileInfo);
    } catch (error) {
        console.error('Error loading file:', error);
        showError(error.message || 'Failed to load file information');
    }
}

function displayFileInfo(fileInfo) {
    loading.style.display = 'none';
    fileInfoSection.style.display = 'block';

    // Update file information
    document.getElementById('fileName').textContent = fileInfo.originalName;
    document.getElementById('fileSize').textContent = formatFileSize(fileInfo.size);
    document.getElementById('uploadTime').textContent = formatDate(new Date(fileInfo.uploadTime));

    // Update expiry time with live countdown
    updateExpiryTime(new Date(fileInfo.expiresAt));

    // Set up sharing links
    document.getElementById('shareLink').value = `${FRONTEND_BASE_FILE}/file.html?id=${fileInfo.fileId}`;
    document.getElementById('downloadLink').value = `${API_BASE_FILE}/api/download/${fileInfo.fileId}`;

    // Load preview if supported
    loadPreview(fileInfo);

    // Store file info for download
    window.currentFileInfo = fileInfo;

    // Start expiry countdown timer
    startExpiryCountdown(new Date(fileInfo.expiresAt));
}

function loadPreview(fileInfo) {
    const previewContainer = document.getElementById('filePreview');
    const mimetype = fileInfo.mimetype.toLowerCase();

    // Clear any existing content
    previewContainer.innerHTML = '';

    if (mimetype.startsWith('image/')) {
        loadImagePreview(previewContainer, fileInfo);
    } else if (mimetype.startsWith('text/') || mimetype === 'application/json') {
        loadTextPreview(previewContainer, fileInfo);
    } else if (mimetype === 'application/pdf') {
        showPreviewPlaceholder(previewContainer, '📋', 'PDF Document', 'Click download to view the PDF file');
    } else if (mimetype.startsWith('video/')) {
        loadVideoPreview(previewContainer, fileInfo);
    } else if (mimetype.startsWith('audio/')) {
        loadAudioPreview(previewContainer, fileInfo);
    } else {
        const icon = getFileIcon(mimetype);
        const fileType = getFileTypeDescription(mimetype);
        showPreviewPlaceholder(previewContainer, icon, fileType, 'Preview not available - Click download to open the file');
    }
}

function loadImagePreview(container, fileInfo) {
    const img = document.createElement('img');
    img.src = `${API_BASE_FILE}/api/preview/${fileInfo.fileId}`;
    img.alt = fileInfo.originalName;
    img.style.cssText = 'max-width: 100%; max-height: 500px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.3);';

    img.onload = () => {
        container.appendChild(img);
    };

    img.onerror = () => {
        showPreviewPlaceholder(container, '🖼️', 'Image File', 'Image preview not available');
    };

    // Show loading state
    container.innerHTML = '<div class="preview-loading">Loading image...</div>';
}

function loadTextPreview(container, fileInfo) {
    // Show loading state
    container.innerHTML = '<div class="preview-loading">Loading text preview...</div>';

    fetch(`${API_BASE_FILE}/api/preview/${fileInfo.fileId}`)
    .then(response => {
        if (!response.ok) throw new Error('Preview not available');
        return response.text();
    })
    .then(text => {
        const pre = document.createElement('pre');
        pre.style.cssText = `
        white-space: pre-wrap;
        word-wrap: break-word;
        padding: 20px;
        margin: 0;
        font-family: 'Courier New', monospace;
        font-size: 0.9em;
        max-height: 400px;
        overflow-y: auto;
        background: #1a1a1a;
        border-radius: 8px;
        border: 1px solid #333;
        `;

        // Truncate very long text files
        const maxLength = 5000;
        if (text.length > maxLength) {
            pre.textContent = text.substring(0, maxLength) + '\n\n[Content truncated - Download to view full file]';
        } else {
            pre.textContent = text;
        }

        container.innerHTML = '';
        container.appendChild(pre);
    })
    .catch(() => {
        showPreviewPlaceholder(container, '📄', 'Text File', 'Text preview not available');
    });
}

function loadVideoPreview(container, fileInfo) {
    const video = document.createElement('video');
    video.src = `${API_BASE_FILE}/api/preview/${fileInfo.fileId}`;
    video.controls = true;
    video.style.cssText = 'max-width: 100%; max-height: 400px; border-radius: 8px;';
    video.preload = 'metadata';

    video.onerror = () => {
        showPreviewPlaceholder(container, '🎥', 'Video File', 'Video preview not available');
    };

    container.appendChild(video);
}

function loadAudioPreview(container, fileInfo) {
    const audio = document.createElement('audio');
    audio.src = `${API_BASE_FILE}/api/preview/${fileInfo.fileId}`;
    audio.controls = true;
    audio.style.cssText = 'width: 100%; margin: 20px 0;';
    audio.preload = 'metadata';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'text-align: center; padding: 40px;';
    wrapper.innerHTML = '<div style="font-size: 3em; margin-bottom: 20px;">🎵</div>';
    wrapper.appendChild(audio);

    audio.onerror = () => {
        showPreviewPlaceholder(container, '🎵', 'Audio File', 'Audio preview not available');
    };

    container.appendChild(wrapper);
}

function showPreviewPlaceholder(container, icon, title, message) {
    container.innerHTML = `
    <div class="preview-placeholder">
    <div class="icon" style="font-size: 4em; margin-bottom: 20px; opacity: 0.7;">${icon}</div>
    <h3 style="margin-bottom: 10px; color: #cccccc;">${title}</h3>
    <p style="color: #888888;">${message}</p>
    </div>
    `;
}

function getFileIcon(mimetype) {
    if (mimetype.includes('video')) return '🎥';
    if (mimetype.includes('audio')) return '🎵';
    if (mimetype.includes('image')) return '🖼️';
    if (mimetype.includes('archive') || mimetype.includes('zip') || mimetype.includes('rar')) return '🗜️';
    if (mimetype.includes('pdf')) return '📋';
    if (mimetype.includes('word') || mimetype.includes('document')) return '📝';
    if (mimetype.includes('spreadsheet') || mimetype.includes('excel')) return '📊';
    if (mimetype.includes('presentation') || mimetype.includes('powerpoint')) return '📈';
    if (mimetype.includes('code') || mimetype.includes('javascript') || mimetype.includes('python')) return '💻';
    return '📄';
}

function getFileTypeDescription(mimetype) {
    if (mimetype.includes('video')) return 'Video File';
    if (mimetype.includes('audio')) return 'Audio File';
    if (mimetype.includes('image')) return 'Image File';
    if (mimetype.includes('pdf')) return 'PDF Document';
    if (mimetype.includes('word')) return 'Word Document';
    if (mimetype.includes('excel')) return 'Excel Spreadsheet';
    if (mimetype.includes('powerpoint')) return 'PowerPoint Presentation';
    if (mimetype.includes('zip') || mimetype.includes('rar')) return 'Archive File';
    if (mimetype.includes('text')) return 'Text File';
    return 'File';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(date) {
    const options = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    };
    return date.toLocaleDateString('en-US', options);
}

function updateExpiryTime(expiryDate) {
    const element = document.getElementById('expiresIn');
    const now = new Date();
    const diff = expiryDate - now;

    if (diff <= 0) {
        element.textContent = 'Expired';
        element.style.color = '#ff6b6b';
        return;
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    if (hours > 0) {
        element.textContent = `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
        element.textContent = `${minutes}m ${seconds}s`;
    } else {
        element.textContent = `${seconds}s`;
    }

    // Color coding based on time remaining
    if (diff < 3600000) { // Less than 1 hour
        element.style.color = '#ff9800';
    } else if (diff < 7200000) { // Less than 2 hours
        element.style.color = '#ffeb3b';
    } else {
        element.style.color = '#4caf50';
    }
}

function startExpiryCountdown(expiryDate) {
    // Update immediately
    updateExpiryTime(expiryDate);

    // Update every second
    const interval = setInterval(() => {
        updateExpiryTime(expiryDate);

        // Stop countdown if expired
        if (new Date() >= expiryDate) {
            clearInterval(interval);
            // Optionally show expired message
            setTimeout(() => {
                showError('This file has expired and is no longer available.');
            }, 1000);
        }
    }, 1000);
}

function showError(message) {
    loading.style.display = 'none';
    fileInfoSection.style.display = 'none';
    errorSection.style.display = 'block';
    document.getElementById('errorText').textContent = message;
}

function downloadFile() {
    if (window.currentFileInfo) {
        // Create a temporary link to trigger download
        const link = document.createElement('a');
        link.href = `${API_BASE_FILE}/api/download/${window.currentFileInfo.fileId}`;
        link.download = window.currentFileInfo.originalName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

function shareFile() {
    const shareSection = document.getElementById('shareSection');
    const isVisible = shareSection.style.display !== 'none';
    shareSection.style.display = isVisible ? 'none' : 'block';

    // Update button text
    const shareBtn = document.querySelector('.share-btn span');
    shareBtn.textContent = isVisible ? '🔗 Share' : '❌ Hide';
}

function copyLink(inputId) {
    const input = document.getElementById(inputId);
    input.select();
    input.setSelectionRange(0, 99999);

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

// Initialize file page
document.addEventListener('DOMContentLoaded', () => {
    // Add some CSS for preview loading state
    const style = document.createElement('style');
    style.textContent = `
    .preview-loading {
        text-align: center;
        padding: 40px;
        color: #888888;
        font-style: italic;
    }

    .preview-placeholder {
        text-align: center;
        padding: 40px;
        color: #888888;
    }

    .file-preview pre::-webkit-scrollbar {
        width: 8px;
    }

    .file-preview pre::-webkit-scrollbar-track {
        background: #2a2a2a;
        border-radius: 4px;
    }

    .file-preview pre::-webkit-scrollbar-thumb {
        background: #555;
        border-radius: 4px;
    }

    .file-preview pre::-webkit-scrollbar-thumb:hover {
        background: #777;
    }
    `;
    document.head.appendChild(style);
});
