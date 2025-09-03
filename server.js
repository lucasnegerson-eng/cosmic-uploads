const express = require('express');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || 'https://yourusername.github.io',
    credentials: true
}));

app.use(express.json());

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdir(uploadsDir, { recursive: true }).catch(console.error);

// File storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const fileId = crypto.randomBytes(16).toString('hex');
        const ext = path.extname(file.originalname);
        cb(null, `${fileId}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 1024 * 1024 * 1024 // 1GB limit
    },
    fileFilter: (req, file, cb) => {
        // Allow all file types
        cb(null, true);
    }
});

// File metadata storage (in-memory for simplicity)
const fileMetadata = new Map();

// Helper function to clean expired files
const cleanExpiredFiles = async () => {
    const now = Date.now();
    const expiredFiles = [];

    for (const [fileId, metadata] of fileMetadata.entries()) {
        if (now - metadata.uploadTime > 24 * 60 * 60 * 1000) { // 24 hours
            expiredFiles.push(fileId);
        }
    }

    for (const fileId of expiredFiles) {
        try {
            const metadata = fileMetadata.get(fileId);
            await fs.unlink(metadata.filePath);
            fileMetadata.delete(fileId);
            console.log(`Deleted expired file: ${fileId}`);
        } catch (error) {
            console.error(`Error deleting expired file ${fileId}:`, error);
        }
    }
};

// Helper function to manage storage capacity
const manageStorageCapacity = async () => {
    const MAX_STORAGE = 5 * 1024 * 1024 * 1024; // 5GB total storage

    // Calculate total storage used
    let totalSize = 0;
    const files = Array.from(fileMetadata.entries())
    .map(([id, metadata]) => ({ id, ...metadata }))
    .sort((a, b) => a.uploadTime - b.uploadTime); // Oldest first

    for (const file of files) {
        totalSize += file.size;
    }

    // Delete oldest files if over capacity
    while (totalSize > MAX_STORAGE && files.length > 0) {
        const oldestFile = files.shift();
        try {
            await fs.unlink(oldestFile.filePath);
            fileMetadata.delete(oldestFile.id);
            totalSize -= oldestFile.size;
            console.log(`Deleted file due to storage limit: ${oldestFile.id}`);
        } catch (error) {
            console.error(`Error deleting file ${oldestFile.id}:`, error);
        }
    }
};

// Clean expired files every hour
setInterval(cleanExpiredFiles, 60 * 60 * 1000);
// Manage storage capacity every 10 minutes
setInterval(manageStorageCapacity, 10 * 60 * 1000);

// Upload endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const fileId = path.basename(req.file.filename, path.extname(req.file.filename));
        const metadata = {
            originalName: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype,
            uploadTime: Date.now(),
         filePath: req.file.path,
         filename: req.file.filename
        };

        fileMetadata.set(fileId, metadata);

        // Manage storage after upload
        await manageStorageCapacity();

        res.json({
            fileId: fileId,
            message: 'File uploaded successfully',
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// Get file metadata
app.get('/api/file/:fileId', (req, res) => {
    const { fileId } = req.params;
    const metadata = fileMetadata.get(fileId);

    if (!metadata) {
        return res.status(404).json({ error: 'File not found' });
    }

    // Check if file has expired
    if (Date.now() - metadata.uploadTime > 24 * 60 * 60 * 1000) {
        fileMetadata.delete(fileId);
        fs.unlink(metadata.filePath).catch(console.error);
        return res.status(404).json({ error: 'File has expired' });
    }

    res.json({
        fileId: fileId,
        originalName: metadata.originalName,
        size: metadata.size,
        mimetype: metadata.mimetype,
        uploadTime: metadata.uploadTime,
        expiresAt: new Date(metadata.uploadTime + 24 * 60 * 60 * 1000).toISOString()
    });
});

// Download file
app.get('/api/download/:fileId', async (req, res) => {
    try {
        const { fileId } = req.params;
        const metadata = fileMetadata.get(fileId);

        if (!metadata) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Check if file has expired
        if (Date.now() - metadata.uploadTime > 24 * 60 * 60 * 1000) {
            fileMetadata.delete(fileId);
            await fs.unlink(metadata.filePath).catch(console.error);
            return res.status(404).json({ error: 'File has expired' });
        }

        // Check if file exists on disk
        try {
            await fs.access(metadata.filePath);
        } catch (error) {
            fileMetadata.delete(fileId);
            return res.status(404).json({ error: 'File not found on disk' });
        }

        res.setHeader('Content-Disposition', `attachment; filename="${metadata.originalName}"`);
        res.setHeader('Content-Type', metadata.mimetype);
        res.sendFile(path.resolve(metadata.filePath));
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Download failed' });
    }
});

// Preview file (for supported types)
app.get('/api/preview/:fileId', async (req, res) => {
    try {
        const { fileId } = req.params;
        const metadata = fileMetadata.get(fileId);

        if (!metadata) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Check if file has expired
        if (Date.now() - metadata.uploadTime > 24 * 60 * 60 * 1000) {
            fileMetadata.delete(fileId);
            await fs.unlink(metadata.filePath).catch(console.error);
            return res.status(404).json({ error: 'File has expired' });
        }

        // Only allow preview for safe file types
        const previewableTypes = [
            'image/', 'text/', 'application/json', 'application/pdf'
        ];

        const isPreviewable = previewableTypes.some(type =>
        metadata.mimetype.startsWith(type)
        );

        if (!isPreviewable) {
            return res.status(400).json({ error: 'File type not previewable' });
        }

        res.setHeader('Content-Type', metadata.mimetype);
        res.sendFile(path.resolve(metadata.filePath));
    } catch (error) {
        console.error('Preview error:', error);
        res.status(500).json({ error: 'Preview failed' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`Cosmic Uploads backend running on port ${PORT}`);
    console.log('Cleaning expired files and managing storage...');
    cleanExpiredFiles();
    manageStorageCapacity();
});
